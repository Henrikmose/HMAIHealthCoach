import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ═══ [v105] TAG BACKFILL — one-time admin route ═══════════════════════════════
// Classifies foods that have NO diet_compatibility tags yet (the ~129 AI-cached
// foods added after the USDA import). Open /api/backfill-tags in a browser
// repeatedly until it reports remaining: 0. Batches of 25, ~one Haiku call each.
// Safe to re-run: it only ever selects foods that still lack diet tags.
// NOTE: unauthenticated admin route — acceptable pre-launch, remove or protect
// it during the auth phase.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DIET_TAG_KEYS = ["vegan","vegetarian","pescatarian","dairy_free","gluten_free","nut_free","halal","kosher",
  "keto_friendly","paleo","mediterranean","low_fodmap","low_carb","pork_free","shellfish_free","egg_free","soy_free","fish_free"];

export async function GET() {
  try {
    // 1) Which foods already have diet tags?
    const { data: taggedRows, error: tagErr } = await supabase
      .from("food_tags")
      .select("food_id, tags!inner(category)")
      .eq("tags.category", "diet_compatibility");
    if (tagErr) return Response.json({ success: false, step: "read tagged", error: tagErr.message }, { status: 500 });
    const taggedIds = new Set((taggedRows || []).map(r => r.food_id));

    // 2) All foods; the untagged remainder is our work queue
    const { data: allFoods, error: foodErr } = await supabase.from("foods").select("id, name");
    if (foodErr) return Response.json({ success: false, step: "read foods", error: foodErr.message }, { status: 500 });
    const untagged = (allFoods || []).filter(f => !taggedIds.has(f.id));

    if (untagged.length === 0) {
      return Response.json({ success: true, classified: 0, remaining: 0, message: "All foods have diet tags. Backfill complete." });
    }

    const batch = untagged.slice(0, 25);

    // 3) Classify the batch with one Haiku call
    const prompt = `Classify each food for dietary compatibility. For each, list which of these tags TRULY apply (positive compatibility — only include a tag if the food definitely complies):
${DIET_TAG_KEYS.join(", ")}

Rules: vegan = no animal products at all. vegetarian = no meat/fish (dairy/egg ok). pescatarian = no meat except fish/seafood. X_free tags = definitely contains no X. Do NOT include halal/kosher for meat unless certified. When unsure about a tag, OMIT it.

Foods:
${batch.map(f => `id ${f.id}: ${f.name}`).join("\n")}

Respond with ONLY a JSON array, no prose:
[{"id": <id>, "tags": ["vegan","dairy_free"]}]`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (response.content || []).map(c => (c.type === "text" ? c.text : "")).join("");
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return Response.json({ success: false, step: "parse", error: "no JSON in model reply" }, { status: 500 });
    const parsed = JSON.parse(jsonMatch[0]);

    // 4) Map tag keys -> ids, insert
    const { data: tagRows } = await supabase.from("tags").select("id, tag_key")
      .eq("category", "diet_compatibility").eq("is_active", true);
    const tagIdMap = new Map((tagRows || []).map(t => [t.tag_key, t.id]));

    const inserts = [];
    let classifiedCount = 0;
    const batchIds = new Set(batch.map(f => f.id));
    for (const entry of parsed) {
      if (entry?.id == null || !batchIds.has(entry.id)) continue;
      classifiedCount++;
      for (const k of (entry.tags || [])) {
        const tid = tagIdMap.get(k);
        if (tid && DIET_TAG_KEYS.includes(k)) {
          inserts.push({ food_id: entry.id, tag_id: tid, confidence: 0.8, source: "ai_backfill", reason: "AI diet classification (backfill)" });
        }
      }
    }
    if (inserts.length) {
      // [v105.1] idempotent write: dedupe the batch, and ignore any (food_id, tag_id)
      // pair that already exists — overlapping refreshes or duplicate model output
      // can never error again, reruns are always safe
      const seen = new Set();
      const unique = inserts.filter(i => {
        const k = `${i.food_id}:${i.tag_id}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
      const { error: insErr } = await supabase.from("food_tags")
        .upsert(unique, { onConflict: "food_id,tag_id", ignoreDuplicates: true });
      if (insErr) return Response.json({ success: false, step: "insert", error: insErr.message }, { status: 500 });
    }

    return Response.json({
      success: true,
      classified: classifiedCount,
      tagsWritten: inserts.length,
      remaining: untagged.length - batch.length,
      message: untagged.length - batch.length > 0 ? "Refresh to process the next batch." : "Backfill complete.",
    });
  } catch (e) {
    return Response.json({ success: false, error: e?.message || "backfill failed" }, { status: 500 });
  }
}