import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Parse food items from text
function parseFoodItems(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  
  // Pattern: amount + unit + food
  const pattern = /(\d+\.?\d*)\s*(oz|ounces|lb|lbs|pounds|cup|cups|tbsp|tablespoons|tsp|teaspoons|g|grams|ml|piece|pieces|slice|slices|serving|servings|scoop|scoops)?\s+(?:of\s+)?([a-z\s-]+?)(?=\s+and\s+|\s*,\s*|\s*$|;)/gi;
  
  const items = [];
  let match;
  
  while ((match = pattern.exec(lower)) !== null) {
    const amount = parseFloat(match[1]);
    const unit = match[2] || "serving";
    const food = match[3].trim();
    
    if (food && amount) {
      items.push({ food, amount, unit });
    }
  }
  
  // Also try simpler pattern: "food, amount unit"
  const pattern2 = /([a-z\s-]+?),?\s+(\d+\.?\d*)\s*(oz|ounces|cup|cups|tbsp|tsp|g|ml|serving|servings)?/gi;
  while ((match = pattern2.exec(lower)) !== null) {
    const food = match[1].trim();
    const amount = parseFloat(match[2]);
    const unit = match[3] || "serving";
    
    if (food && amount && !items.some(i => i.food === food)) {
      items.push({ food, amount, unit });
    }
  }
  
  return items;
}

// Look up food in USDA database
async function lookupFood(foodName) {
  if (!foodName) return null;
  try {
    // Full text search
    const { data, error } = await supabase
      .from('foods')
      .select('id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
      .textSearch('name', foodName.split(' ').join(' & '), { type: 'websearch' })
      .limit(1);

    if (!error && data && data.length > 0) return data[0];

    // Fallback: ILIKE search
    const { data: data2 } = await supabase
      .from('foods')
      .select('id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
      .ilike('name', `%${foodName}%`)
      .limit(1);

    return data2?.[0] || null;
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