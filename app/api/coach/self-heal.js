// app/api/coach/self-heal.js
// [HEAL v1] Self-heal system for the keyword resolver — CURA-SPEC-self-heal-v3.1.
//
// Trigger: KEYWORD MISS at log time. One Opus call selects the right row from
// the scored-stage candidate pool; CODE serves the pick and (separately,
// gated) writes the permanent keyword. An owned phrase never fires again.
//
// SERVE vs WRITE are decoupled (spec §1):
//   - SERVE: any structurally valid selection (real id from the pool) is
//     served for THIS log, regardless of confidence or row eligibility.
//   - WRITE: only when ALL gates pass (§7): confidence >= medium, row active
//     AND curated, singularized phrase owned by NO active row.
//   - Only null / invalid / timeout falls to the AI-estimate path.
//
// Clients are passed in by route.js — this module creates none of its own.

const OPUS_MODEL = "claude-opus-4-8";
const SELECTOR_TIMEOUT_MS = 10000; // spec §5.1 — hard limit, user is waiting

// ── Canonical singularization — MUST match script v3's kwCanon exactly:
//    ies -> y, else strip one trailing s. Reuse, don't reinvent (spec §7).
export function kwCanon(phrase) {
  const p = (phrase || "").toLowerCase().trim();
  if (p.endsWith("ies")) return p.slice(0, -3) + "y";
  return p.replace(/s$/, "");
}

// ── §3 AMENDMENT: record EVERY miss, before the selector even runs.
// select-then-update (supabase-js cannot atomically increment via upsert).
export async function recordMiss(supabase, term) {
  try {
    const { data, error } = await supabase
      .from("keyword_misses")
      .select("miss_count, healed_food_id")
      .eq("term", term)
      .maybeSingle();
    if (error) {
      console.log(`[heal] miss-record read error for "${term}": ${error.message}`);
      return { alreadyHealed: false };
    }
    if (data) {
      const { error: upErr } = await supabase
        .from("keyword_misses")
        .update({ last_seen: new Date().toISOString(), miss_count: data.miss_count + 1 })
        .eq("term", term);
      if (upErr) console.log(`[heal] miss-record update error for "${term}": ${upErr.message}`);
      return { alreadyHealed: data.healed_food_id != null };
    }
    const { error: insErr } = await supabase.from("keyword_misses").insert({ term });
    if (insErr) console.log(`[heal] miss-record insert error for "${term}": ${insErr.message}`);
    return { alreadyHealed: false };
  } catch (e) {
    console.log(`[heal] miss-record exception for "${term}": ${e.message}`);
    return { alreadyHealed: false };
  }
}

