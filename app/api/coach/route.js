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
  console.log("🧮 sumMeals called with", meals?.length || 0, "meals");
  
  return (meals || []).reduce(
    (t, m, idx) => {
      const s = Number(m.servings || 1);
      const cals = Number(m.calories||0) * s;
      const prot = Number(m.protein||0) * s;
      const carb = Number(m.carbs||0) * s;
      const fats = Number(m.fat||0) * s;
      
      console.log(`  Meal ${idx+1}: ${m.food} - ${m.calories}cal × ${s} servings = ${cals}cal`);
      
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

  // Step 1: Normalize word-quantities to digits so the numeric pattern below catches them.
  // "a banana" -> "1 banana", "half an avocado" -> "0.5 avocado", "two eggs" -> "2 eggs"
  // Order matters: handle "half" (and "half an") before the bare a/an/one.
  let normalized = " " + message.toLowerCase() + " ";
  normalized = normalized
    .replace(/\bhalf\s+(?:an?\s+)?/g, " 0.5 ")
    .replace(/\b(?:a|an|one)\s+/g, " 1 ")
    .replace(/\btwo\s+/g, " 2 ")
    .replace(/\bthree\s+/g, " 3 ")
    .replace(/\bfour\s+/g, " 4 ")
    .replace(/\bfive\s+/g, " 5 ")
    .replace(/\bwhole\s+/g, " 1 ");

  // Step 2: ONE unified pattern — number, optional unit, food — terminated by comma/semicolon/"and"/end.
  // This runs in a single pass so mixed meals ("8oz chicken and a banana") capture BOTH foods.
 const unitWords = "oz|lb|lbs|g|kg|cup|cups|tbsp|tsp|ml|fl oz|piece|pieces|slice|slices|scoop|scoops|serving|servings|medium|small|large";
  // Stop-words: food capture must end before these so "banana for snack" doesn't become the food name.
  const stopWords = "and|with|for|after|before|then|plus|also|while|during|at|on|in|to|today|yesterday|tomorrow|tonight|this\\s+morning|this\\s+afternoon|this\\s+evening|right\\s+now|just\\s+now";
  const pattern = new RegExp(
    `(\\d+\\.?\\d*)\\s*(${unitWords})?\\s+(?:of\\s+)?([a-z][a-z\\s,]*?[a-z])(?=\\s*(?:,|;|\\.|$|\\b(?:${stopWords})\\b))`,
    "gi"
  );

  const items = [];
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const amount = parseFloat(match[1]);
    const unit = (match[2] || "serving").toLowerCase().trim();
    const food = match[3].trim();
    if (food.length > 2 && !isNaN(amount)) {
      items.push({ amount, unit, food });
    }
  }

  return items;
}

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
    score -= name.length * 0.2; // prefer simpler, shorter names
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

