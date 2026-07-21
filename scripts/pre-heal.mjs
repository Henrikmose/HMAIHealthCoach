// scripts/pre-heal.mjs — CURA-SPEC-self-heal-v3.1 §8: one-time pre-heal.
//
// Runs the §8.1 seed phrases through the SAME Opus selector + gates as the
// runtime system, writing keywords with healed_via='pre_heal'. Eliminates
// first-user Opus hops on obvious words. Idempotent: owned phrases are
// skipped, so re-running is always safe.
//
// USAGE (terminal, with env exported in THIS window):
//   node scripts/pre-heal.mjs --dry     # preview: no writes at all
//   node scripts/pre-heal.mjs --run     # real writes
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MODE = process.argv[2];
if (MODE !== "--dry" && MODE !== "--run") {
  console.log("Usage: node scripts/pre-heal.mjs --dry | --run");
  process.exit(1);
}
const DRY = MODE === "--dry";

for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) { console.log(`Missing env: ${v}`); process.exit(1); }
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OPUS_MODEL = "claude-opus-4-8";

// Same canonical as script v3 / self-heal.js kwCanon — duplicated on purpose
// (scripts don't import from app/): ies -> y, else strip one trailing s.
const kwCanon = (p) => {
  p = (p || "").toLowerCase().trim();
  return p.endsWith("ies") ? p.slice(0, -3) + "y" : p.replace(/s$/, "");
};

// Same brand gate as route.js v113.
const BRAND_WL = new Set(["USDA", "BBQ"]);
const gateBranded = (rows, term) => {
  const t = (term || "").toLowerCase();
  return (rows || []).filter((r) => {
    const name = r.name || "";
    if (/\brestaurant\b/i.test(name) && !/\brestaurant\b/.test(t)) return false;
    const toks = (name.match(/[A-Z]{3,}/g) || []).filter((x) => !BRAND_WL.has(x));
    return toks.length === 0 || toks.some((x) => t.includes(x.toLowerCase()));
  });
};

