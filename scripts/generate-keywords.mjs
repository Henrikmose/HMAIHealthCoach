// scripts/generate-keywords.mjs
// CURA keywords generator — Opus 4.8 via Anthropic Batch API (−50%)
//
// USAGE (from project root, Node 18+):
//   1. npm i @supabase/supabase-js          (already a dependency in CURA)
//   2. Set env vars (see below), then:
//   node scripts/generate-keywords.mjs submit --pilot     # pork/chicken/rice/eggs only
//   node scripts/generate-keywords.mjs status <batch_id>  # check progress
//   node scripts/generate-keywords.mjs apply  <batch_id>  # write keywords to Supabase
//   node scripts/generate-keywords.mjs submit --full      # all remaining families
//
// ENV VARS REQUIRED (put in .env.local or export in the shell):
//   SUPABASE_URL                — same as the app uses
//   SUPABASE_SERVICE_ROLE_KEY   — Dashboard > Settings > API > service_role
//                                 (NOT the anon key: the script must write)
//   ANTHROPIC_API_KEY           — the app's existing key
//
// SCOPE: source in ('usda_db','usda'), skips rows already at KEYWORDS_VERSION.
// ROLLBACK: update foods set keywords = null; (empty column = old behavior)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const KEYWORDS_VERSION = 1;
const MODEL = "claude-opus-4-8";
const ROWS_PER_REQUEST = 80; // one family per request where possible
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
  - COOKED owns the plain phrase. Raw rows get the "raw" phrase ("raw chicken breast") or nothing.
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

const familyOf = (name) =>
  (name || "").toLowerCase().split(",")[0].trim().split(/\s+/)[0].replace(/[^a-z]/g, "");

async function fetchRows() {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("foods")
      .select("id,name")
      .in("source", ["usda_db", "usda"])
      .or(`keywords_version.is.null,keywords_version.lt.${KEYWORDS_VERSION}`)
      .order("id")
      .range(from, from + 999);
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
          max_tokens: 8000,
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
  const rows = await fetchRows();
  console.log(`Rows needing keywords: ${rows.length}`);
  const requests = buildRequests(rows, pilot);
  const total = requests.reduce((s, r) => s + 1, 0);
  const rowCount = requests.reduce(
    (s, r) => s + r.params.messages[0].content.split("\nFOODS:\n").pop().split("\n").length, 0);
  console.log(`Submitting ${total} requests covering ~${rowCount} rows (pilot=${!!pilot})`);
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
    const clean = raw.replace(/```json|```/g, "").trim();
    let arr;
    try { arr = JSON.parse(clean); } catch { failed++; console.error(`BAD JSON: ${r.custom_id}`); continue; }
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
  console.log(`\nNOW RUN THE AMBIGUITY CHECKER in Supabase:`);
  console.log(`select unnest(keywords) kw, count(*), array_agg(id) ids from foods where keywords is not null group by kw having count(*) > 1 order by count(*) desc;`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "submit") await submit(arg === "--pilot");
else if (cmd === "status" && arg) await status(arg);
else if (cmd === "apply" && arg) await apply(arg);
else console.log("usage: submit [--pilot|--full] | status <batch_id> | apply <batch_id>");