// Look up a food in the USDA database
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

    // 2. Also try the plural form ("banana" -> "bananas...")
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
    /((?:workout|gym|run|running|swim|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|bike ride|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|barbecue|potluck|picnic|lunch date)[^.!?]*?)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi,
    // "TIME + X" pattern  
    /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?((?:workout|gym|run|running|swim|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|bike ride|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|barbecue|potluck|picnic|lunch date))/gi,
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
    const { message, context, history = [], userId, localHour, localDate: clientDate, images } = body;
    const image = images?.[0] || null; // backward compat for single image checks

    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";
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
    console.log("\n📊 Loading meals for date:", today);
    let todayMeals = [];
    try {
      const { data: meals } = await supabase
        .from("actual_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      todayMeals = meals || [];
      console.log("✅ Loaded", todayMeals.length, "actual meals");
    } catch (e) { console.log("Meals error:", e.message); }

    // ── Load today's planned meals ──
    let todayPlanned = [];
    try {
      const { data: planned } = await supabase
        .from("planned_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      todayPlanned = planned || [];
      console.log("✅ Loaded", todayPlanned.length, "planned meals");
    } catch (e) { console.log("Planned meals error:", e.message); }

    const plannedTypes = [...new Set(todayPlanned.map(m => m.meal_type))];
    const hasPlannedMeals = todayPlanned.length > 0;
    const plannedSummary = todayPlanned.length > 0
      ? todayPlanned.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal)`).join("\n")
      : "No planned meals yet";

    const totals = sumMeals(todayMeals);
    console.log("📊 Database totals:", totals.calories, "cal |", totals.protein, "g P");
    
    const remaining = {
      calories: Math.max(0, goal.calories - totals.calories),
      protein:  Math.max(0, goal.protein  - totals.protein),
      carbs:    Math.max(0, goal.carbs    - totals.carbs),
      fat:      Math.max(0, goal.fat      - totals.fat),
    };

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
7. When logging a restaurant meal after the fact: always add "Note: these are estimates based on typical restaurant portions — actual macros will vary."`;
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

    // ════════════════════════════════════════════════════════════
    // NEW PROMPT ARCHITECTURE — May 30
    // - Static principles instead of layered scenario rules
    // - Dynamic context in clearly-marked USER_PROFILE / TODAY_STATE blocks
    // - Mode-specific additions for food_log, meal_planning, photo
    // - Parser-required formats preserved (meal block, JSON output)
    // ════════════════════════════════════════════════════════════

    let eventsLine = "No events today";
    if (events.length > 0) {
      eventsLine = events.map(e => {
        const when = e.isTomorrow ? "tomorrow" : "today";
        const time = e.hour !== null ? `${e.hour}:00` : "(time unknown)";
        return `${e.type} at ${time} ${when}${e.label ? ` (${e.label})` : ""}`;
      }).join("; ");
    }

    let systemMessage = `You are ${userName}'s personal nutrition coach.

INVIOLABLE RULES — APPLY EVERY RESPONSE
These two rules sit above all other guidance. Never violate either.

1. TODAY_STATE is the ONLY source of state. The TODAY_STATE block below is the authoritative record of what the user has eaten today, what is planned, current totals, and remaining macros. NEVER derive these numbers from chat history. NEVER recalculate totals from prior messages. NEVER reference a meal as "eaten" or "logged" unless it appears in TODAY_STATE's eaten list. If TODAY_STATE shows "Nothing logged yet today", that is the truth — even if chat history discusses food. Chat history is for understanding the user's current question and conversational continuity. It is never a source of state.

2. The user controls all saves via the 4-button review. When you produce a meal block, the app renders a 4-button review (Add to Eaten / Add to Planned / Edit / Cancel). The user's button tap is what writes to the database — never your response. Phrase responses as proposals to review, not as completed actions. Say "here's the meal block for your review" not "logged successfully" or "added to your eaten food".

OUTPUT RULES
Plain text only. No markdown — no **, ##, *, or _ anywhere in your responses. The app's parser requires plain text.

When you log or suggest a meal, the meal block MUST use this EXACT format (the parser depends on it):

[MealType]
- Foods: <food1>, <amount>; <food2>, <amount>
- Calories: <integer, single total, no math shown>
- Protein: <integer>g
- Carbs: <integer>g
- Fat: <integer>g

Breakdown: <food1> — <cal> cal, <P>g P, <C>g C, <F>g F | <food2> — <cal> cal, <P>g P, <C>g C, <F>g F

Allowed meal types: Breakfast, Lunch, Dinner, Snack. Each block starts with the type word alone on its own line. No bold, no headers, no asterisks. Always include "g" on protein, carbs, and fat. Calories field shows a single total — never "150 + 105 = 255". The Breakdown line is mandatory when a meal has 2+ foods.

For multi-meal day plans, the meal block header may include time and context: "Breakfast — 7:00am" or "Snack — 5:00pm (2hrs before games)". When you don't know the exact end time of an event, write "right after your game" instead of inventing a clock time.

COACHING PRINCIPLES
Be specific and prescriptive. "Eat 4oz chicken with rice for lunch" beats "consider some protein and a carb source."

Use the user's profile and today's state substantively. Their age, sport, goal, current macros, and events should change your recommendation — not just be acknowledged. Reference the actual numbers ("you have 537 cal left", "you're already 60g into your protein target").

Fill in sensible defaults rather than interrogate. If the user says "I had toast", assume 1 slice and disclose your assumption inline ("Assumed 1 slice — let me know if it was more"). If they say "eggs", assume 2. The user can correct in one follow-up; that's faster than blocking with questions. Only ask when the answer would materially change the plan (e.g., "how many people are eating?" for a recipe).

Coach beyond food when relevant. Strategy, hydration, recovery, mental cues, common mistakes — these belong in your responses when they matter. Don't restrict yourself to macros if the situation calls for more.

Match tone to the moment. Routine logging gets concise responses. Big moments (championship game, milestones, a hard day) get more warmth and engagement. Close with a brief note that fits the context ("good luck tonight" for a game; nothing extra for a routine log).

NARROW RULES
When the user states a meal type explicitly ("I had eggs for breakfast"), that IS the meal type — even if the current time doesn't match. Logging is often retroactive; the user is catching up.

One message = one meal log. If the user describes multiple meal types in one message ("eggs for breakfast and chicken for lunch"), ask which to log, or offer to log both as separate entries.

For meal planning that spans the day, use current time + the events listed in TODAY_STATE to sequence meals sensibly. No hardcoded time rules — use judgment.

When the user is planning for a future day (tomorrow, next week, a specific upcoming date), use the FULL daily targets from USER_PROFILE — not TODAY_STATE's remaining macros. TODAY_STATE describes today only. Tomorrow starts fresh with full daily budgets (the user hasn't eaten anything for that future day yet).

<<<USER_PROFILE>>>
Name: ${userName}
Goal: ${goalLabel}
Activity: ${activityLevel}${veryActive ? " (very active)" : ""}
${currentWeight ? `Current weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight ? `Target weight: ${targetWeight} ${weightUnit}` : ""}
${healthConditions ? `Health notes: ${healthConditions}` : ""}

