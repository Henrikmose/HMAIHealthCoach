"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import HamburgerMenu from "./components/HamburgerMenu";
import BottomNav from "./components/BottomNav";

// ========================================
// DATE UTILITIES
// ========================================

function getLocalDate() {
const now = new Date();
return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, days) {
const d = new Date(dateStr + "T12:00:00");
d.setDate(d.getDate() + days);
return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function extractTargetDate(text, surroundingTexts) {
// PRIORITY 1: the trigger message itself. An explicit date cue in the CURRENT request
// always wins over stale mentions earlier in the conversation. "tonight"/"today" -> today.
const trigger = (text || "").toLowerCase();
if (/\b(tonight|today|this (morning|afternoon|evening)|right now)\b/.test(trigger)) return getLocalDate();
if (trigger.includes("tomorrow")) return addDays(getLocalDate(), 1);
if (trigger.includes("yesterday")) return addDays(getLocalDate(), -1);

// PRIORITY 2 (fallback only): if the trigger has no date cue, glance at recent context.
// This is why an earlier "tomorrow" used to leak onto a later "dinner tonight" — now it
// only applies when the current request said nothing about timing.
const allTexts = [text, ...(surroundingTexts || [])].join(" ").toLowerCase();
if (allTexts.includes("tomorrow")) return addDays(getLocalDate(), 1);
if (allTexts.includes("yesterday")) return addDays(getLocalDate(), -1);
return getLocalDate();
}

// ========================================
// INTENT DETECTION
// ========================================

// ── INTENT: question vs. statement (TENSE-INDEPENDENT) ──
// Tense must NOT decide anything. The 4 buttons decide eaten-vs-planned.
// ── INTENT CLASSIFIER (code, not AI; three stable signals, not a scenario list) ──
// Decides only ONE thing: is there food to show a meal card for (a log OR a plan), or is this
// a question? Eaten-vs-planned is NOT decided here — the buttons do that. The three signals
// back each other up so we don't have to enumerate every phrasing:
//   1) Question FORM (ends in "?" or a question stem)     -> question   [checked first]
//   2) A small, stable set of "stating food" phrases      -> food
//   3) Backup: a quantity + food-ish token present         -> food
// "what" is disambiguated by what FOLLOWS it: "what I ate" = food; "what is a good" = question.

function isQuestionForm(t) {
  if (/\?\s*$/.test(t)) return true;
  return [
    /^\s*(how\s+(many|much))\b/i,
    // [v109] Stems aligned with the server's isQuestionTurn — voice dictation drops
    // the "?", and the two sides drifting apart is how "What makes handrolls so high
    // in calories" passed the client as a non-question. Same list on both sides now.
    /^\s*(how\s+(come|do|does|is|are))\b/i,
    /^\s*(is|are|was|were|does|do|did)\b/i,
    /^\s*what('?s|\s+is|\s+are|\s+makes)\b/i,
    /^\s*(when|where|who)\b/i,
    /\bexplain\b/i,
    /^\s*should\s+i\b/i,
    /^\s*can\s+i\b/i,
    // [v88] "can/could/would/will YOU..." is a REQUEST to the coach (make me a plan,
    // give me ideas) — never a food log. Voice drops the "?" so the stem must catch it.
    /^\s*(can|could|would|will)\s+(you|we)\b/i,
    /\bmake\s+(me\s+)?a\s+(meal\s+)?plan\b/i,
    /\bgive\s+me\s+a\s+(meal\s+)?plan\b/i,
    /^\s*what\s+should\b/i,
    /^\s*what('?s|\s+is)\s+a\s+good\b/i,
    /^\s*(which|why)\b/i,
    /\bany\s+(ideas|suggestions|recommendations)\b/i,
    /\bgood\s+(option|choice|idea|pick)\b/i,
    /\bhelp me (pick|choose|decide)\b/i,
  ].some((re) => re.test(t));
}

function statesFoodPhrase(t) {
  // "what I ate/had", "I ate/had/having", "for breakfast/lunch/dinner", "I'm planning ..."
  return [
    /\b(i\s+(just\s+)?(ate|had|have|having|eat|drank|drink|consumed|ordered)|i'?ve\s+(just\s+)?(had|eaten|consumed)|i'?m\s+(having|eating|drinking|ordering|planning))\b/i,
    /\bi'?ll\s+(have|eat|get|take)\b/i,
    /\bi\s+(will|am going to|'?m going to)\s+(have|eat|get)\b/i,
    /\bfor\s+(breakfast|lunch|dinner|a?\s*snack)\b/i,
    /\b(what|everything|all|here'?s what|this is what)\s+i\s+(ate|had|'?ve\s+eaten|have\s+eaten|plan|'?m\s+planning)\b/i,
    /^\s*(breakfast|lunch|dinner|snack)\s*(was|:|-)/i,
  ].some((re) => re.test(t));
}

function hasQuantifiedFood(t) {
  // Backup signal: a quantity token near a word, for phrasings the phrase-set doesn't cover
  // ("a cup of rice and 6oz salmon"). Deliberately simple; server-side parser is authoritative.
  // [v88] Tightened: a bare article ("a plan", "some help") is NOT a quantity —
  // articles/some only count when followed by a real measure word. Digits and
  // number-words still count on their own.
  // [v92] percentages and "80/20 rule"-style numbers are NOT food quantities
  const t2 = t
    .replace(/\d+(\.\d+)?\s*%/g, " ")
    .replace(/\b\d+(\.\d+)?\s*percent\b/gi, " ")
    .replace(/\b\d{2,4}\s*[\/-]?\s*\d{0,2}\s*rule\b/gi, " ");
  const hasQty =
    /\b\d+(\.\d+)?\b/.test(t2) ||
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|couple|\u00bd|\u00bc|\u00be)\b/i.test(t2) ||
    /\b(a|an|some)\s+(oz|ounce|ounces|cup|cups|g|gram|grams|tbsp|tsp|slice|slices|piece|pieces|scoop|scoops|bottle|bottles|can|cans|bowl|bowls|plate|glass|serving|servings|bar|bars|handful)\b/i.test(t2);
  const shortEnough = t.split(/\s+/).length <= 40;
  const notAdvicey = !/\b(should|healthy|better|worse|recommend|suggest|plan|planning|ideas?|good\s+(for|option|choice))\b/i.test(t);
  return hasQty && shortEnough && notAdvicey;
}

// isFoodQuestion kept for compatibility with other call sites: true = it's a question (no card).
function isFoodQuestion(text) {
  if (!text) return false;
  const t = text.trim();
  if (isQuestionForm(t)) return true;      // question form wins first
  if (statesFoodPhrase(t)) return false;   // clearly stating food -> not a question
  return false;                            // default: let statesAFood decide via food content
}

function statesAFood(text, inThread = false) {
  if (!text) return false;
  const t = text.trim();
  if (isQuestionForm(t)) return false;     // 1) a question is never a food log
  if (statesFoodPhrase(t)) return true;    // 2) explicit "I ate / for breakfast / what I ate"
  // [v92] inside a ↩ Continue thread you're mid-conversation — only EXPLICIT food
  // phrasing logs. The loose quantity signal is disabled so "make it 80/20" or
  // "around 2000" can never be mistaken for a meal.
  if (!inThread && hasQuantifiedFood(t)) return true;
  return false;
}

function isLogMessage(text, inThread = false) {
  return statesAFood(text, inThread);
}

function isMealPlanningRequest(text) {
if (!text) return false;
return [
/what\s+should\s+i\s+eat/i,
/what\s+can\s+i\s+eat/i,
/what\s+do\s+i\s+eat/i,
/what\s+should\s+i\s+have/i,
/what\s+should\s+i\s+make/i,
/what\s+can\s+i\s+make/i,
/what\s+can\s+i\s+cook/i,
/what\s+to\s+make/i,
/i\s+have\s+(some\s+)?(chicken|beef|fish|salmon|turkey|pork|tofu|eggs|rice|pasta|potatoes|vegetables|veggies)/i,
/plan\s+my\s+meals/i,
/meal\s+plan/i,
/create.*meal/i,
/make.*meal/i,
/suggest.*meal/i,
/suggest.*eat/i,
/recommend.*eat/i,
/recommend.*meal/i,
/what.*eat.*game/i,
/what.*eat.*race/i,
/what.*eat.*before/i,
/what.*eat.*today/i,
/what.*eat.*tonight/i,
/ideal\s+meal/i,
/give.*meal/i,
/yes\s+please/i, /yes.*plan/i,
/sure.*plan/i,
/create.*plan/i,
/make.*plan/i,
/build.*plan/i,
/great.*plan/i,
/can you.*plan/i,
/help.*plan/i,
/put together.*plan/i,
/plan.*today/i,
/plan.*tonight/i,
/plan.*tomorrow/i,
/plan.*game/i,
/plan.*race/i,
/plan.*match/i,
/plan.*event/i,
/plan.*for.*me/i,
/plan.*my.*day/i,
/plan.*my.*week/i,
/fuel.*race/i,
/fuel.*game/i,
/eat.*race\s+day/i,
/race\s+day.*eat/i,
/how.*eat.*race/i,
/how.*eat.*game/i,
// Broader dinner/meal suggestion patterns
/help.*deciding.*dinner/i,
/help.*deciding.*lunch/i,
/help.*deciding.*breakfast/i,
/what.*have.*dinner/i,
/what.*have.*lunch/i,
/what.*have.*breakfast/i,
/dinner.*macros/i,
/lunch.*macros/i,
/hit.*macros/i,
/reach.*macros/i,
/recommendations.*eat/i,
/what.*recommendations/i,
/ideas.*eat/i,
/ideas.*dinner/i,
/ideas.*lunch/i,
/tell me.*dinner/i,
/tell me.*eat/i,
/deciding.*eat/i,
/for\s+dinner\b/i,
/for\s+lunch\b/i,
/for\s+breakfast\b/i,
].some((p) => p.test(text));
}

function isConfirmation(text) {
if (!text) return false;
return /\b(yes|yeah|yep|yup|yew|yea|ya|ye|sure|perfect|great|sounds good|i like that|let'?s do|that one|i'?ll have|add it|can we do that|looks good|works for me|do that one|i want that|i'?ll take|love it|that works|go with that|do it|let'?s go with|as planned|as actual|for later|plan it|log it|save it|add (it |this )?(to my )?(plan|log)|confirm|correct|right|exactly|absolutely|i'?ll go|i will go|go over|i'?ll take that|i choose|going with|i'?ll have that|that one|the (protein|shake|fitzels|first|second|last|other) one)\b/i.test(text);
}

function isMealSwap(text) {
if (!text) return false;
return /i ran out|don'?t have|don'?t want|out of|no more|something else|another option|another suggestion|swap|give me another|can'?t make|different option|instead of|instead|replace|substitute|change it|can you change|no (salmon|chicken|beef|fish|meat|that)/i.test(text);
}

function isFutureMeal(text) {
if (!text) return false;
return /\b(i'?ll have|i will have|i'?m (going to|gonna) have|i'?m planning (to have|on having)|planning to eat|going to eat|will eat|i'?ll eat|having .* (tonight|later|for dinner|for lunch|for breakfast|after|tomorrow))\b/i.test(text);
}

function detectPhotoIntent(text) {
if (!text) return "unknown";
const lower = text.toLowerCase();
if (/i (just |already )?(had|ate|drank|consumed|finished)/i.test(lower)) return "eaten";
if (/for (dinner|lunch|breakfast|snack|later|tonight|tomorrow)/i.test(lower)) return "planned";
if (/(going to|will have|planning|saving|for when i get home|store|shopping|found this)/i.test(lower)) return "planned";
if (/(which|better|compare|vs|versus|best for|recommend|should i (get|buy|choose))/i.test(lower)) return "compare";
if (/(menu|order|what (should|can) i (get|order|have)|restaurant)/i.test(lower)) return "menu";
return "unknown";
}

function isWeightGoalRequest(text) {
if (!text) return false;
return [
/want.*lose/i,
/want.*drop/i,
/want.*shed/i,
/trying.*lose/i,
/lose.*pounds/i,
/drop.*pounds/i,
/lose.*weight/i,
/gain.*weight/i,
/bulk.*up/i,
].some((p) => p.test(text));
}

function extractMealType(text) {
if (!text) return null;
const lower = text.toLowerCase();
if (lower.includes("breakfast")) return "breakfast";
if (lower.includes("lunch")) return "lunch";
if (lower.includes("dinner")) return "dinner";
if (lower.includes("snack")) return "snack";
return null;
}

function inferMealTypeFromHour(hour) {
// Time windows aligned with real eating patterns (not artificial meal slots).
// Mid-morning, mid-afternoon, and late-night all default to Snack.
if (hour >= 5 && hour < 9) return "breakfast";    // 5am-8:59am
if (hour >= 9 && hour < 11) return "snack";       // 9am-10:59am (mid-morning)
if (hour >= 11 && hour < 13) return "lunch";      // 11am-12:59pm
if (hour >= 13 && hour < 17) return "snack";      // 1pm-4:59pm (afternoon)
if (hour >= 17 && hour < 20) return "dinner";     // 5pm-7:59pm
return "snack";                                    // 8pm-4:59am (late/early)
}

// ========================================
// STANDARD OBSERVATIONS (code-owned, DB-derived)
// ========================================
// [v80] This function was CALLED in the previous build but never DEFINED — the
// try/catch around the call swallowed the ReferenceError, so post-save shortfall
// observations silently never fired. Now implemented, in code, from DB totals.

function standardObservations(totals, goals) {
  const calPct = goals.calories > 0 ? Math.round((totals.calories / goals.calories) * 100) : 0;
  const hour = new Date().getHours();
  let line = `📊 You're at ${Math.round(totals.calories)}/${goals.calories} cal (${calPct}%) for today.`;
  let offer = null;
  const proteinPct = goals.protein > 0 ? totals.protein / goals.protein : 1;
  if (hour >= 16 && proteinPct < 0.6) {
    line += ` Protein is at ${Math.round(totals.protein)}g of ${goals.protein}g — worth prioritizing in your next meal.`;
    offer = "👉 Tap ↩ Continue and ask if you want a high-protein idea.";
  } else if (calPct > 100) {
    line += ` You're over your daily target — keep the rest of the day light.`;
  }
  return { line, offer };
}

// ========================================
// MEAL PARSER (planning path — AI prose day plans)
// Supports multiple Snacks (pre-game, post-game etc.)
// Only one Breakfast, Lunch, or Dinner per plan.
// ========================================

function parseAllMeals(text) {
if (!text) return [];

const meals = [];
const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
const mealCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
// Fix 2: allow compound prefixes like "Pre-Workout Snack", "Morning Snack", "Post-Workout Snack".
// Only recognized descriptor prefixes are allowed — prevents false positives in prose like "For lunch I'll...".
const compoundPrefixRe = /^(pre-\w+|post-\w+|mid-\w+|late-\w+|morning|afternoon|evening|early)\s+/i;

// Returns the matched meal type if the line is a meal header, null otherwise.
// Handles both simple ("Breakfast", "Lunch — 12pm") and compound ("Pre-Workout Snack") headers.
function detectMealType(line, lineLower) {
const isNotDataLine =
!lineLower.includes("total") &&
!lineLower.includes("calories:") &&
!line.startsWith("-");
if (!isNotDataLine) return null;

for (const type of mealTypes) {
// Simple: line starts with meal type
if (
lineLower === type ||
lineLower.startsWith(type + " ") ||
lineLower.startsWith(type + "(")
) {
return type;
}
}

// Compound: line has descriptor prefix, then meal type
if (compoundPrefixRe.test(lineLower)) {
const remainder = lineLower.replace(compoundPrefixRe, "");
for (const type of mealTypes) {
if (
remainder === type ||
remainder.startsWith(type + " ") ||
remainder.startsWith(type + "(")
) {
return type;
}
}
}

return null;
}

const lines = text.split("\n").map((l) => l.trim());
let i = 0;

while (i < lines.length) {
const line = lines[i];
const lineLower = line.toLowerCase().trim();

const matchedType = detectMealType(line, lineLower);

if (matchedType) {
let foods = null, calories = null, protein = null, carbs = null, fat = null;
let j = i + 1;

while (j < lines.length && j < i + 15) {
const fl = lines[j];
const fll = fl.toLowerCase().trim();

const isNextMeal = detectMealType(fl, fll) !== null;
const isTotal =
fll.startsWith("total") ||
fll.includes("📊") ||
fll.startsWith("this plan") ||
fll.startsWith("---");

if (isNextMeal || isTotal) break;

if (fll.startsWith("- foods:")) foods = fl.replace(/^-\s*foods:\s*/i, "").trim();
else if (fll.startsWith("- calories:")) { const m = fl.match(/[\d.]+/); if (m) calories = parseFloat(m[0]); }
else if (fll.startsWith("- protein:")) { const m = fl.match(/[\d.]+/); if (m) protein = parseFloat(m[0]); }
else if (fll.startsWith("- carbs:")) { const m = fl.match(/[\d.]+/); if (m) carbs = parseFloat(m[0]); }
else if (fll.startsWith("- fat:")) { const m = fl.match(/[\d.]+/); if (m) fat = parseFloat(m[0]); }

j++;
}

if (foods && calories !== null) {
mealCounts[matchedType]++;
const count = mealCounts[matchedType];

// Deduplicate — only one Breakfast, Lunch, Dinner allowed per plan
// Snacks can repeat freely
if (matchedType !== "snack" && count > 1) {
i = j;
continue; // skip duplicate non-snack blocks
}

const displayType =
matchedType === "snack" && count > 1
? `snack_${count}`
: matchedType;

meals.push({
mealType: matchedType,
displayType,
food: foods,
calories: Math.round(calories),
protein: Math.round(protein || 0),
carbs: Math.round(carbs || 0),
fat: Math.round(fat || 0),
});
}

i = j;
} else {
i++;
}
}

// Inline fallback
if (meals.length === 0) {
const re = /(breakfast|lunch|dinner|snack)\s*[-–]\s*foods?:\s*([^-\n]+?)\s*[-–]\s*calories?:\s*(\d+)\s*[-–]\s*protein?:\s*(\d+)\s*[-–]\s*carbs?:\s*(\d+)\s*[-–]\s*fat?:\s*(\d+)/gi;
const inlineCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
let m;
while ((m = re.exec(text)) !== null) {
const type = m[1].toLowerCase();
inlineCounts[type]++;
const displayType =
type === "snack" && inlineCounts[type] > 1
? `snack_${inlineCounts[type]}`
: type;

meals.push({
mealType: type,
displayType,
food: m[2].trim(),
calories: Math.round(parseFloat(m[3])),
protein: Math.round(parseFloat(m[4])),
carbs: Math.round(parseFloat(m[5])),
fat: Math.round(parseFloat(m[6])),
});
}
}

return meals;
}

// ========================================
// MEAL CARDS — [v80] STRUCTURED, ONE CARD PER MEAL
// ========================================
// A "card" = { meal_type, items: [...] }. Cards are the single source for the
// save UI. Server food-log responses return them directly (data.mealCards).
// AI paths that still emit <<<MEAL_DATA>>> blocks (photo, single-meal planning)
// are parsed into the SAME card shape — one card per block, never merged.

const MEAL_DATA_REGEX_G = /<<<MEAL_DATA>>>\s*([\s\S]*?)\s*<<<END_MEAL_DATA>>>/g;

function extractMealCards(text) {
  if (!text) return [];
  const cards = [];
  let m;
  MEAL_DATA_REGEX_G.lastIndex = 0;
  while ((m = MEAL_DATA_REGEX_G.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed === "object" && parsed.meal_type
          && Array.isArray(parsed.items) && parsed.items.length > 0) {
        cards.push({ meal_type: parsed.meal_type, date: parsed.date || null, items: parsed.items });
      }
    } catch (err) {
      console.warn("MEAL_DATA JSON parse failed (one block skipped):", err.message);
    }
  }
  return cards;
}

function stripMealData(text) {
  if (!text) return text;
  return text
    .replace(MEAL_DATA_REGEX_G, "")
    .replace(FACT_DATA_REGEX_G, "")
    .replace(FACT_REMOVE_REGEX_G, "")
    .replace(GOAL_DATA_REGEX_G, "")
    .trim(); // g flags: strip ALL blocks, never leak code
}

// ═══ [v83] INTELLIGENCE CARDS — FACT_DATA / GOAL_DATA ═══
// Same lifecycle as meal cards: extracted from the stored response, rendered as
// confirmation cards, dismissed/saved state persisted in ai_messages.dismissed_cards
// (string tokens "f0"/"g0" so they never collide with numeric meal-card indices).

const FACT_DATA_REGEX_G = /<<<FACT_DATA>>>\s*([\s\S]*?)\s*<<<END_FACT_DATA>>>/g;
const FACT_REMOVE_REGEX_G = /<<<FACT_REMOVE>>>\s*([\s\S]*?)\s*<<<END_FACT_REMOVE>>>/g;
const GOAL_DATA_REGEX_G = /<<<GOAL_DATA>>>\s*([\s\S]*?)\s*<<<END_GOAL_DATA>>>/g;

function extractBlocks(text, regex) {
  if (!text) return [];
  const out = [];
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch (err) { /* skip malformed block */ }
  }
  return out;
}

function extractFactCards(text) {
  return extractBlocks(text, FACT_DATA_REGEX_G).filter(f => f.kind && (f.value || (Array.isArray(f.values) && f.values.length > 0)));
}

function extractFactRemovals(text) {
  return extractBlocks(text, FACT_REMOVE_REGEX_G).filter(f => f.kind && f.value);
}

function extractGoalCards(text) {
  return extractBlocks(text, GOAL_DATA_REGEX_G).filter(g => Number(g.calories) > 0);
}

const FACT_KIND_LABELS = {
  dietary_style: "Diet style",
  allergen: "Allergy",
  intolerance: "Intolerance",
  restriction: "Won't eat",
  love: "Loves",
  dislike: "Dislikes",
  health_condition: "Health condition",
  nutrient: "Nutrient goal",
  lifestyle: "Lifestyle",
  activity: "Activity",
  constraint: "Commitment",
};

function factCardLabel(fact) {
  const kind = FACT_KIND_LABELS[fact.kind] || fact.kind;
  // [v92] batch card: one label for a whole list
  if (Array.isArray(fact.values)) {
    const shown = fact.values.slice(0, 8).join(", ");
    const more = fact.values.length > 8 ? ` +${fact.values.length - 8} more` : "";
    return `${kind} (${fact.values.length}): ${shown}${more}`;
  }
  let label = `${kind}: ${fact.value}`;
  if (fact.kind === "nutrient" && fact.frequency_per_week) label += ` (${fact.frequency_per_week}x/week)`;
  if (fact.expires_at) label += ` — until ${fact.expires_at}`;
  return label;
}

// Honest-wording guard (code-owned, not prompt-owned).
// The AI is told not to over-promise about photos/macros, but a prompt rule can't GUARANTEE it.
// This runs on every AI-authored reply before display, so forbidden promises never reach the user.
// (Code-authored food-log text skips this — there is nothing to clean.)
function cleanOverpromises(text) {
  if (!text) return text;
  let out = text;
  const swaps = [
    // "lock in / dial in / nail down (the) (exact) macros/calories/numbers" — with or without "exact"
    [/\b(lock|dial|nail|zero)\s+(in|down)\b[^.!?\n]*?\b(macros?|calories|numbers|nutrition)\b/gi, "give you my best estimate"],
    // verb + ... + "exact" + ... + macros/calories/numbers
    [/\b(get|capture|grab|calculate|give you|tell you)\b[^.!?\n]*?\bexact\b[^.!?\n]*?\b(macros?|calories|numbers|nutrition)\b/gi, "give you my best estimate"],
    // any leftover "exact macros/calories/numbers/nutrition"
    [/\bexact\s+(macros?|calories|numbers|nutrition)\b/gi, "an estimated $1"],
    // "I'll log it / that / this (for you)" — the AI cannot save; only the buttons save
    [/\bI(?:'|\u2019)?ll\s+log\s+(it|that|this)(\s+for\s+you)?\b/gi, "you can save it with the buttons"],
    [/\bI(?:'|\u2019)?ll\s+log\s+your\b/gi, "you can save your"],
    // "text it over" — there is no texting; it's an in-app photo
    [/\btext\s+it\s+over\b/gi, "send the photo"],
    // "based on (the) portion size ..." — a photo can't read portion size
    [/\bbased on (?:the )?portion size[^.!?\n]*/gi, "as a best estimate"],
  ];
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}

// CODE-OWNED TOTALS (AI-authored text only): the displayed meal-block total must equal
// the sum of the card items. Code-authored food-log text is already correct by construction.
function applyCodeOwnedTotals(text, card) {
  if (!text || !card || !Array.isArray(card.items) || card.items.length === 0) return text;
  const t = card.items.reduce((a, it) => ({
    calories: a.calories + Math.round(Number(it.calories) || 0),
    protein:  a.protein  + (Number(it.protein) || 0),
    carbs:    a.carbs    + (Number(it.carbs)   || 0),
    fat:      a.fat      + (Number(it.fat)     || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const r1 = (n) => Math.round(n);
  let out = text;
  out = out.replace(/(^|\n)(\s*-?\s*Calories:)\s*[\d.]+/i, `$1$2 ${t.calories}`);
  out = out.replace(/(^|\n)(\s*-?\s*Protein:)\s*[\d.]+\s*g/i, `$1$2 ${r1(t.protein)}g`);
  out = out.replace(/(^|\n)(\s*-?\s*Carbs:)\s*[\d.]+\s*g/i, `$1$2 ${r1(t.carbs)}g`);
  out = out.replace(/(^|\n)(\s*-?\s*Fat:)\s*[\d.]+\s*g/i, `$1$2 ${r1(t.fat)}g`);
  return out;
}

function cleanForDisplay(text) {
  return cleanOverpromises(stripMealData(text));
}

// Convert ONE card into save-ready meal rows — one row per food item.
// Also used (with the same food-string construction) to detect "already saved" state,
// so save and detection can never drift apart.
function cardToSaveRows(card, mealTypeOverride) {
  if (!card || !Array.isArray(card.items)) return [];
  const mealType = mealTypeOverride || card.meal_type;
  return card.items.map((item) => {
    const namePart = item.canonical_name || item.food || item.user_text || "Unknown food";
    const qtyPart = item.amount && item.unit ? `${item.amount} ${item.unit}` : (item.amount ? `${item.amount}` : "");
    const food = qtyPart ? `${namePart}, ${qtyPart}` : namePart;
    return {
      mealType,
      displayType: mealType,
      food,
      calories: Math.round(Number(item.calories) || 0),
      protein: Math.round(Number(item.protein) || 0),
      carbs: Math.round(Number(item.carbs) || 0),
      fat: Math.round(Number(item.fat) || 0),
      // Track 2 — carry provenance through to the DB so we can tell where each number came from.
      source: item.source || "ai_estimate",
      // Track 2 write-back: carry the clean name + grams for the save route's cache logic.
      canonicalName: item.canonical_name || item.food || item.user_text || namePart,
      grams: Number(item.grams) || 0,
    };
  });
}

function cardTotals(card) {
  return (card?.items || []).reduce((a, i) => ({
    calories: a.calories + (Number(i.calories) || 0),
    protein: a.protein + (Number(i.protein) || 0),
    carbs: a.carbs + (Number(i.carbs) || 0),
    fat: a.fat + (Number(i.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

// ========================================
// MEAL KEY AND LABEL HELPERS
// ========================================

function getMealKey(msgIdx, meal) {
const foodKey = meal.food.substring(0, 20).replace(/\s/g, "_");
return `${msgIdx}-${meal.displayType}-${meal.calories}-${foodKey}`;
}

function getMealLabel(displayType) {
const labels = {
breakfast: "Breakfast",
lunch: "Lunch",
dinner: "Dinner",
snack: "Snack",
snack_2: "Snack 2",
snack_3: "Snack 3",
};
return labels[displayType] || displayType.charAt(0).toUpperCase() + displayType.slice(1);
}

// [v84] Friendly label for a card's date: Today / Yesterday / Tomorrow / "Jul 9"
function dateLabel(dateStr) {
if (!dateStr) return "Today";
const today = getLocalDate();
if (dateStr === today) return "Today";
if (dateStr === addDays(today, -1)) return "Yesterday";
if (dateStr === addDays(today, 1)) return "Tomorrow";
const d = new Date(dateStr + "T12:00:00");
return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ========================================
// API SAVE (server-side route bypasses RLS)
// ========================================

async function saveMealViaAPI(table, meal, userId) {
  const res = await fetch("/api/save-meals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, meal, userId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    console.error(`Save failed (${table}): ${msg}`, parsed);
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data.success) {
    console.error(`Save rejected (${table}):`, data);
    throw new Error(data.error || "Save rejected by server");
  }
  return true;
}

// ========================================
// MACRO PROGRESS BAR COMPONENT
// ========================================

function MacroBar({ label, value, goal, color }) {
const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
return (
<div className="flex-1">
<div className="flex justify-between mb-1">
<span className="text-xs text-gray-500 font-medium">{label}</span>
<span className="text-xs font-bold text-gray-700">
{Math.round(value)}
<span className="text-gray-400 font-normal">/{goal}g</span>
</span>
</div>
<div className="h-2 bg-gray-100 rounded-full overflow-hidden">
<div
className="h-2 rounded-full transition-all duration-500"
style={{ width: `${pct}%`, backgroundColor: color }}
/>
</div>
</div>
);
}

// ========================================
// MAIN PAGE COMPONENT
// ========================================

export default function HomePage() {
const router = useRouter();
const [message, setMessage] = useState("");
const [history, setHistory] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null); // Continue-thread: when set, next message joins this thread
const [isLoading, setIsLoading] = useState(false);
const [activeMealLog, setActiveMealLog] = useState(null);
const [todayMeals, setTodayMeals] = useState([]);
const [plannedMeals, setPlannedMeals] = useState([]);
// Double-tap protection (Fix 1): ref is synchronous, prevents the same save action firing twice
// when the user taps the button again before the first save completes.
const isSavingRef = useRef(false);
const [isSaving, setIsSaving] = useState(false);

// Meal type dropdown overrides, keyed per CARD: `${msgIdx}:${cardIdx}`.
// Default value comes from the card's meal_type; user overrides via the dropdown.
const [selectedMealTypes, setSelectedMealTypes] = useState({});
// [v84] Per-card DATE overrides, same key scheme. Default comes from card.date
// (decided by the server at log time); the select makes a wrong guess one tap to fix.
const [selectedCardDates, setSelectedCardDates] = useState({});
const [userId, setUserId] = useState(null);
const [userName, setUserName] = useState("");
const [goals, setGoals] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
const [pendingImages, setPendingImages] = useState([]); // max 4: [{ base64, mimeType, preview }]
const [showPhotoMenu, setShowPhotoMenu] = useState(false);
const [loadingStage, setLoadingStage] = useState("");

// Session 2: dismissedPlanKeys persists to localStorage scoped to today's date.
// This is the PLANNING-path (prose day plan) dismissal marker — unchanged in v80.
// (Known limitation: per-device. On the cleanup list; out of Step 2 scope.)
const [dismissedPlanKeys, setDismissedPlanKeys] = useState(() => {
if (typeof window !== "undefined") {
const storedDate = localStorage.getItem("dismissedPlanKeysDate");
if (storedDate === getLocalDate()) {
const stored = localStorage.getItem("dismissedPlanKeys");
if (stored) {
try { return new Set(JSON.parse(stored)); } catch { return new Set(); }
}
}
}
return new Set();
});

// [v80] dismissedReviewIds (localStorage) is GONE. Card dismissals now live in the
// ai_messages.dismissed_cards jsonb column — cross-device, permanent, survives everything.

// Persist dismissedPlanKeys whenever it changes
useEffect(() => {
if (typeof window !== "undefined") {
localStorage.setItem("dismissedPlanKeysDate", getLocalDate());
localStorage.setItem("dismissedPlanKeys", JSON.stringify([...dismissedPlanKeys]));
}
}, [dismissedPlanKeys]);

const messagesEndRef = useRef(null);
const textareaRef = useRef(null);
const cameraInputRef = useRef(null);
const libraryInputRef = useRef(null);

useEffect(() => {
  async function initAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      router.push("/signin");
      return;
    }
    setUserId(user.id);
    setUserName(user.user_metadata?.name || "");
  }
  initAuth();
}, []);

useEffect(() => {
if (userId) {
loadGoals(userId);
loadTodayMeals(userId);
loadPlannedMeals(userId);
loadTodayMessages(userId);
}
}, [userId]);

// Session 2: refresh DB-derived state when user returns to Coach tab from Dashboard or background.
useEffect(() => {
if (!userId) return;

const refresh = () => {
if (document.visibilityState === "visible") {
loadTodayMeals(userId);
loadPlannedMeals(userId);
loadTodayMessages(userId);
}
};

window.addEventListener("focus", refresh);
document.addEventListener("visibilitychange", refresh);

return () => {
window.removeEventListener("focus", refresh);
document.removeEventListener("visibilitychange", refresh);
};
}, [userId]);

useEffect(() => {
messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [history]);

useEffect(() => {
if (textareaRef.current) {
textareaRef.current.style.height = "auto";
textareaRef.current.style.height =
Math.min(textareaRef.current.scrollHeight, 140) + "px";
}
}, [message]);

async function loadGoals(uid) {
try {
const { data } = await supabase
.from("goals").select("*").eq("user_id", uid).single();
if (data) {
setGoals({
calories: data.calories,
protein: data.protein,
carbs: data.carbs,
fat: data.fat,
});
}
} catch (e) {
console.log("Goals load error:", e);
}
}

async function loadTodayMeals(uid) {
try {
const { data } = await supabase
.from("actual_meals").select("*")
.eq("user_id", uid)
.eq("date", getLocalDate());
setTodayMeals(data || []);
return data || [];
} catch (e) {
console.log("Meals load error:", e);
return [];
}
}

async function loadPlannedMeals(uid) {
try {
// Load today AND all future planned meals so saved-detection can match future plans.
const { data } = await supabase
.from("planned_meals").select("*")
.eq("user_id", uid)
.gte("date", getLocalDate());
setPlannedMeals(data || []);
return data || [];
} catch (e) {
console.log("Planned meals load error:", e);
return [];
}
}

async function loadTodayMessages(uid) {
try {
// Last 24 hours of chat (not just "today") so reopening shows the recent conversation.
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const { data, error } = await supabase
.from("ai_messages").select("*")
.eq("user_id", uid)
.gte("created_at", since)
.order("created_at", { ascending: false })
.limit(40);

// Diagnostic: reveals WHY the chat is blank on reopen (rows found vs error). Safe to keep.
console.log("[chat-reload] uid:", uid, "| since:", since, "| rows:", data?.length ?? 0, error ? ("| error: " + error.message) : "");

if (data && data.length > 0) {
const rebuilt = [];
for (const row of data.reverse()) {
if (row.message) rebuilt.push({ role: "user", content: row.message, thread_id: row.thread_id || null });
if (row.response) {
  // [v80] Re-extract cards from the stored response. For code-authored food logs the
  // stored text IS the code-rendered message + per-card MEAL_DATA blocks (Option A).
  // For legacy/AI-authored messages (photo, planning) the same extraction applies.
  const rawResponse = row.response;
  const reloadedCards = extractMealCards(rawResponse);
  const reloadedFacts = extractFactCards(rawResponse);
  const reloadedRemovals = extractFactRemovals(rawResponse);
  const reloadedGoals = extractGoalCards(rawResponse);
  let displayResponse = cleanForDisplay(rawResponse);
  if (reloadedCards.length === 1) {
    displayResponse = applyCodeOwnedTotals(displayResponse, reloadedCards[0]);
  }
  rebuilt.push({
    role: "assistant",
    content: displayResponse,
    mealCards: reloadedCards.length > 0 ? reloadedCards : null,
    factCards: reloadedFacts.length > 0 ? reloadedFacts : null,
    factRemovals: reloadedRemovals.length > 0 ? reloadedRemovals : null,
    goalCards: reloadedGoals.length > 0 ? reloadedGoals : null,
    // dismissed_cards column: cross-device dismissal state. Tolerate the column
    // missing (pre-migration) — treat as none dismissed.
    dismissedCards: Array.isArray(row.dismissed_cards) ? row.dismissed_cards : [],
    aiMessageId: row.id,
    resolved: row.resolved === true,
    thread_id: row.thread_id || null,
    // [v108] On reload we can't recover the original intent, but a stored response
    // WITHOUT structured MEAL_DATA cards was conversational — deny prose parsing so
    // an old question-with-prose-block doesn't resurrect as a card on refresh.
    // Responses WITH cards already render via mealCards and skip prose parsing anyway.
    isPlanningTurn: reloadedCards.length > 0 ? undefined : false,
  });
}
}
setHistory(rebuilt);
}
} catch (e) {
console.log("Messages load error:", e);
}
}

const totals = todayMeals.reduce(
(t, m) => ({
calories: t.calories + Number(m.calories || 0),
protein: t.protein + Number(m.protein || 0),
carbs: t.carbs + Number(m.carbs || 0),
fat: t.fat + Number(m.fat || 0),
}),
{ calories: 0, protein: 0, carbs: 0, fat: 0 }
);

const calPct = goals.calories > 0
? Math.min(100, Math.round((totals.calories / goals.calories) * 100))
: 0;

async function handleSend() {
const trimmed = message.trim();
if ((!trimmed && pendingImages.length === 0) || isLoading) return;

const uid = userId;
setMessage("");
setIsLoading(true);

const userMsg = {
role: "user",
content: trimmed || (pendingImages.length > 0 ? `📷 ${pendingImages.length > 1 ? pendingImages.length + " photos" : "Photo"}` : ""),
imagePreviews: pendingImages.map(img => img.preview),
thread_id: activeThreadId,
};
let newHistory = [...history, userMsg];
setHistory(newHistory);

const imagesToSend = [...pendingImages];
setPendingImages([]);

// Set loading stage based on what's being sent
if (imagesToSend.length > 1) {
setLoadingStage("Comparing labels...");
} else if (imagesToSend.length === 1) {
setLoadingStage("Scanning label...");
} else {
setLoadingStage("Thinking...");
}

// Progressive messages for photo calls
let stageTimer;
if (imagesToSend.length > 0) {
stageTimer = setTimeout(() => setLoadingStage("Reading nutrition values..."), 2500);
setTimeout(() => setLoadingStage("Almost done..."), 5500);
}

try {
let context = {};
let newActiveMealLog = activeMealLog;

// Check if user is confirming a previously suggested meal — MUST check before planning detection
// Look at last 4 AI messages in case the most recent was a text-only response
const recentAiMsgs = [...history].reverse().filter(m => m.role === "assistant").slice(0, 4);
const anyRecentAiHadMeals = recentAiMsgs.some(m => parseAllMeals(m.content).length > 0 || (m.mealCards && m.mealCards.length > 0));
const lastAiHadMeals = anyRecentAiHadMeals;

if (imagesToSend.length === 0 && recentAiMsgs[0]?.goalCards?.length > 0 && /\b[12]\d{3}\b/.test(trimmed) && !statesFoodPhrase(trimmed)) {
// [v91] GOAL FOLLOW-UP: the last AI message was a goal card and this reply carries a
// calorie-sized number ("no, I wanted around 2000") — that's goal negotiation, not a
// food log. Routed BEFORE the log detector so the number can't trip it.
newActiveMealLog = null;
setActiveMealLog(null);
context = { type: "goal_followup" };
} else if (isLogMessage(trimmed, !!activeThreadId) && imagesToSend.length === 0) {
// [v80] ONE ENGINE: every food log goes to the server pipeline. The old client-side
// lookup-foods shortcut is gone — it duplicated the resolver AND merged whole-day
// logs into one meal because it never segmented. The server pipeline is code-owned
// end to end (segmenter → DB resolver → AI-gap write-back → code-rendered cards).
setLoadingStage("Looking up foods...");
newActiveMealLog = {
type: "food_log",
originalMessage: trimmed,
mealType: extractMealType(trimmed),
conversationStage: "initial",
};
setActiveMealLog(newActiveMealLog);
context = newActiveMealLog;
} else if (imagesToSend.length > 0) {
const photoIntent = detectPhotoIntent(trimmed);
newActiveMealLog = null;
setActiveMealLog(null);
context = {
type: "photo",
photoIntent,
imageCount: imagesToSend.length,
message: trimmed,
};
} else if (isConfirmation(trimmed) && lastAiHadMeals) {
// RULE: The 4 buttons are the ONLY way to save. Typing/saying "yes" never saves anything.
setHistory([...newHistory, {
role: "assistant",
content: "Tap Add to Eaten or Add to Planned on the meal above to save it. (You can also change the meal type, Edit, or Cancel there.)",
isConfirmation: true,
}]);
setIsLoading(false);
setLoadingStage("");
return; // Never save from a typed/spoken confirmation
} else if (!statesAFood(trimmed) && (isMealPlanningRequest(trimmed) || isWeightGoalRequest(trimmed) || isMealSwap(trimmed))) {
// A stated food (any tense) must NEVER be captured by planning — it goes to the food_log path above.
if (isMealSwap(trimmed) && history.some(m => m.role === "assistant" && parseAllMeals(m.content).length > 0)) {
// Delete the previous AI message with meals to avoid confusion
const lastAiMealIdx = history.findLastIndex(m => m.role === "assistant" && parseAllMeals(m.content).length > 0);
if (lastAiMealIdx >= 0) {
newHistory = [...history.slice(0, lastAiMealIdx), ...history.slice(lastAiMealIdx + 1)];
}
context = { type: "meal_planning", request: trimmed, isSwap: true };
} else {
context = { type: "meal_planning", request: trimmed };
}

newActiveMealLog = null;
setActiveMealLog(null);
} else if (isQuestionForm(trimmed)) {
// [v109] QUESTION ESCAPE — a question is NEVER a food-log continuation. Without this,
// a question typed right after a log fell into the branch below, shipped to the server
// as context.type="food_log" followup, and the server's food resolver built a card
// from the question's food words — before any question guard ever ran. Route it
// conversational instead: inside a Continue thread the server answers with the full
// threadHistory (so "why are handrolls high in calories" knows about the log above),
// and the v106/v106.1 guards catch any block reflex. Clearing the flag also closes
// the weak-description loop — a question is an exit from "roughly how much?", not an answer to it.
newActiveMealLog = null;
setActiveMealLog(null);
context = {};
} else if (activeMealLog) {
newActiveMealLog = {
...activeMealLog,
followUpMessage: trimmed,
conversationStage: "followup",
};
setActiveMealLog(newActiveMealLog);
context = newActiveMealLog;
}

const res = await fetch("/api/coach", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
message: trimmed,
context,
history: newHistory.slice(-1).map((m) => ({ role: m.role, content: m.content })),
thread_id: activeThreadId,
userId: uid,
localHour: new Date().getHours(),
localMinutes: new Date().getMinutes(),
localDate: getLocalDate(),
images: imagesToSend.length > 0 ? imagesToSend.map(img => ({ base64: img.base64, mimeType: img.mimeType })) : null,
}),
});

const data = await res.json();
const reply = data.reply || "Sorry, could not get a response.";

// [v80] Card resolution:
// 1) Server-built cards (food logs) — code-authored text, use verbatim, no cleaning needed.
// 2) AI-authored replies (photo, single-meal planning) — extract cards from the
//    MEAL_DATA blocks, strip/clean the text, enforce code-owned totals on single cards.
let mealCards = (Array.isArray(data.mealCards) && data.mealCards.length > 0) ? data.mealCards : null;
const factCards = extractFactCards(reply);
const factRemovals = extractFactRemovals(reply);
const goalCards = extractGoalCards(reply);
let displayReply;
if (mealCards) {
displayReply = reply; // code-rendered by the server — display exactly as-is
} else {
const extracted = extractMealCards(reply);
if (extracted.length > 0) mealCards = extracted;
displayReply = cleanForDisplay(reply);
if (mealCards && mealCards.length === 1) {
displayReply = applyCodeOwnedTotals(displayReply, mealCards[0]);
}
}

// [v109] ROOT CAUSE FIX — the log turn is COMPLETE the moment cards come back.
// The card on screen (with its 4 buttons) holds the pending state now, not this flag.
// Pre-v80 this flag was cleared by the auto-save block; the v80 card refactor removed
// auto-save and the clear went with it, so the flag survived forever and swallowed the
// NEXT message as a food-log continuation. The flag now stays set ONLY when the server
// replied without cards — the "roughly how much?" clarifying loop, which is the one
// case where the next message genuinely continues the log.
if (context?.type === "food_log" && mealCards && mealCards.length > 0) {
setActiveMealLog(null);
}

const assistantMessage = {
role: "assistant",
content: displayReply,
// [v108] Intent travels WITH the turn. The prose meal-block parser
// (parseAllMeals) may ONLY run on genuine planning turns. A conversational
// reply — a question, a reaction like "wow that's high", anything not routed
// to meal_planning — must NEVER be scraped into a savable card regardless of
// what words the reply contains. Trusts the classification already made instead
// of re-pattern-matching the reply text.
isPlanningTurn: context?.type === "meal_planning",
mealCards: mealCards || null,
factCards: factCards.length > 0 ? factCards : null,
factRemovals: factRemovals.length > 0 ? factRemovals : null,
goalCards: goalCards.length > 0 ? goalCards : null,
dismissedCards: [],
resolved: false,
thread_id: activeThreadId,
aiMessageId: data.aiMessageId || null,
};

setHistory([
...newHistory,
assistantMessage,
]);

} catch (err) {
console.error("Send error:", err);
setHistory([
...newHistory,
{ role: "assistant", content: "Something went wrong. Please try again." },
]);
} finally {
setIsLoading(false);
setLoadingStage("");
if (stageTimer) clearTimeout(stageTimer);
}
}

async function handleAddToPlan(meal, msgIdx, targetDate) {
// Fix 1: double-tap protection. If a save is already in flight, ignore subsequent taps
// until the first one completes. Prevents duplicate writes when network is slow.
if (isSavingRef.current) return;
isSavingRef.current = true;
setIsSaving(true);
try {
const uid = userId;

const alreadyExists = (rows) => rows.some(r =>
r.date === targetDate &&
r.meal_type === meal.mealType &&
r.food === meal.food &&
Math.abs(Number(r.calories) - Number(meal.calories)) < 5
);
if (alreadyExists(plannedMeals) || alreadyExists(todayMeals)) {
return; // Already saved to DB — no-op, render will hide the button on next paint
}

// Only replace for Breakfast/Lunch/Dinner — Snacks can stack
if (meal.mealType !== "snack") {
const { data: existing } = await supabase
.from("planned_meals")
.select("id")
.eq("user_id", uid)
.eq("meal_type", meal.mealType)
.eq("date", targetDate);

if (existing && existing.length > 0) {
for (const e of existing) {
await supabase.from("planned_meals").delete().eq("id", e.id);
}
}
}

try {
      await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);

      // [v85] Saving also dismisses the button box permanently — DB-content matching
      // alone left zombie buttons after tab switches (the reported bug).
      setDismissedPlanKeys(prev => new Set([...prev, getMealKey(msgIdx, meal)]));

      await loadPlannedMeals(uid);
    } catch (err) {
      alert(`Could not save to plan: ${err.message || "Please try again."}`);
    }
} finally {
isSavingRef.current = false;
setIsSaving(false);
}
}

async function handleAddAllToPlan(meals, msgIdx, targetDate) {
    // Fix 1: double-tap protection.
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
    const uid = userId;
    const failures = [];
    for (const meal of meals) {
      const alreadyExists = (rows) => rows.some(r =>
        r.date === targetDate &&
        r.meal_type === meal.mealType &&
        r.food === meal.food &&
        Math.abs(Number(r.calories) - Number(meal.calories)) < 5
      );
      if (alreadyExists(plannedMeals) || alreadyExists(todayMeals)) {
        continue;
      }
      try {
          await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
          // [v85] save = dismiss, same as the single-add path
          setDismissedPlanKeys(prev => new Set([...prev, getMealKey(msgIdx, meal)]));
        } catch (err) {
          failures.push(`${meal.food}: ${err.message}`);
        }
    }
    await loadPlannedMeals(uid);
    if (failures.length > 0) {
      alert(`Some meals could not be saved:\n${failures.join("\n")}`);
    }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }

  function handleEditPlanMeal(meal) {
const label = getMealLabel(meal.displayType || meal.mealType || "meal");
setHistory(prev => [
...prev,
{
role: "assistant",
content: `Got it — tell me what you'd like instead for ${label}.`,
},
]);
}

function handleCancelPlanMeal(meal, msgIdx) {
const key = getMealKey(msgIdx, meal);
setDismissedPlanKeys(prev => new Set([...prev, key]));
}

// ========================================
// [v80] CARD STATE — cross-device, database-backed
// ========================================

// Resolve the ai_messages row id for a message (with the same fallback markMessageResolved used:
// fresh in-session messages always carry aiMessageId now, but keep the fallback for safety).
async function getDbIdForMsg(msg) {
let id = msg?.aiMessageId;
if (!id && userId) {
try {
const { data } = await supabase
.from("ai_messages")
.select("id")
.eq("user_id", userId)
.eq("resolved", false)
.order("created_at", { ascending: false })
.limit(1);
if (data && data.length > 0) id = data[0].id;
} catch (e) {
console.warn("Could not look up ai_messages row:", e.message);
}
}
return id || null;
}

async function markMessageResolved(msg) {
const id = await getDbIdForMsg(msg);
if (!id) return;
try {
await supabase
.from("ai_messages")
.update({ resolved: true })
.eq("id", id);
} catch (e) {
console.warn("Could not mark message resolved:", e.message);
}
}

// Persist a card dismissal to ai_messages.dismissed_cards (jsonb) — gone on EVERY device.
// [v94] Verified write: reads the column back and retries once. A silently-lost
// dismissal is how the 40-item zombie card happened; it can't be silent anymore.
async function persistDismissedCards(msg, dismissed) {
const id = await getDbIdForMsg(msg);
if (!id) return;
for (let attempt = 0; attempt < 2; attempt++) {
try {
const { data } = await supabase
.from("ai_messages")
.update({ dismissed_cards: dismissed })
.eq("id", id)
.select("dismissed_cards")
.single();
if (data && JSON.stringify(data.dismissed_cards) === JSON.stringify(dismissed)) return;
console.error(`dismissed_cards write verify failed (attempt ${attempt + 1})`, data);
} catch (e) {
console.error(`dismissed_cards write error (attempt ${attempt + 1}):`, e.message);
}
}
}

// Is this card fully saved in the DB (every item row matches)? Cross-device by nature.
function cardSavedInDb(card, mealType, targetDate, todayRows, plannedRows) {
const rows = cardToSaveRows(card, mealType);
if (rows.length === 0) return false;
const matches = (dbRows, r) => dbRows.some(dbr =>
dbr.date === targetDate &&
dbr.meal_type === r.mealType &&
dbr.food === r.food &&
Math.abs(Number(dbr.calories) - Number(r.calories)) < 5
);
return rows.every(r => matches(todayRows, r) || matches(plannedRows, r));
}

// After any card action: if every card on the message is saved-or-dismissed, flip resolved.
async function checkAndResolveMessage(msg, msgIdx, dismissed, targetDate, freshToday, freshPlanned) {
const cards = msg.mealCards || [];
const todayRows = freshToday || todayMeals;
const plannedRows = freshPlanned || plannedMeals;
const allHandled = cards.every((card, ci) => {
if (dismissed.includes(ci)) return true;
const typeKey = `${msgIdx}:${ci}`;
const currentType = selectedMealTypes[typeKey] || card.meal_type;
return cardSavedInDb(card, currentType, targetDate, todayRows, plannedRows);
});
if (allHandled && cards.length > 0) {
await markMessageResolved(msg);
setHistory(prev => prev.map((m, i) => i === msgIdx ? { ...m, resolved: true } : m));
}
}

// The single card action handler — eat / plan / edit / cancel, per card.
async function handleCardAction(action, msg, msgIdx, cardIdx, mealType, targetDate) {
if (isSavingRef.current) return;
isSavingRef.current = true;
setIsSaving(true);
try {
const card = (msg.mealCards || [])[cardIdx];
if (!card) return;

if (action === "cancel" || action === "edit") {
// Cancel and Edit are the SAME operation on the card: permanently dismissed,
// everywhere, forever. Edit just invites a fresh log message afterwards —
// the correction flows through the normal pipeline as a brand-new card.
const newDismissed = [...(msg.dismissedCards || []), cardIdx];
setHistory(prev => prev.map((m, i) => i === msgIdx ? { ...m, dismissedCards: newDismissed } : m));
await persistDismissedCards(msg, newDismissed);
setHistory(prev => [
...prev,
{
role: "assistant",
content: action === "cancel"
? "Canceled — I won't save that meal."
: "Got it — tell me what you actually had instead, and I'll build a fresh card.",
isConfirmation: true,
},
]);
await checkAndResolveMessage({ ...msg, dismissedCards: newDismissed }, msgIdx, newDismissed, targetDate, null, null);
return;
}

// eat / plan
const rows = cardToSaveRows(card, mealType);
if (rows.length === 0) {
alert("No meal data found to save. Try logging again.");
return;
}
const table = action === "eat" ? "actual_meals" : "planned_meals";
// [v96] MEAL GROUPING — every row saved from this card shares ONE group id, so the
// dashboard can treat the whole meal as a unit (one-tap promote to eaten). Plan saves
// only; actual_meals rows stay individual. Falls back to ungrouped if randomUUID is
// unavailable — the column is uuid-typed, so never send a non-uuid string.
const mealGroupId = (action === "plan" && typeof crypto !== "undefined" && crypto.randomUUID)
? crypto.randomUUID() : null;

console.log("💾 Saving card:", { cardIdx, count: rows.length, table, date: targetDate, mealType, mealGroupId });

try {
for (const row of rows) {
await saveMealViaAPI(table, { ...row, date: targetDate, ...(mealGroupId ? { mealGroupId } : {}) }, userId);
}

// [v84] On success the card is ALSO dismissed (cross-device, DB-backed). Saved-detection
// by DB match only sees today's meals, so backdated saves used to leave zombie cards.
const savedDismissed = [...(msg.dismissedCards || []), cardIdx];
setHistory(prev => prev.map((m, i) => i === msgIdx ? { ...m, dismissedCards: savedDismissed } : m));
await persistDismissedCards(msg, savedDismissed);

// Refetch DB state so saved-detection hides this card on next paint.
let freshToday = null, freshPlanned = null;
if (action === "eat") {
freshToday = await loadTodayMeals(userId);
} else {
freshPlanned = await loadPlannedMeals(userId);
}

let obsSuffix = "";
if (action === "eat" && targetDate === getLocalDate()) {
try {
const freshTotals = (freshToday || []).reduce((t, m) => ({
calories: t.calories + (Number(m.calories) || 0),
protein: t.protein + (Number(m.protein) || 0),
carbs: t.carbs + (Number(m.carbs) || 0),
fat: t.fat + (Number(m.fat) || 0),
}), { calories: 0, protein: 0, carbs: 0, fat: 0 });
const obs = standardObservations(freshTotals, goals);
if (obs.line) obsSuffix = `\n\n${obs.line}${obs.offer ? "\n" + obs.offer : ""}`;
} catch (e) { /* best-effort; never block the save */ }
}

const label = getMealLabel(mealType);
const when = dateLabel(targetDate);
setHistory(prev => [
...prev,
{
role: "assistant",
content: (action === "eat"
? `✅ ${label} (${when}) added to your eaten food`
: `✅ ${label} (${when}) added to your planned meals`) + obsSuffix,
isConfirmation: true,
},
]);

await checkAndResolveMessage({ ...msg, dismissedCards: savedDismissed }, msgIdx, savedDismissed, targetDate, freshToday, freshPlanned);
} catch (err) {
console.error("❌ CARD SAVE ERROR:", err);
alert(`Could not save meal: ${err.message || 'Unknown error'}. Please try again.`);
}
} finally {
isSavingRef.current = false;
setIsSaving(false);
}
}

// Save ALL visible cards in one tap (whole-day logs). Each card keeps its own meal type.
async function handleAddAllCards(action, msg, msgIdx, visibleCardIdxs, targetDate) {
if (isSavingRef.current) return;
isSavingRef.current = true;
setIsSaving(true);
try {
const table = action === "eat" ? "actual_meals" : "planned_meals";
const failures = [];
const savedIdxs = [];
for (const ci of visibleCardIdxs) {
const card = (msg.mealCards || [])[ci];
if (!card) continue;
const typeKey = `${msgIdx}:${ci}`;
const mealType = selectedMealTypes[typeKey] || card.meal_type;
// [v84] each card saves to ITS OWN date (override > card-carried > message default)
const cardDate = selectedCardDates[typeKey] || card.date || targetDate;
const rows = cardToSaveRows(card, mealType);
// [v96] one group id per CARD — this card's items form one meal on the dashboard
const mealGroupId = (action === "plan" && typeof crypto !== "undefined" && crypto.randomUUID)
? crypto.randomUUID() : null;
let cardFailed = false;
for (const row of rows) {
try {
await saveMealViaAPI(table, { ...row, date: cardDate, ...(mealGroupId ? { mealGroupId } : {}) }, userId);
} catch (err) {
failures.push(`${row.food}: ${err.message}`);
cardFailed = true;
}
}
if (!cardFailed) savedIdxs.push(ci);
}
// [v84] dismiss every successfully saved card (cross-device; survives backdating)
let newDismissed = msg.dismissedCards || [];
if (savedIdxs.length > 0) {
newDismissed = [...newDismissed, ...savedIdxs];
setHistory(prev => prev.map((m, i) => i === msgIdx ? { ...m, dismissedCards: newDismissed } : m));
await persistDismissedCards(msg, newDismissed);
}
let freshToday = null, freshPlanned = null;
if (action === "eat") {
freshToday = await loadTodayMeals(userId);
} else {
freshPlanned = await loadPlannedMeals(userId);
}

let obsSuffix = "";
if (action === "eat" && failures.length === 0 && freshToday) {
try {
const freshTotals = (freshToday || []).reduce((t, m) => ({
calories: t.calories + (Number(m.calories) || 0),
protein: t.protein + (Number(m.protein) || 0),
carbs: t.carbs + (Number(m.carbs) || 0),
fat: t.fat + (Number(m.fat) || 0),
}), { calories: 0, protein: 0, carbs: 0, fat: 0 });
const obs = standardObservations(freshTotals, goals);
if (obs.line) obsSuffix = `\n\n${obs.line}${obs.offer ? "\n" + obs.offer : ""}`;
} catch (e) {}
}

if (failures.length > 0) {
alert(`Some meals could not be saved:\n${failures.join("\n")}`);
} else {
setHistory(prev => [
...prev,
{
role: "assistant",
content: (action === "eat"
? `✅ All ${visibleCardIdxs.length} meals added to your eaten food`
: `✅ All ${visibleCardIdxs.length} meals added to your planned meals`) + obsSuffix,
isConfirmation: true,
},
]);
}
await checkAndResolveMessage({ ...msg, dismissedCards: newDismissed }, msgIdx, newDismissed, targetDate, freshToday, freshPlanned);
} finally {
isSavingRef.current = false;
setIsSaving(false);
}
}

// [v83] Fact/goal confirmation cards. Save writes through /api/facts; both save and
// dismiss push a string token ("f0"/"g0") into the same dismissed_cards store the meal
// cards use — cross-device, permanent, and collision-free with numeric meal indices.
async function handleIntelCard(action, msg, msgIdx, token, payload) {
if (isSavingRef.current) return;
isSavingRef.current = true;
setIsSaving(true);
try {
const newDismissed = [...(msg.dismissedCards || []), token];
// [v94] DISMISS-FIRST: the card dies the instant it's tapped — dismissal is
// persisted BEFORE the (possibly slow) save runs. The 40-item batch save took
// seconds, and a tab switch in that window lost the dismissal entirely: saved
// data, zombie card. If the save fails, code deliberately RESURRECTS the card
// (un-dismisses it) and says so — never the other way around.
setHistory(prev => prev.map((m, i) => i === msgIdx ? { ...m, dismissedCards: newDismissed } : m));
await persistDismissedCards(msg, newDismissed);

if (action === "save") {
try {
const res = await fetch("/api/facts", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ userId, ...payload, source: "chat" }),
});
const data = await res.json();
if (!data.success) throw new Error(data.error || "Save failed");
} catch (err) {
// resurrect the card so the user can retry — dismissal rolled back everywhere
const reverted = (msg.dismissedCards || []).filter(t => t !== token);
setHistory(prev => prev.map((m, i) => i === msgIdx ? { ...m, dismissedCards: reverted } : m));
await persistDismissedCards(msg, reverted);
alert(`Could not save: ${err.message}. The card is back — tap Save to retry.`);
return;
}
}
if (action === "save" && payload.goal) {
await loadGoals(userId); // header ring + macro bars pick up the new targets
setHistory(prev => [...prev, {
role: "assistant",
content: `✅ Targets updated: ${payload.goal.calories} cal · ${payload.goal.protein}g P / ${payload.goal.carbs}g C / ${payload.goal.fat}g F`,
isConfirmation: true,
}]);
} else if (action === "save" && payload.remove) {
setHistory(prev => [...prev, {
role: "assistant",
content: `🗑 Removed from your profile: ${factCardLabel(payload.fact)}`,
isConfirmation: true,
}]);
} else if (action === "save") {
setHistory(prev => [...prev, {
role: "assistant",
content: Array.isArray(payload.fact?.values)
? `✅ Saved to your profile: ${payload.fact.values.length} foods added to ${(FACT_KIND_LABELS[payload.fact.kind] || payload.fact.kind)}s`
: `✅ Saved to your profile: ${factCardLabel(payload.fact)}`,
isConfirmation: true,
}]);
}
} finally {
isSavingRef.current = false;
setIsSaving(false);
}
}

function handleKeyDown(e) {
if (e.key === "Enter" && !e.shiftKey) {
e.preventDefault();
handleSend();
}
}

async function handleImageSelected(e) {
const file = e.target.files?.[0];
if (!file) return;
setShowPhotoMenu(false);

// Compress image using canvas before sending — prevents Vercel 4.5MB limit
const compressImage = (file) => new Promise((resolve) => {
const img = new Image();
const url = URL.createObjectURL(file);
img.onload = () => {
const MAX = 1024;
let { width, height } = img;
if (width > MAX || height > MAX) {
if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
else { width = Math.round(width * MAX / height); height = MAX; }
}
const canvas = document.createElement("canvas");
canvas.width = width; canvas.height = height;
canvas.getContext("2d").drawImage(img, 0, 0, width, height);
const preview = canvas.toDataURL("image/jpeg", 0.85);
const base64 = preview.split(",")[1];
URL.revokeObjectURL(url);
resolve({ base64, mimeType: "image/jpeg", preview });
};
img.src = url;
});

const compressed = await compressImage(file);
setPendingImages(prev => {
if (prev.length >= 4) return prev;
return [...prev, compressed];
});
e.target.value = "";
}

function removeImage(idx) {
setPendingImages(prev => prev.filter((_, i) => i !== idx));
}

function clearImages() {
setPendingImages([]);
}

// ── CURA Theme ──────────────────────────────────────────────────
const dark = typeof window !== "undefined"
? localStorage.getItem("cura_dark") !== "false"
: true;

const T = dark ? {
bg: "#1c1c1e",
surface: "#242424",
border: "#2c2c2c",
text: "#f0f0f0",
sub: "#888888",
muted: "#3a3a3a",
input: "#2c2c2c",
userBubble: "#2563eb",
aiBubble: "#242424",
aiBorder: "#2c2c2c",
} : {
bg: "#f5f5f5",
surface: "#ffffff",
border: "#ebebeb",
text: "#111111",
sub: "#aaaaaa",
muted: "#f0f0f0",
input: "#f5f5f5",
userBubble: "#2563eb",
aiBubble: "#ffffff",
aiBorder: "#ebebeb",
};

return (
<>
<style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
* { box-sizing: border-box; }
body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; }
`}</style>

<div style={{ display:"flex", flexDirection:"column", height:"100vh",
background: T.bg, fontFamily:"'DM Sans', sans-serif",
maxWidth: 430, margin:"0 auto" }}>

{/* Hidden file inputs */}
<input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
onChange={handleImageSelected} style={{ display:"none" }} />
<input ref={libraryInputRef} type="file" accept="image/*"
onChange={handleImageSelected} style={{ display:"none" }} />

{/* ── Sticky Header ── */}
<div style={{ position:"sticky", top:0, zIndex:50, background: T.surface,
borderBottom:`1px solid ${T.border}`, padding:"52px 20px 14px" }}>
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
<div>
<p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
textTransform:"uppercase", letterSpacing:".1em", margin:0 }}>CURA</p>
<h1 style={{ fontSize:20, fontWeight:800, color: T.text,
margin:"2px 0 0", letterSpacing:"-.02em" }}>
{userName ? `Hey ${userName} 👋` : "AI Coach"}
</h1>
</div>
<div style={{ background:"#2563eb22", border:"1px solid #2563eb44",
borderRadius:16, padding:"8px 12px", textAlign:"right" }}>
<p style={{ fontSize:15, fontWeight:800, color:"#2563eb",
margin:0, lineHeight:1.2 }}>
{totals.calories} <span style={{ fontWeight:400, color:"#3b82f6", fontSize:12 }}>/ {goals.calories}</span>
</p>
<p style={{ fontSize:10, color:"#3b82f6", margin:0, fontWeight:600 }}>
cal today · {calPct}%
</p>
</div>
</div>
{todayMeals.length > 0 && (
<div style={{ display:"flex", gap:8, marginTop:12 }}>
{[
{ label:"P", value:totals.protein, goal:goals.protein, color:"#3b82f6" },
{ label:"C", value:totals.carbs, goal:goals.carbs, color:"#10b981" },
{ label:"F", value:totals.fat, goal:goals.fat, color:"#f59e0b" },
].map(m => {
const pct = Math.min(100, Math.round((m.value/m.goal)*100));
return (
<div key={m.label} style={{ flex:1 }}>
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
<span style={{ fontSize:10, fontWeight:600, color: T.sub,
textTransform:"uppercase", letterSpacing:".05em" }}>{m.label}</span>
<span style={{ fontSize:10, fontWeight:700, color: T.text }}>
{Math.round(m.value)}g
</span>
</div>
<div style={{ height:3, background: T.muted, borderRadius:9999, overflow:"hidden" }}>
<div style={{ height:"100%", width:`${pct}%`, background: m.color,
borderRadius:9999, transition:"width .5s ease" }} />
</div>
</div>
);
})}
</div>
)}
</div>

{/* ── Messages ── */}
<div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px",
display:"flex", flexDirection:"column", gap:12, background: T.bg }}>

{history.length === 0 && (
<div style={{ display:"flex", flexDirection:"column", alignItems:"center",
justifyContent:"center", height:"100%", textAlign:"center", padding:"0 16px 80px" }}>
<div style={{ width:64, height:64, borderRadius:20, background:"#2563eb",
display:"flex", alignItems:"center", justifyContent:"center",
fontSize:28, marginBottom:16, boxShadow:"0 8px 24px #2563eb44" }}>
💬
</div>
<p style={{ fontWeight:800, color: T.text, fontSize:18, margin:"0 0 8px" }}>CURA</p>
<p style={{ fontSize:13, color: T.sub, lineHeight:1.5, maxWidth:260, margin:0 }}>
Tell me what you ate, ask for a meal plan, or get nutrition advice.
</p>
<div style={{ marginTop:20, display:"flex", flexDirection:"column",
gap:8, width:"100%", maxWidth:280 }}>
{[
"I had 8oz chicken and 1 cup rice for lunch",
"Create a meal plan for tomorrow",
"What should I eat for dinner?",
"I want to drop 10 pounds",
].map(s => (
<button key={s} onClick={() => setMessage(s)}
style={{ textAlign:"left", fontSize:13, padding:"12px 14px",
borderRadius:14, border:`1px solid ${T.border}`,
background: T.surface, color: T.sub, cursor:"pointer",
transition:"all .2s" }}>
{s}
</button>
))}
</div>
</div>
)}

{history.map((msg, idx) => {
const isUser = msg.role === "user";

// Find meals — only look back 3 messages (planning-path confirmation flows)
const findRecentMeals = (beforeIdx) => {
const limit = Math.max(0, beforeIdx - 3);
for (let i = beforeIdx - 1; i >= limit; i--) {
if (history[i].role === "assistant") {

const m = parseAllMeals(history[i].content);
if (m.length > 0) return { meals: m, sourceIdx: i };
}
}
return { meals: [], sourceIdx: -1 };
};

const prevUserMsg = !isUser && history[idx - 1]?.role === "user" ? history[idx - 1].content : null;
const thisIsPostConfirmAI = !isUser && prevUserMsg && isConfirmation(prevUserMsg);

// Photo selection — winner pick OR "yes log it" after label advice
const isPhotoSelection = !isUser && prevUserMsg && (
/\b(whole bag|full bag|all of it|i'?ll go (with|over)|i will go (with|over)|i'?ll take that|i choose|going with|log it|add it|yes please log|want to log|add to plan|log this)\b/i.test(prevUserMsg)
|| (isConfirmation(prevUserMsg) && history.slice(Math.max(0, idx-4), idx)
.some(m => m.role === "assistant" && /want me to log|add it to your plan|log it or add/i.test(m.content)))
);

const { meals: confirmMeals, sourceIdx } = (thisIsPostConfirmAI || isPhotoSelection)
? findRecentMeals(idx) : { meals: [], sourceIdx: -1 };

// PLANNING PATH ONLY: prose meal blocks in AI day plans. A message that carries
// structured mealCards NEVER uses this path — cards own the save UI.
// [v108] Prose meal blocks parse ONLY on genuine planning turns. Legacy messages
// saved before v108 lack the flag (undefined) — those keep old behavior so history
// still renders; new conversational turns (questions, reactions) are gated out and
// can never become a savable card from scraped prose.
const proseParseAllowed = msg.isPlanningTurn === true || (msg.isPlanningTurn === undefined && !msg.mealCards);
const thisMeals = (!isUser && !msg.mealCards && proseParseAllowed) ? parseAllMeals(msg.content) : [];

const triggerText = !isUser && history[idx - 1]?.role === "user"
? history[idx - 1].content : "";
const surroundingTexts = history.slice(Math.max(0, idx - 6), idx).map(m => m.content || "");
const targetDate = extractTargetDate(triggerText, surroundingTexts);

const planMealsFromThisMessage =
!isUser && !msg.mealCards && !msg.resolved && thisMeals.length > 0
? thisMeals
: [];

const buttonMeals = planMealsFromThisMessage.length > 0
? planMealsFromThisMessage
: (thisIsPostConfirmAI && confirmMeals.length > 0)
? confirmMeals
: (isPhotoSelection && confirmMeals.length > 0)
? confirmMeals
: [];

const buttonSourceIdx = planMealsFromThisMessage.length > 0
? idx
: (sourceIdx >= 0 ? sourceIdx : idx);

// Hide plan buttons for meals already saved in the database (by content match).
            const mealAlreadyInDb = (m) => {
            
              const matches = (rows) => rows.some(r =>
                r.date === targetDate &&
                r.meal_type === m.mealType &&
                r.food === m.food &&
                Math.abs(Number(r.calories) - Number(m.calories)) < 5
              );
              return matches(todayMeals) || matches(plannedMeals);
            };

            const visibleButtonMeals = buttonMeals.filter((m) => {
              const key = getMealKey(buttonSourceIdx, m);
              if (dismissedPlanKeys.has(key)) return false;
              if (mealAlreadyInDb(m)) return false;
              return true;
            });

const showButtons = visibleButtonMeals.length > 0;
const allSaved = false;

// [v80] CARD VISIBILITY — one card per meal, each with its own lifecycle:
// hidden when the message is resolved, when the card index is in dismissed_cards
// (cross-device, DB-backed), or when every item row already matches the DB (saved).
const dismissed = msg.dismissedCards || [];
const visibleCardIdxs = (!isUser && !msg.resolved && msg.mealCards)
? msg.mealCards.map((_, ci) => ci).filter(ci => {
const card = msg.mealCards[ci];
if (dismissed.includes(ci)) return false;
const typeKey = `${idx}:${ci}`;
const currentType = selectedMealTypes[typeKey] || card.meal_type;
// [v84] the card's own date (override > card-carried > legacy message-context fallback)
const cardDate = selectedCardDates[typeKey] || card.date || targetDate;
if (cardSavedInDb(card, currentType, cardDate, todayMeals, plannedMeals)) return false;
return true;
})
: [];

return (
<div key={idx} style={{ display:"flex",
justifyContent: isUser ? "flex-end" : "flex-start",
alignItems:"flex-end", gap:8 }}>

{!isUser && (
<div style={{ width:32, height:32, borderRadius:10, background:"#2563eb",
display:"flex", alignItems:"center", justifyContent:"center",
fontSize:16, flexShrink:0, marginBottom:4,
boxShadow:"0 2px 8px #2563eb44" }}>
💬
</div>
)}

<div style={{ maxWidth:"82%", display:"flex", flexDirection:"column", gap:6 }}>
{/* Image previews */}
{msg.imagePreviews && msg.imagePreviews.length > 0 && (
<div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
{msg.imagePreviews.map((preview, i) => (
<img key={i} src={preview} alt={`Photo ${i+1}`}
style={{ height:90, width:90, objectFit:"cover",
borderRadius:12, border:`1px solid ${T.border}` }} />
))}
</div>
)}

{/* Message bubble */}
{msg.content && (
<div style={{
borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
padding:"12px 14px", fontSize:14, lineHeight:1.5,
whiteSpace:"pre-wrap",
background: isUser ? T.userBubble : T.aiBubble,
color: isUser ? "#fff" : T.text,
border: isUser ? "none" : `1px solid ${T.aiBorder}`,
}}>
{msg.content}
</div>
)}

{/* [v80] MEAL CARDS — one save box per meal, own dropdown, own buttons */}
{visibleCardIdxs.length > 0 && (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>

{/* [v95] DATE-AWARE BULK BUTTON — planning tomorrow must NEVER write eaten rows.
    All visible cards future-dated → bulk action is PLAN. All today/past → EAT.
    Mixed dates (per-card overrides) → no bulk button; per-card buttons decide. */}
{visibleCardIdxs.length > 1 && (() => {
const todayStrBulk = getLocalDate();
const effDate = (ci) => {
const c = msg.mealCards[ci];
return selectedCardDates[`${idx}:${ci}`] || c.date || targetDate;
};
const allFuture = visibleCardIdxs.every(ci => effDate(ci) > todayStrBulk);
const anyFuture = visibleCardIdxs.some(ci => effDate(ci) > todayStrBulk);
if (anyFuture && !allFuture) return null;
const bulkColor = allFuture ? "#2563eb" : "#10b981";
return (
<button
onClick={() => handleAddAllCards(allFuture ? "plan" : "eat", msg, idx, visibleCardIdxs, targetDate)}
disabled={isSaving}
style={{
fontSize:12, padding:"10px 16px", borderRadius:12, fontWeight:700,
background: isSaving ? `${bulkColor}55` : bulkColor, color:"#fff",
border:"none", cursor:"pointer",
}}
>
{allFuture
? `📅 Add all ${visibleCardIdxs.length} meals to planned`
: `✅ Add all ${visibleCardIdxs.length} meals to eaten`}
</button>
);
})()}

{visibleCardIdxs.map(ci => {
const card = msg.mealCards[ci];
const typeKey = `${idx}:${ci}`;
const currentMealType = selectedMealTypes[typeKey] || card.meal_type;
// [v84] the date this card will save to — server-decided, user-correctable
const cardDate = selectedCardDates[typeKey] || card.date || targetDate;
const label = getMealLabel(currentMealType);
const t = cardTotals(card);
const todayStr = getLocalDate();
const dateOptions = [
{ value: addDays(todayStr, -1), label: "Yesterday" },
{ value: todayStr, label: "Today" },
{ value: addDays(todayStr, 1), label: "Tomorrow" },
];
if (!dateOptions.some(o => o.value === cardDate)) {
dateOptions.unshift({ value: cardDate, label: dateLabel(cardDate) });
}

const buttonBase = {
color:"#fff",
border:"none",
borderRadius:10,
padding:"8px 12px",
fontWeight:600,
cursor:"pointer",
fontSize: 13,
};

return (
<div key={ci} style={{
display:"flex", flexDirection:"column", gap:8,
padding:"12px", borderRadius:12,
border:`1px solid ${T.border}`, background:T.surface,
}}>
<div style={{ fontSize:12, fontWeight:800, color:T.text }}>
{label} · <span style={{ color: cardDate === todayStr ? T.text : "#f59e0b" }}>{dateLabel(cardDate)}</span> · {Math.round(t.calories)} cal · {Math.round(t.protein)}g P
</div>

<div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
{/* [v95] DATE-AWARE PRIMARY BUTTON — a future-dated meal can only be PLANNED,
    never eaten (you can't have already eaten tomorrow's lunch). The buttons
    react to the date dropdown: correct the date to today and Eaten returns. */}
{cardDate > todayStr ? (
<button
onClick={() => handleCardAction("plan", msg, idx, ci, currentMealType, cardDate)}
disabled={isSaving}
style={{ ...buttonBase, background: isSaving ? "#2563eb55" : "#2563eb" }}
>
📅 Add to Planned
</button>
) : (
<button
onClick={() => handleCardAction("eat", msg, idx, ci, currentMealType, cardDate)}
disabled={isSaving}
style={{ ...buttonBase, background: isSaving ? "#10b98155" : "#10b981" }}
>
✅ Add to Eaten
</button>
)}

<div style={{ position:"relative", display:"inline-block" }}>
<select
value={currentMealType}
onChange={(e) => setSelectedMealTypes(prev => ({ ...prev, [typeKey]: e.target.value }))}
disabled={isSaving}
style={{
...buttonBase,
background:"#374151",
appearance:"none",
WebkitAppearance:"none",
paddingRight: 26,
cursor:"pointer",
}}
>
<option value="breakfast">Breakfast</option>
<option value="lunch">Lunch</option>
<option value="snack">Snack</option>
<option value="dinner">Dinner</option>
</select>
<span style={{
position:"absolute",
right:8,
top:"50%",
transform:"translateY(-50%)",
pointerEvents:"none",
color:"#fff",
fontSize:10,
}}>▾</span>
</div>

{/* [v84] date selector — a wrong server guess is one tap to fix, BEFORE saving */}
<div style={{ position:"relative", display:"inline-block" }}>
<select
value={cardDate}
onChange={(e) => setSelectedCardDates(prev => ({ ...prev, [typeKey]: e.target.value }))}
disabled={isSaving}
style={{
...buttonBase,
background: cardDate === todayStr ? "#374151" : "#b45309",
appearance:"none",
WebkitAppearance:"none",
paddingRight: 26,
cursor:"pointer",
}}
>
{dateOptions.map(o => (
<option key={o.value} value={o.value}>{o.label}</option>
))}
</select>
<span style={{
position:"absolute",
right:8,
top:"50%",
transform:"translateY(-50%)",
pointerEvents:"none",
color:"#fff",
fontSize:10,
}}>▾</span>
</div>

{/* [v95] hidden on future-dated cards — Planned is already the primary button above */}
{cardDate <= todayStr && (
<button
onClick={() => handleCardAction("plan", msg, idx, ci, currentMealType, cardDate)}
disabled={isSaving}
style={{ ...buttonBase, background: isSaving ? "#2563eb55" : "#2563eb" }}
>
📅 Add to Planned
</button>
)}

<button
onClick={() => handleCardAction("edit", msg, idx, ci, currentMealType, cardDate)}
disabled={isSaving}
style={{ ...buttonBase, background: isSaving ? "#f59e0b55" : "#f59e0b" }}
>
✏️ Edit
</button>

<button
onClick={() => handleCardAction("cancel", msg, idx, ci, currentMealType, cardDate)}
disabled={isSaving}
style={{ ...buttonBase, background: isSaving ? "#ef444455" : "#ef4444" }}
>
❌ Cancel
</button>
</div>
</div>
);
})}
</div>
)}

{/* [v83] FACT / GOAL confirmation cards — the review gate for the intelligence layer */}
{!isUser && ((msg.factCards && msg.factCards.length > 0) || (msg.factRemovals && msg.factRemovals.length > 0) || (msg.goalCards && msg.goalCards.length > 0)) && (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
{(msg.factCards || []).map((fact, fi) => {
const token = `f${fi}`;
if ((msg.dismissedCards || []).includes(token)) return null;
return (
<div key={token} style={{ display:"flex", flexDirection:"column", gap:8,
padding:"12px", borderRadius:12, border:"1px solid #8b5cf655", background:T.surface }}>
<div style={{ fontSize:12, fontWeight:800, color:T.text }}>
🧠 Save to your profile?
</div>
<div style={{ fontSize:13, color:T.text }}>
{factCardLabel(fact)}
{fact.reason ? <span style={{ color:T.sub }}> — {fact.reason}</span> : null}
</div>
<div style={{ display:"flex", gap:6 }}>
<button
onClick={() => handleIntelCard("save", msg, idx, token, { fact })}
disabled={isSaving}
style={{ color:"#fff", border:"none", borderRadius:10, padding:"8px 12px",
fontWeight:600, cursor:"pointer", fontSize:13,
background: isSaving ? "#8b5cf655" : "#8b5cf6" }}
>
💾 Save
</button>
<button
onClick={() => handleIntelCard("dismiss", msg, idx, token, { fact })}
disabled={isSaving}
style={{ color:"#fff", border:"none", borderRadius:10, padding:"8px 12px",
fontWeight:600, cursor:"pointer", fontSize:13,
background: isSaving ? "#ef444455" : "#ef4444" }}
>
❌ No
</button>
</div>
</div>
);
})}

{(msg.factRemovals || []).map((fact, ri) => {
const token = `r${ri}`;
if ((msg.dismissedCards || []).includes(token)) return null;
return (
<div key={token} style={{ display:"flex", flexDirection:"column", gap:8,
padding:"12px", borderRadius:12, border:"1px solid #ef444455", background:T.surface }}>
<div style={{ fontSize:12, fontWeight:800, color:T.text }}>
🗑 Remove from your profile?
</div>
<div style={{ fontSize:13, color:T.text }}>
{factCardLabel(fact)}
</div>
<div style={{ display:"flex", gap:6 }}>
<button
onClick={() => handleIntelCard("save", msg, idx, token, { remove: true, fact })}
disabled={isSaving}
style={{ color:"#fff", border:"none", borderRadius:10, padding:"8px 12px",
fontWeight:600, cursor:"pointer", fontSize:13,
background: isSaving ? "#ef444455" : "#ef4444" }}
>
🗑 Remove
</button>
<button
onClick={() => handleIntelCard("dismiss", msg, idx, token, { remove: true, fact })}
disabled={isSaving}
style={{ color:"#fff", border:"none", borderRadius:10, padding:"8px 12px",
fontWeight:600, cursor:"pointer", fontSize:13,
background: isSaving ? "#37415155" : "#374151" }}
>
Keep it
</button>
</div>
</div>
);
})}

{(msg.goalCards || []).map((goal, gi) => {
const token = `g${gi}`;
if ((msg.dismissedCards || []).includes(token)) return null;
return (
<div key={token} style={{ display:"flex", flexDirection:"column", gap:8,
padding:"12px", borderRadius:12, border:"1px solid #2563eb55", background:T.surface }}>
<div style={{ fontSize:12, fontWeight:800, color:T.text }}>
🎯 New daily targets (computed, not guessed)
</div>
<div style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>
{goal.calories} cal · {goal.protein}g P / {goal.carbs}g C / {goal.fat}g F
{Number(goal.maintenance) > 0 ? (
<div style={{ color:T.sub, fontSize:12 }}>
Anchored to your maintenance: ~{goal.maintenance} cal/day
</div>
) : null}
{goal.direction && goal.direction !== "maintain" && goal.est_weeks ? (
<div style={{ color:T.sub, fontSize:12 }}>
{goal.direction === "lose" ? "Losing" : "Gaining"} ~{goal.weekly_rate_lbs} lb/week · about {goal.est_weeks} weeks
{goal.target_weight ? ` · target ${goal.target_weight} ${goal.weight_unit}` : ""}
</div>
) : null}
{goal.clamped ? (
<div style={{ color:"#f59e0b", fontSize:12, marginTop:2 }}>
⚠️ Adjusted to a safe rate — faster isn't sustainable or healthy.
</div>
) : null}
{goal.note ? (
<div style={{ color:"#f59e0b", fontSize:12, marginTop:2 }}>
{goal.note}
</div>
) : null}
</div>
<div style={{ display:"flex", gap:6 }}>
<button
onClick={() => handleIntelCard("save", msg, idx, token, { goal })}
disabled={isSaving}
style={{ color:"#fff", border:"none", borderRadius:10, padding:"8px 12px",
fontWeight:600, cursor:"pointer", fontSize:13,
background: isSaving ? "#2563eb55" : "#2563eb" }}
>
✅ Update my targets
</button>
<button
onClick={() => handleIntelCard("dismiss", msg, idx, token, { goal })}
disabled={isSaving}
style={{ color:"#fff", border:"none", borderRadius:10, padding:"8px 12px",
fontWeight:600, cursor:"pointer", fontSize:13,
background: isSaving ? "#ef444455" : "#ef4444" }}
>
❌ Keep current
</button>
</div>
</div>
);
})}
</div>
)}

{/* ↩ Continue — start/extend a thread from this AI reply (not on status confirmations) */}
{!isUser && msg.content && !msg.isConfirmation && (
  <button
    onClick={() => {
      const tid = msg.thread_id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));
      setActiveThreadId(tid);
      if (!msg.thread_id) {
        setHistory(prev => prev.map((m, i) => i === idx ? { ...m, thread_id: tid } : m));
        if (msg.aiMessageId) {
          fetch("/api/thread-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aiMessageId: msg.aiMessageId, thread_id: tid }),
          }).catch(() => {});
        }
      }
    }}
    style={{
      alignSelf: "flex-start",
      background: (msg.thread_id && msg.thread_id === activeThreadId) ? "#2563eb22" : "transparent",
      border: "none",
      color: (msg.thread_id && msg.thread_id === activeThreadId) ? "#3b82f6" : "#9ca3af",
      fontSize: 13, cursor: "pointer", marginTop: 2, padding: "4px 8px", borderRadius: 8,
    }}
  >
    ↩ Continue
  </button>
)}

{/* Meal plan buttons (planning path — prose day plans, unchanged) */}
{showButtons && (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
{visibleButtonMeals.length > 1 && (
<button
onClick={() => handleAddAllToPlan(visibleButtonMeals, buttonSourceIdx, targetDate)}
disabled={allSaved}
style={{
fontSize:12,
padding:"10px 16px",
borderRadius:12,
fontWeight:700,
background: allSaved ? "#10b98122" : "#10b981",
color: allSaved ? "#10b981" : "#fff",
border:"none",
cursor: allSaved ? "default" : "pointer",
}}
>
{allSaved ? "✅ All selected meals added" : `+ Add all ${visibleButtonMeals.length} meals to plan`}
</button>
)}

{visibleButtonMeals.map(meal => {
const key = getMealKey(buttonSourceIdx, meal);
const isSaved = mealAlreadyInDb(meal);
const label = getMealLabel(meal.displayType);
const hasExisting = meal.mealType !== "snack" && plannedMeals.some(
pm => pm.meal_type === meal.mealType && pm.date === targetDate
);

// Don't show buttons if already saved
                        if (isSaved) return null;

return (
<div key={key} style={{
display:"flex",
flexDirection:"column",
gap:6,
padding:"10px",
borderRadius:12,
border:`1px solid ${T.border}`,
background:T.surface,
}}>
<div style={{ fontSize:12, fontWeight:800, color:T.text }}>
{label} · {meal.calories} cal
</div>

<div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
<button
onClick={() => handleAddToPlan(meal, buttonSourceIdx, targetDate)}
style={{
fontSize:12,
padding:"8px 10px",
borderRadius:10,
fontWeight:700,
border:"none",
background: hasExisting ? "#f59e0b" : "#2563eb",
color:"#fff",
cursor:"pointer",
}}
>
{hasExisting ? `↺ Replace ${label}` : `+ Add ${label}`}
</button>

<button
onClick={() => handleEditPlanMeal(meal)}
style={{
fontSize:12,
padding:"8px 10px",
borderRadius:10,
fontWeight:700,
border:"none",
background:"#f59e0b",
color:"#fff",
cursor:"pointer",
}}
>
✏️ Edit
</button>

<button
onClick={() => handleCancelPlanMeal(meal, buttonSourceIdx)}
disabled={isSaved}
style={{
fontSize:12,
padding:"8px 10px",
borderRadius:10,
fontWeight:700,
border:"none",
background:"#ef4444",
color:"#fff",
cursor: isSaved ? "default" : "pointer",
opacity: isSaved ? 0.5 : 1,
}}
>
❌ Cancel
</button>
</div>
</div>
);
})}
</div>
)}
</div>
</div>
);
})}

{isLoading && (
<div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
<div style={{ width:32, height:32, borderRadius:10, background:"#2563eb",
display:"flex", alignItems:"center", justifyContent:"center",
fontSize:16, flexShrink:0, boxShadow:"0 2px 8px #2563eb44" }}>
💬
</div>
<div style={{ background: T.aiBubble, border:`1px solid ${T.aiBorder}`,
borderRadius:"18px 18px 18px 4px", padding:"12px 16px",
display:"flex", flexDirection:"column", gap:8 }}>
{/* Progressive status text */}
{loadingStage && (
<p style={{ fontSize:12, color: T.sub, margin:0, fontWeight:500 }}>
{loadingStage}
</p>
)}
{/* Bouncing dots */}
<div style={{ display:"flex", gap:5, alignItems:"center" }}>
{[0,150,300].map(d => (
<div key={d} style={{ width:7, height:7, borderRadius:"50%",
background:"#2563eb", animation:"bounce 1s infinite",
animationDelay:`${d}ms` }} />
))}
</div>
</div>
</div>
)}

<div ref={messagesEndRef} />
</div>

{/* ── Input ── */}
<div style={{ background: T.surface, borderTop:`1px solid ${T.border}`,
padding:"12px 14px", paddingBottom:"calc(12px + env(safe-area-inset-bottom, 0px))" }}>

{/* Photo menu */}
{showPhotoMenu && (
<div style={{ display:"flex", gap:8, marginBottom:10 }}>
<button onClick={() => { setShowPhotoMenu(false); cameraInputRef.current?.click(); }}
style={{ flex:1, fontSize:13, padding:"10px 12px", borderRadius:12,
background:"#2563eb22", color:"#2563eb", border:"1px solid #2563eb44",
fontWeight:600, cursor:"pointer" }}>
📷 Take Photo
</button>
<button onClick={() => { setShowPhotoMenu(false); libraryInputRef.current?.click(); }}
style={{ flex:1, fontSize:13, padding:"10px 12px", borderRadius:12,
background:"#2563eb22", color:"#2563eb", border:"1px solid #2563eb44",
fontWeight:600, cursor:"pointer" }}>
🖼️ Library
</button>
<button onClick={() => setShowPhotoMenu(false)}
style={{ fontSize:13, padding:"10px 12px", borderRadius:12,
background: T.muted, color: T.sub, border:"none", cursor:"pointer" }}>
✕
</button>
</div>
)}

{/* Image thumbnails */}
{pendingImages.length > 0 && (
<div style={{ display:"flex", gap:8, overflowX:"auto", marginBottom:10, paddingBottom:2 }}>
{pendingImages.map((img, i) => (
<div key={i} style={{ position:"relative", flexShrink:0 }}>
<img src={img.preview} alt={`Photo ${i+1}`}
style={{ width:72, height:72, objectFit:"cover", borderRadius:10,
border:`1px solid ${T.border}` }} />
<button onClick={() => removeImage(i)}
style={{ position:"absolute", top:-6, right:-6, width:18, height:18,
borderRadius:"50%", background:"#3a3a3a", color:"#fff",
border:"none", cursor:"pointer", fontSize:10,
display:"flex", alignItems:"center", justifyContent:"center" }}>
✕
</button>
</div>
))}
</div>
)}

{activeThreadId && (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
    background:"#2563eb22", border:"1px solid #2563eb55", borderRadius:10,
    padding:"6px 12px", marginBottom:8, fontSize:12, color:"#3b82f6" }}>
    <span>↩ Continuing this conversation…</span>
    <button onClick={() => setActiveThreadId(null)}
      style={{ background:"transparent", border:"none", color:"#3b82f6", cursor:"pointer", fontSize:16, lineHeight:1 }}>
      ✕
    </button>
  </div>
)}

<div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
{/* Camera button */}
<button onClick={() => pendingImages.length < 4 && setShowPhotoMenu(!showPhotoMenu)}
disabled={isLoading || pendingImages.length >= 4}
style={{ minHeight:52, minWidth:48, borderRadius:14, background: T.muted,
border:"none", cursor:"pointer", display:"flex", flexDirection:"column",
alignItems:"center", justifyContent:"center", gap:2, flexShrink:0,
opacity: pendingImages.length >= 4 ? .4 : 1 }}>
<span style={{ fontSize:20 }}>📷</span>
{pendingImages.length > 0 && (
<span style={{ fontSize:9, fontWeight:700, color:"#2563eb" }}>
{pendingImages.length}/4
</span>
)}
</button>

{/* Text input */}
<textarea ref={textareaRef} value={message}
onChange={e => setMessage(e.target.value)}
onKeyDown={handleKeyDown}
placeholder={pendingImages.length > 1 ? "Compare these or add a message..." :
pendingImages.length === 1 ? "Add a message or just send..." : "Ask your coach..."}
rows={1}
style={{ flex:1, resize:"none", borderRadius:14, padding:"14px 16px",
fontSize:14, border:`1px solid ${activeThreadId ? "#3b82f6" : (message ? "#2563eb" : T.border)}`,
background: T.input, color: T.text, outline:"none",
minHeight:52, maxHeight:120, fontFamily:"'DM Sans', sans-serif",
transition:"border-color .2s" }}
/>

{/* Send button */}
<button onClick={handleSend}
disabled={isLoading || (!message.trim() && pendingImages.length === 0)}
style={{ minHeight:52, minWidth:52, borderRadius:14,
background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
border:"none", color:"#fff", fontWeight:700, fontSize:14,
cursor:"pointer", flexShrink:0, opacity: (isLoading || (!message.trim() && pendingImages.length === 0)) ? .4 : 1,
padding:"0 16px", boxShadow:"0 4px 12px #2563eb44" }}>
Send
</button>
</div>
</div>

{/* ── Bottom Nav — [v97] shared component, inline variant (chat input sits above) ── */}
<BottomNav active="coach" t={T} fixed={false} />
</div>

<style>{`
@keyframes bounce {
0%, 100% { transform: translateY(0); }
50% { transform: translateY(-5px); }
}
`}</style>
</>
);

}