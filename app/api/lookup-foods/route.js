import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Parse food items from text
function parseFoodItems(text) {
  if (!text) return [];

  let normalized = " " + text.toLowerCase() + " ";

  // Fractions -> decimals BEFORE numeric parsing. Fixes "1/4 cup" being read as "4".
  normalized = normalized.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (m, w, n, d) => {
    const dd = parseInt(d, 10); if (!dd) return m;
    return String(parseInt(w, 10) + parseInt(n, 10) / dd);
  });
  normalized = normalized.replace(/(\d+)\s*\/\s*(\d+)/g, (m, n, d) => {
    const dd = parseInt(d, 10); if (!dd) return m;
    return String(parseInt(n, 10) / dd);
  });
  normalized = normalized
    .replace(/¼/g, "0.25").replace(/½/g, "0.5").replace(/¾/g, "0.75")
    .replace(/⅓/g, "0.333").replace(/⅔/g, "0.667");

  normalized = normalized
    .replace(/\bquarter\s+(?:of\s+)?(?:an?\s+)?/g, " 0.25 ")
    .replace(/\bhalf\s+(?:an?\s+)?/g, " 0.5 ")
    .replace(/\b(?:a|an|one)\s+/g, " 1 ")
    .replace(/\btwo\s+/g, " 2 ")
    .replace(/\bthree\s+/g, " 3 ")
    .replace(/\bfour\s+/g, " 4 ")
    .replace(/\bfive\s+/g, " 5 ")
    .replace(/\bwhole\s+/g, " 1 ");

  const unitWords = "oz|ounces|lb|lbs|pounds|g|grams|kg|cup|cups|tbsp|tablespoons|tsp|teaspoons|ml|fl oz|piece|pieces|slice|slices|scoop|scoops|serving|servings|medium|small|large";
  const stopWords = "and|with|for|after|before|then|plus|also|while|during|at|on|in|to|today|yesterday|tomorrow|tonight|this\\s+morning|this\\s+afternoon|this\\s+evening|right\\s+now|just\\s+now";
  const pattern = new RegExp(
    `(\\d+\\.?\\d*)\\s*(${unitWords})?\\s+(?:of\\s+)?([a-z][a-z\\s,-]*?[a-z])(?=\\s*(?:,|;|\\.|$|\\b(?:${stopWords})\\b))`,
    "gi"
  );

  const items = [];
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const amount = parseFloat(match[1]);
    const unit = (match[2] || "serving").toLowerCase().trim();
    const food = match[3].trim();
    if (food.length > 2 && !isNaN(amount)) {
      items.push({ food, amount, unit });
    }
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
  const t = (term || '').toLowerCase();
  if (/\b(raw|dry|uncooked)\b/.test(t)) return null; // user explicitly wants raw -> use DB
  // longest match first so "brown rice" beats "rice", "sweet potato" beats "potato"
  const sorted = [...COOKED_STAPLES].sort((a,b)=>Math.max(...b.match.map(m=>m.length))-Math.max(...a.match.map(m=>m.length)));
  for (const st of sorted) for (const m of st.match) if (t.includes(m)) return st;
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
  const cols = 'id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g';
  const clean = foodName.trim().toLowerCase();
  try {
    const { data: starts } = await supabase.from('foods').select(cols).ilike('name', `${clean}%`).limit(8);
    if (starts && starts.length > 0) return pickBest(starts, clean);
    const { data: startsPlural } = await supabase.from('foods').select(cols).ilike('name', `${clean}s%`).limit(8);
    if (startsPlural && startsPlural.length > 0) return pickBest(startsPlural, clean);
    const { data: fts } = await supabase.from('foods').select(cols).textSearch('name', clean.split(' ').join(' & '), { type: 'websearch' }).limit(8);
    if (fts && fts.length > 0) return pickBest(fts, clean);
    const { data: contains } = await supabase.from('foods').select(cols).ilike('name', `%${clean}%`).limit(10);
    if (contains && contains.length > 0) return pickBest(contains, clean);
    return null;
  } catch (e) {
    console.log('Food lookup error:', e.message);
    return null;
  }
}

async function convertToGrams(amount, unit, foodId) {
  const unitLower = unit.toLowerCase().replace(/s$/, '');
  if (foodId) {
    const { data } = await supabase.from('food_specific_conversions').select('grams_per_unit').eq('food_id', foodId).ilike('unit_name', `%${unitLower}%`).limit(1);
    if (data?.[0]) return amount * data[0].grams_per_unit;
  }
  const { data } = await supabase.from('unit_conversions').select('grams_per_unit, ml_per_unit').eq('unit_name', unitLower).limit(1);
  if (data?.[0]) {
    if (data[0].grams_per_unit) return amount * data[0].grams_per_unit;
    if (data[0].ml_per_unit) return amount * data[0].ml_per_unit;
  }
  return null;
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

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message) return Response.json({ found: [], missing: [], error: "No message provided" });
    const items = parseFoodItems(message);
    if (items.length === 0) return Response.json({ found: [], missing: [], parsedItems: [] });
    const found = [];
    const missing = [];
    for (const item of items.slice(0, 10)) {
      // 1) COOKED-STAPLE PATH: truthful cooked macros + "(cooked)" label, before the raw DB.
      const staple = matchCookedStaple(item.food);
      if (staple) {
        const grams = gramsForStaple(staple, item.amount, item.unit);
        const f = grams / 100;
        found.push({
          food: staple.label,
          amount: item.amount, unit: item.unit, grams: Math.round(grams),
          calories: Math.round(staple.per100.calories * f),
          protein:  Math.round(staple.per100.protein  * f * 10) / 10,
          carbs:    Math.round(staple.per100.carbs     * f * 10) / 10,
          fat:      Math.round(staple.per100.fat       * f * 10) / 10,
          source: 'usda_db',
          cooked: true,
        });
        continue;
      }

      // 2) DATABASE PATH (non-staples, or explicit raw)
      const food = await lookupFood(item.food);
      if (!food) { missing.push({ food: item.food, amount: item.amount, unit: item.unit }); continue; }
      let grams = await convertToGrams(item.amount, item.unit, food.id);
      if (!grams) {
        // fall back to a generic portion weight so we don't drop the food entirely
        const u = (item.unit || 'serving').toLowerCase().replace(/s$/,'');
        grams = item.amount * (GENERIC_GRAMS[u] || GENERIC_GRAMS.serving);
      }
      const macros = calcMacros(food, grams);
      found.push({ food: food.name, amount: item.amount, unit: item.unit, grams: Math.round(grams), ...macros, source: 'usda_db' });
    }

    // CODE-OWNED TOTALS: the system sums every item. The AI never adds these up.
    const totals = found.reduce((t, f) => ({
      calories: t.calories + (f.calories || 0),
      protein:  Math.round((t.protein + (f.protein || 0)) * 10) / 10,
      carbs:    Math.round((t.carbs   + (f.carbs   || 0)) * 10) / 10,
      fat:      Math.round((t.fat     + (f.fat     || 0)) * 10) / 10,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    return Response.json({ found, missing, totals, success: true });
  } catch (error) {
    console.error("Lookup error:", error);
    return Response.json({ found: [], missing: [], error: error.message }, { status: 500 });
  }
}