// §8.1 seed list, verbatim from the spec.
const PHRASES = [
  "oyster","shrimp","scallop","crab","lobster","clam","mussel",
  "salmon","tuna","cod","tilapia","halibut","sardine",
  "pork chop","pork loin","pork tenderloin","bacon","ham","sausage",
  "ground beef","steak","ribeye","sirloin","filet mignon","flank steak",
  "brisket","meatball","ground turkey","turkey breast","turkey",
  "chicken","chicken breast","chicken thigh","chicken wing","drumstick",
  "egg","scrambled egg","hard boiled egg","fried egg","omelet",
  "rice","white rice","brown rice","quinoa","oatmeal","pasta",
  "spaghetti","noodle","bread","toast","bagel","tortilla",
  "potato","sweet potato","french fries","mashed potato",
  "broccoli","spinach","kale","lettuce","cucumber","tomato",
  "onion","carrot","mushroom","avocado","corn","green bean",
  "apple","banana","orange","strawberry","blueberry","grape",
  "milk","yogurt","greek yogurt","cheese","cottage cheese","butter",
  "peanut butter","almond","walnut","protein shake","protein powder",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function candidatesFor(phrase) {
  // Curated tier only — pre-heal assigns owners among curated rows (§7 gate 3
  // would refuse ai_estimate anyway, so don't waste pool slots on them).
  const mk = () => supabase.from("foods")
    .select("id, name, source").eq("active", true)
    .or("source.neq.ai_estimate,source.is.null");
  const pool = [];
  const push = (rows) => { for (const r of gateBranded(rows, phrase)) if (!pool.some((p) => p.id === r.id)) pool.push(r); };
  const { data: s } = await mk().ilike("name", `${phrase}%`).order("name").limit(20);
  push(s);
  const { data: sp } = await mk().ilike("name", `${phrase}s%`).order("name").limit(20);
  push(sp);
  const { data: f } = await mk().textSearch("name", phrase.split(" ").join(" & "), { type: "websearch" }).limit(20);
  push(f);
  if (phrase.length >= 5) {
    const { data: c } = await mk().ilike("name", `%${phrase}%`).order("name").limit(20);
    push(c);
  }
  return pool.slice(0, 10);
}

function tolerantParse(text) {
  let t = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function opusSelect(phrase, candidates) {
  const prompt = `User logged the food term: "${phrase}"

Which ONE of these database rows is what they mean?

Rules:
- The row must BE the food, not merely contain the word
  (an "emu oyster cut" is NOT an oyster).
- Prefer cooked/plain over raw/processed.
- Prefer lean+fat (red meat) / meat-only (poultry) over separated cuts.
- Prefer without-salt over with-salt; fresh over frozen/breaded/canned.
- Prefer generic over brand-specific unless the brand was named.
- If NONE of these rows genuinely IS this food, return null.

Candidates:
${JSON.stringify(candidates.map((r) => ({ id: r.id, name: r.name })))}

Reply ONLY with JSON:
{"id": <id or null>, "confidence": "high"|"medium"|"low", "reasoning": "<one sentence>"}`;
  try {
    const resp = await anthropic.messages.create(
      { model: OPUS_MODEL, max_tokens: 300, messages: [{ role: "user", content: prompt }] },
      { timeout: 20000, maxRetries: 1 } // batch context: more patient than runtime
    );
    return tolerantParse(resp?.content?.find((b) => b.type === "text")?.text || "");
  } catch (e) {
    console.log(`  [pre-heal] selector_failed: ${e.message}`);
    return null;
  }
}

let wrote = 0, skippedOwned = 0, refused = 0, nulls = 0, noCands = 0;

for (const raw of PHRASES) {
  const phrase = kwCanon(raw);
  // Skip if owned (idempotency + one-phrase-one-row).
  const { data: owners, error: ownErr } = await supabase.from("foods")
    .select("id, name").contains("keywords", [phrase]).eq("active", true).limit(1);
  if (ownErr) { console.log(`"${phrase}": uniqueness check error (${ownErr.message}) — skipped`); continue; }
  if (owners && owners.length > 0) {
    console.log(`"${phrase}": already owned by ${owners[0].id} (${owners[0].name.slice(0, 50)}) — skip`);
    skippedOwned++;
    continue;
  }
  const cands = await candidatesFor(phrase);
  if (cands.length === 0) { console.log(`"${phrase}": NO candidates — skip`); noCands++; continue; }
  const sel = await opusSelect(phrase, cands);
  if (!sel || sel.id == null) {
    console.log(`"${phrase}": selector null (${sel?.reasoning || "failed"})`);
    nulls++;
    await sleep(300);
    continue;
  }
  const conf = (sel.confidence || "low").toLowerCase();
  const row = cands.find((c) => c.id === sel.id);
  if (!row) { console.log(`"${phrase}": REFUSED invalid_id ${sel.id}`); refused++; await sleep(300); continue; }
  if (conf !== "high" && conf !== "medium") {
    console.log(`"${phrase}": REFUSED low_confidence (${sel.reasoning})`);
    refused++;
    await sleep(300);
    continue;
  }
  if (DRY) {
    console.log(`"${phrase}": WOULD WRITE -> ${row.id} (${conf}) ${row.name.slice(0, 60)}`);
    wrote++;
    await sleep(300);
    continue;
  }
  // WRITE — re-fetch keywords fresh, append, upsert keyword_misses.
  const { data: live } = await supabase.from("foods").select("keywords").eq("id", row.id).maybeSingle();
  const kws = [...new Set([...(live?.keywords || []), phrase])];
  const { error: kwErr } = await supabase.from("foods").update({ keywords: kws }).eq("id", row.id);
  if (kwErr) { console.log(`"${phrase}": WRITE ERROR ${kwErr.message}`); refused++; continue; }
  await supabase.from("keyword_misses").upsert({
    term: phrase,
    healed_food_id: row.id,
    healed_at: new Date().toISOString(),
    healed_via: "pre_heal",
    healed_metadata: { model: OPUS_MODEL, confidence: conf, reasoning: sel.reasoning, candidate_ids: cands.map((c) => c.id) },
  }, { onConflict: "term" });
  console.log(`"${phrase}": WROTE -> ${row.id} (${conf}) ${row.name.slice(0, 60)}`);
  wrote++;
  await sleep(300);
}

console.log(`\n=== PRE-HEAL ${DRY ? "DRY RUN" : "COMPLETE"} ===`);
console.log(`${DRY ? "would write" : "wrote"}: ${wrote} | already owned: ${skippedOwned} | selector null: ${nulls} | refused: ${refused} | no candidates: ${noCands}`);