Daily targets (set by the user — never invent different numbers):
Calories: ${goal.calories} | Protein: ${goal.protein}g | Carbs: ${goal.carbs}g | Fat: ${goal.fat}g
<<<END_USER_PROFILE>>>

<<<TODAY_STATE>>>
Date: ${today}
Local time: ${hour}:00 (${timeOfDay})

Meals eaten today:
${mealsSummary}

Meals planned today:
${plannedSummary}

Totals so far today (from database — authoritative):
${totals.calories} cal | ${totals.protein}g protein | ${totals.carbs}g carbs | ${totals.fat}g fat

Remaining vs target:
${remaining.calories} cal | ${remaining.protein}g protein | ${remaining.carbs}g carbs | ${remaining.fat}g fat

Events: ${eventsLine}
<<<END_TODAY_STATE>>>`;

    // ── Mode-specific addition: FOOD LOG ──
    if (context?.type === "food_log") {
      systemMessage += `

MODE: FOOD LOG
The user is logging food they ate. Build ONE meal block from their description — only the meal they're logging now. If quantity is missing or ambiguous, assume a single serving and disclose your assumption inline (don't ask, just log + tell). Include the Breakdown line when 2+ foods.

Produce ONLY ONE meal block per food-log response. Do NOT add additional meal blocks for other meals (no proactive lunch block, no snack block, no dinner block) in the same response. If you want to offer planning guidance for the rest of the day, do it in prose only — never as a formatted meal block. The user can request a meal plan separately if they want one.

If TODAY_STATE shows a planned meal of the same meal type as the one being logged, briefly note in prose that confirming this log will supersede the planned meal — but as awareness, not a question. Example: "Logged here for your review — note this'll replace your planned chicken lunch once you confirm." The 4-button review remains the user's decision point.
`;

      if (dbFoodResults && dbFoodResults.length > 0) {
        systemMessage += `
DATABASE LOOKUP — USE THESE EXACT NUMBERS (from USDA):
${dbFoodResults.map(r => `${r.food} (${r.amount} ${r.unit} = ${r.grams}g): ${r.calories} cal | ${r.protein}g P | ${r.carbs}g C | ${r.fat}g F`).join("\n")}

Use the numbers above EXACTLY for these foods. Do not recalculate or estimate them.
`;
      }

      // Preserve the Batch 2.1 JSON output instruction — Stage 2 will read this.
      systemMessage += `
