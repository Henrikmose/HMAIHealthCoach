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
// Penalize oddball/edge-case USDA variants; prefer simple, common cuts.
function scoreFoodMatch(rowName, query) {
  const name = (rowName || "").toLowerCase();
  const q = (query || "").toLowerCase().trim();
  let score = 0;

  // Strong penalties for non-food or edge parts the user almost never means
  const badParts = [
    "rind", "skin only", "shell", "peel only", "rind only",
    "cartilage", "bone", "gizzard", "neck", "back", "tail",
    "fat only", "trimmings", "novel", "imitation", "babyfood", "baby food",
  ];
  for (const bad of badParts) if (name.includes(bad)) score -= 50;

  // Mild penalty for "with skin" / "meat and skin" when user didn't ask for skin
  if (!q.includes("skin") && (name.includes("with skin") || name.includes("meat and skin"))) score -= 8;

  // Prefer canonical lean cuts when relevant
  if (q.includes("chicken") && name.includes("breast")) score += 10;
  if (name.includes("boneless")) score += 3;
  if (name.includes("skinless")) score += 3;

  // Prefer "cooked" when the user didn't say "raw"; prefer "raw" when they did
  if (q.includes("raw")) { if (name.includes("raw")) score += 4; }
  else { if (name.includes("cooked")) score += 4; if (name.includes("raw")) score -= 2; }

  // Shorter names are usually the plain/base food ("Watermelon, raw" > long oddball variants)
  score -= Math.min(name.length / 25, 6);

  // Bonus if the row name starts with the query word (closest match)
  if (name.startsWith(q.split(" ")[0])) score += 5;

  return score;
}