// ── Format-tolerant JSON parse (spec §5.1): strip fences, slice outermost
// braces. Opus preamble broke strict parsing twice on Jul 17.
function tolerantParse(text) {
  if (!text) return null;
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── §5 The Opus selector call. Returns:
//   { id, confidence, reasoning }  — parsed selection (id may be null)
//   null                           — timeout / API error / unparseable (§6 -> AI path)
export async function opusSelect(anthropic, cleanTerm, candidates) {
  const list = candidates.map((r) => ({ id: r.id, name: r.name }));
  const prompt = `User logged the food term: "${cleanTerm}"

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
${JSON.stringify(list)}

Reply ONLY with JSON:
{"id": <id or null>, "confidence": "high"|"medium"|"low", "reasoning": "<one sentence>"}`;

  try {
    const resp = await anthropic.messages.create(
      {
        model: OPUS_MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: SELECTOR_TIMEOUT_MS, maxRetries: 0 }
    );
    const text = resp?.content?.find((b) => b.type === "text")?.text || "";
    const parsed = tolerantParse(text);
    if (!parsed || !("id" in parsed)) {
      console.log(`[heal] selector_failed: unparseable response for "${cleanTerm}"`);
      return null;
    }
    return {
      id: parsed.id,
      confidence: (parsed.confidence || "low").toLowerCase(),
      reasoning: parsed.reasoning || "",
    };
  } catch (e) {
    console.log(`[heal] selector_failed: ${e.message} for "${cleanTerm}"`);
    return null;
  }
}

// ── §7 Gated write. Code owns it; Opus only selected. All gates must pass.
// A refusal NEVER changes what was served.
async function gatedWrite(supabase, cleanTerm, selection, selectedRow, candidates) {
  const phrase = kwCanon(cleanTerm);

  // Gate 2: confidence
  if (selection.confidence !== "high" && selection.confidence !== "medium") {
    console.log(`[heal] refused: low_confidence — "${phrase}" not written (served anyway)`);
    return false;
  }

  // Gate 3: row eligibility — active AND curated (not ai_estimate)
  const src = (selectedRow.source || "").toLowerCase();
  if (src === "ai_estimate") {
    console.log(`[heal] refused: row_not_eligible (ai_estimate) — "${phrase}" not written (served anyway)`);
    return false;
  }
  // Candidates come from active-only stages, but verify against the DB —
  // never trust a stale in-memory flag for a permanent write.
  const { data: liveRow, error: rowErr } = await supabase
    .from("foods")
    .select("id, active, source, keywords")
    .eq("id", selectedRow.id)
    .maybeSingle();
  if (rowErr || !liveRow || liveRow.active !== true) {
    console.log(`[heal] refused: row_not_eligible (inactive/missing) — "${phrase}" not written (served anyway)`);
    return false;
  }
  const liveSrc = (liveRow.source || "").toLowerCase();
  if (liveSrc === "ai_estimate") {
    console.log(`[heal] refused: row_not_eligible (ai_estimate) — "${phrase}" not written (served anyway)`);
    return false;
  }

  // Gate 4: uniqueness — one-phrase-one-row is INVIOLABLE
  const { data: owners, error: ownErr } = await supabase
    .from("foods")
    .select("id, name")
    .contains("keywords", [phrase])
    .eq("active", true)
    .limit(1);
  if (ownErr) {
    console.log(`[heal] refused: uniqueness check error (${ownErr.message}) — "${phrase}" not written`);
    return false;
  }
  if (owners && owners.length > 0) {
    console.log(`[heal] refused: already_owned — "${phrase}" owned by row ${owners[0].id} (served anyway)`);
    return false;
  }

  // Gate 5: WRITE — append phrase to row.keywords + mark healed
  const newKeywords = [...(liveRow.keywords || []), phrase];
  const { error: kwErr } = await supabase
    .from("foods")
    .update({ keywords: newKeywords })
    .eq("id", liveRow.id);
  if (kwErr) {
    console.log(`[heal] refused: keyword write error (${kwErr.message}) — "${phrase}"`);
    return false;
  }
  const { error: healErr } = await supabase
    .from("keyword_misses")
    .update({
      healed_food_id: liveRow.id,
      healed_at: new Date().toISOString(),
      healed_via: "opus_selector",
      healed_metadata: {
        model: OPUS_MODEL,
        confidence: selection.confidence,
        reasoning: selection.reasoning,
        candidate_ids: candidates.map((c) => c.id),
      },
    })
    .eq("term", cleanTerm);
  if (healErr) {
    console.log(`[heal] warn: keyword written but keyword_misses update failed (${healErr.message}) for "${cleanTerm}"`);
  }
  const flag = selection.confidence === "medium" ? " [medium — flagged for review]" : "";
  console.log(`[heal] wrote: "${phrase}" -> row ${liveRow.id}${flag}`);
  return true;
}

// ── ORCHESTRATOR — the one function route.js calls on a keyword miss.
// Inputs: clients, the clean term, and the candidate pool (full row objects
// from the scored stages, ALREADY brand-gated).
// Returns:
//   { row }        — serve this row for THIS log (write handled internally)
//   { row: null }  — no valid selection: caller proceeds to AI-estimate path
export async function runSelfHeal({ supabase, anthropic, term, candidates }) {
  if (!candidates || candidates.length === 0) {
    console.log(`[heal] skipped: no candidates for "${term}"`);
    return { row: null };
  }

  const { alreadyHealed } = await recordMiss(supabase, term);
  if (alreadyHealed) {
    // Healed but keyword missed anyway (e.g. keyword later removed) — do not
    // re-fire the selector; fall through to today's behavior.
    console.log(`[heal] skipped: "${term}" already healed in keyword_misses`);
    return { row: null };
  }

  console.log(`[heal] fired: "${term}" with ${candidates.length} candidates`);
  const selection = await opusSelect(anthropic, term, candidates);

  // §6: timeout / parse fail / API error -> AI-estimate path
  if (!selection) return { row: null };

  // §6: explicit null -> AI-estimate path (it emits its own keywords)
  if (selection.id == null) {
    console.log(`[heal] selector null for "${term}" (${selection.reasoning}) -> AI-estimate path`);
    return { row: null };
  }

  // Gate 1 (governs SERVE too): id must be a real member of the pool
  const selectedRow = candidates.find((c) => c.id === selection.id);
  if (!selectedRow) {
    console.log(`[heal] refused: invalid_id ${selection.id} for "${term}" -> AI-estimate path`);
    return { row: null };
  }

  // SERVE is now guaranteed. WRITE is separately gated — its outcome does not
  // change what the user gets for this log.
  console.log(`[heal] served: "${term}" -> row ${selectedRow.id} (${selection.confidence})`);
  await gatedWrite(supabase, term, selection, selectedRow, candidates);

  return { row: selectedRow };
}