OUTPUT FORMAT — STRUCTURED DATA (CRITICAL):
After your normal response above, append a structured JSON block. This is parsed by the app, not shown to the user.

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
      "source": "usda_db" | "ai_estimate",
      "usda_food_id": <number or null>
    }
  ]
}

RULES:
- ONE object per food. If the user logged 2 foods, output 2 objects in items[]. NEVER merge two foods into one object.
- If a food appeared in the DATABASE LOOKUP section above, set source="usda_db" and use those exact numbers. Set usda_food_id if provided, else null.
- If a food was NOT in DATABASE LOOKUP (you estimated it), set source="ai_estimate" and usda_food_id=null.
- canonical_name should be the standard nutritional name. Examples: user types "banana" → "Banana, raw". User types "PB" → "Peanut butter, smooth". User types "Big Mac" → "Big Mac".
- ALWAYS include the JSON block when logging a meal. ALWAYS close with <<<END_MEAL_DATA>>>.
- The JSON must be VALID JSON (parseable by JSON.parse). No trailing commas, no comments inside the braces. Use null, not undefined.`;
    }

    // ── Mode-specific addition: MEAL PLANNING ──
    if (context?.type === "meal_planning") {
      systemMessage += `

MODE: MEAL PLANNING
The user wants a meal plan. Structure your response like this:

1. Open with a 1-3 line strategy for the day. Name the key challenge or opportunity. Reference their actual events and goal. Specific to THIS person, not generic.

2. Then present meal blocks in time order. Use the meal block format defined above, with time + context in the header: "Breakfast — 7:00am" or "Snack — 5:00pm (2hrs before game)". For events without a specific end time, write "right after your game/workout" — do not invent clock times.

3. After all meal blocks, include a Total line on its own:
   Total: <X> cal | <Y>g protein | <Z>g carbs | <W>g fat
   The Total must include already-eaten calories (from TODAY_STATE) plus the planned meals you're suggesting. Aim for the daily target in TODAY_STATE, generally 85-100% of the calorie goal.

4. Close with 2-4 short coaching notes if useful (hydration, timing tips, what to watch for). Optional. Plain text, not a list.

Fill in sensible portions in each block. If the user gave you a smoothie recipe with vague amounts, pick reasonable defaults ("1 scoop protein, ½ cup oats, 1 tbsp honey") — don't ask them to fill in every ingredient. If a clarifying question would materially change the plan, ask ONE at the end as a refinement, not blocking up front.

Do not present "Option A / Option B" choices. Pick the best single plan. The user can ask for changes after.`;
    }

    // ── Mode-specific addition: PHOTO ──
    if (image || (images && images.length > 0)) {
      const imageCount = images?.length || (image ? 1 : 0);
      const photoIntent = context?.intent || "infer";

      systemMessage += `

MODE: PHOTO — ${imageCount} image(s)
Intent: ${photoIntent}

If a nutrition label:
- Use label values EXACTLY. Never substitute estimates. The label says 150 cal → use 150.
- Read per-serving values: calories, protein, carbs, fat, serving size, servings per container.
- For a meal block from a label: use PER-SERVING macros in the macro fields, and set the servings field to how many servings the user consumed.
  Example — ate whole bag of 3 servings: macros = per-serving values, servings = 3. (The dashboard multiplies for the dashboard total.)
- If the label has multiple servings and the user didn't say how much they ate, ask: "The bag has 3 servings — did you have 1 or the whole bag?"
- Skip the ask if the user clearly said "whole bag", "all of it", or "I ate this" with single-serve context.

