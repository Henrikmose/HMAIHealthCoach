import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getLocalDate(localDate) {
  if (localDate) return localDate;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function sumMeals(meals) {
  return (meals || []).reduce(
    (t, m) => {
      const s = Number(m.servings || 1);
      return {
        calories: t.calories + Number(m.calories||0) * s,
        protein:  t.protein  + Number(m.protein||0)  * s,
        carbs:    t.carbs    + Number(m.carbs||0)    * s,
        fat:      t.fat      + Number(m.fat||0)      * s,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function extractWeightFromMessage(message) {
  if (!message) return null;
  const match = message.match(/(\d+)\s*(pounds?|lbs?|kg|kilograms?)/i);
  if (match) return { amount: parseInt(match[1]), unit: match[2].toLowerCase().startsWith("k") ? "kg" : "lbs" };
  return null;
}

function isVeryActive(activityLevel) {
  const level = (activityLevel || "").toLowerCase();
  return level.includes("very") || level.includes("extra") || level.includes("athlete") || level.includes("high");
}

// ── Food Database Lookup ──────────────────────────────────────────

// Parse food items and quantities from a message
// Returns array of { food, amount, unit }
// ── UNIFIED FOOD ENGINE (shared logic — same as lookup-foods resolver) ──
// One engine for the whole app: fraction parsing, cooked-default staples, explicit-wins ranking.
function parseFoodItems(text) {
  if (!text) return [];
  let s = " " + text.toLowerCase() + " ";
  s = s.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (m,w,n,d)=>{const dd=+d;return dd?String(+w+(+n)/dd):m;});
  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, (m,n,d)=>{const dd=+d;return dd?String((+n)/dd):m;});
  s = s.replace(/¼/g,"0.25").replace(/½/g,"0.5").replace(/¾/g,"0.75").replace(/⅓/g,"0.333").replace(/⅔/g,"0.667");
  s = s.replace(/(\d)([a-z])/gi, "$1 $2");
  s = s
    .replace(/\bquarter\s+(?:of\s+)?(?:an?\s+)?/g," 0.25 ")
    .replace(/\bhalf\s+(?:an?\s+)?/g," 0.5 ")
    .replace(/\b(?:a|an|one)\s+/g," 1 ")
    .replace(/\btwo\s+/g," 2 ").replace(/\bthree\s+/g," 3 ").replace(/\bfour\s+/g," 4 ")
    .replace(/\bfive\s+/g," 5 ").replace(/\bsix\s+/g," 6 ").replace(/\bseven\s+/g," 7 ")
    .replace(/\beight\s+/g," 8 ").replace(/\bnine\s+/g," 9 ").replace(/\bten\s+/g," 10 ")
    .replace(/\bsome\s+/g," 1 ").replace(/\bwhole\s+/g," 1 ");
  s = s.replace(/\b(and|with|plus|also|of)\b/g, " ");
  // strip non-food filler verbs/pronouns so "I had chicken" doesn't log "i had" as a food
  s = s.replace(/\b(i|im|ive|id|he|she|we|they|had|have|having|has|ate|eat|eaten|eating|drank|drink|drinking|drunk|got|get|getting|consumed|consume|the|my|me|mine|will|gonna|going|planning|plan|want|wanna|like|grab|grabbed|made|make|having|about|around|roughly|approximately|approx|maybe|nearly|almost|that|which|it|its|what|so|far|well|really|please|is|are|was|were)\b/g, " ");
  s = s.replace(/\b(for|at|after|before|then|during|today|yesterday|tomorrow|tonight|this|morning|afternoon|evening|lunch|dinner|breakfast|snack|right|now|just)\b/g, " ");

  const units = "oz|ounces|ounce|lb|lbs|pounds|pound|g|grams|gram|kg|cup|cups|tbsp|tablespoons|tablespoon|tsp|teaspoons|teaspoon|ml|piece|pieces|slice|slices|scoop|scoops|serving|servings|medium|small|large";
  const unitRe = new RegExp("^(?:"+units+")$","i");
  const isNum = t => /^\d*\.?\d+$/.test(t);
  const tokens = s.split(/\s+/).filter(Boolean);
  const items = [];

  // leading food with no quantity: words before the first number
  const firstNum = tokens.findIndex(isNum);
  if (firstNum > 0) {
    const lead = tokens.slice(0, firstNum).join(" ").replace(/[^a-z\s-]/gi,"").trim();
    if (lead.length > 2) items.push({ food: lead, amount: 1, unit: "serving" });
  } else if (firstNum === -1) {
    const only = tokens.join(" ").replace(/[^a-z\s-]/gi,"").trim();
    if (only.length > 2) items.push({ food: only, amount: 1, unit: "serving" });
    return items;
  }

  let i = firstNum < 0 ? tokens.length : firstNum;
  while (i < tokens.length) {
    if (!isNum(tokens[i])) { i++; continue; }
    const amount = parseFloat(tokens[i]); i++;
    let unit = "serving";
    if (i < tokens.length && unitRe.test(tokens[i])) { unit = tokens[i].toLowerCase().replace(/s$/,''); i++; }
    const fw = [];
    while (i < tokens.length && !isNum(tokens[i])) { fw.push(tokens[i]); i++; }
    const food = fw.join(" ").replace(/[^a-z\s-]/gi,"").trim();
    if (food.length > 2 && !isNaN(amount)) items.push({ food, amount, unit });
  }
  return items;
}

function pickBest(rows, term) {
  const oddVariants = ['wing','skin','rind','bone','neck','giblet','liver','gizzard','heart','feet','tail',
    'overripe','underripe','unripe','dried','dehydrated','candied','sweetened','juice','powder','flour','baby food','restaurant','glutinous'];
  const specialty = ['black','red','wild','brown','green','jasmine','basmati'];
  const cuts = ['wing','thigh','drumstick','breast','ground','skin'];
  const commonPrefer = ['breast','white','boneless','skinless','long grain'];
  const term_l = (term || '').toLowerCase();
  const termWords = term_l.split(/[\s,]+/).filter(Boolean);
  const userWantsRaw = /\b(raw|dry|uncooked)\b/.test(term_l);
  const namedSpecialty = [...specialty, ...cuts].filter(v => term_l.includes(v));

  const scored = rows.map(r => {
    const name = (r.name || '').toLowerCase();
    let score = 0;
    if (name === term_l) score += 100;
    if (name.startsWith(term_l+',')||name.startsWith(term_l+' ')||name.startsWith(term_l+'s,')||name.startsWith(term_l+'s ')) score += 40;
    else if (name.startsWith(term_l)) score += 20;
    for (const w of termWords) if (w.length >= 3 && name.includes(w)) score += 30;
    if (!userWantsRaw) { if (name.includes('cooked')) score += 30; if (/\b(raw|dry|uncooked)\b/.test(name)) score -= 30; }
    else { if (/\b(raw|dry|uncooked)\b/.test(name)) score += 30; if (name.includes('cooked')) score -= 10; }
    if (namedSpecialty.length > 0) {
      for (const v of namedSpecialty) if (!name.includes(v)) score -= 200;
    } else {
      for (const c of commonPrefer) if (name.includes(c)) score += 25;
      for (const v of specialty) if (name.includes(v)) score -= 40;
    }
    for (const v of oddVariants) if (name.includes(v) && !term_l.includes(v)) score -= 35;
    // [v86] SOURCE TIER: a user-declared label is truth; an AI estimate is a guess.
    // When name relevance is comparable, label wins and ai_estimate loses. USDA/custom
    // sit between — never displaced by a label unless the label's NAME matches better.
    const src = (r.source || '').toLowerCase();
    if (src === 'label') score += 12;
    else if (src === 'ai_estimate') score -= 12;
    score -= name.length * 0.15;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

// ── COOKED-STAPLES TABLE ──
// Foods people eat cooked. Values are per-100g of the COOKED food, plus common portion weights.
// This makes "rice"/"pasta"/"chicken" return truthful cooked numbers + a "(cooked)" label,
// independent of the raw-only USDA rows and the near-empty conversions table.
// gramsPerCup / gramsEach are cooked-portion weights. cookKeywords trigger the match.
const COOKED_STAPLES = [
  { key:'white rice',   match:['rice'],            label:'White rice (cooked)',   per100:{calories:130,protein:2.7,carbs:28,fat:0.3}, gramsPerCup:158 },
  { key:'brown rice',   match:['brown rice'],      label:'Brown rice (cooked)',   per100:{calories:123,protein:2.7,carbs:25.6,fat:1.0}, gramsPerCup:195 },
  { key:'pasta',        match:['pasta','spaghetti','penne','macaroni'], label:'Pasta (cooked)', per100:{calories:158,protein:5.8,carbs:31,fat:0.9}, gramsPerCup:140 },
  { key:'chicken breast', match:['chicken','chicken breast'], label:'Chicken breast (cooked)', per100:{calories:165,protein:31,carbs:0,fat:3.6}, gramsPerCup:140, gramsPerOz:28.35 },
  { key:'oats',         match:['oats','oatmeal','porridge'], label:'Oatmeal (cooked)', per100:{calories:71,protein:2.5,carbs:12,fat:1.5}, gramsPerCup:234 },
  { key:'quinoa',       match:['quinoa'],          label:'Quinoa (cooked)',       per100:{calories:120,protein:4.4,carbs:21,fat:1.9}, gramsPerCup:185 },
  { key:'potato',       match:['potato','potatoes'], label:'Potato (cooked)',     per100:{calories:87,protein:1.9,carbs:20,fat:0.1}, gramsPerCup:156, gramsEach:170 },
  { key:'sweet potato', match:['sweet potato'],    label:'Sweet potato (cooked)', per100:{calories:90,protein:2,carbs:21,fat:0.1}, gramsPerCup:200, gramsEach:130 },
  { key:'ground beef',  match:['ground beef','beef mince','hamburger'], label:'Ground beef (cooked)', per100:{calories:250,protein:26,carbs:0,fat:15}, gramsPerOz:28.35 },
  { key:'salmon',       match:['salmon'],          label:'Salmon (cooked)',       per100:{calories:206,protein:22,carbs:0,fat:12}, gramsPerOz:28.35 },
  { key:'lentils',      match:['lentils'],         label:'Lentils (cooked)',      per100:{calories:116,protein:9,carbs:20,fat:0.4}, gramsPerCup:198 },
  { key:'black beans',  match:['black beans'],     label:'Black beans (cooked)',  per100:{calories:132,protein:8.9,carbs:24,fat:0.5}, gramsPerCup:172 },
  { key:'chickpeas',    match:['chickpeas','garbanzo'], label:'Chickpeas (cooked)', per100:{calories:164,protein:8.9,carbs:27,fat:2.6}, gramsPerCup:164 },
];

// Generic portion grams when not a staple and DB/units can't resolve it.
const GENERIC_GRAMS = { cup:150, tbsp:15, tsp:5, slice:30, piece:50, scoop:30, serving:100, oz:28.35, ounce:28.35, g:1, gram:1, kg:1000, lb:453.6, pound:453.6, ml:1, medium:120, small:90, large:150 };

function matchCookedStaple(term) {
  const t = (term || '').toLowerCase().trim();
  if (/\b(raw|dry|uncooked)\b/.test(t)) return null; // explicit raw -> use DB

  // Specialty/qualifier words that mean "this is NOT the plain staple" -> send to DB instead.
  // e.g. "black rice", "salmon sashimi", "fried rice", "rice noodles", "chicken wing".
  const sendToDB = ['black','red','wild','jasmine','basmati','sashimi','nigiri','roll','sushi',
    'fried','noodle','noodles','cake','cakes','flour','wing','thigh','drumstick','skin','soup',
    'crispy','breaded','tempura','smoked','cured','canned','dried','chip','chips','crackers'];
  for (const w of sendToDB) if (new RegExp('\\b'+w+'\\b').test(t)) return null;

  const sorted = [...COOKED_STAPLES].sort((a,b)=>Math.max(...b.match.map(m=>m.length))-Math.max(...a.match.map(m=>m.length)));
  for (const st of sorted) {
    for (const m of st.match) {
      // require the staple keyword to be present AND the term to be "close" to it
      // (the term is essentially just the staple, not staple+extra-food like "salmon sashimi")
      if (new RegExp('\\b'+m.replace(/\s+/g,'\\s+')+'\\b').test(t)) {
        const extra = t.replace(new RegExp('\\b'+m.replace(/\s+/g,'\\s+')+'\\b'), '').replace(/\b(cooked|fresh|grilled|baked|boiled|steamed|plain|white)\b/g,'').trim();
        // allow only trivial leftover words (qualifiers we accept); if a whole other food-word remains, skip
        if (extra.split(/\s+/).filter(Boolean).length === 0) return st;
      }
    }
  }
  return null;
}

function gramsForStaple(st, amount, unit) {
  const u = (unit || 'serving').toLowerCase().replace(/s$/,'');
  if ((u==='cup') && st.gramsPerCup) return amount * st.gramsPerCup;
  if ((u==='oz'||u==='ounce') && st.gramsPerOz) return amount * st.gramsPerOz;
  if ((u==='serving'||u==='piece'||u==='medium') && st.gramsEach) return amount * st.gramsEach;
  if (u==='g'||u==='gram') return amount;
  if (u==='kg') return amount*1000;
  if (u==='lb'||u==='pound') return amount*453.6;
  if (u==='oz'||u==='ounce') return amount*28.35;
  if (u==='cup' && !st.gramsPerCup) return amount * (GENERIC_GRAMS.cup);
  // default: one "serving" of the staple ~ a cup if we have it, else 150g
  if (st.gramsPerCup) return amount * st.gramsPerCup;
  if (st.gramsEach) return amount * st.gramsEach;
  return amount * 150;
}

async function lookupFood(foodName) {
  if (!foodName) return null;
  const cols = 'id, fdc_id, name, category, source, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g';
  // [v86] ENTRY GUARD: sanitize BEFORE any query stage. Leading punctuation is stripped
  // (a leading "-" turns the full-text stage into a NOT-query that matches nearly the
  // whole table — the espresso incident), and junk/too-short terms never reach the DB.
  const clean = foodName.trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/(^|\s)-+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length < 3) return null;
  // COMPOSED DISH GUARD: "tacos with eggs, potato, tortilla", "burrito with rice beans chicken", etc.
  // A multi-ingredient dish must NOT fuzzy-match a single ingredient (e.g. logging just "potato").
  // Send it to the AI to estimate the whole dish as one item. Heuristic: contains "with", or is a
  // long multi-word phrase (4+ words) that isn't a simple "<qualifier> <food>" pair.
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  if (/\bwith\b/.test(clean) || wordCount >= 4) {
    return null; // -> falls through to AI estimate (composed dish)
  }
  try {
    const { data: starts } = await supabase.from('foods').select(cols).ilike('name', `${clean}%`).limit(8);
    if (starts && starts.length > 0) return pickBest(starts, clean);
    const { data: startsPlural } = await supabase.from('foods').select(cols).ilike('name', `${clean}s%`).limit(8);
    if (startsPlural && startsPlural.length > 0) return pickBest(startsPlural, clean);
    const { data: fts } = await supabase.from('foods').select(cols).textSearch('name', clean.split(' ').join(' & '), { type: 'websearch' }).limit(8);
    if (fts && fts.length > 0) return pickBest(fts, clean);
    // SUBSTRING GUARD: the %contains% stage is a shotgun — short terms match inside
    // unrelated words ("cal" -> "Squid (CALamari)", "fat" -> "Buttermilk, low FAT").
    // Only allow it for terms long enough to be a real food name.
    if (clean.length >= 5) {
      const { data: contains } = await supabase.from('foods').select(cols).ilike('name', `%${clean}%`).limit(10);
      if (contains && contains.length > 0) return pickBest(contains, clean);
    }
    return null;
  } catch (e) { console.log('Food lookup error:', e.message); return null; }
}

async function convertToGrams(amount, unit, foodId) {
  const unitLower = (unit||'serving').toLowerCase().replace(/s$/, '');
  if (foodId) {
    const { data } = await supabase.from('food_specific_conversions').select('grams_per_unit').eq('food_id', foodId).ilike('unit_name', `%${unitLower}%`).limit(1);
    if (data?.[0]) return amount * data[0].grams_per_unit;
  }
  const { data } = await supabase.from('unit_conversions').select('grams_per_unit, ml_per_unit').eq('unit_name', unitLower).limit(1);
  if (data?.[0]) { if (data[0].grams_per_unit) return amount * data[0].grams_per_unit; if (data[0].ml_per_unit) return amount * data[0].ml_per_unit; }
  // generic fallback so we never drop a food
  return amount * (GENERIC_GRAMS[unitLower] || GENERIC_GRAMS.serving);
}

function calcMacros(food, grams) {
  const factor = grams / 100;
  return {
    calories: Math.round(food.calories_per_100g * factor),
    protein:  Math.round(food.protein_per_100g  * factor * 10) / 10,
    carbs:    Math.round(food.carbs_per_100g     * factor * 10) / 10,
    fat:      Math.round(food.fat_per_100g       * factor * 10) / 10,
  };
}

// Main lookup — tries DB, returns null if not found
// ── WEAK-DESCRIPTION DETECTOR (code, no AI) ─────────────────────────────────
// A composed/multi-ingredient food with almost no quantities can't be logged
// accurately (one small potato vs half a cup is a big difference). Rather than
// guess (or let the AI guess — it collapses "tacos with potato and eggs" to just
// potato), we ask the user for rough amounts. Returns { weak, question }.
// ── MEAL SEGMENTER (pure code) ──────────────────────────────────────────────
// Splits a multi-meal food-log message into {meal_type, text} segments so code (not the
// AI) decides the meals. Explicit marker ("for breakfast", "as a snack") wins; otherwise
// infer from time of day. The per-meal card dropdown lets the user override any guess.
function inferMealTypeFromHour(hour) {
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 17) return "snack";
  if (hour >= 17 && hour < 22) return "dinner";
  return "snack";
}

function segmentMeals(message, currentHour = 12) {
  // [v86] Handles BOTH natural orientations:
  //   marker-first: "for breakfast 2 eggs, for lunch a salad"   (food AFTER its marker)
  //   food-first:   "2 eggs for breakfast and a salad for lunch" (food BEFORE its marker)
  // The old version only understood marker-first, so "X for dinner" produced ZERO
  // segments (nothing after the marker) and every such log fell to the fallback.
  // Hard guarantee now: a non-empty message NEVER returns zero segments.
  if (!message) return [];
  const text = message.trim();
  if (!text) return [];
  const markers = [
    { type: "breakfast", re: /\b(for |as |had )?breakfast\b/gi },
    { type: "lunch",     re: /\b(for |as |had )?lunch\b/gi },
    { type: "dinner",    re: /\b(for |as |had )?dinner\b/gi },
    { type: "snack",     re: /\b(for |as )?(a )?snack\b/gi },
  ];
  const hits = [];
  for (const m of markers) {
    m.re.lastIndex = 0;
    let match;
    while ((match = m.re.exec(text)) !== null) {
      hits.push({ type: m.type, index: match.index, end: m.re.lastIndex });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  if (hits.length === 0) {
    return [{ meal_type: inferMealTypeFromHour(currentHour), text, inferred: true }];
  }

  // "Substantive" = still contains real content after stripping filler words.
  // Includes ANNOUNCEMENT filler ("what I've eaten today so far", "here's everything",
  // "let me tell you") — a lead like that is narration, not food, and must not flip
  // the orientation to food-first.
  const FILLER_RE = /\b(i|i'?m|i'?ve|i'?d|we|he|she|they|had|have|having|has|ate|eat|eaten|eating|drank|drink|got|get|just|also|then|and|so|um|uh|my|the|a|an|of|for|as|at|around|about|today|yesterday|tomorrow|tonight|this|that|morning|afternoon|evening|earlier|later|right|now|oh|well|ok|okay|what|whats|everything|all|here|heres|is|was|been|far|did|tell|you|your|see|if|can|coach|hey|hi|hello|please|lets|let|me|it|its|log|logging|logged)\b/gi;
  const substantive = (s) => {
    const cleaned = (s || "").replace(/'/g, "").replace(FILLER_RE, " ").replace(/[^a-z0-9\s-]/gi, " ").replace(/\s+/g, " ").trim();
    return cleaned.length > 2;
  };
  const trim = (s) => (s || "").replace(/^[\s,.:;\u2014-]+|[\s,.:;]+$/g, "").trim();
  const UNIT_WORDS_RE = /\b(oz|ounce|ounces|cup|cups|g|gram|grams|kg|lb|lbs|pound|pounds|tbsp|tsp|slice|slices|piece|pieces|scoop|scoops|serving|servings|bottle|can|bowl|plate|half|quarter)\b/i;

  const lead = text.slice(0, hits[0].index);

  const buildFoodFirst = () => {
    const segs = [];
    let prevEnd = 0;
    for (let i = 0; i < hits.length; i++) {
      const chunk = trim(text.slice(prevEnd, hits[i].index));
      if (substantive(chunk)) segs.push({ meal_type: hits[i].type, text: chunk, inferred: false });
      prevEnd = hits[i].end;
    }
    const tail = trim(text.slice(hits[hits.length - 1].end));
    if (substantive(tail)) {
      const lastType = hits[hits.length - 1].type;
      const lastSeg = segs[segs.length - 1];
      if (!lastSeg || lastSeg.meal_type !== lastType) {
        segs.push({ meal_type: lastType, text: tail, inferred: false });
      } else {
        lastSeg.text += " " + tail;
      }
    }
    return segs;
  };

  const buildMarkerFirst = () => {
    const segs = [];
    for (let i = 0; i < hits.length; i++) {
      const stop = (i + 1 < hits.length) ? hits[i + 1].index : text.length;
      const chunk = trim(text.slice(hits[i].end, stop));
      if (substantive(chunk)) segs.push({ meal_type: hits[i].type, text: chunk, inferred: false });
    }
    return segs;
  };

  // ORIENTATION DECISION (cascade):
  // 1. Lead is pure filler/announcement -> marker-first ("...so for breakfast I had X")
  // 2. Lead contains a quantity (digit or unit word) -> food-first ("8oz chicken ... for dinner")
  // 3. Ambiguous -> build both, keep the one that assigns food to MORE markers; tie -> marker-first
  let segments;
  if (!substantive(lead)) {
    segments = buildMarkerFirst();
  } else if (/\d/.test(lead) || UNIT_WORDS_RE.test(lead)) {
    segments = buildFoodFirst();
  } else {
    const ff = buildFoodFirst();
    const mf = buildMarkerFirst();
    segments = ff.length > mf.length ? ff : mf;
  }

  // HARD FLOOR: never return zero segments for a message that reached this point.
  // Use the full text (the food parser strips meal words itself) with the first
  // marker's meal type — one card the user can correct beats a dead-end fallback.
  if (segments.length === 0) {
    return [{ meal_type: hits[0].type, text, inferred: false }];
  }
  return segments;
}

function detectWeakComposedFood(message) {
  const t = (message || "").toLowerCase();
  const composedWords = /\b(taco|tacos|burrito|burritos|sandwich|sandwiches|wrap|wraps|bowl|bowls|salad|salads|smoothie|smoothies|stir\s?fry|casserole|stew|soup|curry|omelet|omelette|scramble|plate|dish)\b/;
  const isComposed = composedWords.test(t) || /\bwith\b/.test(t);
  if (!isComposed) return { weak: false };

  // A REAL ingredient amount = number+unit, a fraction, or a "<n> egg/slice/scoop/cup" phrase.
  // A bare dish count ("3 tacos") does NOT count — we need amounts for the ingredients.
  const withoutDishCount = t.replace(/\b\d+\s+(tacos?|burritos?|sandwiches?|wraps?|bowls?|omelets?|omelettes?)\b/g, " ");
  const realQtyCues = (withoutDishCount.match(
    /\b\d+\.?\d*\s*(oz|ounces?|lb|lbs|pounds?|g|grams?|kg|cups?|tbsp|tsp|tablespoons?|teaspoons?|ml|slices?|pieces?|scoops?|servings?)\b|½|¼|¾|⅓|⅔|\bhalf\b|\bquarter\b|\bthird\b|\b\d+\s+(egg|eggs|slice|slices|scoop|scoops|piece|pieces|cup|cups)\b/g
  ) || []).length;

  // Ask ONLY when it's composed AND there are zero real ingredient amounts anywhere.
  // Any single real amount -> proceed (standard sizes fill unspecified parts downstream).
  const weak = isComposed && realQtyCues === 0;
  if (!weak) return { weak: false };
  return {
    weak: true,
    question:
      "Happy to log this — I just need a rough amount for the main ingredients (even approximate). " +
      "For example: how many eggs, and about how much potato (half a cup? a small one?). " +
      "I'll use standard sizes for the rest. Tap ↩ Continue to send it."
  };
}

async function lookupFoodMacros(message) {
  const items = parseFoodItems(message);
  if (items.length === 0) return null;

  const results = [];
  for (const item of items.slice(0, 5)) { // max 5 foods per message
    // 1) COOKED-STAPLE PATH — truthful cooked macros + "(cooked)" label, before the raw DB.
    const staple = matchCookedStaple(item.food);
    if (staple) {
      const grams = gramsForStaple(staple, item.amount, item.unit);
      const f = grams / 100;
      results.push({
        food: staple.label, amount: item.amount, unit: item.unit, grams: Math.round(grams),
        calories: Math.round(staple.per100.calories * f),
        protein:  Math.round(staple.per100.protein  * f * 10) / 10,
        carbs:    Math.round(staple.per100.carbs     * f * 10) / 10,
        fat:      Math.round(staple.per100.fat       * f * 10) / 10,
        source: 'usda_db', cooked: true,
      });
      continue;
    }
    // 2) DATABASE PATH
    const food = await lookupFood(item.food);
    if (!food) continue;

    // FOOD TYPE decides the math:
    //  - usda           -> GRAM-based (per-100g * grams/100)
    //  - ai_estimate /  -> SERVING-based (per-serving macros * serving count).
    //    label             A Big Mac is "1 serving"; half = x0.5, two = x2. No grams.
    const ftype = (food.source || 'usda').toLowerCase();
    if (ftype === 'ai_estimate' || ftype === 'label') {
      // The stored per-100g columns actually hold PER-SERVING macros for these rows
      // (write-back stores them that way). The "amount" is the serving count.
      const servings = Number(item.amount) || 1;
      results.push({
        food: food.name,
        amount: item.amount, unit: 'serving',
        servings,
        calories: Math.round((Number(food.calories_per_100g) || 0) * servings),
        protein:  Math.round((Number(food.protein_per_100g)  || 0) * servings * 10) / 10,
        carbs:    Math.round((Number(food.carbs_per_100g)    || 0) * servings * 10) / 10,
        fat:      Math.round((Number(food.fat_per_100g)      || 0) * servings * 10) / 10,
        source: ftype,
      });
      continue;
    }

    // USDA gram-based path
    const grams = await convertToGrams(item.amount, item.unit, food.id);
    if (!grams) continue;
    const macros = calcMacros(food, grams);
    results.push({
      food: food.name, amount: item.amount, unit: item.unit,
      grams: Math.round(grams), ...macros, source: 'usda_db',
    });
  }

  return results.length > 0 ? results : null;
}

// ═══ [v86] CODE-OWNED FOOD-LOG PIPELINE ═════════════════════════════════════
// The AI NEVER writes the chat message for a food log. Its only jobs here are:
//   (a) parse a segment the code parser couldn't (returns structured items, no numbers)
//   (b) supply macros for ONE unknown food (JSON only → written to `foods` → read back)
// Everything the user sees is rendered by code from database values.

async function callStructuredAI(prompt) {
  const provider = process.env.AI_PROVIDER || "openai";
  try {
    if (provider === "claude") {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content.find(b => b.type === "text")?.text || "";
    } else {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });
      return completion.choices[0].message.content || "";
    }
  } catch (e) { console.log("structured AI call failed:", e.message); return ""; }
}

function parseLooseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// (a) UNDERSTANDING fallback — used ONLY when parseFoodItems finds nothing in a segment.
// Returns structured items (food/amount/unit). Never returns macros or any displayed text.
async function parseSegmentViaAI(text) {
  const prompt = `Extract the foods from this food-log text. Return ONLY a JSON array, no markdown, no prose:
[{"food":"<name>","amount":<number>,"unit":"<unit>"}]
Use "serving" as the unit when none is stated. Text: "${(text || "").replace(/"/g, "'")}"`;
  const raw = await callStructuredAI(prompt);
  const parsed = parseLooseJSON(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(it => it && typeof it.food === "string" && it.food.trim().length > 1)
    .slice(0, 8)
    .map(it => ({
      food: it.food.trim(),
      amount: Number(it.amount) > 0 ? Number(it.amount) : 1,
      unit: (typeof it.unit === "string" && it.unit.trim()) ? it.unit.trim().toLowerCase() : "serving",
    }));
}

// (b) MACROS for one unknown food. The result NEVER goes toward the screen —
// it goes into `foods`, and the STORED ROW is what feeds the message.
async function fetchMacrosViaAI(food, amount, unit) {
  const isWeightUnit = /^(oz|ounce|ounces|g|gram|grams|kg|lb|lbs|pound|pounds|ml)$/.test((unit || "").toLowerCase());
  const prompt = `You are a nutrition database. Return ONLY valid JSON, no markdown, no prose:
{"canonical_name":"<standard name>","grams_per_serving":<number>,"calories":<number>,"protein":<number>,"carbs":<number>,"fat":<number>}
Values are for ONE standard serving of: ${food}.${isWeightUnit ? "" : ` One serving = 1 ${unit}.`}`;
  const raw = await callStructuredAI(prompt);
  const parsed = parseLooseJSON(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const n = k => Number(parsed[k]);
  if (!(n("calories") >= 0)) return null;
  return {
    canonical_name: (parsed.canonical_name || food).toString().slice(0, 120),
    grams_per_serving: n("grams_per_serving") > 0 ? n("grams_per_serving") : 0,
    calories: Math.round(n("calories") || 0),
    protein: Math.round((n("protein") || 0) * 10) / 10,
    carbs: Math.round((n("carbs") || 0) * 10) / 10,
    fat: Math.round((n("fat") || 0) * 10) / 10,
  };
}

// Write the AI-found food to `foods` (source='ai_estimate', per-SERVING values in the
// per-100g columns — the established write-back convention) and return the STORED row.
// If a row with this name already exists (another user logged it meanwhile), use that one.
async function writeBackAIFood(macros) {
  const cols = "id, name, source, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g";
  try {
    const { data: existing } = await supabase.from("foods")
      .select(cols).ilike("name", macros.canonical_name).limit(1);
    if (existing && existing[0]) return existing[0];
    const { data: inserted, error } = await supabase.from("foods").insert([{
      name: macros.canonical_name,
      category: "ai",
      source: "ai_estimate",
      calories_per_100g: macros.calories,
      protein_per_100g: macros.protein,
      carbs_per_100g: macros.carbs,
      fat_per_100g: macros.fat,
    }]).select(cols).single();
    if (error) { console.log("write-back failed:", error.message); return null; }
    return inserted; // this IS the read-back: the stored row, straight from the database
  } catch (e) { console.log("write-back error:", e.message); return null; }
}

const WEIGHT_UNIT_GRAMS = { oz: 28.35, ounce: 28.35, g: 1, gram: 1, kg: 1000, lb: 453.6, pound: 453.6, ml: 1 };

// ═══ [v86] CARD-CARRIED DATES ═══════════════════════════════════════════════
// The target date is decided ONCE, here, at log time, from the log message itself —
// then stored inside each card. The client renders the stored date and lets the user
// correct it with one tap. Render-time date recomputation (which sampled surrounding
// chat and produced today/tomorrow chaos) is dead.
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function detectLogDate(text, todayStr) {
  const t = (text || "").toLowerCase();
  if (/\byesterday\b/.test(t)) return shiftDate(todayStr, -1);
  if (/\b(day before yesterday)\b/.test(t)) return shiftDate(todayStr, -2);
  if (/\btomorrow\b/.test(t)) return shiftDate(todayStr, 1);
  if (/\blast night\b/.test(t)) {
    // "last night" before ~11am means the previous calendar day
    return todayStr; // conservative default; hour-aware version below overrides
  }
  return todayStr;
}

function detectLogDateWithHour(text, todayStr, hour) {
  const t = (text || "").toLowerCase();
  if (/\blast night\b/.test(t) && typeof hour === "number" && hour < 11) {
    return shiftDate(todayStr, -1);
  }
  return detectLogDate(text, todayStr);
}

// Resolve ONE parsed item to numbers. Order: cooked staple → foods DB → AI + write-back.
// Every displayed number comes from the code tables or a database row — never AI prose.
async function resolveOneFood(item) {
  // 1) cooked-staple path (code-owned table)
  const staple = matchCookedStaple(item.food);
  if (staple) {
    const grams = gramsForStaple(staple, item.amount, item.unit);
    const f = grams / 100;
    return {
      user_text: `${item.amount} ${item.unit} ${item.food}`,
      canonical_name: staple.label, food: staple.label,
      amount: item.amount, unit: item.unit, grams: Math.round(grams),
      calories: Math.round(staple.per100.calories * f),
      protein: Math.round(staple.per100.protein * f * 10) / 10,
      carbs: Math.round(staple.per100.carbs * f * 10) / 10,
      fat: Math.round(staple.per100.fat * f * 10) / 10,
      source: "usda_db", usda_food_id: null,
    };
  }
  // 2) database path (custom/community/USDA — one foods table, source column decides math)
  let row = await lookupFood(item.food);
  let aiGramsPerServing = 0;
  // 3) unknown food → AI supplies macros ONCE → written to foods → stored row is used
  if (!row) {
    const macros = await fetchMacrosViaAI(item.food, item.amount, item.unit);
    if (!macros) return null;
    aiGramsPerServing = macros.grams_per_serving || 0;
    row = await writeBackAIFood(macros);
    if (!row) {
      // DB write failed — serve the user this once from the same values; nothing cached
      row = { name: macros.canonical_name, source: "ai_estimate",
        calories_per_100g: macros.calories, protein_per_100g: macros.protein,
        carbs_per_100g: macros.carbs, fat_per_100g: macros.fat };
    }
  }
  const ftype = (row.source || "usda").toLowerCase();
  if (ftype === "ai_estimate" || ftype === "label") {
    // Serving-based math. Weight units convert via grams-per-serving when the AI supplied it.
    let servings = Number(item.amount) || 1;
    const gpu = WEIGHT_UNIT_GRAMS[(item.unit || "").toLowerCase().replace(/s$/, "")];
    if (gpu && aiGramsPerServing > 0) servings = (servings * gpu) / aiGramsPerServing;
    servings = Math.round(servings * 100) / 100;
    return {
      user_text: `${item.amount} ${item.unit} ${item.food}`,
      canonical_name: row.name, food: row.name,
      amount: servings, unit: "serving",
      grams: aiGramsPerServing > 0 ? Math.round(servings * aiGramsPerServing) : 0,
      calories: Math.round((Number(row.calories_per_100g) || 0) * servings),
      protein: Math.round((Number(row.protein_per_100g) || 0) * servings * 10) / 10,
      carbs: Math.round((Number(row.carbs_per_100g) || 0) * servings * 10) / 10,
      fat: Math.round((Number(row.fat_per_100g) || 0) * servings * 10) / 10,
      source: ftype, usda_food_id: null,
    };
  }
  // USDA gram-based math
  const grams = await convertToGrams(item.amount, item.unit, row.id);
  const m = calcMacros(row, grams);
  return {
    user_text: `${item.amount} ${item.unit} ${item.food}`,
    canonical_name: row.name, food: row.name,
    amount: item.amount, unit: item.unit, grams: Math.round(grams),
    calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
    source: "usda_db", usda_food_id: row.id || null,
  };
}

// Words that must NEVER become a food on their own — they're macro/label vocabulary
// that voice dictation leaves behind ("...has 160 cal 3 g of fat and 30 g of protein").
const FOOD_STOPWORDS = new Set([
  "cal", "cals", "calorie", "calories", "kcal",
  "carb", "carbs", "carbohydrate", "carbohydrates",
  "fat", "fats", "gram", "grams", "macro", "macros",
  "sugar", "sugars", "fiber", "fibre", "sodium",
]);

// Strip dictated OR pasted nutrition specs from a segment BEFORE parsing, so macro
// words never become phantom foods. Handles BOTH orders:
//   speech order: "60 cal", "3 g of fat", "three carbs"
//   label order:  "Calories: 60", "Protein 7g" (pasted/typed nutrition panels)
// Bullet dashes are killed first — a leading "- " once turned "- protein" into a
// full-text NOT-query that matched the whole foods table (the espresso incident).
// The number-first boundary allows another macro word to follow ("60 cal fat 2 g"),
// while "2 protein bars" stays safe: "bars" is not a boundary word.
function stripInlineMacroSpecs(text) {
  if (!text) return text;
  let out = text.replace(/(^|\n)\s*[-•*]\s*/g, "$1 "); // bullets die at the source
  const NUMW = "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)";
  const MACRO = "(?:calories?|cals?|kcal|protein|carbs?|carbohydrates?|fats?|sugars?|fiber|fibre|sodium)";
  const BOUNDARY = `(?=\\s*(?:and\\b|,|\\.|;|:|$|\\d|one\\b|two\\b|three\\b|four\\b|five\\b|six\\b|seven\\b|eight\\b|nine\\b|ten\\b|that\\b|which\\b|this\\b|it\\b|so\\b|of\\b|${MACRO}))`;
  const numberFirst = new RegExp(`\\b${NUMW}\\s*(?:g|grams?|mg)?\\s*(?:of\\s+)?${MACRO}${BOUNDARY}`, "gi");
  const labelOrder = new RegExp(`\\b${MACRO}\\s*[:=]?\\s*${NUMW}\\s*(?:g|grams?|mg)?\\b`, "gi");
  let prev;
  do {
    prev = out;
    out = out.replace(labelOrder, " ");
    out = out.replace(numberFirst, " ");
  } while (out !== prev);
  // clean the connectors the specs leave behind ("that has", "which has", "with")
  out = out.replace(/\b(that|which|it)\s+(has|have|had|contains?|is|was)\b/gi, " ");
  return out.replace(/\s+/g, " ").trim();
}

// ═══ [v86] LAYER 2 — LABEL DECLARATION ══════════════════════════════════════
// A message that is FOOD NAME + MACRO VALUES is a label being read to us — the
// best data source we have. Detected by CODE. The user's numbers are used
// VERBATIM for this log, and written back to `foods` as source='label', which
// SUPERSEDES ai_estimate rows (fixes them in place) and never touches usda/custom.
// Covers all three input forms: dictated, typed, and pasted label panels.

function extractLabelDeclaration(segText) {
  if (!segText) return null;
  const t = " " + segText.replace(/(^|\n)\s*[-•*]\s*/g, "$1 ").replace(/\s+/g, " ") + " ";
  const wordNums = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, half:0.5 };
  const toNum = (s) => wordNums[s.toLowerCase()] !== undefined ? wordNums[s.toLowerCase()] : Number(s);

  // SEQUENTIAL SCANNER: one pass, left to right, matching EITHER order per macro
  // ("60 cal" / "Calories: 60"). Each number binds to exactly ONE macro — this is
  // what stops "Calories: 60 - Protein: 7g" reading protein as 60. If a macro word
  // repeats ("2 g of fat ... of fat"), the duplicate is skipped and scanning resumes
  // one character later so the number stays available for its true macro.
  const NUMW = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)";
  const MACRO = "(cal(?:orie)?s?|kcal|protein|carb(?:ohydrate)?s?|fats?)";
  const scanner = new RegExp(
    `\\b${NUMW}\\s*(?:g|grams?|mg)?\\s*(?:of\\s+)?${MACRO}\\b|\\b${MACRO}\\s*[:=]?\\s*${NUMW}\\s*(?:g|grams?|mg)?\\b`,
    "gi"
  );
  const macroKey = (w) => {
    const x = w.toLowerCase();
    if (x.startsWith("cal") || x === "kcal") return "calories";
    if (x.startsWith("protein")) return "protein";
    if (x.startsWith("carb")) return "carbs";
    return "fat";
  };
  const found = {};
  let m;
  while ((m = scanner.exec(t)) !== null) {
    const numStr = m[1] || m[4];
    const macroStr = m[2] || m[3];
    if (!numStr || !macroStr) continue;
    const key = macroKey(macroStr);
    if (found[key] === undefined) {
      found[key] = toNum(numStr);
    } else {
      // duplicate macro word — release the number for the next macro
      scanner.lastIndex = m.index + 1;
    }
  }

  // A declaration needs calories plus at least one other macro — anything less is
  // conversation, not a label, and flows through the normal pipeline.
  const others = ["protein", "carbs", "fat"].filter(k => found[k] !== undefined && found[k] >= 0).length;
  if (!(found.calories !== undefined && found.calories >= 0) || others < 1) return null;

  // The food name is whatever remains after the specs are stripped — minus any
  // trailing orphan macro word ("...powder thing protein") and serving suffixes.
  const stripped = stripInlineMacroSpecs(segText);
  const items = parseFoodItems(stripped).filter(it => {
    const f = (it.food || "").trim().toLowerCase().replace(/^[^a-z0-9]+/, "");
    return f.length >= 3 && !FOOD_STOPWORDS.has(f) && !f.split(/\s+/).every(w => FOOD_STOPWORDS.has(w));
  });
  if (items.length === 0) return null;
  let name = items[0].food
    .replace(/\s+(calories?|cals?|kcal|protein|carbs?|carbohydrates?|fats?|each|per serving|per)\s*$/i, "")
    .trim();
  if (name.length < 3) name = items[0].food;

  return {
    name,
    amount: Number(items[0].amount) > 0 ? Number(items[0].amount) : 1,
    unit: items[0].unit || "serving",
    perServing: {
      calories: Math.round(found.calories),
      protein: Math.round((found.protein ?? 0) * 10) / 10,
      carbs: Math.round((found.carbs ?? 0) * 10) / 10,
      fat: Math.round((found.fat ?? 0) * 10) / 10,
    },
  };
}

// Write/refresh the declared label in `foods`. Rules:
//   no row            -> insert as source='label'
//   ai_estimate row   -> UPDATE in place to the declared values (guess -> truth)
//   label row         -> update (latest declaration wins; users redeclare to correct)
//   usda / custom row -> untouched (label never outranks those); numbers still used for THIS log
async function writeBackLabelDeclaration(decl) {
  const cols = "id, name, source";
  try {
    const cleanName = decl.name.trim();
    if (cleanName.length < 3) return { action: "skipped" };
    const { data: existing } = await supabase.from("foods")
      .select(cols).ilike("name", cleanName).limit(1);
    const values = {
      calories_per_100g: decl.perServing.calories,
      protein_per_100g: decl.perServing.protein,
      carbs_per_100g: decl.perServing.carbs,
      fat_per_100g: decl.perServing.fat,
    };
    if (existing && existing[0]) {
      const src = (existing[0].source || "").toLowerCase();
      if (src === "usda" || src === "custom") return { action: "kept_" + src, name: existing[0].name };
      const { error } = await supabase.from("foods")
        .update({ ...values, source: "label", category: "branded" })
        .eq("id", existing[0].id);
      if (error) return { action: "failed" };
      return { action: src === "label" ? "updated" : "superseded_ai", name: existing[0].name };
    }
    const { error } = await supabase.from("foods").insert([{
      name: cleanName, category: "branded", source: "label", ...values,
    }]);
    if (error) return { action: "failed" };
    return { action: "created", name: cleanName };
  } catch (e) { return { action: "failed" }; }
}

// Resolve a whole segment: code parser first; AI parse ONLY if code found nothing.
async function resolveSegment(segText) {
  // [v86] LABEL DECLARATION check FIRST: if this segment is "food + macro values",
  // the user's numbers are the truth — used verbatim, cached as source='label'.
  const decl = extractLabelDeclaration(segText);
  if (decl) {
    const wb = await writeBackLabelDeclaration(decl);
    const servings = decl.amount;
    const item = {
      user_text: `${decl.amount} ${decl.unit} ${decl.name}`,
      canonical_name: wb.name || decl.name, food: wb.name || decl.name,
      amount: servings, unit: "serving",
      grams: 0,
      calories: Math.round(decl.perServing.calories * servings),
      protein: Math.round(decl.perServing.protein * servings * 10) / 10,
      carbs: Math.round(decl.perServing.carbs * servings * 10) / 10,
      fat: Math.round(decl.perServing.fat * servings * 10) / 10,
      source: "label", usda_food_id: null,
    };
    console.log(`  [v86] LABEL DECLARATION: "${decl.name}" ${decl.perServing.calories} cal (write-back: ${wb.action})`);
    return { items: [item], unresolved: [], labelSaved: (wb.action === "created" || wb.action === "superseded_ai" || wb.action === "updated") ? (wb.name || decl.name) : null };
  }
  const cleanedText = stripInlineMacroSpecs(segText);
  let parsed = parseFoodItems(cleanedText);
  if (parsed.length === 0) parsed = await parseSegmentViaAI(cleanedText);
  // Drop stopword and too-short "foods" — macro vocabulary and dictation debris.
  // Normalized first (leading dashes/punctuation removed), and compounds made ENTIRELY
  // of stopwords ("cal fat") are dropped too — "60 cal fat 2g" must never become a food.
  parsed = parsed.filter(it => {
    const f = (it.food || "").trim().toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/\s+/g, " ").trim();
    it.food = f;
    if (f.length < 3) return false;
    if (FOOD_STOPWORDS.has(f)) return false;
    const words = f.split(" ");
    if (words.every(w => FOOD_STOPWORDS.has(w))) return false;
    return true;
  });
  const items = [];
  const unresolved = [];
  for (const it of parsed.slice(0, 6)) {
    const r = await resolveOneFood(it);
    if (r) items.push(r); else unresolved.push(it.food);
  }
  return { items, unresolved };
}

// Code-rendered card text — identical layout every single time, no AI involvement.
function renderCardText(card) {
  const label = card.meal_type.charAt(0).toUpperCase() + card.meal_type.slice(1);
  const foodsLine = card.items.map(i => `${i.food}, ${i.amount} ${i.unit}`).join("; ");
  const t = card.items.reduce((a, i) => ({
    calories: a.calories + (Number(i.calories) || 0),
    protein: a.protein + (Number(i.protein) || 0),
    carbs: a.carbs + (Number(i.carbs) || 0),
    fat: a.fat + (Number(i.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const breakdown = card.items.map(i =>
    `${i.food} — ${Math.round(i.calories)} cal, ${Math.round(i.protein)}g P, ${Math.round(i.carbs)}g C, ${Math.round(i.fat)}g F`
  ).join(" | ");
  let text =
    `${label}\n` +
    `- Foods: ${foodsLine}\n` +
    `- Calories: ${Math.round(t.calories)}\n` +
    `- Protein: ${Math.round(t.protein)}g\n` +
    `- Carbs: ${Math.round(t.carbs)}g\n` +
    `- Fat: ${Math.round(t.fat)}g`;
  if (card.items.length > 1) text += `\n\nBreakdown: ${breakdown}`;
  return text;
}

function renderMealDataBlock(card) {
  return `<<<MEAL_DATA>>>\n${JSON.stringify({ meal_type: card.meal_type, date: card.date || null, items: card.items })}\n<<<END_MEAL_DATA>>>`;
}

// ═══ [v86] INTELLIGENCE LAYER — FACT_DATA / GOAL_DATA ═══════════════════════
// Same division of labor as everything else in CURA:
//   AI  = language only. It EXTRACTS facts/goal parameters into blocks. Nothing more.
//   CODE = assigns tiers, computes every number, stores, and applies stored facts.
// Blocks ride on coach turns that already happen — zero extra AI calls.

// Code-assigned tiers. The AI never decides enforcement level.
// 1 = HARD (allergies, diet style, exclusions, health conditions)
// 2 = SOFT (likes/dislikes, lifestyle, nutrient habits)
// 3 = TIME-BOUNDED (auto-retires by date)
const FACT_KINDS = {
  dietary_style: 1, allergen: 1, intolerance: 1, restriction: 1, health_condition: 1,
  love: 2, dislike: 2, lifestyle: 2, nutrient: 2,
  constraint: 3,
};

function normalizeFactBlock(o) {
  if (!o || typeof o !== "object") return null;
  const kind = (o.kind || "").toString().toLowerCase().trim();
  if (!(kind in FACT_KINDS)) return null;
  const value = (o.value || "").toString().trim();
  if (value.length < 2 || value.length > 120) return null;
  const fact = {
    kind, value,
    reason: (o.reason || "").toString().slice(0, 200),
    tier: FACT_KINDS[kind],
    expires_at: null,
    frequency_per_week: null,
  };
  if (o.expires_at && /^\d{4}-\d{2}-\d{2}$/.test(String(o.expires_at))) {
    fact.expires_at = String(o.expires_at);
    fact.tier = 3;
  }
  if (kind === "constraint") fact.tier = 3;
  if (kind === "nutrient" && Number(o.frequency_per_week) > 0) {
    fact.frequency_per_week = Math.min(21, Math.round(Number(o.frequency_per_week)));
  }
  return fact;
}

// The current goal_type's built-in calorie adjustment (from the profile wizard's table).
// Backing this out of the stored calories gives estimated maintenance — no height needed.
function goalTypeAdjustment(goalType) {
  const t = (goalType || "").toString().toLowerCase();
  if (t.includes("loss") || t.includes("lose") || t.includes("cut")) return -400;
  if (t.includes("gain") || t.includes("muscle") || t.includes("bulk")) return 300;
  if (t.includes("performance")) return 200;
  return 0;
}

// ═══ [v86] GOAL MATH — STRICT MODE. The delta method is DEAD. ════════════════
// Maintenance comes from the user's BODY (Mifflin-St Jeor: weight, height, age,
// gender, activity) or not at all. Deriving it from the current calorie target
// caused a death spiral: each goal request re-cut from the last cut (1800 → 1500
// → 1200...). A deficit is only meaningful relative to true maintenance. The
// current target is CONTEXT on the card now — never an input to the math.

const GOAL_REQUIRED_FIELDS = [
  { key: "height_cm", label: "Height" },
  { key: "age", label: "Age" },
  { key: "current_weight", label: "Current weight" },
  { key: "gender", label: "Gender" },
  { key: "activity_level", label: "Activity level" },
];

function missingGoalFields(profile) {
  const missing = [];
  for (const f of GOAL_REQUIRED_FIELDS) {
    const v = profile?.[f.key];
    if (f.key === "height_cm" || f.key === "age" || f.key === "current_weight") {
      if (!(Number(v) > 0)) missing.push(f.label);
    } else if (!v || !String(v).trim()) {
      missing.push(f.label);
    }
  }
  return missing;
}

function trueMaintenance(profile) {
  const h = Number(profile?.height_cm);
  const a = Number(profile?.age);
  const w = Number(profile?.current_weight);
  if (!(h > 0 && a > 0 && w > 0)) return null;
  const wKg = (profile?.weight_unit || "kg").toString().toLowerCase().startsWith("lb") ? w / 2.205 : w;
  const isFemale = (profile?.gender || "").toString().toLowerCase().startsWith("f");
  const bmr = 10 * wKg + 6.25 * h - 5 * a + (isFemale ? -161 : 5);
  const mult = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, "very-active": 1.9,
  }[(profile?.activity_level || "moderate").toString().toLowerCase()] || 1.55;
  return { maintenance: Math.round(bmr * mult), bmr: Math.round(bmr) };
}

// Returns null if the profile can't support safe math — callers must handle that
// by TELLING THE USER what's missing, never by guessing.
function computeGoalTargets(profile, currentGoals, params) {
  const base = trueMaintenance(profile);
  if (!base) return null;
  const { maintenance, bmr } = base;

  const dir = params.direction === "gain" ? 1 : params.direction === "maintain" ? 0 : -1;
  let amountLbs = Math.abs(Number(params.amount)) || 0;
  const unit = (params.amount_unit || "lb").toString().toLowerCase();
  if (unit.startsWith("k")) amountLbs *= 2.2046;

  const weeks = Number(params.timeframe_weeks) > 0 ? Number(params.timeframe_weeks) : null;
  const MAX_RATE_LBS_WK = 1.5;
  let ratePerWeek = (dir !== 0) ? (weeks ? amountLbs / weeks : 1) : 0;
  let clamped = false;
  if (ratePerWeek > MAX_RATE_LBS_WK) { ratePerWeek = MAX_RATE_LBS_WK; clamped = true; }

  let dailyDelta = dir * ratePerWeek * 3500 / 7;
  let calories = Math.round(maintenance + dailyDelta);

  // TWO floors, both code-enforced: never below the user's own BMR, and never
  // below the absolute minimum. Whichever bites recomputes the honest rate.
  const absFloor = (profile?.gender || "").toString().toLowerCase().startsWith("f") ? 1200 : 1500;
  const floorCal = Math.max(bmr, absFloor);
  if (dir < 0 && calories < floorCal) {
    calories = floorCal;
    clamped = true;
    dailyDelta = calories - maintenance;
    ratePerWeek = Math.abs(dailyDelta) * 7 / 3500;
  }

  const estWeeks = (dir !== 0 && amountLbs > 0)
    ? Math.ceil(amountLbs / Math.max(ratePerWeek, 0.1)) : null;

  const ratios = dir > 0 ? { p: 0.30, c: 0.45, f: 0.25 }
              : dir < 0 ? { p: 0.35, c: 0.35, f: 0.30 }
              :           { p: 0.25, c: 0.45, f: 0.30 };
  const protein = Math.round(calories * ratios.p / 4);
  const carbs = Math.round(calories * ratios.c / 4);
  const fat = Math.round(calories * ratios.f / 9);

  const goal_type = dir > 0 ? "muscle_gain" : dir < 0 ? "fat_loss" : "maintain";

  const cw = Number(profile?.current_weight) || null;
  const wu = (profile?.weight_unit || "lb").toString();
  let target_weight = null;
  if (cw && dir !== 0 && amountLbs > 0) {
    const amtInUnit = wu.toLowerCase().startsWith("k") ? amountLbs / 2.2046 : amountLbs;
    target_weight = Math.round((cw + dir * amtInUnit) * 10) / 10;
  }

  // Current-target honesty: the user's existing number is shown and compared,
  // never fed into the math. If they were already cutting harder than this goal
  // requires, the card says so instead of stacking a deficit on a deficit.
  const currentCalories = Number(currentGoals?.calories) || null;
  let note = null;
  if (dir < 0 && currentCalories && currentCalories < calories) {
    note = `Your current target (${currentCalories} cal) is already BELOW the safe level for this goal — you've been cutting harder than needed. The recommendation raises you to ${calories}.`;
  } else if (dir < 0 && currentCalories && currentCalories === calories) {
    note = `Your current target already matches this goal.`;
  }

  return {
    calories, protein, carbs, fat, goal_type, target_weight, weight_unit: wu,
    clamped, weekly_rate_lbs: Math.round(ratePerWeek * 100) / 100,
    est_weeks: estWeeks, maintenance, bmr, current_calories: currentCalories, note,
    direction: params.direction, amount: params.amount, amount_unit: unit,
  };
}

// ═══ [v86] GOAL STATEMENT PARSER — code understands "I want to lose 30 lbs in
// 8 weeks" without AI. Regular numbers + a tiny vocabulary; the AI-extraction
// path remains only as fallback for phrasings this can't read.
function parseGoalStatement(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  let direction = null;
  // NOTE: no leading \b on the unit group — "30lbs" has no word boundary between
  // the digits and the letters, and that's exactly how people type it.
  if (/\b(lose|drop|shed|cut|losing|dropping)\b/.test(t) && /(lb|lbs|pound|pounds|kg|kgs|kilo|kilos|weight)\b/.test(t)) direction = "lose";
  else if (/\b(gain|put on|bulk|gaining)\b/.test(t) && /(lb|lbs|pound|pounds|kg|kgs|kilo|kilos|weight|muscle)\b/.test(t)) direction = "gain";
  else if (/\bmaintain\b.*\bweight\b|\bweight\b.*\bmaintain/.test(t)) direction = "maintain";
  if (!direction) return null;

  const amt = t.match(/(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?)\b/);
  const amount = amt ? Number(amt[1]) : null;
  const amount_unit = amt ? (amt[2].startsWith("k") ? "kg" : "lb") : "lb";

  let timeframe_weeks = null;
  const wk = t.match(/(?:in|over|within)\s+(\d+(?:\.\d+)?)\s*(weeks?|months?)\b/);
  if (wk) {
    const n = Number(wk[1]);
    timeframe_weeks = wk[2].startsWith("month") ? Math.round(n * 4.345) : n;
  }

  if (direction !== "maintain" && !(amount > 0)) {
    return { direction, amount: null, amount_unit, timeframe_weeks, incomplete: true };
  }
  return { direction, amount, amount_unit, timeframe_weeks, incomplete: false };
}

// The PROFILE slot of the assembled context object (spec §6). Code-built compact summary
// of currently-active facts. The `activity` slot intentionally does not exist yet — the
// activity_log table isn't live; when it is, it fills a slot here and nothing upstream moves.
async function assembleProfileSlot(userId) {
  try {
    const today = getLocalDate();
    const [dp, hc, np, uf] = await Promise.all([
      supabase.from("user_dietary_preferences").select("*").eq("user_id", userId).eq("is_active", true).limit(1),
      supabase.from("user_health_conditions").select("condition, reason").eq("user_id", userId).eq("is_active", true),
      supabase.from("user_nutrient_preferences").select("nutrient, frequency_per_week, reason").eq("user_id", userId).eq("is_active", true),
      supabase.from("user_facts").select("kind, value, reason, expires_at").eq("user_id", userId).eq("is_active", true),
    ]);
    const lines = [];
    const arr = (a) => (Array.isArray(a) && a.length ? a.join(", ") : null);
    const d = dp?.data?.[0];
    if (d) {
      if (arr(d.dietary_style)) lines.push(`Dietary style (HARD — never violate in any suggestion): ${arr(d.dietary_style)}`);
      if (arr(d.allergens)) lines.push(`ALLERGIES (SAFETY-CRITICAL — never suggest, ever): ${arr(d.allergens)}`);
      if (arr(d.intolerances)) lines.push(`Intolerances (never suggest): ${arr(d.intolerances)}`);
      if (arr(d.restrictions)) lines.push(`Hard exclusions (never suggest): ${arr(d.restrictions)}`);
      if (arr(d.loves)) lines.push(`Enjoys: ${arr(d.loves)}`);
      if (arr(d.dislikes)) lines.push(`Dislikes (avoid suggesting): ${arr(d.dislikes)}`);
    }
    for (const c of hc?.data || []) {
      lines.push(`Health condition: ${c.condition}${c.reason ? ` (${c.reason})` : ""}`);
    }
    for (const n of np?.data || []) {
      lines.push(`Nutrient habit: ${n.nutrient}${n.frequency_per_week ? ` ${n.frequency_per_week}x/week` : ""}${n.reason ? ` — ${n.reason}` : ""}`);
    }
    for (const f of uf?.data || []) {
      if (f.expires_at && f.expires_at < today) continue; // time-bounded: active-by-date, not by flag
      if (f.kind === "constraint") {
        lines.push(`Active commitment${f.expires_at ? ` (until ${f.expires_at})` : ""}: ${f.value}`);
      } else {
        lines.push(`Lifestyle: ${f.value}${f.reason ? ` (${f.reason})` : ""}`);
      }
    }
    if (lines.length === 0) return "";
    return `\n\nSTORED PROFILE FACTS (from past conversations and the user's profile — apply them silently; don't recite them unless asked. They shape what you SUGGEST. They must NEVER block, judge, or comment negatively on what the user LOGS):\n- ${lines.join("\n- ")}\n`;
  } catch (e) {
    return ""; // missing table (pre-migration) or read error — coach just runs without facts
  }
}

const INTEL_CAPTURE_PROMPT = `

FACT & GOAL CAPTURE (silent — never mention these blocks in your prose):
If the user CLEARLY states a durable fact about themselves, append one FACT_DATA block per fact AFTER your reply:
<<<FACT_DATA>>>{"kind":"allergen","value":"shellfish","reason":"","expires_at":null}<<<END_FACT_DATA>>>
Valid kinds: dietary_style (vegan, vegetarian, pescatarian, keto...), allergen, intolerance, restriction (foods they always avoid, e.g. "no pork"), love, dislike, health_condition, nutrient (include "frequency_per_week" if stated, e.g. ginger 5x/week), lifestyle (e.g. "works nights, skips breakfast"), constraint (time-bounded commitment — include "expires_at" as YYYY-MM-DD if a timeframe was given).
RULES: Only facts the user explicitly stated about themselves — never inferences, never one-off mentions ("I had shrimp" is NOT a fact; "I'm allergic to shrimp" is). When unsure, emit nothing. Do not re-emit facts already listed in STORED PROFILE FACTS.
If the user CLEARLY states a stored fact NO LONGER applies ("I'm not vegan anymore", "my blood pressure is fine now", "I actually like beans"), append a removal block instead — ONLY for facts that appear in STORED PROFILE FACTS:
<<<FACT_REMOVE>>>{"kind":"dietary_style","value":"vegan"}<<<END_FACT_REMOVE>>>
Same kinds as FACT_DATA. Never emit removals as guesses; the user confirms via a card before anything changes.
If the user states a weight/body goal ("I want to lose 10 lbs in 2 months"), append:
<<<GOAL_DATA>>>{"direction":"lose","amount":10,"amount_unit":"lb","timeframe_weeks":8}<<<END_GOAL_DATA>>>
Parameters ONLY — direction (lose/gain/maintain), amount, amount_unit (lb/kg), timeframe_weeks (null if unstated). NEVER compute or state new calorie/macro targets yourself; code computes them and shows the user a confirmation card.`;

// Post-process the AI reply: validate FACT blocks (code assigns tier), replace GOAL
// parameter blocks with CODE-COMPUTED targets. Invalid blocks are stripped entirely.
async function enrichIntelligenceBlocks(reply, userId) {
  if (!reply) return reply;
  const hasFact = reply.includes("<<<FACT_DATA>>>");
  const hasRemove = reply.includes("<<<FACT_REMOVE>>>");
  const hasGoal = reply.includes("<<<GOAL_DATA>>>");
  if (!hasFact && !hasGoal && !hasRemove) return reply;
  let out = reply;
  if (hasFact) {
    out = out.replace(/<<<FACT_DATA>>>\s*([\s\S]*?)\s*<<<END_FACT_DATA>>>/g, (m, body) => {
      const fact = normalizeFactBlock(parseLooseJSON(body));
      return fact ? `<<<FACT_DATA>>>\n${JSON.stringify(fact)}\n<<<END_FACT_DATA>>>` : "";
    });
  }
  if (hasRemove) {
    out = out.replace(/<<<FACT_REMOVE>>>\s*([\s\S]*?)\s*<<<END_FACT_REMOVE>>>/g, (m, body) => {
      const fact = normalizeFactBlock(parseLooseJSON(body));
      return fact ? `<<<FACT_REMOVE>>>\n${JSON.stringify(fact)}\n<<<END_FACT_REMOVE>>>` : "";
    });
  }
  if (hasGoal) {
    let profile = null, currentGoals = null;
    try {
      const { data } = await supabase.from("user_profiles").select("*").eq("user_id", userId).single();
      profile = data;
    } catch {}
    try {
      const { data } = await supabase.from("goals").select("*").eq("user_id", userId).single();
      currentGoals = data;
    } catch {}
    out = out.replace(/<<<GOAL_DATA>>>\s*([\s\S]*?)\s*<<<END_GOAL_DATA>>>/g, (m, body) => {
      const parsed = parseLooseJSON(body);
      if (!parsed || !parsed.direction || !["lose", "gain", "maintain"].includes(String(parsed.direction))) return "";
      // Already-enriched blocks (code-owned goal path) pass through untouched.
      if (Number(parsed.calories) > 0 && Number(parsed.maintenance) > 0) return m;
      const computed = computeGoalTargets(profile, currentGoals, parsed);
      if (!computed) return ""; // missing profile data — no card built on guesses
      return `<<<GOAL_DATA>>>\n${JSON.stringify(computed)}\n<<<END_GOAL_DATA>>>`;
    });
  }
  return out;
}

function classifyEventType(text) {
  const lower = text.toLowerCase();
  if (/hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket/.test(lower)) return "sport";
  if (/gym|workout|training|crossfit|weightlift|lifting|exercise|run|running|cycling|swim|yoga|pilates|hiit|cardio/.test(lower)) return "workout";
  if (/hike|hiking|bike ride|marathon|race|triathlon|spartan|10k|5k|half marathon|full marathon/.test(lower)) return "endurance";
  if (/dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|lunch date|sushi|italian|chinese|mexican|thai|indian|steakhouse|dinner out|dinner tonight|dinner tomorrow|dinner at/.test(lower)) return "social_dining";
  if (/drinks|bar|cocktail|wine|beer|happy hour/.test(lower)) return "social_drinks";
  if (/bbq|barbecue|cookout|potluck|picnic/.test(lower)) return "social_food";
  if (/long day|work event|conference|meeting|presentation|interview|all.?day/.test(lower)) return "work";
  if (/travel|flight|airport|long drive|road trip/.test(lower)) return "travel";
  return null;
}

function isPhysicalEvent(type) {
  return ["sport", "workout", "endurance"].includes(type);
}

function isSocialEvent(type) {
  return ["social_dining", "social_drinks", "social_food"].includes(type);
}

function parseHour(hourStr, ampm) {
  let h = parseInt(hourStr);
  const ap = (ampm || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h < 6) h += 12; // assume pm for ambiguous small numbers
  return h;
}

// Extract ALL events from text with their times
// Returns array sorted by hour: [{ type, hour, label, isTomorrow }]
function extractAllEvents(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const events = [];

  // Patterns to find time + event combinations
  // e.g. "workout at 7am", "tennis at 5pm", "dinner at 8"
  const timeEventPatterns = [
    // "X at TIME" pattern
    /((?:workout|gym|run|running|swim|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|bike ride|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|barbecue|potluck|picnic|lunch date)[^.!?]*?)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi,
    // "TIME + X" pattern  
    /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?((?:workout|gym|run|running|swim|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|bike ride|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|barbecue|potluck|picnic|lunch date))/gi,
  ];

  // Try pattern 1: "event at time"
  let match;
  const re1 = /(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|dinner|sushi|italian|chinese|mexican|thai|indian|steakhouse|restaurant|going out|eating out|birthday|wedding|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|potluck|picnic|lunch)\b[^.!?]{0,30}?)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  
  while ((match = re1.exec(lower)) !== null) {
    const eventText = match[1].trim();
    const h = parseHour(match[2], match[4]);
    const type = classifyEventType(eventText);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = lower.includes("tomorrow");
      events.push({ type, hour: h, label: eventText.trim(), isTomorrow });
    }
  }

  // Try pattern 2: "at time for/event"  
  const re2 = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|10k|5k|golf|cycling|dinner|restaurant|brunch|drinks|bar|party|bbq)\b)/gi;
  
  while ((match = re2.exec(lower)) !== null) {
    const h = parseHour(match[1], match[3]);
    const type = classifyEventType(match[4]);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = lower.includes("tomorrow");
      // Avoid duplicates at same hour
      if (!events.find(e => e.hour === h && e.type === type)) {
        events.push({ type, hour: h, label: match[4].trim(), isTomorrow });
      }
    }
  }

  // Sort by hour
  events.sort((a, b) => a.hour - b.hour);
  return events;
}

// Check if we have events but are missing times — need to ask user
function eventsMissingTimes(text) {
  const lower = text.toLowerCase();
  const hasEventKeywords = /workout|gym|tennis|hockey|soccer|football|basketball|marathon|race|triathlon|golf|yoga|run|swim|dinner party|dinner date|restaurant|going out|eating out|birthday|wedding|brunch|drinks|bar/.test(lower);
  const hasTimeKeywords = /\d+\s*(am|pm)|at\s+\d+|\d+:\d+|morning|afternoon|evening|night/.test(lower);
  return hasEventKeywords && !hasTimeKeywords;
}

// Build the day strategy from multiple events
function buildMultiEventStrategy(events, currentHour, goal) {
  if (events.length === 0) return "";

  const physicalEvents = events.filter(e => isPhysicalEvent(e.type));
  const socialEvents = events.filter(e => isSocialEvent(e.type));
  const hasPhysical = physicalEvents.length > 0;
  const hasSocial = socialEvents.length > 0;

  let strategy = `
MULTI-EVENT DAY DETECTED — ${events.length} event(s):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 (${e.label})`).join("\n")}

CALORIE TARGET: Aim for 85-95% of ${goal.calories} cal (${Math.round(goal.calories * 0.85)}-${Math.round(goal.calories * 0.95)} cal). Never below 80% (${Math.round(goal.calories * 0.8)} cal) on active days.

MEAL TIMELINE RULES:
`;

  // Add rules for each event in order
  events.forEach((event, idx) => {
    const prevEvent = idx > 0 ? events[idx - 1] : null;
    const nextEvent = idx < events.length - 1 ? events[idx + 1] : null;

    if (isPhysicalEvent(event.type)) {
      // Smart timing logic - don't suggest eating at 3-4am for early events!
      let preEventAdvice;
      if (event.hour <= 8) {
        // Early morning event (7am, 8am)
        preEventAdvice = "30-60 minutes before OR eat after: light snack (banana, toast) 200-300 cal OR have your main meal after the workout";
      } else if (event.hour <= 12) {
        // Late morning event  
        preEventAdvice = "1-2 hours before: light snack — HIGH carbs, LOW fat (banana, rice cakes) 250-350 cal";
      } else {
        // Afternoon/evening event
        preEventAdvice = "2-3 hours before: pre-event Snack — HIGH carbs, LOW fat, easy to digest (banana, rice cakes, oatmeal) 300-400 cal";
      }
      
      strategy += `
${event.type.toUpperCase()} at ${event.hour}:00 (${event.label}):
- ${preEventAdvice}
- Within 1 hour after: recovery meal — HIGH protein + carbs
${nextEvent && isSocialEvent(nextEvent.type) ? `- NOTE: Social event follows at ${nextEvent.hour}:00 — recovery meal should be lighter since social eating comes next` : "- Include a full Dinner block for post-event recovery"}
`;
    } else if (isSocialEvent(event.type)) {
      const eventCalBudget = Math.round(goal.calories * 0.45);
      strategy += `
SOCIAL EVENT at ${event.hour}:00 (${event.label}):
${prevEvent && isPhysicalEvent(prevEvent.type) ? `- Follows physical event at ${prevEvent.hour}:00 — budget remaining calories for this meal` : "- Keep meals before this event LIGHT (lean protein + veg)"}
- DO NOT create a meal block for this event — unknown menu
- After all planned meal blocks, add this EXACT plain text (no meal block):

"For the ${event.label} — you have around ${eventCalBudget} calories budgeted for this meal.
Here's what to look for:
- Lean protein: grilled or baked over fried
- Light on heavy sauces and rich sides
- Go easy on bread and alcohol
- Watch portion sizes on starches
When you're there, take a photo of the menu and I'll help you pick the best options for your goals."

- Budget approximately ${eventCalBudget} cal for this event — state this number explicitly
`;
    }
  });

  strategy += `
MEAL BLOCK STRUCTURE FOR THIS DAY:
Only create blocks for meals YOU control (before events or between events).
For social dining events: plain text guidance only, NO meal block.
For physical events: include Dinner block for post-event recovery UNLESS a social event follows soon after.
Total planned meals should add up to 85-95% of ${goal.calories} cal.
`;

  return strategy;
}

function isRestaurantOrPartyMeal(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /dinner party|dinner date|restaurant|going out|eating out|party|wedding|birthday|someone('s| else| is).*cook|friend.*cook|family.*cook|steak dinner|sushi|italian|chinese|mexican|thai|indian|at a (restaurant|bar|pub|place)/.test(lower);
}

function getUnloggedMealPrompt(hour, nothingLogged) {
  if (!nothingLogged) return null;
  if (hour >= 7  && hour < 11) return "It's morning and nothing is logged yet. Ask: 'Have you had breakfast yet? If so, what did you have? I want to make sure I account for it before planning your day.'";
  if (hour >= 11 && hour < 14) return "It's late morning/lunchtime and nothing is logged. Ask: 'Before I plan your meals, what have you eaten so far today? Even a rough idea helps me give you accurate advice.'";
  if (hour >= 14 && hour < 18) return "It's afternoon and nothing is logged. Ask: 'I don't have any food logged for today. What have you eaten so far? Knowing this is important before I suggest anything for the rest of the day.'";
  if (hour >= 18) return "It's evening and nothing is logged. Say: 'I don't see anything logged today. What did you eat earlier? I want to factor that in before suggesting anything for tonight.'";
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { message, context, history = [], userId, localHour, localDate: clientDate, images, thread_id = null } = body;
    const image = images?.[0] || null; // backward compat for single image checks

    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";

    // ── CONTINUE-THREAD: when a thread_id is present, load the whole chain from ai_messages
    // and feed it to the AI as context. Default (no thread) keeps the slice(-1) behavior.
    const stripMealData = (t) => (t || "").replace(/<<<MEAL_DATA>>>[\s\S]*?<<<END_MEAL_DATA>>>/g, "").trim();
    let threadHistory = [];
    if (thread_id) {
      try {
        const { data: prior } = await supabase
          .from("ai_messages")
          .select("message, response, created_at")
          .eq("thread_id", thread_id)
          .order("created_at", { ascending: true });
        if (prior && prior.length > 0) {
          for (const row of prior) {
            if (row.message)  threadHistory.push({ role: "user", content: row.message });
            if (row.response) threadHistory.push({ role: "assistant", content: stripMealData(row.response) });
          }
        }
      } catch (e) { console.log("thread history load error:", e.message); }
    }
    const hour = typeof localHour === "number" ? localHour : new Date().getHours();
    const today = getLocalDate(clientDate);

    // ── Load profile ──
    let userName = "there", currentWeight = null, targetWeight = null;
    let weightUnit = "lbs", activityLevel = "moderately active", goalType = "fat_loss";
    let healthConditions = "";

    try {
      const { data: profile } = await supabase
        .from("user_profiles").select("*").eq("user_id", activeUserId).single();
      if (profile) {
        userName         = profile.name || "there";
        currentWeight    = profile.current_weight;
        targetWeight     = profile.target_weight;
        weightUnit       = profile.weight_unit || "lbs";
        activityLevel    = profile.activity_level || "moderately active";
        goalType         = profile.goal_type || "fat_loss";
        healthConditions = profile.health_conditions || "";
      }
    } catch (e) { console.log("Profile error:", e.message); }

    // ── Load goals ──
    let goal = { calories: 2200, protein: 180, carbs: 220, fat: 70 };
    try {
      const { data: g } = await supabase
        .from("goals").select("*").eq("user_id", activeUserId).single();
      if (g) goal = { calories: g.calories||2200, protein: g.protein||180, carbs: g.carbs||220, fat: g.fat||70 };
    } catch (e) { console.log("Goals error:", e.message); }

    // ── Load today's meals ──
    let todayMeals = [];
    try {
      const { data: meals } = await supabase
        .from("actual_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      todayMeals = meals || [];
    } catch (e) { console.log("Meals error:", e.message); }

    // ── Load today's planned meals ──
    let todayPlanned = [];
    try {
      const { data: planned } = await supabase
        .from("planned_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      todayPlanned = planned || [];
    } catch (e) { console.log("Planned meals error:", e.message); }

    const plannedTypes = [...new Set(todayPlanned.map(m => m.meal_type))];
    const hasPlannedMeals = todayPlanned.length > 0;
    const plannedSummary = todayPlanned.length > 0
      ? todayPlanned.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal)`).join("\n")
      : "No planned meals yet";

   const totals = sumMeals(todayMeals);          // EATEN totals
    const plannedTotals = sumMeals(todayPlanned); // PLANNED totals
    // Committed = eaten PLUS already-planned for today.
    const committed = {
      calories: totals.calories + plannedTotals.calories,
      protein:  totals.protein  + plannedTotals.protein,
      carbs:    totals.carbs    + plannedTotals.carbs,
      fat:      totals.fat      + plannedTotals.fat,
    };
    // TRUE remaining = goal minus eaten minus planned.
    const remaining = {
      calories: Math.max(0, goal.calories - committed.calories),
      protein:  Math.max(0, goal.protein  - committed.protein),
      carbs:    Math.max(0, goal.carbs    - committed.carbs),
      fat:      Math.max(0, goal.fat      - committed.fat),
    };

    // ═══ [v86] FOOD LOG — CODE-OWNED, EARLY RETURN ═══════════════════════════
    // The conversational AI below NEVER runs for a food log. Code segments the
    // message, resolves every food from the database (AI fills gaps in the
    // background via write-back), renders the message, and returns cards.
    let dbFoodResults = null;   // kept for the planning path below
    let mealSegments = null;    // legacy var; food_log no longer reaches the AI section
    let lookupMsg = null;
    if (context?.type === "food_log") {
      lookupMsg = context.followUpMessage || context.originalMessage || message;

      // WEAK-DESCRIPTION GUARD (unchanged): composed food with zero real amounts →
      // ask for rough sizes instead of guessing.
      const weakCheck = detectWeakComposedFood(lookupMsg);
      if (weakCheck.weak) {
        console.log("🡒 weak composed food — asking for amounts instead of guessing:", lookupMsg);
        try {
          await supabase.from("ai_messages").insert([{
            user_id: activeUserId, message: message || "", response: weakCheck.question,
            thread_id: thread_id || null, created_at: new Date().toISOString(),
          }]);
        } catch (e) {}
        return Response.json({ reply: weakCheck.question });
      }

      const localHourForSeg = (typeof localHour === "number") ? localHour : 12;
      // [v86] Decide the target date ONCE, from THIS log message ("yesterday" in the
      // sentence itself — never from surrounding chat), and carry it on every card.
      const todayStr = getLocalDate(clientDate);
      const logDate = detectLogDateWithHour(lookupMsg, todayStr, localHourForSeg);
      const segs = segmentMeals(lookupMsg, localHourForSeg);
      const cards = [];
      const allUnresolved = [];
      const labelSaves = [];
      for (const seg of segs) {
        const { items, unresolved, labelSaved } = await resolveSegment(seg.text);
        allUnresolved.push(...unresolved);
        if (labelSaved) labelSaves.push(labelSaved);
        if (items.length > 0) {
          cards.push({ meal_type: seg.meal_type, inferred: !!seg.inferred, date: logDate, items });
        }
        console.log(`  [v86] [${seg.meal_type}] "${seg.text}" -> ${items.length} food(s)${unresolved.length ? `, unresolved: ${unresolved.join(", ")}` : ""}`);
      }

      // Nothing identifiable anywhere → deterministic clarifying message (code, not AI).
      if (cards.length === 0) {
        const fallbackMsg = "I couldn't identify the foods in that — could you say it again with rough amounts? For example: \"2 eggs and a slice of toast\".";
        try {
          await supabase.from("ai_messages").insert([{
            user_id: activeUserId, message: message || "", response: fallbackMsg,
            thread_id: thread_id || null, created_at: new Date().toISOString(),
          }]);
        } catch (e) {}
        return Response.json({ reply: fallbackMsg });
      }

      // Code-rendered display text — identical format every time.
      let displayText = cards.map(renderCardText).join("\n\n");
      if (allUnresolved.length > 0) {
        displayText += `\n\n(I couldn't identify: ${allUnresolved.join(", ")} — send a follow-up with rough amounts and I'll add ${allUnresolved.length > 1 ? "them" : "it"}.)`;
      }
      if (labelSaves.length > 0) {
        displayText += `\n\n📋 Saved the label for ${labelSaves.join(", ")} — next time just say the name and I'll use these exact numbers.`;
      }

      // Option A persistence: the STORED response is the code-generated text plus one
      // MEAL_DATA block per card. Reload re-extracts the exact same cards from this.
      const storedResponse = displayText + "\n\n" + cards.map(renderMealDataBlock).join("\n");

      let logMessageId = null;
      try {
        const { data: inserted } = await supabase.from("ai_messages").insert([{
          user_id: activeUserId, message: message || "", response: storedResponse,
          thread_id: thread_id || null, created_at: new Date().toISOString(),
        }]).select("id").single();
        logMessageId = inserted?.id || null;
      } catch (e) { console.log("Save error:", e); }

      console.log(`=== FOOD LOG [v86] | ${cards.length} card(s) | conversational AI: skipped`);
      return Response.json({ reply: displayText, aiMessageId: logMessageId, mealCards: cards });
    }

    // ═══ [v86] GOAL STATEMENT — CODE-OWNED, EARLY RETURN ═════════════════════
    // "I want to lose 30 lbs" never reaches the AI. Code parses it, code computes
    // from TRUE maintenance, code authors the reply. If mandatory profile data is
    // missing, code says exactly what to fill in — it never guesses.
    if (!(images?.length > 0) && context?.type !== "photo" && context?.type !== "food_log") {
      const goalParams = parseGoalStatement(message);
      if (goalParams) {
        const saveCodeReply = async (text) => {
          let id = null;
          try {
            const { data: ins } = await supabase.from("ai_messages").insert([{
              user_id: activeUserId, message: message || "", response: text,
              thread_id: thread_id || null, created_at: new Date().toISOString(),
            }]).select("id").single();
            id = ins?.id || null;
          } catch (e) {}
          return id;
        };

        if (goalParams.incomplete) {
          const askMsg = `Happy to set that up — how much do you want to ${goalParams.direction}? Tell me like: "I want to ${goalParams.direction} 20 pounds" (add "in 10 weeks" if you have a timeline).`;
          const mid = await saveCodeReply(askMsg);
          return Response.json({ reply: askMsg, aiMessageId: mid });
        }

        let gProfile = null, gGoals = null;
        try {
          const { data } = await supabase.from("user_profiles").select("*").eq("user_id", activeUserId).single();
          gProfile = data;
        } catch (e) {}
        try {
          const { data } = await supabase.from("goals").select("*").eq("user_id", activeUserId).single();
          gGoals = data;
        } catch (e) {}

        const missing = missingGoalFields(gProfile);
        if (missing.length > 0) {
          const missMsg = `To calculate this safely I need your real numbers — guessing produces bad targets. Please fill in: ${missing.join(", ")}. You'll find ${missing.length > 1 ? "them" : "it"} under Profile → basics (height is near the Recalculate button). Then just ask me again.`;
          const mid = await saveCodeReply(missMsg);
          console.log(`=== GOAL [v86] | blocked, missing: ${missing.join(", ")}`);
          return Response.json({ reply: missMsg, aiMessageId: mid });
        }

        const computed = computeGoalTargets(gProfile, gGoals, goalParams);
        if (computed) {
          const dirWord = computed.direction === "gain" ? "gain" : computed.direction === "maintain" ? "maintain" : "lose";
          let replyText = `Here's the plan, computed from your profile (weight, height, age, activity):\n`
            + `- Your maintenance: ~${computed.maintenance} cal/day\n`
            + (computed.direction !== "maintain"
              ? `- To ${dirWord} ${goalParams.amount} ${computed.amount_unit} at ${computed.weekly_rate_lbs} lb/week: ${computed.calories} cal/day (~${computed.est_weeks} weeks)\n`
              : `- To maintain: ${computed.calories} cal/day\n`)
            + `- Macros: ${computed.protein}g protein / ${computed.carbs}g carbs / ${computed.fat}g fat`;
          if (computed.clamped) replyText += `\n\n⚠️ I adjusted the pace to a safe rate — faster isn't sustainable or healthy.`;
          if (computed.note) replyText += `\n\nNote: ${computed.note}`;
          replyText += `\n\nReview the card below — nothing changes until you confirm.`;
          const storedGoal = replyText + `\n\n<<<GOAL_DATA>>>\n${JSON.stringify(computed)}\n<<<END_GOAL_DATA>>>`;
          const mid = await saveCodeReply(storedGoal);
          console.log(`=== GOAL [v86] | code-owned | maintenance ${computed.maintenance} -> target ${computed.calories}`);
          return Response.json({ reply: storedGoal, aiMessageId: mid });
        }
      }
    }

    // Planning lookup: only when the user NAMED specific foods (e.g. "I'm planning 8oz chicken and 1/4 cup rice").
    // NOT when they asked for an open plan (e.g. "plan my day") — there are no stated foods to look up.
    let plannedFoodResults = null;
    if (context?.type === "meal_planning") {
      const planMsg = context.request || message || "";
      // Heuristic: a stated meal contains a quantity token (number + unit/food). An open plan request does not.
      const hasStatedFoods = /\b\d+\.?\d*\s*(oz|ounce|ounces|cup|cups|g|gram|grams|tbsp|tsp|slice|slices|piece|pieces|scoop|scoops|egg|eggs)\b/i.test(planMsg);
      if (hasStatedFoods) {
        plannedFoodResults = await lookupFoodMacros(planMsg);
        if (plannedFoodResults) {
          console.log(`=== DB FOOD LOOKUP (planning): found ${plannedFoodResults.length} food(s) ===`);
          plannedFoodResults.forEach(r => console.log(`  ${r.food}: ${r.calories} cal, ${r.protein}g P, ${r.carbs}g C, ${r.fat}g F`));
        } else {
          console.log("=== DB FOOD LOOKUP (planning): no match — AI will estimate ===");
        }
      } else {
        console.log("=== PLANNING: open plan request, no stated foods — AI will build the day ===");
      }
    }

    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const nothingEatenYet = todayMeals.length === 0;
    const unloggedPrompt = getUnloggedMealPrompt(hour, nothingEatenYet);

    const allText = [...history.map(h => h.content || ""), message || ""].join(" ");
    // Multi-event detection
    const events = extractAllEvents(allText);
    const hasMultipleEvents = events.length > 1;
    const hasAnyEvent = events.length > 0;
    const hasPhysicalEvents = events.some(e => isPhysicalEvent(e.type));
    const hasSocialEvents = events.some(e => isSocialEvent(e.type));
    const hasRestaurantMeal = isRestaurantOrPartyMeal(allText);
    const missingEventTimes = eventsMissingTimes(allText);

    // Legacy single-event vars for backward compat with prompt sections
    const primaryEvent = events[0] || null;
    const eventType = primaryEvent?.type || null;
    const eventHour = primaryEvent?.hour || null;
    const hoursUntilEvent = eventHour !== null ? eventHour - hour : null;
    const hasEventToday = events.some(e => !e.isTomorrow && e.hour > hour);
    const hasTomorrowEvent = events.some(e => e.isTomorrow);

    const goalLabel = {
      fat_loss: "Fat Loss", muscle_gain: "Muscle Gain", maintain: "Maintain Weight",
      health: "General Health", blood_pressure: "Heart Health / Blood Pressure",
      performance: "Athletic Performance",
    }[goalType] || "General Health";

    const mentionedWeight = extractWeightFromMessage(message);
    const weightToLose = mentionedWeight?.amount || null;
    const weeksToGoal = weightToLose ? Math.ceil(weightToLose) : null;
    const veryActive = isVeryActive(activityLevel);
    const foodCutAmount = veryActive ? 500 : 300;
    const weightLossCals = goal.calories - foodCutAmount;

    // Only show weight loss deficit coaching if user is explicitly asking about losing weight
    const allLower = (message || "").toLowerCase();
    const isWeightLossConversation = weightToLose !== null ||
      /lose weight|losing weight|lose \d|drop \d|cut calories|deficit|slim down/.test(allLower);

    const mealsSummary = todayMeals.length > 0
      ? todayMeals.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`).join("\n")
      : "Nothing logged yet today";

    // Build event strategy
    let eventStrategy = "";

    // If user mentioned events but no times — ask for times
    if (missingEventTimes && !hasAnyEvent) {
      eventStrategy = `
MISSING EVENT TIMES:
The user mentioned events but didn't provide specific times.
Ask them: "What time is each event? I need the times to plan your meals properly around them."
Do NOT guess or plan without times. Just ask.`;
    } else if (hasMultipleEvents) {
      // Multi-event day — use new timeline builder
      eventStrategy = buildMultiEventStrategy(events, hour, goal);
   } else if (hasRestaurantMeal && !hasPhysicalEvents) {
      eventStrategy = `
RESTAURANT / EATING OUT:
If the user has NOT yet said what they'll order: don't fabricate specific dishes for the restaurant meal. Plan the other meals around it, give brief guidance for the meal out (lean/grilled over fried, light on heavy sauces, watch portions), and tell them to photo the menu or their order so they can save it with the buttons. Budget it from their REMAINING macros.
If the user HAS stated specific foods/dishes: that overrides the above — build the meal block for it immediately and emit MEAL_DATA. Never ask "out or planned?"; the buttons handle that.
When logging a restaurant meal after the fact, note that macros are estimates based on typical portions.`;
    } else if ((hasEventToday || hasTomorrowEvent) && eventType) {
      if (["sport", "workout", "endurance"].includes(eventType)) {
        eventStrategy = `
PHYSICAL EVENT STRATEGY (${eventType} at ${eventHour !== null ? eventHour + ":00" : "scheduled time"}, ${hoursUntilEvent !== null ? hoursUntilEvent + "h away" : ""}):

CALORIE RULE FOR SPORT/RACE DAY: Aim for 85-95% of the ${goal.calories} calorie target (${Math.round(goal.calories * 0.85)}-${Math.round(goal.calories * 0.95)} cal minimum). Athletes need solid fuel. Never plan below 80% (${Math.round(goal.calories * 0.8)} cal) on a race or game day unless user explicitly asks for a deficit.

MEAL STRUCTURE FOR THE FULL DAY:
1. Breakfast: balanced, good carbs + protein (up at ${hour}:00 so plan accordingly)
2. Lunch: high carbs, moderate protein, low fat — fuel loading
3. Pre-event timing (smart approach based on event time):
   ${eventHour <= 8 ? "Early event — eat 30-60 min before OR after the event" : eventHour <= 12 ? "Mid-morning — eat 1-2 hours before" : "Afternoon/evening — eat 2-3 hours before"}
   HIGH carbs, LOW fat, easy to digest (300-400 cal) — banana, rice cakes, oatmeal
4. Post-event Dinner (within 1-2 hours after): HIGH protein + carbs for recovery — this is MANDATORY, do not skip it

ATHLETIC EVENT FOOD EXAMPLES — USE THESE FOR RECOVERY DINNER:
- Grilled chicken with pasta or quinoa
- Salmon with sweet potato and rice  
- Turkey with mashed potato
- Lean beef with rice and vegetables
- NOT steak or heavy/fatty foods — keep it digestible for recovery

IMPORTANT:
- You MUST include a Dinner block for post-race/game recovery. This is NOT a restaurant meal — create the Dinner block with recovery-focused foods.
- Total across all meals should reach ${goal.calories} cal
- Add timing notes AFTER each meal block in plain text
- You CAN use two Snack blocks (pre-event + post-event if needed)`;
      } else if (eventType === "work") {
        eventStrategy = `
LONG WORK DAY STRATEGY:
- Steady energy, avoid sugar crashes
- Breakfast: complex carbs + protein
- Lunch: balanced, not too heavy
- Afternoon Snack: light focus food`;
      }
    }

    let systemMessage = `You are ${userName}'s personal AI nutrition coach — a knowledgeable, supportive friend who knows nutrition cold. This app serves all kinds of people (athletes, busy parents, people managing health conditions, seniors). Adapt to who THIS person is and what their day looks like.

══════════════════════════════════════════
HOW YOU OPERATE — FOUR CORE RULES
══════════════════════════════════════════
1. ASSUME AND STATE — DON'T INTERROGATE. When something is missing, make the reasonable assumption, say it in one short line, and keep moving. The plan itself is the correction tool — the user edits or removes anything that's wrong. Only ask when you genuinely cannot proceed (an event with no time given, or a bare "ok"/"hey"). Never restart a conversation with a clarifying question.

2. WORDS NEVER SAVE — ONLY BUTTONS SAVE. A meal is saved ONLY when you emit a MEAL_DATA block, the app shows buttons, and the user taps one. "yes", "sure", "sounds good", "perfect" save NOTHING and are NOT instructions to act on. Never say "want me to log this?", "reply yes to save", or "ready to add it?". If the user says yes to a suggestion, the block and its buttons are already on screen — acknowledge briefly and STOP. Never re-output the block, never start over.

3. DON'T STATE WHAT YOU CAN'T KNOW. Never present a guess as certain: the time an event will end, what someone will order at a restaurant, or exact macros from a photo. Say "right after your game" (not a guessed time), give guidance + a budget for an un-ordered restaurant meal (not invented dishes), and call any photo result an estimate (never "exact").

4. NUMBERS COME FROM THE DATA, NOT FROM YOU. Use the day-state numbers you're given. Don't invent or recompute totals. Show single totals only — never "X + Y = Z".

══════════════════════════════════════════
VOICE
══════════════════════════════════════════
Knowledgeable friend, not a data-entry tool. Lead with strategy, then specifics. Confident and direct — real recommendations, not vague hedging. Specific to THIS person's day — name the real challenge (a workout, a social lunch, an energy dip). Never generic ("eat healthy" is not coaching). Honest — push back on unrealistic goals; say "Real Talk" when needed.

NUMBERS RULE (critical): Do NOT compute or state how the user is tracking against their DAILY goals — never say things like "you're at 70% of your calories", "you're 170g protein, above your goal", "you have 400 cal left today", or any percentage/above-below/remaining figure for the DAY. The APP calculates and displays all of that (it's shown on screen and after each meal). Your job is the qualitative coaching around it — WHAT to eat and WHY — not the arithmetic. If you need to reference where they stand, speak generally ("you've got room for a solid dinner", "protein's worth prioritizing") without inventing numbers. The one exception: when you build a meal/plan, you may state that meal's own macros.

══════════════════════════════════════════
FORMATTING — NO MARKDOWN, EVER
══════════════════════════════════════════
Plain text only. NEVER use **, ##, *, or _ — markdown breaks the app display. This applies to EVERY response (plans, Q&A, comparisons, everything).
Meal block header is EXACTLY: [MealType] — [relative timing] ([short context]) — e.g. "Snack — 2 hours before your game" or "Breakfast — post-walk". The meal-type word alone starts the line. No bold, no asterisks. NEVER put a clock time in a header (see TIMES rule below).
Emojis for structure only (🎯 📊 👉 ✅ ⚖️ 💬 🧠 👍 🔍), not decoration (avoid 🎉 😊 🔥 💪). Short sections with line breaks — never walls of text.

══════════════════════════════════════════
USER PROFILE
══════════════════════════════════════════
Name: ${userName}
Health Goal: ${goalLabel}
Activity Level: ${activityLevel}
Very Active: ${veryActive ? "YES" : "NO"}
${currentWeight  ? `Current Weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight   ? `Target Weight: ${targetWeight} ${weightUnit}` : ""}
${healthConditions ? `Health Notes: ${healthConditions}` : ""}
Local Time: ${hour}:00 (${timeOfDay})

DAILY TARGETS — SET BY USER, DO NOT CHANGE:
Calories: ${goal.calories} | Protein: ${goal.protein}g | Carbs: ${goal.carbs}g | Fat: ${goal.fat}g

══════════════════════════════════════════
CRITICAL CALORIE RULE — READ THIS CAREFULLY
══════════════════════════════════════════
${userName}'s daily calorie target is ${goal.calories}. This number was SET BY THE USER in their profile.

You MUST use ${goal.calories} as the daily calorie goal in ALL coaching and meal plans.
Do NOT say "your new target for fat loss is 2300" or any invented number.
Do NOT use ${weightLossCals} as the plan target unless user explicitly asks to lose weight TODAY.
If user says "stay within my macros" or "plan my meals" → use ${goal.calories}. Full stop.
Do NOT calculate a different number based on their goal type.
Do NOT apply your own deficit to arrive at a different target.
Do NOT say "for fat loss you should eat X" if X is different from ${goal.calories}.

The ${goal.calories} target ALREADY reflects their goals — it is the number they want to eat each day.

TODAY'S NUMBERS — straight from the database. These are facts. Use them; never invent or recompute a total or a "remaining."
EATEN so far (${today}): ${totals.calories} cal | ${totals.protein}g P | ${totals.carbs}g C | ${totals.fat}g F
ALREADY PLANNED today, not yet eaten: ${plannedTotals.calories} cal | ${plannedTotals.protein}g P | ${plannedTotals.carbs}g C | ${plannedTotals.fat}g F
REMAINING for today (goal − eaten − planned) — THIS is the budget for anything you suggest today: ${remaining.calories} cal | ${remaining.protein}g P | ${remaining.carbs}g C | ${remaining.fat}g F
Daily goal, for reference: ${goal.calories} cal | ${goal.protein}g P | ${goal.carbs}g C | ${goal.fat}g F

THESE NUMBERS ARE FOR TODAY ONLY. If the user is planning a DIFFERENT day ("plan tomorrow", "plan for Saturday"), that day starts FRESH against the full daily goal — do NOT subtract today's eaten or planned food from it. What they ate today has nothing to do with another day's budget.
If a meal will be eaten out (restaurant/photo), its budget is whatever REMAINING is left after the other planned meals — state it plainly, e.g. "that leaves about X cal for the meal out." Never state a "remaining" number that isn't one of the numbers above.

MEALS LOGGED TODAY:
${mealsSummary}

PLANNED MEALS TODAY:
${plannedSummary}
${hasPlannedMeals ? `
CRITICAL — PLANNED MEALS ALREADY EXIST:
The user already has ${todayPlanned.length} planned meal(s) for today: ${plannedTypes.join(", ")}.
- Do NOT re-generate or re-suggest these meals
- Do NOT ask if they want to plan the rest of the day if all major meals are planned
- Do NOT end with "Reply yes to save this plan" for meals that are already saved
- If user says "yes" or confirms → acknowledge their existing plan, do NOT create new meal blocks
- If user asks to change something specific → make ONLY that change
- If a meal type is already planned → treat any new food for that type as an ADDITIONAL entry (new log), not a replacement
` : ""}

${events.length > 0 ? `📅 EVENTS DETECTED (${events.length}):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 ${e.isTomorrow ? "(tomorrow)" : "(today)"} — ${e.label}`).join("\n")}` : ""}
${hasRestaurantMeal ? "🍽️ RESTAURANT/PARTY MEAL DETECTED" : ""}
${missingEventTimes && !hasAnyEvent ? "⚠️ EVENTS MENTIONED BUT NO TIMES PROVIDED — ASK FOR TIMES BEFORE PLANNING" : ""}

WORKING WITH WHAT'S LOGGED:
The eaten and planned meals are in the numbers above — use them directly. NEVER ask "what have you eaten today?". If nothing is logged, just work from the goal; don't interrogate the user about unlogged food. Time of day tells you what to PLAN (don't plan a breakfast at 2pm) but NOT whether they ate. If it's midday and nothing's logged, plan forward from the current meal slot and, in one line, invite them to mention any earlier meals so you can fit them in — but show the plan immediately, don't wait on the answer.

${eventStrategy}

READING THE MESSAGE:
Act on the user's intent. If the message mentions any food, meal, macro, plan, or goal — proceed, don't ask what they want. If they're replying to something you just said, treat it as a continuation; never restart with a clarifying question. Only ask when the message is genuinely impossible to act on (a bare "hey" or "ok"), or when an event has no time.

RESTAURANT / EATING OUT (one rule — applies whether standalone or inside a day plan):
If the user has NOT said what they'll order: do NOT fabricate dishes, name specific menu items, or build a saveable block — you have NOT seen the menu and cannot know what they'll choose. Instead, TEACH them how to navigate that cuisine — the general principles for eating well there (e.g. for Chinese: steamed or stir-fried over deep-fried; lean protein like chicken, shrimp, tofu or beef with vegetables; sauce on the side; watch words that mean fried such as crispy/battered/sweet-and-sour/General Tso's; go easy on fried rice and noodles). Give a calorie budget from REMAINING, then invite them to share the menu or their order when they're there so you can point them to specific picks. Do NOT recommend specific dishes as an order until you've seen the menu or they've told you what they're having.
If the user HAS named specific dishes ("2 akami nigiri, miso soup") OR shared the menu: THEN get specific — recommend real items and/or build the meal block and emit MEAL_DATA. Never ask "out or planned?" — the buttons handle that.
══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format.
The meal type word MUST be ALONE on its own line.
NEVER use **Breakfast** — just write Breakfast (plain text).

ALLOWED MEAL TYPES: Breakfast, Lunch, Dinner, Snack

TIMES — RELATIVE ONLY, NEVER A CLOCK TIME:
Use any times the user gives you to SEQUENCE the day (what comes before/after a workout, lunch, etc.) — but NEVER display a set clock time like "3:30pm" in a header or in the text, not even a time the user stated. Clock times go stale the moment a plan shifts (a 6pm run moves to 7pm and "snack at 3:30pm" is now wrong and useless), and you must never schedule anything earlier than right now. Anchor all timing to the EVENT, relatively:
- "Breakfast — post-walk" / "this morning"
- "Lunch — midday" (or "Lunch — Chinese, midday")
- "Snack — about 2 hours before your run"
- "Snack — right after your workout"
- "Dinner — evening, after the gym"
Never write "Breakfast — 9:00am", "Snack — 3:30pm", or any clock time. The header must still START with the meal-type word.

ONE PER TYPE RULE — NO EXCEPTIONS:
- MAXIMUM 1 Breakfast block per plan
- MAXIMUM 1 Lunch block per plan
- MAXIMUM 1 Dinner block per plan
- Snack is the ONLY type that can repeat
WRONG: Two Dinner blocks in one plan — NEVER do this
WRONG: Two Lunch blocks in one plan — NEVER do this

SNACK RULE:
- You CAN suggest MULTIPLE Snacks in one plan
- Each Snack gets its own separate block
- Add timing context AFTER the block in plain text

CORRECT (multiple snacks):
Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 175
- Protein: 3g
- Carbs: 42g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F | Rice cakes — 70 cal, 2g P, 15g C, 0g F

👉 Have this 2 hours before your game for quick energy.

Snack
- Foods: Protein shake, 1 scoop; Milk whole, 1 cup
- Calories: 270
- Protein: 33g
- Carbs: 12g
- Fat: 8g

Breakdown: Protein shake — 120 cal, 25g P, 3g C, 2g F | Milk — 150 cal, 8g P, 9g C, 6g F

👉 Have this right after your game for recovery.

WRONG:
Snack (pre-game)     FORBIDDEN — no parentheses
Snack (post-game)    FORBIDDEN — no parentheses
**Snack**            FORBIDDEN — no markdown

POST-EVENT TIMING RULE:
NEVER guess a specific time after an event. You don't know how long it lasts.
WRONG: "Have this at 8:30pm (after your workout)"
WRONG: "Have this at 9:00pm post-game"
RIGHT: "Have this right after your workout"
RIGHT: "Have this right after your game — within 1 hour of finishing"

TOTAL FORMAT — plain text only:
📊 Total planned: X/Y cal (Z%) | Xg protein | Xg carbs | Xg fat
👉 [one coaching note]

Do NOT end with "reply yes to save" or any chat-based save prompt — the buttons handle saving.

CUISINE / STATED FOODS:
If the user names specific foods or dishes (sushi rolls, a pasta, specific items) — build the meal block immediately and emit MEAL_DATA. NEVER ask "are you going out or planning this?" The user chooses eaten vs planned by tapping a button, and the meal-type dropdown handles meal type. Only when the user names a cuisine with NO specific dishes AND no other context ("I might do Italian sometime") is it fine to ask what dishes they're thinking of — never "out or planned."
══════════════════════════════════════════
CALORIE TARGETS FOR MEAL PLANS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${goal.calories} cal.
${isWeightLossConversation ? `Weight loss plan: ${weightLossCals} cal.` : ""}
Social event days: distribute so event meal is included in budget.
If plan is below 85% of target, flag the shortfall.
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal.

OVER-BUDGET RULE:
If a meal plan comes in 1-10% over the calorie target, just mention it casually — do NOT suggest changes.
Example: "This comes in just slightly over at 105% — totally fine, small buffer."
Only suggest adjustments if user asks, or if over 15%+.

══════════════════════════════════════════
MEAL SWAP / REPLACE RULE
══════════════════════════════════════════
If user rejects a suggestion or says they don't have an ingredient ("I ran out of X", "I don't have X", "something else", "another option", "swap it", "can't make that"):
1. Acknowledge briefly: "No problem — let me swap that out."
2. Suggest a NEW meal that hits similar macros
3. Use the same meal block format
4. Do NOT ask the clarifying question. Do NOT restart. Just swap.

If user CONFIRMS a suggestion ("yes", "yes please", "I like that", "let's do that", "perfect", "sounds good", "that one", "I'll have that", "can we do that one", "sure", "great"):
- Respond warmly and briefly confirming the choice
- End with: "Ready to add it to your plan?"
- Do NOT output another meal block — the user already confirmed the previous one
- Do NOT offer adjustments or revisions unless the user asked for them

══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
CRITICAL: Only suggest meals for remaining time today.

${hour < 10  ? "All meals available: Breakfast, Lunch, Snack, Dinner" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner. DO NOT suggest Breakfast." : ""}
${hour >= 14 && hour < 17 ? "Breakfast and Lunch time have passed. Available: Snack, Dinner. DO NOT suggest Breakfast or Lunch." : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack only. DO NOT suggest Breakfast, Lunch, or afternoon Snacks." : ""}
${hour >= 20 ? "Available: Snack only. DO NOT suggest any full meals." : ""}

If it's 6pm or later and user has a dinner event, suggest only light pre-dinner snack if anything.
Weight loss confirmations → plan TOMORROW full day.

══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
${isWeightLossConversation ? `Use weight amount THEY SAID — not profile target.
Push back if unrealistic (max 2 lbs/week safely).
${veryActive
  ? `Very active — just reduce food by ${foodCutAmount} cal. New target: ${weightLossCals} cal.`
  : `Split: eat ${foodCutAmount} cal less + burn 200 more (20-30 min walk). New target: ${weightLossCals} cal.`}
${weightToLose ? `Timeline: ${weightToLose} lbs ÷ 1/week = ${weeksToGoal} weeks.` : ""}
Ask: "Want a meal plan for tomorrow at ${weightLossCals} cal? Or a 2-3 day plan?"
When confirmed → plan TOMORROW at ${weightLossCals} cal, full day.` : `If user asks about losing weight or mentions lbs to lose, THEN calculate a deficit plan. Otherwise use ${goal.calories} cal for all plans.`}

══════════════════════════════════════════
MULTI-FOOD LOGGING
══════════════════════════════════════════
If the user gives multiple foods WITH quantities in one message (e.g. "8oz chicken, 1/4 cup sweet potato, 1 cup cottage cheese"), build the meal block IMMEDIATELY. Do NOT ask them to confirm quantities you were already given. Do NOT ask about prep method (grilled/baked/etc) — it barely changes macros and is never a reason to delay the meal block. If they want to adjust anything, that is what the Edit button is for.
Only ask for a quantity if a food was named with NO amount at all (e.g. "I had chicken and rice" with no sizes). In that case ask for the missing quantities one at a time, then build the block.

══════════════════════════════════════════
MACRO REFERENCE
══════════════════════════════════════════
Chicken breast:    1oz = 46 cal, 8.7g P, 0g C, 1g F
Ground beef lean:  1oz = 55 cal, 7g P, 0g C, 3g F
Salmon:            1oz = 58 cal, 8g P, 0g C, 3g F
Tuna canned:       1oz = 30 cal, 7g P, 0g C, 0g F
Turkey breast:     1oz = 35 cal, 7g P, 0g C, 0.5g F
Shrimp:            1oz = 28 cal, 6g P, 0g C, 0g F
Eggs:              1 large = 70 cal, 6g P, 0g C, 5g F
Egg whites:        1 large = 17 cal, 4g P, 0g C, 0g F
White rice cooked: 1 cup = 200 cal, 4g P, 44g C, 0g F
Brown rice cooked: 1 cup = 215 cal, 5g P, 45g C, 2g F
Pasta cooked:      1 cup = 220 cal, 8g P, 43g C, 1g F
Oatmeal cooked:    1 cup = 150 cal, 5g P, 27g C, 3g F
Bread whole wheat: 1 slice = 80 cal, 4g P, 15g C, 1g F
Sweet potato:      1 medium = 130 cal, 3g P, 30g C, 0g F
Banana:            1 medium = 105 cal, 1g P, 27g C, 0g F
Apple:             1 medium = 95 cal, 0g P, 25g C, 0g F
Blueberries:       1 cup = 85 cal, 1g P, 21g C, 0g F
Greek yogurt:      1 cup = 130 cal, 22g P, 9g C, 0g F
Cottage cheese:    1 cup = 200 cal, 28g P, 8g C, 4g F
Milk whole:        1 cup = 150 cal, 8g P, 12g C, 8g F
Protein shake:     1 scoop = 120 cal, 25g P, 3g C, 2g F
Broccoli:          1 cup = 55 cal, 4g P, 11g C, 0g F
Spinach:           1 cup = 7 cal, 1g P, 1g C, 0g F
Avocado:           1 medium = 240 cal, 3g P, 13g C, 22g F
Almonds:           1oz = 165 cal, 6g P, 6g C, 14g F
Peanut butter:     2 tbsp = 190 cal, 8g P, 6g C, 16g F
Olive oil:         1 tbsp = 120 cal, 0g P, 0g C, 14g F
Quinoa cooked:     1 cup = 222 cal, 8g P, 39g C, 4g F
Lentils cooked:    1 cup = 230 cal, 18g P, 40g C, 1g F
Rice cakes:        1 cake = 35 cal, 1g P, 7g C, 0g F
Cheddar cheese:    1oz = 113 cal, 7g P, 0g C, 9g F
Walnuts:           1oz = 185 cal, 4g P, 4g C, 18g F
Hummus:            2 tbsp = 70 cal, 2g P, 6g C, 4g F

UNITS: Always use US units — oz, cups, tbsp, tsp, slices, pieces`;

    if (context?.type === "food_log") {
      systemMessage += `

══════════════════════════════════════════
FOOD LOGGING MODE
══════════════════════════════════════════
${userName} is logging food they ate.
Original: "${context.originalMessage}"
${context.mealType ? `Meal type: ${context.mealType}` : `Meal type not specified. Infer it from time of day and food; the user can correct it with one tap. Never ask which meal it is, and never refuse to log because meal type is unclear.`}
${context.followUpMessage ? `Follow-up: "${context.followUpMessage}"` : ""}

${dbFoodResults ? `
DATABASE LOOKUP — USE THESE EXACT NUMBERS (from USDA). Do not recalculate or estimate them:
${dbFoodResults.map(r => `${r.food} (${r.amount} ${r.unit} = ${r.grams}g):
  Calories: ${r.calories} | Protein: ${r.protein}g | Carbs: ${r.carbs}g | Fat: ${r.fat}g`).join('\n')}
` : `For any food not in a database lookup, estimate its macros from your nutrition knowledge. Never ask the user for calories or macros — that's your job.`}

${mealSegments ? `
═══ MULTIPLE MEALS — CODE HAS ALREADY SPLIT THIS INTO MEALS ═══
The user logged several meals in one message. Code has split it by meal type and resolved the foods.
Emit ONE meal block AND ONE MEAL_DATA block PER meal below — in this exact grouping. Do NOT merge meals.
${mealSegments.map(seg => `
MEAL: ${seg.meal_type}${seg.inferred ? " (inferred from time — user can change via dropdown)" : ""}
User said: "${seg.text}"
${seg.resolved && seg.resolved.length > 0
  ? "Resolved foods (USE THESE EXACT NUMBERS):\n" + seg.resolved.map(r => `  ${r.food} (${r.amount} ${r.unit} = ${r.grams}g): ${r.calories} cal, ${r.protein}g P, ${r.carbs}g C, ${r.fat}g F`).join("\n")
  : "No DB match — estimate these foods' macros from your knowledge."}
`).join("\n")}
Emit a separate MEAL_DATA block for each MEAL above, each with its own meal_type and items[]. This is REQUIRED so the app can render one card per meal.
` : ""}
HOW TO LOG:
- Build the meal block immediately. "a", "half", "some", "2", "8oz", "medium" are all valid quantities — never re-ask for a quantity that's present, and never re-confirm a quantity or meal type the user already gave. Only ask if a food has NO amount at all (bare "chicken"), about just that one food, one question max.
- Prep method, doneness, and brand never matter — never ask about them. No commentary on the choice itself — just log it.
- "I also had X" / "add X to my [meal]" → log ONLY the new item, not a combined block. The dashboard sums entries automatically.

═══ MULTIPLE MEALS IN ONE MESSAGE (very common — the user logs their whole day at once) ═══
When the user lists several meals in one message (e.g. "for breakfast X, as a snack Y, for lunch Z, for dinner W"):
- Output a SEPARATE meal block AND a SEPARATE MEAL_DATA block for EACH meal — one per meal type (breakfast, lunch, snack, dinner). Do NOT merge them into one block.
- Each MEAL_DATA block has its own meal_type and its own items[]. Emit them all, one after another, in your response.
- DO NOT interrogate. If a quantity is present ("about a cup", "1 waffle", "a bottle"), USE IT — assume a reasonable standard amount and log it. The user corrects anything wrong by tapping Edit on that meal's card. Asking a pile of clarifying questions for a normal day-log is the WRONG behavior.
- Only if a food has NO amount at all AND you truly cannot estimate a standard portion, make your best standard-portion assumption anyway and log it (the card lets them fix it). Prefer logging over asking.
- The app renders each meal as its own card with its own Add/Edit/Cancel — so the user can accept the good ones and fix or cancel a wrong one. Your job is to emit all the blocks so those cards can appear.

MEAL BLOCK FORMAT:
[MealType]
- Foods: [food1, amount]; [food2, amount]
- Calories: [single total number, no math shown]
- Protein: [X]g
- Carbs: [X]g
- Fat: [X]g
Breakdown: [food1] — [cal] cal, [P]g P, [C]g C, [F]g F | [food2] — ...

Calories is a number only; protein/carbs/fat always include "g". Single totals, never "X + Y = Z". After the block, one short coaching tip (👉). Do NOT write a running daily total or "X calories remaining" line — the dashboard owns those numbers.

══════════════════════════════════════════
STRUCTURED DATA OUTPUT — MANDATORY
══════════════════════════════════════════
After your conversational response above, you MUST append a structured JSON block.
This is parsed by the app to save the meal. Without it, the user cannot save what they logged.
The user does NOT see this block — it's stripped before display.

EVERY food log response MUST end with a MEAL_DATA block. No exceptions. Even if you're asking a clarifying question, if you've identified ANY foods in the user's message, emit MEAL_DATA for what you know.
IF THE USER LOGGED MULTIPLE MEALS: emit MULTIPLE MEAL_DATA blocks — one per meal type — back to back, each with its own meal_type and items[]. The app parses all of them and renders one card per meal. Never collapse several meals into a single block.

═══ FORBIDDEN PATTERN — NEVER DO THIS ═══
DO NOT ask "Want me to log this for you?" or "Should I save this?" or "Shall I add this?" or any similar chat-based save confirmation.
You CANNOT save meals via chat. The user CANNOT reply "yes" and have it save.
The ONLY way meals are saved is: you emit MEAL_DATA → the app renders 4 buttons → the user taps a button → code saves the meal.
If you ask "want me to log this?", the user will say yes, NOTHING WILL HAPPEN, and they will lose trust in the app.
Whenever you have identified foods with complete macros and the user has committed to eating/planning them, emit MEAL_DATA. The 4-button review IS the confirmation.
═══════════════════════════════════════════

Wrap the JSON in these EXACT delimiters on their own lines:
<<<MEAL_DATA>>>
{ ...json here... }
<<<END_MEAL_DATA>>>

The JSON MUST have this shape:
{
  "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
  "items": [
    {
      "user_text": "<what the user typed for this food>",
      "canonical_name": "<standard nutritional name, e.g. 'Banana, raw'>",
      "amount": <number, e.g. 1 or 0.5>,
      "unit": "<unit, e.g. 'medium', 'tbsp', 'oz', 'g', 'slice'>",
      "grams": <approximate weight in grams as integer>,
      "calories": <integer>,
      "protein": <integer>,
      "carbs": <integer>,
      "fat": <integer>,
      "source": "usda_db" | "ai_estimate" | "label",
      "usda_food_id": <number or null>
    }
  ]
}

RULES — READ CAREFULLY:
- ONE object per food. If the user logged 3 foods (burger + eggs + sweet potato), output 3 objects in items[]. NEVER merge multiple foods into one object.
- INCLUDE ALL FOODS the user mentioned. If garbled or unclear text might mean food, include your best interpretation (e.g., "3X eggs" → assume "3 eggs"). Do not silently drop items.
- meal_type: use what the user explicitly said. If they didn't specify, use your best inference from context (time of day, food choice). The app will let the user correct it if needed.
- If a food appeared in the DATABASE LOOKUP section above (marked "from USDA"), set source="usda_db" and use the EXACT numbers from there. Set usda_food_id if provided, else null.
- If a food was NOT in DATABASE LOOKUP (you estimated it), set source="ai_estimate" and usda_food_id=null.
- If the food's macros were read from a NUTRITION LABEL in a photo, set source="label" (NOT "ai_estimate") and usda_food_id=null. Label reads are exact values off the package — always tag them "label".
- canonical_name should be the standard nutritional name. Examples: user types "banana" → "Banana, raw". User types "PB" → "Peanut butter, smooth". User types "Big Mac" → "Big Mac".
- The JSON must be VALID JSON (parseable by JSON.parse). No trailing commas. Use null, not undefined.
- If adding to an existing meal ("I also had X"), the items[] array should contain ONLY the NEW item(s).

THIS IS NOT OPTIONAL. Every food log response ends with MEAL_DATA. Failure to emit it means the user cannot save what they ate.`;
    }

    if (context?.type === "meal_planning") {
      // [v86] ONE SUGGESTION AT A TIME (single-meal requests). Multiple options broke
      // the UI: the parser deduplicates per meal type, so option 2's button silently
      // vanished and the user couldn't pick it. One suggestion, one set of buttons;
      // don't like it -> Cancel/Edit and ask for another. Full-day plans still get
      // one block PER MEAL (that's per-meal, not multi-option).
      systemMessage += `
SINGLE-SUGGESTION RULE (single-meal requests like "suggest a lunch" / "what should I have for dinner"):
- Give EXACTLY ONE meal suggestion — one meal block, never two alternatives, never "Option A / Option B", never two blocks of the same meal type.
- End by inviting iteration instead: "Want a different option? Just say so."
- Full-day plan requests are different: one block per meal (breakfast/lunch/dinner/snacks), still no alternatives per meal.
`;
      // Calculate suggested eating times based on events
      let timingGuide = "";
      if (events.length > 0) {
        const sortedEvents = [...events].sort((a, b) => a.hour - b.hour);
        sortedEvents.forEach((event, idx) => {
          if (isPhysicalEvent(event.type)) {
            if (event.hour <= 8) {
              // Early morning workout — light snack before OR fasted, post-workout breakfast after
              timingGuide += `
${event.type.toUpperCase()} at ${event.hour}:00:
- If eating before: light snack at ${event.hour - 1}:30 (30 min before) — banana or toast ~150 cal only
- Post-workout: Breakfast right after your workout (do NOT assign a specific time)
- DO NOT suggest a full 300+ cal meal before a ${event.hour}:00am workout — eating at ${event.hour - 1}:00am or earlier is unrealistic
- DO NOT present Option A / Option B choices — just include a light pre-workout Snack block + a Breakfast block labeled as post-workout
- NEVER write "Option A" or "Option B" or "Fasted Workout" — just present the single plan
`;
            } else {
              const preEventTime = event.hour - 2;
              timingGuide += `
${event.type.toUpperCase()} at ${event.hour}:00:
- Pre-event snack: ${preEventTime}:00 (2 hours before)
- Post-event recovery: right after your ${event.type} — do NOT assign a specific time
`;
            }
          } else if (isSocialEvent(event.type)) {
            timingGuide += `
SOCIAL EVENT at ${event.hour}:00 (${event.label}):
- Keep meals before this LIGHT
- Budget ${Math.round(goal.calories * 0.4)}-${Math.round(goal.calories * 0.5)} cal for this event
- NO meal block — give plain text guidance only
`;
          }
        });
      }

      systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
Request: "${context.request || message}"
Local time: ${hour}:00
${plannedFoodResults ? `
DATABASE LOOKUP — USE THESE EXACT NUMBERS (from USDA) for the foods the user named:
${plannedFoodResults.map(r => `${r.food} (${r.amount} ${r.unit} = ${r.grams}g):
  Calories: ${r.calories} | Protein: ${r.protein}g | Carbs: ${r.carbs}g | Fat: ${r.fat}g`).join('\n')}

CRITICAL: For the foods listed above, use these EXACT macro numbers. Do NOT recalculate or estimate them. Only estimate macros for foods the user did NOT name.
` : ""}
Planning for: ${events.some(e => e.isTomorrow) ? "TOMORROW" : "TODAY"}
${events.length > 0 ? `Events detected: ${events.map(e => `${e.type} at ${e.hour}:00`).join(", ")}` : "No events detected"}
${missingEventTimes && !hasAnyEvent ? "MISSING TIMES: Ask user what time each event is before planning." : ""}
${hasRestaurantMeal && !hasPhysicalEvents ? "Restaurant/social event only — DO NOT create a Dinner block. Plain text guidance only." : ""}

${timingGuide}

HOW TO BUILD THE PLAN:

1. Open with 2-4 lines of strategy specific to THEIR day — name the real challenge (a workout, a social lunch, an energy dip). Not generic.

2. Then the meals in TRUE CHRONOLOGICAL ORDER — earliest first, back to back. A restaurant/social meal that is guidance-only (no block) STILL takes its place in the sequence at the right time: put its guidance where that meal falls in the day, never floating at the end or buried in another meal's note. Sanity-check the order before sending — a midday lunch must come before an afternoon snack. Each block:

[MealType] — [relative timing] ([short context])   (e.g. "Lunch — midday", "Snack — 2 hours before your run" — NEVER a clock time like 3:30pm; see TIMES rule)
- Foods: [food1, amount]; [food2, amount]
- Calories: [single total number]
- Protein: [X]g
- Carbs: [X]g
- Fat: [X]g
Breakdown: [food1] — [cal] cal, [P]g P, [C]g C, [F]g F | [food2] — ...

Calories is a number only; protein/carbs/fat always include "g". Single totals, never "X + Y = Z" math. Breakdown line required when a meal has 2+ foods.

3. After the blocks, write one summary line:
📊 Total planned: [sum of the blocks you wrote]/${goal.calories} cal | [P]g protein | [C]g carbs | [F]g fat
This is the sum of the meal blocks in THIS plan only. Do not fold in already-eaten meals or earlier messages.

4. End with 2-3 short rules specific to the day. Be decisive — present ONE plan, never "Option A/Option B." Do NOT ask the user to reply "yes" or confirm in chat; the buttons handle saving.

CRITICAL — SAVING THE PLAN (do not skip):
- If this plan is a SINGLE meal (the user asked to plan ONE meal, e.g. "plan my dinner", "what should I have for lunch") → you MUST end your response with a MEAL_DATA block for that meal, using the exact format below. Without it, the user has no button to save the meal and your plan is useless to them.
- If this plan is MULTIPLE meals (a whole day / several meals) → do NOT emit MEAL_DATA; the prose meal blocks above render their own per-meal save buttons.
- This applies inside continued/threaded conversations too: even mid-conversation, a single-meal plan MUST end with MEAL_DATA. Never let the discussion replace the structured block.

SINGLE-MEAL MEAL_DATA FORMAT (only for a one-meal plan):
<<<MEAL_DATA>>>
{"meal_type":"dinner","items":[{"food":"<name>","amount":<n>,"unit":"<unit>","calories":<n>,"protein":<n>,"carbs":<n>,"fat":<n>,"source":"usda_db"|"ai_estimate"|"label"}]}
<<<END_MEAL_DATA>>>

RULES THAT MATTER:
- Plan only the remaining part of the day. Don't re-plan meals already eaten or planned (shown in the numbers above). Use the REMAINING budget, not the full goal.
- One Breakfast, one Lunch, one Dinner max; snacks can repeat. Each meal its own block.
- Respect what the user told you: stated times, named meals, their schedule. Use common sense for how long activities take and when meals fit around them.
- Fuel before physical activity; support recovery after it.
- A restaurant or social meal inside the plan is the ONE exception to "build a block for every meal": give it cuisine-navigation guidance (how to eat well at THAT kind of place — see the RESTAURANT rule) + a calorie budget from REMAINING, NOT a fabricated block and NOT specific dish recommendations off a menu you haven't seen. The other meals still get real blocks; only the restaurant meal is guidance — unless the user already named specific dishes or shared the menu, then get specific. Place this guidance in its correct time slot in the day's sequence. Be honest about photos: a photo identifies the food, not the portion; results are estimates; the buttons save (never say "I'll log it", "exact macros", "text it over", or that you can read portion size from a photo).`;
    }

    if (context?.type === "photo" && images?.length > 0) {
      const photoIntent = context.photoIntent || "unknown";
      const imageCount = images.length;
      systemMessage += `

══════════════════════════════════════════
PHOTO MODE — ${imageCount} image(s) received
══════════════════════════════════════════
User message: "${context.message || "(no message)"}"
Intent detected: ${photoIntent}
Number of images: ${imageCount}

${imageCount === 1 ? `SINGLE IMAGE — it's either a nutrition label, a restaurant menu, or a photo of actual food. Handle by what it is:

NUTRITION LABEL:
- Read the values EXACTLY off the label — calories, protein, carbs, fat, serving size, servings per container. Never substitute your own estimates.
- Use PER-SERVING macros, and set the servings count to how many they had (the dashboard multiplies). If the container has multiple servings and the user didn't say how much, ask once ("1 serving or the whole bag?") unless context makes it obvious.
- Infer meal type from time of day; the user can correct it with one tap. Then build the meal block immediately — don't ask "want me to log this?".
- If they asked a question about it ("can I eat this?"), answer briefly from their remaining macros, then build the block anyway so they can save it if they want.

RESTAURANT MENU:
- Read the actual items. Using their remaining macros (${remaining.calories} cal | ${remaining.protein}g P | ${remaining.carbs}g C | ${remaining.fat}g F), recommend a few specific named items to get, 1-2 to consider with a caveat, and a few to avoid with the specific reason. Name real items from THIS menu — never generic advice.
- Flag fried/heavy signals ("crunchy/tempura" = fried, "spicy mayo/cream cheese" = heavy).
- This is guidance only — do NOT build a meal block from a menu, because you don't know what they'll order yet. Tell them to let you know what they pick and you'll build them a block to save with the buttons.

PHOTO OF ACTUAL FOOD (plated meal, not a menu):
- Estimate the foods and macros, infer meal type from time, and build the meal block immediately.` :

`MULTIPLE IMAGES:
- If they're nutrition labels: read each, show a short per-serving and full-container comparison, flag multi-serving traps, and declare a winner based on their remaining macros. Build a block only once they say which one (and how much) — otherwise ask once.
- If one is a menu and another is actual food, treat the food photo as the meal to log and the menu as context for guidance.`}

THE OVERRIDE RULE — read this:
The "don't build a block from a menu" guidance applies ONLY while the user hasn't said what they're having. The MOMENT the user states their order or selection — "I'll have X", "I'm getting X", "I chose X", "I'm having the salmon", or lists specific items — that is a STATED MEAL. Build the meal block immediately and emit MEAL_DATA. Do NOT ask "are you going out or planning this?" or "want me to log it?" — the user picks eaten vs planned by tapping a button. Stated food always beats the no-block rule.

NEVER make up macro numbers — report what you can read on a label; estimate sensibly for menu/plated food.

══════════════════════════════════════════
STRUCTURED DATA OUTPUT — MANDATORY (PHOTO MODE)
══════════════════════════════════════════
After your conversational response above, you MUST append a structured JSON block.
This is parsed by the app to save the meal. Without it, the user cannot save what they logged or planned.
The user does NOT see this block — it's stripped before display.

EVERY photo response with a nutrition label MUST end with this block. No exceptions. This applies whether intent is "eaten", "planned", "later today", or anything else — if you've identified a food from the label, emit MEAL_DATA.

Wrap the JSON in these EXACT delimiters on their own lines:
<<<MEAL_DATA>>>
{ ...json here... }
<<<END_MEAL_DATA>>>

The JSON MUST have this shape:
{
  "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
  "items": [
    {
      "user_text": "<what the user typed for this food>",
      "canonical_name": "<standard nutritional name from the label, e.g. 'Protein shake, ready-to-drink'>",
      "amount": <number, e.g. 1 or 0.5>,
      "unit": "<unit, e.g. 'bottle', 'serving', 'oz'>",
      "grams": <approximate weight in grams as integer, can be 0 if not relevant>,
      "calories": <integer from label>,
      "protein": <integer from label>,
      "carbs": <integer from label>,
      "fat": <integer from label>,
      "source": "label",
      "usda_food_id": null
    }
  ]
}

RULES:
- Use EXACT values from the label. Never estimate when label values are visible.
- meal_type: use what the user explicitly said. If they didn't specify, infer from time of day. The app's UI lets the user correct it with one tap.
- For "I'm planning this later today" or "having this later" → still emit MEAL_DATA. The app's review UI lets the user choose Add to Eaten vs Add to Planned with the same button set.
- This is the ONLY way the app can save the meal. Without MEAL_DATA, the user has to start over.

For RESTAURANT MENU photos (multiple food items being recommended): do NOT emit MEAL_DATA on the initial menu photo response. Give coaching advice. Wait for the user to confirm which item they want.

═══ MENU MODE EXIT — CRITICAL ═══
Once the user has indicated WHAT they're eating (any of these triggers):
- "I'll have X" / "I selected X" / "I'm getting X" / "I chose X"
- "I'm having the X"
- Sending a photo of the actual food (not the menu)
- Confirming a recommendation you made ("yes, the salmon")

Then you MUST emit MEAL_DATA in your response. Do not ask "want me to log this?" — emit MEAL_DATA. The 4-button review IS the confirmation step.

This applies even if the user attaches new photos with their selection. Photos of actual food = log it. Photos of menus = recommend. Both at once = log the selected food.
═══════════════════════════════════════════

For MULTIPLE LABEL comparison mode: do NOT emit MEAL_DATA on the comparison response. Wait for the user to confirm which one they're having, then emit MEAL_DATA in the follow-up.

THIS IS NOT OPTIONAL for single-label responses. Every nutrition-label photo response ends with MEAL_DATA.`;
    }

    // ═══ [v86] INTELLIGENCE: inject the code-assembled PROFILE slot + capture rules.
    // Coaching/planning turns only — never photos (vision prompt stays clean), and
    // food logs never reach here (early return). Zero extra AI calls: the blocks
    // ride on this turn's existing response.
    const intelEligible = !(images?.length > 0) && context?.type !== "photo";
    if (intelEligible) {
      const profileSlot = await assembleProfileSlot(activeUserId);
      if (profileSlot) systemMessage += profileSlot;
      systemMessage += INTEL_CAPTURE_PROMPT;
    }

    const conversationMessages = [{ role: "system", content: systemMessage }];
    // Threaded → use the full thread chain; otherwise → existing slice(-1)-style behavior.
    const effectiveHistory = (thread_id && threadHistory.length > 0) ? threadHistory : history;
    if (effectiveHistory?.length > 0) {
      for (const msg of effectiveHistory.slice(-12)) {
        if (msg.role && msg.content) conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Build final user message — with images if present
    if (images?.length > 0) {
      const contentParts = images.map(img => ({
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail: "high",
        },
      }));
      if (message) contentParts.push({ type: "text", text: message });
      conversationMessages.push({ role: "user", content: contentParts });
    } else {
      conversationMessages.push({ role: "user", content: message || "" });
    }

    const provider = process.env.AI_PROVIDER || "openai";
    const hasImages = images?.length > 0;
    console.log(`=== AI [v86] | ${provider} | ${userName} | ${hour}:00 | Goal: ${goal.calories} cal | Photos: ${images?.length || 0} | Events: ${events.length}`);

    let reply;

    if (provider === "claude") {
      // Convert OpenAI-format messages to Anthropic format:
      // 1. System message moves to the top-level `system` param (not in messages array)
      // 2. Image blocks change from `image_url` shape to `image`/base64 shape
      const claudeMessages = conversationMessages
        .filter(m => m.role !== "system")
        .map(m => {
          if (!Array.isArray(m.content)) return m;
          const converted = m.content.map(part => {
            if (part.type !== "image_url") return part;
            const url = part.image_url.url; // "data:image/jpeg;base64,XXXX"
            const [meta, data] = url.split(",");
            const media_type = meta.match(/data:(.*?);/)?.[1] || "image/jpeg";
            return { type: "image", source: { type: "base64", media_type, data } };
          });
          return { role: m.role, content: converted };
        });

      const claudeModel = hasImages ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";

      const response = await anthropic.messages.create({
        model: claudeModel,
        max_tokens: 3000,
        system: systemMessage,
        messages: claudeMessages,
        temperature: 0.7,
      });

      reply = response.content.find(b => b.type === "text")?.text || "";
    } else {
      const model = hasImages ? "gpt-4o" : "gpt-4o-mini";

      const completion = await client.chat.completions.create({
        model,
        messages: conversationMessages,
        temperature: 0.7,
      });

      reply = completion.choices[0].message.content;
    }
    console.log("=== RESPONSE ===\n", reply);

    // [v86] Validate FACT blocks and replace GOAL parameters with code-computed targets
    // BEFORE the reply is stored or returned — the client only ever sees enriched blocks.
    reply = await enrichIntelligenceBlocks(reply, activeUserId);

    let aiMessageId = null;
    try {
      const { data: inserted } = await supabase.from("ai_messages").insert([{
        user_id: activeUserId, message: message || "", response: reply,
        thread_id: thread_id || null,
        created_at: new Date().toISOString(),
      }]).select("id").single();
      aiMessageId = inserted?.id || null;
    } catch (e) { console.log("Save error:", e); }

    // CODE-BUILT MEAL DATA (buttons must NEVER depend on the AI emitting a MEAL_DATA block).
    // If code resolved foods for a food log, build the structured mealData here — with
    // code-computed totals — and return it. The client renders save buttons directly from this.
    let codeMealData = null;
    if (context?.type === "food_log") {
      const buildItems = (foods, mealType) => (foods || []).map(r => ({
        canonical_name: r.food, food: r.food,
        amount: r.amount, unit: r.unit, grams: r.grams,
        calories: Math.round(Number(r.calories) || 0),
        protein: Math.round(Number(r.protein) || 0),
        carbs: Math.round(Number(r.carbs) || 0),
        fat: Math.round(Number(r.fat) || 0),
        source: r.source || "ai_estimate",
        meal_type: mealType,
      }));
      if (mealSegments && mealSegments.length > 1) {
        // Multi-meal: one merged mealData tagged per item, multi_meal flag for per-card render.
        const items = [];
        for (const seg of mealSegments) items.push(...buildItems(seg.resolved, seg.meal_type));
        if (items.length > 0) {
          codeMealData = { meal_type: mealSegments[0].meal_type, items, multi_meal: true };
        }
      } else if (dbFoodResults && dbFoodResults.length > 0) {
        // Single meal: infer type from time if the user didn't state one.
        // [v79] lookupMsg is now in scope here (hoisted above) — this line previously threw
        // ReferenceError and crashed the whole request into the generic error message.
        const singleType = (segmentMeals(lookupMsg, (typeof localHour === "number" ? localHour : 12))[0] || {}).meal_type || "snack";
        codeMealData = { meal_type: singleType, items: buildItems(dbFoodResults, singleType) };
      }
    }

    return Response.json({ reply, aiMessageId, mealData: codeMealData });

  } catch (error) {
    console.error("AI ERROR:", error);
    return Response.json({ reply: "Something went wrong. Please try again." }, { status: 500 });
  }
}