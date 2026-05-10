import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  console.log("🔍 sumMeals called with", meals?.length || 0, "meals");
  
  return (meals || []).reduce(
    (t, m, idx) => {
      const s = Number(m.servings || 1);
      const cals = Number(m.calories||0) * s;
      const prot = Number(m.protein||0)  * s;
      const carb = Number(m.carbs||0)    * s;
      const fats = Number(m.fat||0)      * s;
      
      console.log(`  Meal ${idx+1}: ${m.food || 'Unknown'} - base: ${m.calories}cal × ${s} servings = ${cals}cal | ${prot}g P | ${carb}g C | ${fats}g F`);
      
      return {
        calories: t.calories + cals,
        protein:  t.protein  + prot,
        carbs:    t.carbs    + carb,
        fat:      t.fat      + fats,
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
function parseFoodItems(message) {
  if (!message) return [];
  const items = [];

  // Patterns: "8oz chicken", "2 eggs", "1 cup rice", "half avocado", "a banana"
  const patterns = [
    // number + unit + food: "8oz chicken breast", "1 cup oatmeal"
    /(\d+\.?\d*)\s*(oz|lb|lbs|g|kg|cup|cups|tbsp|tsp|ml|fl oz|piece|pieces|slice|slices|scoop|scoops|serving|servings)\s+(?:of\s+)?([a-z][a-z\s,]+?)(?:\s*[,;]|$)/gi,
    // number + food (no unit): "2 eggs", "3 chicken wings"
    /(\d+\.?\d*)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi,
    // descriptor + food: "a banana", "half avocado", "whole chicken breast"
    /\b(a|an|half|whole|one|two|three|four|five)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi,
  ];

  const [p1, p2, p3] = patterns;
  let match;

  // Pattern 1: number + unit + food
  while ((match = p1.exec(message)) !== null) {
    items.push({ amount: parseFloat(match[1]), unit: match[2].toLowerCase(), food: match[3].trim() });
  }

  // Pattern 2: number + food (if no unit match found for same position)
  if (items.length === 0) {
    while ((match = p2.exec(message)) !== null) {
      const food = match[2].trim();
      if (food.length > 2) items.push({ amount: parseFloat(match[1]), unit: 'serving', food });
    }
  }

  return items;
}

// Look up a food in the USDA database
async function lookupFood(foodName) {
  if (!foodName) return null;
  try {
    // Full text search — finds closest match
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
  const unitLower = unit.toLowerCase().replace(/s$/, ''); // remove plural

  // 1. Try food-specific conversion first
  if (foodId) {
    const { data } = await supabase
      .from('food_specific_conversions')
      .select('grams_per_unit')
      .eq('food_id', foodId)
      .ilike('unit_name', `%${unitLower}%`)
      .limit(1);
    if (data?.[0]) return amount * data[0].grams_per_unit;
  }

  // 2. Standard weight/volume conversion
  const { data } = await supabase
    .from('unit_conversions')
    .select('grams_per_unit, ml_per_unit, unit_category')
    .eq('unit_name', unitLower)
    .limit(1);

  if (data?.[0]) {
    if (data[0].grams_per_unit) return amount * data[0].grams_per_unit;
    // Volume — use water density (1g/ml) as default
    if (data[0].ml_per_unit) return amount * data[0].ml_per_unit;
  }

  // 3. Can't convert — return null, AI will estimate
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

// Main lookup — tries DB, returns null if not found
async function lookupFoodMacros(message) {
  const items = parseFoodItems(message);
  if (items.length === 0) return null;

  const results = [];
  for (const item of items.slice(0, 5)) { // max 5 foods per message
    const food = await lookupFood(item.food);
    if (!food) continue;

    const grams = await convertToGrams(item.amount, item.unit, food.id);
    if (!grams) continue;

    const macros = calcMacros(food, grams);
    results.push({
      food: food.name,
      amount: item.amount,
      unit: item.unit,
      grams: Math.round(grams),
      ...macros,
      source: 'usda_db',
    });
  }

  return results.length > 0 ? results : null;
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
  if (hour < 11) return "It's morning and nothing is logged. Ask: 'Before I suggest anything, did you have breakfast yet? Just a quick rundown helps me give better advice.'";
  if (hour >= 11 && hour < 14) return "It's late morning/lunchtime and nothing is logged. Ask: 'Before I plan your meals, what have you eaten so far today? Even a rough idea helps me give you accurate advice.'";
  if (hour >= 14 && hour < 18) return "It's afternoon and nothing is logged. Ask: 'I don't have any food logged for today. What have you eaten so far? Knowing this is important before I suggest anything for the rest of the day.'";
  if (hour >= 18) return "It's evening and nothing is logged. Say: 'I don't see anything logged today. What did you eat earlier? I want to factor that in before suggesting anything for tonight.'";
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { message, context, history = [], userId, localHour, localDate: clientDate, images } = body;
    const image = images?.[0] || null; // backward compat for single image checks

    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";
    const hour = typeof localHour === "number" ? localHour : new Date().getHours();
    const today = getLocalDate(clientDate);
    
    console.log("\n═══════════════════════════════════════════");
    console.log("🎯 ROUTE.JS DEBUG - MACRO CALCULATION");
    console.log("═══════════════════════════════════════════");
    console.log("📅 Date being used:", today);
    console.log("🕐 Hour:", hour);
    console.log("👤 User ID:", activeUserId);
    console.log("📝 Client sent date:", clientDate || "NOT PROVIDED");

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

    console.log("🎯 Daily Goals:", goal);

    // ── Load today's meals ──
    console.log("\n🔍 Fetching actual_meals for date:", today);
    let todayMeals = [];
    try {
      const { data: meals, error } = await supabase
        .from("actual_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      
      if (error) {
        console.error("❌ Error fetching actual_meals:", error);
      } else {
        console.log("✅ Found", meals?.length || 0, "actual meals");
        todayMeals = meals || [];
        
        // Log each meal retrieved
        todayMeals.forEach((m, idx) => {
          console.log(`  Meal ${idx+1}: ${m.food} - ${m.calories}cal (servings: ${m.servings || 1})`);
        });
      }
    } catch (e) { 
      console.log("Meals error:", e.message); 
    }

    // ── Load today's planned meals ──
    console.log("\n🔍 Fetching planned_meals for date:", today);
    let todayPlanned = [];
    try {
      const { data: planned, error } = await supabase
        .from("planned_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      
      if (error) {
        console.error("❌ Error fetching planned_meals:", error);
      } else {
        console.log("✅ Found", planned?.length || 0, "planned meals");
        todayPlanned = planned || [];
        
        // Log each planned meal
        todayPlanned.forEach((m, idx) => {
          console.log(`  Planned ${idx+1}: ${m.food} - ${m.calories}cal (servings: ${m.servings || 1})`);
        });
      }
    } catch (e) { 
      console.log("Planned meals error:", e.message); 
    }

    const plannedTypes = [...new Set(todayPlanned.map(m => m.meal_type))];
    const hasPlannedMeals = todayPlanned.length > 0;
    const plannedSummary = todayPlanned.length > 0
      ? todayPlanned.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal)`).join("\n")
      : "No planned meals yet";

    console.log("\n🧮 Calculating totals using sumMeals()...");
    const totals = sumMeals(todayMeals);
    
    console.log("\n📊 FINAL TOTALS:");
    console.log("  Calories:", totals.calories, "/", goal.calories);
    console.log("  Protein:", totals.protein, "/", goal.protein, "g");
    console.log("  Carbs:", totals.carbs, "/", goal.carbs, "g");
    console.log("  Fat:", totals.fat, "/", goal.fat, "g");
    
    const remaining = {
      calories: Math.max(0, goal.calories - totals.calories),
      protein:  Math.max(0, goal.protein  - totals.protein),
      carbs:    Math.max(0, goal.carbs    - totals.carbs),
      fat:      Math.max(0, goal.fat      - totals.fat),
    };
    
    console.log("\n⏳ REMAINING:");
    console.log("  Calories:", remaining.calories);
    console.log("  Protein:", remaining.protein, "g");
    console.log("  Carbs:", remaining.carbs, "g");
    console.log("  Fat:", remaining.fat, "g");
    console.log("═══════════════════════════════════════════\n");

    // ── DB Food Lookup (for food_log context) ──
    let dbFoodResults = null;
    if (context?.type === "food_log") {
      const lookupMsg = context.followUpMessage || context.originalMessage || message;
      dbFoodResults = await lookupFoodMacros(lookupMsg);
      if (dbFoodResults) {
        console.log(`=== DB FOOD LOOKUP: found ${dbFoodResults.length} food(s) ===`);
        dbFoodResults.forEach(r => console.log(`  ${r.food}: ${r.calories} cal, ${r.protein}g P, ${r.carbs}g C, ${r.fat}g F`));
      } else {
        console.log("=== DB FOOD LOOKUP: no match — AI will estimate ===");
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
RESTAURANT / UNKNOWN MENU STRATEGY — MANDATORY:
The user is eating at a restaurant, dinner party, or someone's home.
You DO NOT know the menu. You CANNOT guess what they will eat.

RULES — NO EXCEPTIONS:
1. Create meal blocks ONLY for meals BEFORE the event (Breakfast, Lunch, Snack)
2. Do NOT create a Dinner block. Not even an estimate. Not steak, not anything.
3. After the pre-event meal blocks, write this in plain text:
   "For the dinner itself — I don't know the exact menu, so here's what to look for:
   - Go for grilled or baked protein over fried
   - Skip heavy cream sauces and rich sides
   - Go easy on bread and appetizers
   - Watch portion sizes on starches
   When you're there, take a photo of the menu and I'll help you pick the best option for your goals."
4. Tell them how many calories they have budgeted for the event in plain text only
5. Keep pre-event meals light — lean protein + vegetables
6. Budget ${Math.round(goal.calories * 0.45)}-${Math.round(goal.calories * 0.5)} cal for the event
7. For early-day restaurant meals (lunch / brunch) — same rules apply: no meal block for the restaurant, just guidance + pre-meal planning

SOCIAL DINING EXAMPLES:
- "dinner party at a friend's" → NO Dinner block. Plan Breakfast, Lunch, Snack. Then add plain text guidance.
- "sushi date tonight" → NO Dinner block. Plan what to eat BEFORE the date. Then plain text guidance.
- "going out for dinner" → NO Dinner block. Plan earlier meals. Then plain text guidance.
- "eating at a restaurant" → NO Dinner block. Plan other meals. Then plain text guidance.`;
    } else if (hasEventToday && eventType && hoursUntilEvent !== null && hoursUntilEvent >= 0) {
      // Single event today
      const eventLabel = primaryEvent?.label || eventType;
      eventStrategy = `
SINGLE EVENT TODAY:
${eventType.toUpperCase()} at ${eventHour}:00 (${eventLabel})
Hours until event: ${hoursUntilEvent}

${isPhysicalEvent(eventType) ? `
PHYSICAL EVENT FUELING — CRITICAL RULES:
1. PRE-EVENT MEAL (2-3 hours before): HIGH carbs, LOW fat for easy digestion
   Avoid: heavy fats, dairy, high fiber right before the event
   Good: rice, pasta, banana, rice cakes, toast, oatmeal
   Target: 300-400 calories
2. RECOVERY MEAL (within 1 hour after): HIGH protein + carbs
   Protein target: 30-40g minimum
   Include: lean protein + fast carbs (rice, pasta, fruit)
3. If event is in less than 2 hours: suggest LIGHT snack now (banana, rice cakes, toast) 150-250 cal
4. Budget approximately ${Math.round(goal.calories * 0.15)} cal pre-event + ${Math.round(goal.calories * 0.25)} cal recovery` : ""}

${isSocialEvent(eventType) ? `
SOCIAL EVENT STRATEGY:
The user is going to a social dining event.
DO NOT create a meal block for this event — you don't know the menu.
After all pre-event meal blocks, add plain text guidance about what to look for at the restaurant.
Budget approximately ${Math.round(goal.calories * 0.45)} cal for this social event.` : ""}`;
    }

    let systemMessage = `You are CURA, an AI nutrition coach. You provide meal recommendations, track food intake, and guide users toward their health goals.

CRITICAL INSTRUCTION — READ THIS FIRST:
You are NOT the source of truth for today's calorie totals.
The DATABASE is the source of truth. The user's current intake is:

TODAY'S DATABASE VALUES (${today}):
${totals.calories}/${goal.calories} cal (${Math.round((totals.calories/goal.calories)*100)}%) | ${totals.protein}g P | ${totals.carbs}g C | ${totals.fat}g F

These numbers come directly from the database. DO NOT recalculate based on conversation history.
When the user asks "how many calories have I had?" or "what are my totals?" — use these exact numbers.
Do NOT add up meals from the chat. Do NOT estimate. Use the database values shown above.

══════════════════════════════════════════
MEAL LOGGING
══════════════════════════════════════════
When user logs food ("I had X", "I ate Y"), return a meal block in this EXACT format:

Breakfast
- Foods: 8oz chicken breast, 1 cup white rice, 1 tbsp olive oil
- Calories: 520
- Protein: 62g
- Carbs: 44g
- Fat: 10g

Breakdown: Chicken — 370 cal, 70g P, 0g C, 8g F | Rice — 200 cal, 4g P, 44g C, 0g F | Olive oil — 120 cal, 0g P, 0g C, 14g F

CRITICAL FOOD LOGGING RULES:
1. ALWAYS include a detailed breakdown line showing individual food macros
2. The breakdown MUST list EVERY food item with its individual macros
3. Each food should show: Name — Xcal, XgP, XgC, XgF
4. Use the pipe separator | between foods
5. This breakdown is REQUIRED for every logged meal — no exceptions

SERVINGS FIELD RULE — CRITICAL:
The dashboard multiplies calories × servings automatically.
ALWAYS set servings = 1 for single portions.
ONLY use servings > 1 if the user explicitly ate MULTIPLE servings of the SAME thing.
Examples:
- "I had 2 chicken breasts" → servings: 1, but double the chicken macros in the meal block
- "I ate the whole bag (3 servings)" → servings: 3, use per-serving macros
- "I had a protein shake" → servings: 1

DATABASE FOOD LOOKUP — USE WHEN AVAILABLE:
${dbFoodResults ? `
DATABASE MATCH FOUND for this message:
${dbFoodResults.map(f => `- ${f.food}, ${f.amount} ${f.unit} (${f.grams}g): ${f.calories} cal | ${f.protein}g P | ${f.carbs}g C | ${f.fat}g F`).join("\n")}

YOU MUST use these exact values in your meal block. Do NOT estimate — use the database numbers.
The database has already done the conversion and calculation for you.` : "No database match — estimate based on standard portion sizes."}

If user message is vague ("I had chicken"), ask quantity: "How much chicken? 4oz? 8oz?"
Never guess amounts — get specifics first, THEN return the meal block.

If they say "I also had X" after already logging a meal, treat X as a NEW separate meal entry to add.
Do NOT re-log the previous meal. ONLY log the new food X they just mentioned.

MEAL TYPE RULE:
If user doesn't specify meal type (breakfast/lunch/dinner/snack), infer from time of day:
- Before 11am → Breakfast
- 11am-2pm → Lunch
- 2pm-5pm → Snack
- 5pm+ → Dinner

══════════════════════════════════════════
MEAL PLANNING FORMAT
══════════════════════════════════════════
Plans must follow this structure. NO EXCEPTIONS.

MEAL TYPE RULES — CRITICAL:
Each meal type word (Breakfast, Lunch, Dinner, Snack) MUST be:
- ALONE on its own line
- NO markdown (no **, no #, no other formatting)
- NO parentheses after it
- NO emoji before or after it
- NO timing context on the same line

CORRECT:
Breakfast
- Foods: X
- Calories: Y

WRONG (all of these are BROKEN and will not be detected):
**Breakfast**           ← markdown breaks the parser
Breakfast (7:00am)      ← parentheses break the parser
🍳 Breakfast            ← emoji breaks the parser
Breakfast — 7:00am      ← extra text breaks the parser

TIMING CONTEXT RULE:
Put timing/context AFTER the meal block as plain text, never on the meal type line.

CORRECT:
Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 175
- Protein: 3g
- Carbs: 42g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F | Rice cakes — 70 cal, 2g P, 15g C, 0g F

👉 Have this 1 hour before puck drop.

WRONG:
Snack (pre-game)
- Foods: Banana
...

RIGHT:
Snack
- Foods: Banana, 1 medium
- Calories: 105
- Protein: 1g
- Carbs: 27g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F

👉 Have this right after your workout for recovery.

WRONG:
Breakfast (fuel up after your shift)
- Foods: X
...

RIGHT:
Breakfast
- Foods: Oatmeal, 1 cup; Banana, 1 medium; Protein shake, 1 scoop
- Calories: 425
- Protein: 31g
- Carbs: 57g
- Fat: 5g

Breakdown: Oatmeal — 150 cal, 5g P, 27g C, 3g F | Banana — 105 cal, 1g P, 27g C, 0g F | Protein shake — 120 cal, 25g P, 3g C, 2g F

👉 Have this right after your shift ends.

EMOJI USAGE — STRICT RULE:
NEVER use emojis on the meal type line or anywhere inside the meal block structure.
Emojis are ONLY allowed in plain text coaching notes that come AFTER the meal block.

ALLOWED (emojis in coaching text after meal block):
Breakfast
- Foods: X
- Calories: Y

👉 Fuel up right after your shift.

FORBIDDEN (emojis breaking the meal block):
🍳 Breakfast         ← WRONG
Breakfast 🍳         ← WRONG
- Foods: 🍗 Chicken  ← WRONG

Avoid: 🎉 😊 🔥 💪

MULTIPLE SNACKS — CRITICAL FORMAT:
You CAN have multiple Snack blocks in one plan (pre-game snack, post-game snack, etc.)
Each Snack must be its own complete block with timing context AFTER it.

CORRECT (two snacks with different timing):
Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 175
- Protein: 3g
- Carbs: 42g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F | Rice cakes — 70 cal, 2g P, 15g C, 0g F

👉 Have this 1 hour before puck drop for quick energy.

Snack
- Foods: Protein shake, 1 scoop; Milk whole, 1 cup
- Calories: 270
- Protein: 33g
- Carbs: 15g
- Fat: 10g

Breakdown: Protein shake — 120 cal, 25g P, 3g C, 2g F | Milk — 150 cal, 8g P, 12g C, 8g F

👉 Have this right after your game for recovery.

WRONG:
Breakfast
- Foods: X

WRONG: "Snack (pre-game)" or "Snack — 6:00pm"
RIGHT: "Snack" alone, then timing after the block

WRONG FORMAT EXAMPLES (these will NOT work):
Breakfast (7:00am)
- Foods: X
...

Snack — pre-game
- Foods: X
...

**Dinner**
- Foods: X
...

Breakfast — 7:00am (fuel up after your shift)
- Foods: X
...

🍳 Breakfast
- Foods: X
...

ALL OF THE ABOVE ARE WRONG. Meal type must be ALONE on its own line.

CORRECT FORMAT:
Breakfast
- Foods: Oatmeal, 1 cup; Banana, 1 medium; Protein shake, 1 scoop
- Calories: 425
- Protein: 31g
- Carbs: 57g
- Fat: 5g

Breakdown: Oatmeal — 150 cal, 5g P, 27g C, 3g F | Banana — 105 cal, 1g P, 27g C, 0g F | Protein shake — 120 cal, 25g P, 3g C, 2g F

WRONG:
Breakfast — 7:00am (fuel up after your shift)
FORBIDDEN — no parentheses

RIGHT: "Breakfast" alone on the line, add timing AFTER the block in plain text

Breakfast
- Foods: X
- Calories: Y
- Protein: Zg
- Carbs: Zg
- Fat: Zg

Breakdown: X — A cal, Bg P, Cg C, Dg F | Y — E cal, Fg P, Gg C, Hg F

👉 Have this at 7:00am right after your shift.

MULTI-SNACK EXAMPLE (correct):
Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 175
- Protein: 3g
- Carbs: 42g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F | Rice cakes — 70 cal, 2g P, 15g C, 0g F

👉 Have this 2 hours before your game for fuel.

Snack
- Foods: Protein shake, 1 scoop; Milk whole, 1 cup
- Calories: 270
- Protein: 33g
- Carbs: 15g
- Fat: 10g

Breakdown: Protein shake — 120 cal, 25g P, 3g C, 2g F | Milk — 150 cal, 8g P, 12g C, 8g F

👉 Have this right after your game for recovery.

TIMING CONTEXT EXAMPLES:

WRONG:
Breakfast (7:00am)
RIGHT:
Breakfast
...
👉 Have this at 7:00am (right after your shift).

WRONG:
Snack — 6:00pm (1hr before puck drop)
RIGHT:
Snack
...
👉 Have this at 6:00pm — 1 hour before puck drop.

WRONG:
Snack (pre-game)
RIGHT:
Snack
...
👉 Have this 1-2 hours before your game.

WRONG:
Dinner — 4:30pm (2.5hrs before your 7pm game)
RIGHT:
Dinner
...
👉 Have this at 4:30pm — 2.5 hours before your 7pm game for optimal digestion.

WRONG:
Breakfast — 7:00am (fuel up after your shift)
Snack
WRONG:
**Breakfast**

CORRECT EXAMPLES:
Breakfast
- Foods: Oatmeal, 1 cup; Banana, 1 medium; Protein shake, 1 scoop
- Calories: 425
- Protein: 31g
- Carbs: 57g
- Fat: 5g

Breakdown: Oatmeal — 150 cal, 5g P, 27g C, 3g F | Banana — 105 cal, 1g P, 27g C, 0g F | Protein shake — 120 cal, 25g P, 3g C, 2g F

RIGHT: "Breakfast" alone on its own line
WRONG: "Breakfast — 7:00am (fuel up after your shift)"

Lunch
- Foods: Grilled chicken breast, 8oz; Sweet potato, 1 medium; Broccoli, 2 cups
- Calories: 560
- Protein: 74g
- Carbs: 52g
- Fat: 8g

Breakdown: Chicken — 370 cal, 70g P, 0g C, 8g F | Sweet potato — 130 cal, 3g P, 30g C, 0g F | Broccoli — 110 cal, 8g P, 22g C, 0g F

Dinner
- Foods: Salmon fillet, 6oz; Quinoa, 1 cup cooked; Spinach, 2 cups
- Calories: 570
- Protein: 58g
- Carbs: 47g
- Fat: 23g

Breakdown: Salmon — 350 cal, 48g P, 0g C, 18g F | Quinoa — 222 cal, 8g P, 39g C, 4g F | Spinach — 14 cal, 2g P, 2g C, 0g F

Snack
- Foods: Greek yogurt, 1 cup; Blueberries, 1 cup
- Calories: 215
- Protein: 23g
- Carbs: 30g
- Fat: 0g

Breakdown: Greek yogurt — 130 cal, 22g P, 9g C, 0g F | Blueberries — 85 cal, 1g P, 21g C, 0g F

TIMING CONTEXT — CORRECT PLACEMENT:
Put timing/context AFTER the meal block, never on the meal type line.

Example for: off work 7am, hockey 7pm:
Breakfast
- Foods: X
- Calories: Y

Breakdown: ...

👉 Have this at 7:00am (right after your shift ends).

Snack
- Foods: X
- Calories: Y

Breakdown: ...

👉 Have this at 6:00pm — 1 hour before puck drop.

NEVER:
Breakfast — 7:00am (fuel up after your shift)
WRONG: "Snack (pre-game)" ← This format breaks the parser

CORRECT:
Snack
- Foods: Banana, 1 medium
- Calories: 105
- Protein: 1g
- Carbs: 27g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F

👉 Have this 1 hour before your game.

CORRECT EXAMPLES OF TIMING:
Breakfast
- Foods: Oatmeal, 1 cup; Banana, 1 medium; Protein shake, 1 scoop
- Calories: 425
- Protein: 31g
- Carbs: 57g
- Fat: 5g

Breakdown: Oatmeal — 150 cal, 5g P, 27g C, 3g F | Banana — 105 cal, 1g P, 27g C, 0g F | Protein shake — 120 cal, 25g P, 3g C, 2g F

👉 Fuel up after your shift (around 7:00am).

Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 175
- Protein: 3g
- Carbs: 42g
- Fat: 0g

Breakdown: Banana — 105 cal, 1g P, 27g C, 0g F | Rice cakes — 70 cal, 2g P, 15g C, 0g F

👉 Have this around 6:00pm (1 hour before puck drop).

Example for: off work 7am, walk before 9am work, hockey 7pm-10:30pm:
  Breakfast → 7:00am (fuel up right after your shift)
  Walk → ~8:00am
  Lunch → 12:00pm
  Dinner → 4:30pm (2.5hrs before your 7pm games)
  Pre-game snack → 6:00pm (1hr before puck drop)
  Post-game recovery → right after your second game

SNACK RULES:
- For athletic events: suggest TWO Snacks (pre-event + post-event recovery)
- Each Snack gets its own separate block with timing context after it
- NEVER suggest 2 Breakfasts, 2 Lunches, or 2 Dinners

For weight loss confirmations → plan TOMORROW.
Each meal type alone on its own line — no parentheses.
📊 Total planned: X/Y cal (Z%) | Xg protein | Xg carbs | Xg fat after all meal blocks.`;

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

${imageCount === 1 ? `SINGLE LABEL / MENU:
IF it's a NUTRITION LABEL:
1. Read ALL values EXACTLY from the label: calories, protein, carbs, fat, serving size
2. ONLY use what you can read on the label — NEVER use your own estimates
3. Report clearly: "Got it — [Product name]: Calories X | Protein Xg | Carbs Xg | Fat Xg | Serving: X"
4. If meal type not mentioned → infer from time: before 11am=Breakfast, 11-2=Lunch, 2-5=Snack, 5pm+=Dinner
5. If intent is "eaten" or inferred eaten → return meal block immediately, no questions
6. If intent is "planned" → return meal block for planned
7. If servings unclear → ask "How many servings did you have?" THEN log

CRITICAL — USE LABEL VALUES ONLY:
The label says 150 cal → use 150. Do NOT use 120.
The label says 30g protein → use 30g. Do NOT use 25g.
You are reading a nutrition label, not estimating. Trust what you read.

SERVINGS HANDLING — CRITICAL:
1. Read: calories per serving, protein per serving, carbs per serving, fat per serving, servings per container
2. If user ate 1 serving → servings field = 1, use per-serving macros
3. If user ate whole container with X servings → servings field = X, use per-serving macros
   The dashboard multiplies: calories × servings automatically
4. ALWAYS ask if label has multiple servings (>1) and user didn't specify how much:
   "The bag has 3 servings — did you have 1 serving (120 cal) or the whole bag (360 cal)?"
   EXCEPTION: skip asking if user said "whole bag", "all of it", "I ate this" with clear single-serve context
5. NEVER use whole-bag totals as the per-serving macros

Meal block from label MUST use PER-SERVING values + correct servings count:
WRONG (ate whole bag of 3 servings):
- Foods: Fitzels, 1 bag
- Calories: 370  ← wrong, this is whole bag total
- Servings: 1    ← wrong

RIGHT (ate whole bag of 3 servings):
- Foods: Fitzels, 1 serving
- Calories: 120  ← per serving value
- Protein: 5g    ← per serving value
- Carbs: 19g     ← per serving value
- Fat: 4g        ← per serving value
- Servings: 3    ← actual servings consumed (dashboard calculates 120 × 3 = 360 cal)

RIGHT (ate 1 serving):
- Foods: Fitzels, 1 serving
- Calories: 120
- Protein: 5g
- Carbs: 19g
- Fat: 4g
- Servings: 1

IF intent is "eaten" → skip the question, return meal block directly using inferred meal type from time:
  Before 11am → Breakfast | 11am-2pm → Lunch | 2pm-5pm → Snack | 5pm+ → Dinner
  NEVER skip logging because meal type is missing — always infer it

IF intent is "planned" / "for later" / "as planned" → skip question, return meal block for planned

IF intent is "unknown" and no meal type mentioned → infer from time of day, log as eaten

IF user asks "can I eat this?" / "is this okay?" / "should I have this?" / "good for me?":
1. Answer the question first — yes/no with brief reasoning based on remaining macros
2. ALWAYS end with: "Want me to log it or add it to your plan?"
3. When user confirms (yes/sure/log it/add it) → return a meal block immediately
   Use inferred meal type from time of day
   Use EXACT label values for macros
   Do NOT loop back to asking again

IF it's a RESTAURANT MENU:
1. Read EVERY item on the menu carefully
2. Based on ${userName}'s remaining macros: ${remaining.calories} cal | ${remaining.protein}g P | ${remaining.carbs}g C | ${remaining.fat}g F
3. Structure your response exactly like this:

Best picks (name 2-3 specific items):
- [Item name] — why it's good (specific: "lean protein, no sauce, light rice")
- [Item name] — why it's good

Worth considering (1-2 items with a caveat):
- [Item name] — good but [specific caveat: "ask for sauce on the side"]

Avoid these (name specific items and exactly why):
- [Item name] — specific reason ("fried tempura inside + mayo drizzle = 600+ cal")
- [Item name] — specific reason ("cream cheese based, looks healthy but isn't")
- [Item name] — specific reason ("imitation crab mixed with mayo")

Key words that signal unhealthy: "crunchy" = fried, "spicy mayo" = heavy sauce, "cream cheese" = high fat, "shaggy dog" = fried shrimp + mayo, "tempura" = battered and fried

4. End with one specific ordering tip: portion size, what to skip, or what to ask for
5. Always add: "Note: these are estimates based on typical restaurant portions — actual macros will vary."
6. End with: "Let me know which one you pick and I'll log it for you"

NEVER give generic advice like "lean proteins are good choices" — always name the specific items from THIS menu.` :

`MULTIPLE LABELS — COMPARISON MODE (${imageCount} labels):
1. Read each label carefully — label them Label 1, Label 2, etc.
2. Read BOTH per-serving AND total container values. This is critical coaching context.
3. Build a comparison showing BOTH serving and full container:
   Label 1: [name if visible]
   Per serving: X cal | Xg P | Xg C | Xg F
   Servings per container: X (full container = X cal total)

   Label 2: [name if visible]
   Per serving: X cal | Xg P | Xg C | Xg F
   Servings per container: X (full container = X cal total)

4. COACHING NOTE on servings — always flag if container has multiple servings:
   "Note: Fitzels has 3 servings per bag — if you eat the whole bag that's 360 cal, not 120."
   This is key coaching — many people eat the whole container assuming it's one serving.

5. Ask: "Are you planning to have 1 serving or the full [container/bag/bottle]?"
   Then base your recommendation on their actual intended portion.

6. Based on ${userName}'s remaining macros today:
   Remaining: ${remaining.calories} cal | ${remaining.protein}g protein | ${remaining.carbs}g carbs | ${remaining.fat}g fat
7. Declare a winner with clear reasoning — which fits best for their goals at the portion they intend
8. End with: "Want me to log the winner? And did you eat it or saving for later?"`}

NEVER make up macro numbers. Only report what you can clearly read on the label.`;
    }

    const conversationMessages = [{ role: "system", content: systemMessage }];
    if (history?.length > 0) {
      for (const msg of history.slice(-10)) {
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

    console.log(`=== AI | ${userName} | ${hour}:00 | Goal: ${goal.calories} cal | Photos: ${images?.length || 0} | Events: ${events.length}`);

    const model = images?.length > 0 ? "gpt-4o" : "gpt-4o-mini";

    const completion = await client.chat.completions.create({
      model,
      messages: conversationMessages,
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content;
    console.log("=== RESPONSE ===\n", reply);

    try {
      await supabase.from("ai_messages").insert([{
        user_id: activeUserId, message: message || "", response: reply,
        created_at: new Date().toISOString(),
      }]);
    } catch (e) { console.log("Save error:", e); }

    return Response.json({ reply });

  } catch (error) {
    console.error("AI ERROR:", error);
    return Response.json({ reply: "Something went wrong. Please try again." }, { status: 500 });
  }
}