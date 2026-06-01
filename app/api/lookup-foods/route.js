import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Parse food items from text
function parseFoodItems(text) {
  if (!text) return [];

  // Step 1: Normalize word-quantities to digits so the numeric pattern below catches them.
  // "a banana" -> "1 banana", "half an avocado" -> "0.5 avocado", "two eggs" -> "2 eggs"
  // Order matters: handle "half" (and "half an") before bare a/an/one.
  let normalized = " " + text.toLowerCase() + " ";
  normalized = normalized
    .replace(/\bhalf\s+(?:an?\s+)?/g, " 0.5 ")
    .replace(/\b(?:a|an|one)\s+/g, " 1 ")
    .replace(/\btwo\s+/g, " 2 ")
    .replace(/\bthree\s+/g, " 3 ")
    .replace(/\bfour\s+/g, " 4 ")
    .replace(/\bfive\s+/g, " 5 ")
    .replace(/\bwhole\s+/g, " 1 ");

  // Step 2: One unified pattern — number, optional unit, food — terminated by comma/semicolon/stop-word/period/end.
  // Stop-words prevent food capture from running into "for snack", "at lunch", etc.
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

// Look up food in USDA database
// Rank candidate food rows: prefer the search term as a leading whole word,
// prefer plain "raw" forms, penalize odd variants, prefer shorter/simpler names.
function pickBest(rows, term) {
  const oddVariants = ['overripe','underripe','unripe','dried','dehydrated','frozen','canned','cooked','fried','candied','sweetened','juice','powder'];
  const scored = rows.map(r => {
    const name = (r.name || '').toLowerCase();
    let score = 0;
    if (name === term) score += 100;
    if (name.startsWith(term + ',') || name.startsWith(term + ' ') ||
        name.startsWith(term + 's,') || name.startsWith(term + 's ')) score += 40;
    else if (name.startsWith(term)) score += 20;
    if (name.includes('raw')) score += 10;
    for (const v of oddVariants) if (name.includes(v)) score -= 25;
    score -= name.length * 0.2;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

async function lookupFood(foodName) {
  if (!foodName) return null;
  const cols = 'id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g';
  const clean = foodName.trim().toLowerCase();
  try {
    // 1. Prefer names that START with the search term — excludes "Peppers, banana..." for "banana"
    const { data: starts } = await supabase
      .from('foods').select(cols)
      .ilike('name', `${clean}%`)
      .limit(8);
    if (starts && starts.length > 0) return pickBest(starts, clean);

    // 2. Also try the plural form
    const { data: startsPlural } = await supabase
      .from('foods').select(cols)
      .ilike('name', `${clean}s%`)
      .limit(8);
    if (startsPlural && startsPlural.length > 0) return pickBest(startsPlural, clean);

    // 3. Full-text search
    const { data: fts } = await supabase
      .from('foods').select(cols)
      .textSearch('name', clean.split(' ').join(' & '), { type: 'websearch' })
      .limit(8);
    if (fts && fts.length > 0) return pickBest(fts, clean);

    // 4. Last resort: contains-anywhere
    const { data: contains } = await supabase
      .from('foods').select(cols)
      .ilike('name', `%${clean}%`)
      .limit(10);
    if (contains && contains.length > 0) return pickBest(contains, clean);

    return null;
  } catch (e) {
    console.log('Food lookup error:', e.message);
    return null;
  }
}

// Convert amount + unit to grams
async function convertToGrams(amount, unit, foodId) {
  const unitLower = unit.toLowerCase().replace(/s$/, '');

  // Try food-specific conversion first
  if (foodId) {
    const { data } = await supabase
      .from('food_specific_conversions')
      .select('grams_per_unit')
      .eq('food_id', foodId)
      .ilike('unit_name', `%${unitLower}%`)
      .limit(1);
    if (data?.[0]) return amount * data[0].grams_per_unit;
  }

  // Standard weight/volume conversion
  const { data } = await supabase
    .from('unit_conversions')
    .select('grams_per_unit, ml_per_unit')
    .eq('unit_name', unitLower)
    .limit(1);

  if (data?.[0]) {
    if (data[0].grams_per_unit) return amount * data[0].grams_per_unit;
    if (data[0].ml_per_unit) return amount * data[0].ml_per_unit;
  }

  return null;
}

// Calculate macros from DB food + grams
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
    
    if (!message) {
      return Response.json({ found: [], missing: [], error: "No message provided" });
    }

    // Parse foods from message
    const items = parseFoodItems(message);
    
    if (items.length === 0) {
      return Response.json({ found: [], missing: [], parsedItems: [] });
    }

    const found = [];
    const missing = [];

    // Look up each food
    for (const item of items.slice(0, 10)) { // max 10 foods
      const food = await lookupFood(item.food);
      
      if (!food) {
        missing.push({ food: item.food, amount: item.amount, unit: item.unit });
        continue;
      }

      const grams = await convertToGrams(item.amount, item.unit, food.id);
      
      if (!grams) {
        missing.push({ food: item.food, amount: item.amount, unit: item.unit, reason: "unit_conversion_failed" });
        continue;
      }

      const macros = calcMacros(food, grams);
      found.push({
        food: food.name,
        amount: item.amount,
        unit: item.unit,
        grams: Math.round(grams),
        ...macros,
        source: 'usda_db',
      });
    }

    return Response.json({ 
      found, 
      missing,
      success: true  
    });

  } catch (error) {
    console.error("Lookup error:", error);
    return Response.json({ 
      found: [], 
      missing: [], 
      error: error.message 
    }, { status: 500 });
  }
}