async function lookupFood(foodName) {
  if (!foodName) return null;
  try {
    // Pull several candidates, then rank — instead of blindly taking the first.
    const { data, error } = await supabase
      .from('foods')
      .select('id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
      .textSearch('name', foodName.split(' ').join(' & '), { type: 'websearch' })
      .limit(25);

    let candidates = (!error && data) ? data : [];

    // Fallback: ILIKE search if full-text found nothing
    if (candidates.length === 0) {
      const { data: data2 } = await supabase
        .from('foods')
        .select('id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
        .ilike('name', `%${foodName}%`)
        .limit(25);
      candidates = data2 || [];
    }

    if (candidates.length === 0) return null;

    // Rank candidates and return the best.
    candidates.sort((a, b) => scoreFoodMatch(b.name, foodName) - scoreFoodMatch(a.name, foodName));
    console.log(`lookupFood "${foodName}" → "${candidates[0].name}" (from ${candidates.length} candidates)`);
    return candidates[0];
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

    // ── DB Food Lookup (for food_log AND meal_planning when user states specific foods) ──
    let dbFoodResults = null;
    if (context?.type === "food_log") {
      const lookupMsg = context.followUpMessage || context.originalMessage || message;
      dbFoodResults = await lookupFoodMacros(lookupMsg);
      if (dbFoodResults) {
        console.log(`=== DB FOOD LOOKUP (food_log): found ${dbFoodResults.length} food(s) ===`);
        dbFoodResults.forEach(r => console.log(`  ${r.food}: ${r.calories} cal, ${r.protein}g P, ${r.carbs}g C, ${r.fat}g F`));
      } else {
        console.log("=== DB FOOD LOOKUP: no match — AI will estimate ===");
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
If the user has NOT yet said what they'll order: don't fabricate specific dishes for the restaurant meal. Plan the other meals around it, give brief guidance for the meal out (lean/grilled over fried, light on heavy sauces, watch portions), and tell them to photo the menu or their order and you'll log it. Budget it from their REMAINING macros.
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

    let systemMessage = `STOP — READ THIS FIRST — NO MARKDOWN EVER
══════════════════════════════════════════
NEVER use ** or ## or * or _ or any markdown. EVER. In ANY response.
This includes: nutrition questions, Q&A, general advice, comparisons, lists.
Write plain text only. Markdown breaks the app display.

MOST COMMON VIOLATIONS — NEVER DO THESE:
WRONG: **Breakfast — 7:30am**           RIGHT: Breakfast — 7:30am
WRONG: **Lunch — 12:00pm**             RIGHT: Lunch — 12:00pm
WRONG: **Pre-event Snack — 5:00pm**    RIGHT: Snack — 5:00pm (2hrs before games)
WRONG: **Post-event Recovery Snack**   RIGHT: Snack — right after your second game
WRONG: **Healthy Fats**                RIGHT: Healthy Fats
WRONG: **Summary**                     RIGHT: Summary

THE MEAL BLOCK HEADER MUST BE EXACTLY:
[MealType] — [Time] ([context])
Examples:
Breakfast — 7:00am (eat before your walk)
Lunch — 12:00pm
Snack — 5:00pm (2hrs before your 7pm games)
Snack — right after your second game

NO asterisks. NO bold. NO ##. The meal type word ALONE starts the line.
This rule applies to EVERY response — meal plans, Q&A, comparisons, everything.
══════════════════════════════════════════

You are ${userName}'s personal AI nutrition coach, health advisor, and supportive friend.

This app serves ALL types of people — athletes, gym-goers, busy professionals, people managing health conditions, parents, seniors, and anyone wanting to live healthier. Adapt completely to WHO the person is and WHAT their day looks like.

══════════════════════════════════════════
FORMATTING RULES
══════════════════════════════════════════
1. Plain text only — NO markdown (no **, ##, *, _)
2. Emojis for structure only, not decoration.
3. Short sections with line breaks. Never walls of text.

EMOJI RULES:
Use: 🎯 📊 👉 ✅ ⚖️ 💬 🧠 👍 🔍
Avoid: 🎉 😊 🔥 💪

══════════════════════════════════════════
PERSONALITY
══════════════════════════════════════════
- Like a knowledgeable friend who truly knows nutrition — not a data entry tool
- Lead with strategy and insight, then back it up with specifics
- Confident and direct — give clear recommendations, not vague suggestions
- Proactive — name the danger zones, flag the key moments, think ahead
- Honest — push back on unrealistic goals, say "Real Talk" when needed
- Specific to THIS person's day — reference their actual events, schedule, habits
- Never generic — "eat healthy" or "stay hydrated" is not coaching

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

DAY STATE — USE THESE EXACT NUMBERS. NEVER COMPUTE YOUR OWN TOTALS OR "REMAINING."
These are calculated from the database. "Remaining" already accounts for BOTH eaten and planned food.
When you plan or recommend anything, you are spending the REMAINING numbers below — not the full daily goal.

EATEN so far (${today}):
Calories: ${totals.calories} | Protein: ${totals.protein}g | Carbs: ${totals.carbs}g | Fat: ${totals.fat}g

ALREADY PLANNED for today (not yet eaten):
Calories: ${plannedTotals.calories} | Protein: ${plannedTotals.protein}g | Carbs: ${plannedTotals.carbs}g | Fat: ${plannedTotals.fat}g

COMMITTED (eaten + planned):
Calories: ${committed.calories}/${goal.calories} | Protein: ${committed.protein}/${goal.protein}g | Carbs: ${committed.carbs}/${goal.carbs}g | Fat: ${committed.fat}/${goal.fat}g

REMAINING (goal − eaten − planned) — THIS IS YOUR BUDGET:
Calories: ${remaining.calories} | Protein: ${remaining.protein}g | Carbs: ${remaining.carbs}g | Fat: ${remaining.fat}g

When the user asks what to eat next, plan within REMAINING. If a meal will be eaten out (restaurant/photo), its budget is whatever REMAINING is after the other planned meals — state it plainly: "your eaten + planned leaves ~X cal and ~Yg protein for that meal." Never state a "remaining" or "left" number that isn't one of the numbers above.

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

USING WHAT THE USER HAS EATEN/PLANNED:
The eaten and planned meals are shown above in DAY STATE. Use that data directly. NEVER ask "what have you eaten today?" — you can already see it. If nothing is logged, simply work from the goal; do not interrogate the user about unlogged food.

${eventStrategy}

INTERPRETING THE MESSAGE:
Read the user's intent and act on it. Only ask a clarifying question if the message is genuinely impossible to interpret (e.g. a bare "hey" or "ok"). If the message mentions any food, meal, macro, plan, or goal, do NOT ask what they want — proceed. If they're responding to something you just said, treat it as a continuation; never restart with a clarifying question mid-conversation.

$${hasRestaurantMeal ? `RESTAURANT / EATING OUT:
If the user has NOT yet said what they'll order at the restaurant: don't fabricate specific dishes for it — give brief guidance (lean protein over fried, light on heavy sauces, watch portions) and tell them to photo the menu or their order and you'll log it. Budget it from their REMAINING macros.
BUT if the user HAS stated specific foods/dishes (e.g. "I'll have 2 akami nigiri, miso soup") — that overrides the above: build the meal block immediately and emit MEAL_DATA. Never ask "out or planned" — the buttons handle that.` : ""}

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format.
The meal type word MUST be ALONE on its own line.
NEVER use **Breakfast** — just write Breakfast (plain text).

ALLOWED MEAL TYPES: Breakfast, Lunch, Dinner, Snack

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

EVERY MEAL PLAN MUST END WITH THIS LINE:
Reply "yes" to save this plan, or let me know if you'd like to change anything.

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

HOW TO LOG:
- Build the meal block immediately. Words like "a", "an", "half", "some", "whole", "2", "8oz", "medium" are all valid quantities — never ask for quantity when one is present. Only ask if a food has truly no amount at all (e.g. bare "chicken"), and ask about just that food, one question max.
- Respect what the user stated — never re-confirm a quantity or meal type they already gave. Prep method, doneness, and brand never matter — never ask about them.
- Never say "let me confirm" or "want me to log this?" — just output the meal block. The user confirms by tapping a button.
- No commentary on the food choice itself (don't call a combo unusual). Just log it.
- "I also had X" / "add X to my [meal]" → log ONLY the new item, not a combined block. The dashboard sums entries automatically.

MEAL BLOCK FORMAT:
[MealType]
- Foods: [food1, amount]; [food2, amount]
- Calories: [single total number, no math shown]
- Protein: [X]g
- Carbs: [X]g
- Fat: [X]g
Breakdown: [food1] — [cal] cal, [P]g P, [C]g C, [F]g F | [food2] — ...

Calories is a number only; protein/carbs/fat always include "g". Show single totals, never "X + Y = Z" math.

After the meal block, add one short coaching tip (👉). Do NOT write a running daily total or "X calories remaining" line — the app's dashboard owns those numbers.

══════════════════════════════════════════
STRUCTURED DATA OUTPUT — MANDATORY
══════════════════════════════════════════
After your conversational response above, you MUST append a structured JSON block.
This is parsed by the app to save the meal. Without it, the user cannot save what they logged.
The user does NOT see this block — it's stripped before display.

EVERY food log response MUST end with this block. No exceptions. Even if you're asking a clarifying question, if you've identified ANY foods in the user's message, emit MEAL_DATA for what you know.

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
      "source": "usda_db" | "ai_estimate",
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
- canonical_name should be the standard nutritional name. Examples: user types "banana" → "Banana, raw". User types "PB" → "Peanut butter, smooth". User types "Big Mac" → "Big Mac".
- The JSON must be VALID JSON (parseable by JSON.parse). No trailing commas. Use null, not undefined.
- If adding to an existing meal ("I also had X"), the items[] array should contain ONLY the NEW item(s).

THIS IS NOT OPTIONAL. Every food log response ends with MEAL_DATA. Failure to emit it means the user cannot save what they ate.`;
    }

    if (context?.type === "meal_planning") {
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

2. Then the meal blocks, in time order, back to back with nothing between them. Each block:

[MealType] — [time] ([short context])
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

RULES THAT MATTER:
- Plan only the remaining part of the day (don't plan meals already past, or meals already eaten/planned — those are shown in DAY STATE).
- One Breakfast, one Lunch, one Dinner maximum. Snacks can repeat (e.g. pre- and post-workout). Each snack is its own block.
- Use the REMAINING budget from DAY STATE, not the full daily goal.
- Restaurant / social / photo meals: give short inline ordering guidance, NOT a meal block (you can't know exact portions). Budget it as whatever REMAINING is after the other planned meals, and say so plainly. Tell them to photo the menu/food and you'll log it after.
- Timing must be realistic: a 3-mile walk is ~45-60 min, a workout + shower ~60 min. For a time after an event you can't size, say "right after your [event]" instead of guessing a clock time. Pre-event fuel ~2hr before; pre-event snack ~45-60 min before.
- "I get off at 7am" means a night shift just ended — first meal right at 7:00am, don't assume they just woke.`;
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
- This is guidance only — do NOT build a meal block from a menu, because you don't know what they'll order yet. Tell them to let you know what they pick and you'll log it.

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