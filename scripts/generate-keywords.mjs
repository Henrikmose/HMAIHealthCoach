// scripts/generate-keywords.mjs  (v3)
// CURA keywords generator — Opus 4.8 via Anthropic Batch API (−50%)
//
// v2 changes: ROWS_PER_REQUEST 40, max_tokens 16000, preamble-proof JSON parsing,
// bad-response dump files, hardened prompt (enhanced/raw ownership), and the new
// `resolve` command — AI collision resolution for the ambiguity checker.
//
// USAGE (from project root, Node 18+):
//   node scripts/generate-keywords.mjs submit --pilot     # pork/chicken/rice/eggs only
//   node scripts/generate-keywords.mjs submit --full      # all remaining families
//   node scripts/generate-keywords.mjs status <batch_id>
//   node scripts/generate-keywords.mjs apply  <batch_id>  # write keywords to Supabase
//   node scripts/generate-keywords.mjs resolve            # fix keyword collisions via AI
//
// ENV VARS REQUIRED (export in the same terminal session):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
//
// ROLLBACK: update foods set keywords = null; (empty column = old behavior)

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const KEYWORDS_VERSION = 1;
const MODEL = "claude-opus-4-8";
const ROWS_PER_REQUEST = 40; // one family per request where possible
const PILOT_FAMILIES = ["pork", "chicken", "rice", "eggs", "egg"];

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing env var ${k}`); process.exit(1); }
  return v;
};
const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"));
const ANTHROPIC_KEY = need("ANTHROPIC_API_KEY");

const PROMPT = `You are normalising USDA food names into the words real people actually say.
For each food below, output the phrases a normal person would type or say when they mean THAT food.

THE ONE RULE THAT MATTERS:
A keyword must unambiguously identify THIS food and NOT a sibling. If a phrase could equally
describe a different cut, organ, species or product, DO NOT emit it.
  - Pork tenderloin must NEVER get "pork loin" or "loin" — those belong to the loin roast.
  - Chicken liver must NEVER get "chicken" — that belongs to plain chicken meat.
  - Broccoli raab must NEVER get "broccoli" — it is a different plant.
When in doubt, emit the LONGER, more specific phrase. Emitting nothing is better than emitting
a phrase that another food could claim.

VARIANT OWNERSHIP (raw/cooked, lean/lean+fat, salt/no-salt):
When sibling rows differ ONLY in preparation state, exactly ONE of them owns the plain
phrase — the one matching what a person means by default when they say they ATE it:
  - COOKED owns the plain phrase. A RAW row must NEVER get the plain phrase — raw rows
    get ONLY phrases containing the word "raw" ("raw chicken breast"), or nothing.
  - "Enhanced", brine-injected, cured, or otherwise treated rows must NEVER get the
    plain phrase — only phrases that say so ("enhanced pork tenderloin"), or nothing.
  - For red meat: "separable lean and fat" owns the plain phrase. "Separable lean only"
    rows get the "lean" phrase ("lean pork chop") or nothing.
  - For poultry: "meat only" owns the plain phrase. "Meat and skin" rows get the skin
    phrase ("chicken thigh with skin") or nothing.
  - "Without salt" owns the plain phrase over "with salt".
  - Plain/fresh owns the plain phrase over frozen, breaded, canned, or dried rows —
    those rows only get phrases that say so ("frozen breaded chicken thighs").

BARE TERMS ("chicken", "pork", "rice", "broccoli"):
Exactly ONE food may own a bare term — the plain, whole, ordinary version an average shopper
buys and cooks. Give the bare term to that food ONLY.
  - A composite / "meat only" / plain cooked row MAY own the bare term.
  - Organ meats, processed products, specific cuts, named varieties, baby food, and dishes MUST NOT.
If this food is not the plain ordinary version, do not emit the bare term.

ALSO:
- Lowercase. 1-5 phrases. SINGULAR ONLY — never emit a plural ("pork chop", not
  "pork chops"); the matching code handles plurals.
- No macros, no brands unless the name has one.
- Prefer what a shopper says ("pork chop") over lab language ("separable lean only").
- Do not repeat the USDA name back.

Return ONLY a JSON array, one object per input, same order:
[{"id":123,"keywords":["...","..."]}]

FOODS:
`;

const RESOLVE_PROMPT = `Multiple USDA food rows are claiming the same keyword phrase. For each
keyword below, pick EXACTLY ONE row id as the owner — the row a person most likely means when
they say that phrase.

OWNERSHIP RULES, in priority order:
1. COOKED beats raw. A raw row may only own a phrase containing the word "raw".
2. Plain beats enhanced/brine-injected/cured/frozen/breaded/processed.
3. "Separable lean and fat" beats "separable lean only" (red meat, as-eaten).
4. "Meat only" beats "meat and skin" (poultry) — unless the phrase itself says skin,
   then the skin row owns it.
5. If the rows describe essentially THE SAME food (duplicate imports, e.g.
   "Chicken Thigh (Cooked)" vs "Chicken, broilers or fryers, thigh, meat only, cooked"),
   prefer the simpler/generic-named row.