If a food or menu photo:
- Identify the dish(es). Give realistic macros for typical portions.
- For menu photos: name specific items from THIS menu — never give generic advice ("lean proteins are good"). Pick the best 1-2 options based on the user's remaining macros in TODAY_STATE.
- Compare with the user's remaining macros and recommend a winner.`;

      // Photo logs should also produce the JSON block (if a clear food/label log)
      if (photoIntent === "eaten" || photoIntent === "planned") {
        systemMessage += `

For label/photo logs, ALSO append the same MEAL_DATA JSON block described in the food-logging instructions, with source="ai_estimate" (or "label_scan" if reading from a clear nutrition label) and usda_food_id=null.`;
      }
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

    const provider = process.env.AI_PROVIDER || "openai";
    const hasImages = images?.length > 0;
    console.log(`=== AI | ${provider} | ${userName} | ${hour}:00 | Goal: ${goal.calories} cal | Photos: ${images?.length || 0} | Events: ${events.length}`);

    let reply;

    if (provider === "claude") {
      // Convert OpenAI-format messages to Anthropic format:
      // 1. System message moves to top-level `system` param (not in messages array)
      // 2. Image blocks change from `image_url` shape to `image` shape
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

   // Detect food logging (past tense) vs meal planning (future tense)
    const isFoodLog = /\b(had|ate|consumed|drank|finished|got|grabbed|just)\b/i.test(message);

    // Strip leading emojis, markdown markers, and bullets from each line, then check
    // for a meal-type word at the start. Tolerates "🍳 Breakfast", "**Breakfast**",
    // "Breakfast — 7:00am (eat before your walk)", "Lunch:", "- Snack", etc.
    const replyLines = reply.split("\n");
    const hasMealHeaderLine = replyLines.some(line => {
      const cleaned = line
        .trim()
        .replace(/^[\s\*_•·●○\-–—#>]+/, "")
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .toLowerCase();
      if (!/^(breakfast|lunch|dinner|snack)(\b|[\s\-–—:(])/.test(cleaned)) return false;
      if (cleaned.includes("calories:") || cleaned.includes("foods:")) return false;
      return true;
    });

    const hasMealBlockFormat = hasMealHeaderLine &&
                               /- calories:/i.test(reply) &&
                               /- protein:/i.test(reply);

    const hasMealInlineFormat = /(breakfast|lunch|dinner|snack)\s*[-–]\s*\d+\s*cal/i.test(reply);
    
    const hasMealBlock = hasMealBlockFormat || hasMealInlineFormat;
    
    // Debug logging
    console.log("🔍 MEAL REVIEW DETECTION:");
    console.log("  - isFoodLog:", isFoodLog, "(message:", message.substring(0, 50) + "...)");
    console.log("  - hasMealBlockFormat:", hasMealBlockFormat);
    console.log("  - hasMealInlineFormat:", hasMealInlineFormat);
    console.log("  - hasMealBlock:", hasMealBlock);
    console.log("  - hasImages:", images?.length > 0);
    console.log("  - Should trigger?", hasMealBlock && (isFoodLog || images?.length > 0));
    
    let mealReview = null;
    // Trigger meal review for: (1) past tense food logging OR (2) photo-based meals
    if (hasMealBlock && (isFoodLog || images?.length > 0)) {
      console.log("✅ Meal review triggered - showing 4-button review");
      
      // Clean up AI response - remove any button instructions
      const cleanedReply = reply
        .replace(/choose one:?\s*/gi, '')
        .replace(/select one:?\s*/gi, '')
        .replace(/pick one:?\s*/gi, '')
        .replace(/✅\s*add to eaten/gi, '')
        .replace(/📅\s*add to planned/gi, '')
        .replace(/✏️\s*edit/gi, '')
        .replace(/❌\s*cancel/gi, '')
        .trim();
      
      console.log("🧹 Cleaned reply length:", cleanedReply.length, "vs original:", reply.length);
      
      mealReview = {
        actions: ["eat", "plan", "edit", "cancel"],
        targetDate: today
      };
      
      // Return cleaned reply
      try {
        await supabase.from("ai_messages").insert([{
          user_id: activeUserId, message: message || "", response: cleanedReply,
          created_at: new Date().toISOString(),
        }]);
      } catch (e) { console.log("Save error:", e); }

      return Response.json({ reply: cleanedReply, mealReview });
    } else {
      console.log("❌ Meal review NOT triggered");
    }

    try {
      await supabase.from("ai_messages").insert([{
        user_id: activeUserId, message: message || "", response: reply,
        created_at: new Date().toISOString(),
      }]);
    } catch (e) { console.log("Save error:", e); }

    return Response.json({ reply, mealReview });

  } catch (error) {
    console.error("AI ERROR:", error);
    return Response.json({ reply: "Something went wrong. Please try again." }, { status: 500 });
  }
}