6. A phrase containing "raw" must go to a raw row; "lean" to a lean-only row, etc. —
   the phrase's own qualifiers bind.

Return ONLY a JSON array, one object per keyword, same order:
[{"keyword":"...","owner":123}]

COLLISIONS:
`;

const familyOf = (name) =>
  (name || "").toLowerCase().split(",")[0].trim().split(/\s+/)[0].replace(/[^a-z]/g, "");

const parseModelJson = (raw) => {
  const cleanRaw = raw.replace(/```json|```/g, "").trim();
  const clean = cleanRaw.slice(cleanRaw.indexOf("["), cleanRaw.lastIndexOf("]") + 1);
  return JSON.parse(clean);
};

async function fetchRows(needingKeywords = true) {
  const all = [];
  let from = 0;
  for (;;) {
    let q = supabase
      .from("foods")
      .select("id,name,keywords")
      .in("source", ["usda_db", "usda"])
      .order("id")
      .range(from, from + 999);
    if (needingKeywords) q = q.or(`keywords_version.is.null,keywords_version.lt.${KEYWORDS_VERSION}`);
    else q = q.not("keywords", "is", null);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function buildRequests(rows, pilot) {
  const families = new Map();
  for (const r of rows) {
    const f = familyOf(r.name);
    if (pilot && !PILOT_FAMILIES.includes(f)) continue;
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(r);
  }
  const requests = [];
  let n = 0;
  for (const [fam, members] of [...families.entries()].sort()) {
    members.sort((a, b) => a.name.localeCompare(b.name)); // siblings adjacent
    for (let i = 0; i < members.length; i += ROWS_PER_REQUEST) {
      const chunk = members.slice(i, i + ROWS_PER_REQUEST);
      const foodsList = chunk.map((r) => JSON.stringify({ id: r.id, name: r.name })).join("\n");
      requests.push({
        custom_id: `kw-${fam}-${n++}`,
        params: {
          model: MODEL,
          max_tokens: 16000,
          messages: [{ role: "user", content: PROMPT + foodsList }],
        },
      });
    }
  }
  return requests;
}

async function anthropic(path, opts = {}) {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    ...opts,
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res;
}

async function submit(pilot) {
  const rows = await fetchRows(true);
  console.log(`Rows needing keywords: ${rows.length}`);
  const requests = buildRequests(rows, pilot);
  const rowCount = requests.reduce(
    (s, r) => s + r.params.messages[0].content.split("\nFOODS:\n").pop().split("\n").length, 0);
  console.log(`Submitting ${requests.length} requests covering ~${rowCount} rows (pilot=${!!pilot})`);
  const res = await anthropic("/v1/messages/batches", {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  const batch = await res.json();
  writeFileSync(`batch-${batch.id}.json`, JSON.stringify(batch, null, 2));
  console.log(`\nBatch submitted: ${batch.id}`);
  console.log(`Next: node scripts/generate-keywords.mjs status ${batch.id}`);
}

async function status(batchId) {
  const res = await anthropic(`/v1/messages/batches/${batchId}`);
  const b = await res.json();
  console.log(`status: ${b.processing_status}`);
  console.log(`counts: ${JSON.stringify(b.request_counts)}`);
  if (b.processing_status === "ended")
    console.log(`Next: node scripts/generate-keywords.mjs apply ${batchId}`);
}

async function apply(batchId) {
  const res = await anthropic(`/v1/messages/batches/${batchId}/results`);
  const text = await res.text();
  const updates = [];
  let failed = 0;
  for (const line of text.split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.result?.type !== "succeeded") { failed++; console.error(`FAILED: ${r.custom_id} (${r.result?.type})`); continue; }
    const raw = r.result.message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    let arr;
    try { arr = parseModelJson(raw); } catch { failed++; console.error(`BAD JSON: ${r.custom_id}`); writeFileSync(`bad-${r.custom_id}.txt`, raw); continue; }
    for (const item of arr) {
      if (!item.id || !Array.isArray(item.keywords)) continue;
      const kws = [...new Set(item.keywords.map((k) => String(k).toLowerCase().trim()).filter((k) => k.length > 1 && k.length < 60))];
      updates.push({ id: item.id, keywords: kws, version: KEYWORDS_VERSION });
    }
  }
  console.log(`Parsed ${updates.length} rows to update, ${failed} failed requests.`);
  let done = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("foods")
      .update({ keywords: u.keywords, keywords_version: u.version })
      .eq("id", u.id);
    if (error) { console.error(`update ${u.id}: ${error.message}`); continue; }
    if (++done % 200 === 0) console.log(`  ...${done}/${updates.length}`);
  }
  console.log(`Done: ${done} rows written with keywords_version=${KEYWORDS_VERSION}.`);
  console.log(`Next: node scripts/generate-keywords.mjs resolve`);
}

// [v3] PLURAL-AWARE COLLISION GROUPS. The matcher singularizes queries, so
// "scrambled egg" and "scrambled eggs" are ONE contested phrase, not two keywords.
// Group any claims sharing a singular/plural variant; resolve the group as one.
const kwVariants = (k) => new Set([k, k.replace(/ies$/, "y"), k.replace(/es$/, ""), k.replace(/s$/, "")].filter((x) => x.length > 1));
const kwCanon = (k) => { const a = k.replace(/ies$/, "y"); return a !== k ? a : k.replace(/s$/, ""); };

function findCollisionGroups(rows) {
  const byKw = new Map();
  for (const r of rows) {
    for (const kw of r.keywords || []) {
      if (!byKw.has(kw)) byKw.set(kw, []);
      byKw.get(kw).push(r);
    }
  }
  const formToGroup = new Map();
  const groups = [];
  for (const [kw, claimants] of byKw) {
    let g = null;
    for (const f of kwVariants(kw)) if (formToGroup.has(f)) { g = formToGroup.get(f); break; }
    if (!g) { g = { kws: new Map() }; groups.push(g); }
    g.kws.set(kw, claimants);
    for (const f of kwVariants(kw)) formToGroup.set(f, g);
  }
  return groups
    .map((g) => {
      const claimed = [...g.kws.keys()];
      const rep = claimed.map(kwCanon).sort((a, b) => a.length - b.length)[0];
      const rowsById = new Map();
      for (const rs of g.kws.values()) for (const r of rs) rowsById.set(String(r.id), r);
      return { rep, claimed, rows: [...rowsById.values()] };
    })
    .filter((g) => g.rows.length > 1);
}

async function resolve() {
  const rows = await fetchRows(false);
  const collisions = findCollisionGroups(rows);
  console.log(`Rows with keywords: ${rows.length}. Colliding phrase groups: ${collisions.length}`);
  if (collisions.length === 0) { console.log("Nothing to resolve — checker is clean."); return; }

  const decisions = [];
  const CHUNK = 60;
  for (let i = 0; i < collisions.length; i += CHUNK) {
    const chunk = collisions.slice(i, i + CHUNK);
    const payload = chunk
      .map((g) => JSON.stringify({ keyword: g.rep, rows: g.rows.map((r) => ({ id: r.id, name: r.name })) }))
      .join("\n");
    console.log(`Resolving ${i + 1}-${Math.min(i + CHUNK, collisions.length)} of ${collisions.length}...`);
    const res = await anthropic("/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content: RESOLVE_PROMPT + payload }],
      }),
    });
    const data = await res.json();
    const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    let arr;
    try { arr = parseModelJson(raw); } catch {
      writeFileSync(`bad-resolve-${i}.txt`, raw);
      console.error(`BAD JSON in resolve chunk at ${i} — saved to bad-resolve-${i}.txt`);
      continue;
    }
    decisions.push(...arr);
  }

  // apply: losers lose every claimed variant; the owner is normalized to the
  // singular rep (matcher singularizes queries but never pluralizes — a
  // plural-only keyword would be unreachable for singular queries).
  const rowById = new Map(rows.map((r) => [String(r.id), r]));
  const dirty = new Map();
  let unresolved = 0;
  for (const g of collisions) {
    const d = decisions.find((x) => x.keyword === g.rep);
    if (!d || !d.owner) { unresolved++; console.error(`NO DECISION for "${g.rep}" — left as-is`); continue; }
    for (const r of g.rows) {
      const row = rowById.get(String(r.id));
      if (!row) continue;
      if (String(r.id) === String(d.owner)) {
        const next = (row.keywords || []).filter((k) => !g.claimed.includes(k));
        if (!next.includes(g.rep)) next.push(g.rep);
        row.keywords = next;
      } else {
        row.keywords = (row.keywords || []).filter((k) => !g.claimed.includes(k));
      }
      dirty.set(String(row.id), row);
    }
  }
  console.log(`Decisions applied: ${collisions.length - unresolved}, unresolved: ${unresolved}. Updating ${dirty.size} rows...`);
  let done = 0;
  for (const row of dirty.values()) {
    const { error } = await supabase.from("foods").update({ keywords: row.keywords }).eq("id", row.id);
    if (error) { console.error(`update ${row.id}: ${error.message}`); continue; }
    if (++done % 100 === 0) console.log(`  ...${done}/${dirty.size}`);
  }
  console.log(`Done: ${done} rows updated.`);

  // re-check
  const after = await fetchRows(false);
  const remaining = findCollisionGroups(after);
  console.log(`\nCHECKER RE-RUN: ${remaining.length} colliding phrase groups remain.`);
  for (const g of remaining.slice(0, 20))
    console.log(`  "${g.rep}" (${g.claimed.join(" + ")}) -> ${g.rows.map((r) => r.id).join(", ")}`);
  if (remaining.length === 0) console.log("CLEAN — ready for the sibling suite.");
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "submit") await submit(arg === "--pilot");
else if (cmd === "status" && arg) await status(arg);
else if (cmd === "apply" && arg) await apply(arg);
else if (cmd === "resolve") await resolve();
else console.log("usage: submit [--pilot|--full] | status <batch_id> | apply <batch_id> | resolve");
