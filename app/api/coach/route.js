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
  return (meals || []).reduce(
    (t, m) => {
      const s = Number(m.servings || 1);
      return {
        calories: t.calories + Number(m.calories||0) * s,
        protein: t.protein + Number(m.protein||0) * s,
        carbs: t.carbs + Number(m.carbs||0) * s,
        fat: t.fat + Number(m.fat||0) * s,
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
  return level.includes("very") || level.includes("extra") || level.includes("athlete") || level.includes("sport");
}

// ── Food Database Lookup ──────────────────────────────────────────
function parseFoodItems(message) {
  if (!message) return [];
  const items = [];
  const patterns = [
    /(\d+\.?\d*)\s*(oz|lb|lbs|g|kg|cup|cups|tbsp|tsp|ml|fl oz|piece|pieces|slice|slices|scoop|scoops)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi,
    /(\d+\.?\d*)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi,
    /\b(a|an|half|whole|one|two|three|four|five)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi
  ];
  const [p1, p2, p3] = patterns;
  let match;
  while ((match = p1.exec(message)) !== null) {
    items.push({ amount: parseFloat(match[1]), unit: match[2].toLowerCase(), food: match[3].trim() });
  }
  if (items.length === 0) {
    while ((match = p2.exec(message)) !== null) {
      const food = match[2].trim();
      if (food.length > 2) items.push({ amount: parseFloat(match[1]), unit: 'serving', food });
    }
  }
  return items;
}

async function lookupFood(foodName) {
  if (!foodName) return null;
  try {
    const { data, error } = await supabase
      .from('foods')
      .select('id, fdc_id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
      .textSearch('name', foodName.split(' ').join(' & '), { type: 'websearch' })
      .limit(1);
    if (!error && data && data.length > 0) return data[0];
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

async function convertToGrams(amount, unit, foodId) {
  const unitLower = unit.toLowerCase().replace(/s$/, '');
  if (foodId) {
    const { data } = await supabase
      .from('food_specific_conversions')
      .select('grams_per_unit')
      .eq('food_id', foodId)
      .ilike('unit_name', `%${unitLower}%`)
      .limit(1);
    if (data?.[0]) return amount * data[0].grams_per_unit;
  }
  const { data } = await supabase
    .from('unit_conversions')
    .select('grams_per_unit, ml_per_unit, unit_category')
    .eq('unit_name', unitLower)
    .limit(1);
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
    protein: Math.round(food.protein_per_100g * factor * 10) / 10,
    carbs: Math.round(food.carbs_per_100g * factor * 10) / 10,
    fat: Math.round(food.fat_per_100g * factor * 10) / 10,
  };
}

async function lookupFoodMacros(message) {
  const items = parseFoodItems(message);
  if (items.length === 0) return null;
  const results = [];
  for (const item of items.slice(0, 5)) {
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
  if (/dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|event/.test(lower)) return "social_dining";
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
  if (!ap && h < 6) h += 12;
  return h;
}

function extractAllEvents(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const events = [];
  let match;

  const re1 = /(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|dinner|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration)\b[a-z\s]*?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;

  while ((match = re1.exec(lower)) !== null) {
    const eventText = match[1].trim();
    const h = parseHour(match[2], match[4]);
    const type = classifyEventType(eventText);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = lower.includes("tomorrow");
      events.push({ type, hour: h, label: eventText.trim(), isTomorrow });
    }
  }

  const re2 = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon)\b)/gi;

  while ((match = re2.exec(lower)) !== null) {
    const h = parseHour(match[1], match[3]);
    const type = classifyEventType(match[4]);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = lower.includes("tomorrow");
      if (!events.find(e => e.hour === h && e.type === type)) {
        events.push({ type, hour: h, label: match[4].trim(), isTomorrow });
      }
    }
  }

  events.sort((a, b) => a.hour - b.hour);
  return events;
}

function eventsMissingTimes(text) {
  const lower = text.toLowerCase();
  const hasEventKeywords = /workout|gym|tennis|hockey|soccer|football|basketball|marathon|race|triathlon|hike|cycling|swim|yoga|dinner party|going out|restaurant/.test(lower);
  const hasTimeKeywords = /\d+\s*(am|pm)|at\s+\d+|\d+:\d+|morning|afternoon|evening|night/.test(lower);
  return hasEventKeywords && !hasTimeKeywords;
}

function buildMultiEventStrategy(events, currentHour, goal) {
  if (events.length === 0) return "";
  const physicalEvents = events.filter(e => isPhysicalEvent(e.type));
  const socialEvents = events.filter(e => isSocialEvent(e.type));

  let strategy = `
MULTI-EVENT DAY DETECTED — ${events.length} event(s):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 (${e.label})`).join("\n")}
CALORIE TARGET: Aim for 85-95% of ${goal.calories} cal (${Math.round(goal.calories * 0.85)}-${Math.round(goal.calories * 0.95)} cal)

MEAL TIMELINE RULES:
`;

  events.forEach((event, idx) => {
    const prevEvent = idx > 0 ? events[idx - 1] : null;
    const nextEvent = idx < events.length - 1 ? events[idx + 1] : null;

    if (isPhysicalEvent(event.type)) {
      let preEventAdvice;
      if (event.hour <= 8) {
        preEventAdvice = "30-60 minutes before OR eat after: light snack (banana, toast) 200-250 cal";
      } else if (event.hour <= 12) {
        preEventAdvice = "1-2 hours before: light snack — HIGH carbs, LOW fat (banana, rice cakes, oatmeal)";
      } else {
        preEventAdvice = "2-3 hours before: pre-event Snack — HIGH carbs, LOW fat, easy to digest (300-400 cal)";
      }

      strategy += `
${event.type.toUpperCase()} at ${event.hour}:00 (${event.label}):
- ${preEventAdvice}
- Within 1 hour after: recovery meal — HIGH protein + carbs
${nextEvent && isSocialEvent(nextEvent.type) ? `- NOTE: Social event follows at ${nextEvent.hour}:00 — keep recovery meal moderate` : ""}
`;
    } else if (isSocialEvent(event.type)) {
      const eventCalBudget = Math.round(goal.calories * 0.45);
      strategy += `
SOCIAL EVENT at ${event.hour}:00 (${event.label}):
${prevEvent && isPhysicalEvent(prevEvent.type) ? `- Follows physical event at ${prevEvent.hour}:00 — you may be hungry, but pace yourself` : ""}
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
For physical events: include Dinner block for post-event recovery UNLESS a social event follows.
Total planned meals should add up to 85-95% of ${goal.calories} cal.
`;
  return strategy;
}

function isRestaurantOrPartyMeal(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /dinner party|dinner date|restaurant|going out|eating out|party|wedding|birthday|someone'?s (place|house|home)|their place|her place|his place/.test(lower);
}

function getUnloggedMealPrompt(hour, nothingLogged) {
  if (!nothingLogged) return null;
  if (hour >= 7 && hour < 11) return "It's morning and nothing is logged yet. Ask: 'Have you had breakfast yet?'";
  if (hour >= 11 && hour < 14) return "It's late morning/lunchtime and nothing is logged. Ask: 'Have you eaten anything today yet?'";
  if (hour >= 14 && hour < 18) return "It's afternoon and nothing is logged. Ask: 'I don't have any meals logged for you today — have you eaten yet?'";
  if (hour >= 18) return "It's evening and nothing is logged. Say: 'I don't see anything logged today — what have you eaten so far?'";
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { message, context, history = [], userId, localHour, localDate: clientDate, images } = body;
    const image = images?.[0] || null;
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
        userName = profile.name || "there";
        currentWeight = profile.current_weight;
        targetWeight = profile.target_weight;
        weightUnit = profile.weight_unit || "lbs";
        activityLevel = profile.activity_level || "moderately active";
        goalType = profile.goal_type || "fat_loss";
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

    const totals = sumMeals(todayMeals);
    const remaining = {
      calories: Math.max(0, goal.calories - totals.calories),
      protein: Math.max(0, goal.protein - totals.protein),
      carbs: Math.max(0, goal.carbs - totals.carbs),
      fat: Math.max(0, goal.fat - totals.fat),
    };

    // ── DB Food Lookup (for food_log context) ──
    let dbFoodResults = null;
    if (context?.type === "food_log") {
      const lookupMsg = context.followUpMessage || context.originalMessage || message;
      dbFoodResults = await lookupFoodMacros(lookupMsg);
      if (dbFoodResults) {
        console.log(`=== DB FOOD LOOKUP: found ${dbFoodResults.length} food(s) ===`);
        dbFoodResults.forEach(r => console.log(` ${r.food}: ${r.calories} cal, ${r.protein}g P`));
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

    const allLower = (message || "").toLowerCase();
    const isWeightLossConversation = weightToLose !== null ||
      /lose weight|losing weight|lose \d|drop \d|cut calories|deficit|slim down/.test(allLower);

    const mealsSummary = todayMeals.length > 0
      ? todayMeals.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`).join("\n")
      : "Nothing logged yet today";

    // Build event strategy
    let eventStrategy = "";
    if (missingEventTimes && !hasAnyEvent) {
      eventStrategy = `
MISSING EVENT TIMES:
The user mentioned events but didn't provide specific times.
Ask them: "What time is each event? I need the times to plan your meals properly around them."
Do NOT guess or plan without times. Just ask.`;
    } else if (hasMultipleEvents) {
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
7. When logging a restaurant meal after the fact: always add "Note: these are estimates based on typical restaurant portions — actual macros will vary"`;
    } else if ((hasEventToday || hasTomorrowEvent) && eventType) {
      if (["sport", "workout", "endurance"].includes(eventType)) {
        eventStrategy = `
PHYSICAL EVENT STRATEGY (${eventType} at ${eventHour !== null ? eventHour + ":00" : "scheduled time"}):
CALORIE RULE FOR SPORT/RACE DAY: Aim for 85-95% of the ${goal.calories} calorie target (${Math.round(goal.calories * 0.85)}-${Math.round(goal.calories * 0.95)} cal)
MEAL STRUCTURE FOR THE FULL DAY:
1. Breakfast: balanced, good carbs + protein (up at ${hour}:00 so plan accordingly)
2. Lunch: high carbs, moderate protein, low fat — fuel loading
3. Pre-event timing (smart approach based on event time):
 ${eventHour <= 8 ? "Early event — eat 30-60 min before OR after the event" : eventHour <= 12 ? "Late morning — light snack 1-2 hours before" : "Afternoon/evening — Snack 2-3 hours before"}
 HIGH carbs, LOW fat, easy to digest (300-400 cal) — banana, rice cakes, oatmeal
4. Post-event Dinner (within 1-2 hours after): HIGH protein + carbs for recovery — this is MANDATORY
ATHLETIC EVENT FOOD EXAMPLES — USE THESE FOR RECOVERY DINNER:
- Grilled chicken with pasta or quinoa
- Salmon with sweet potato and rice
- Turkey with mashed potato
- Lean beef with rice and vegetables
- NOT steak or heavy/fatty foods — keep it digestible for recovery
IMPORTANT:
- You MUST include a Dinner block for post-race/game recovery. This is NOT a restaurant meal — you know what recovery food looks like.
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
WRONG: **Breakfast — 7:30am** RIGHT: Breakfast — 7:30am
WRONG: **Lunch — 12:00pm** RIGHT: Lunch — 12:00pm
WRONG: **Pre-event Snack — 5:00pm** RIGHT: Snack — 5:00pm (2hrs before games)
WRONG: **Post-event Recovery Snack** RIGHT: Snack — right after your second game
WRONG: **Healthy Fats** RIGHT: Healthy Fats
WRONG: **Summary** RIGHT: Summary
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
This app serves ALL types of people — athletes, gym-goers, busy professionals, people managing health conditions, and everyday users who just want to eat better.
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
${currentWeight ? `Current Weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight ? `Target Weight: ${targetWeight} ${weightUnit}` : ""}
${healthConditions ? `Health Notes: ${healthConditions}` : ""}
Local Time: ${hour}:00 (${timeOfDay})
DAILY TARGETS — SET BY USER, DO NOT CHANGE:
Calories: ${goal.calories} | Protein: ${goal.protein}g | Carbs: ${goal.carbs}g | Fat: ${goal.fat}g
══════════════════════════════════════════
CRITICAL CALORIE RULE — READ THIS CAREFULLY
══════════════════════════════════════════
${userName}'s daily calorie target is ${goal.calories}. This number was SET BY THE USER in their goals. It is final.
You MUST use ${goal.calories} as the daily calorie goal in ALL coaching and meal plans.
Do NOT say "your new target for fat loss is 2300" or any invented number.
Do NOT use ${weightLossCals} as the plan target unless user explicitly asks to lose weight TODAY.
If user says "stay within my macros" or "plan my meals" → use ${goal.calories}. Full stop.
Do NOT calculate a different number based on their goal type.
Do NOT apply your own deficit to arrive at a different target.
Do NOT say "for fat loss you should eat X" if X is different from ${goal.calories}.
The ${goal.calories} target ALREADY reflects their goals — it is the number they want to eat each day.
When telling the user how many calories they have left, ALWAYS calculate from ${goal.calories}.
Example: if ${userName} has eaten ${totals.calories} cal, they have ${remaining.calories} cal left.
TODAY'S INTAKE (${today}):
Calories: ${totals.calories}/${goal.calories} (${Math.round((totals.calories/goal.calories)*100)}%)
Protein: ${totals.protein}/${goal.protein}g (${Math.round((totals.protein/goal.protein)*100)}%)
Carbs: ${totals.carbs}/${goal.carbs}g (${Math.round((totals.carbs/goal.carbs)*100)}%)
Fat: ${totals.fat}/${goal.fat}g (${Math.round((totals.fat/goal.fat)*100)}%)
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
- If a meal type is already planned → treat any new food for that type as an ADDITIONAL entry
` : ""}
${events.length > 0 ? `📅 EVENTS DETECTED (${events.length}):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 ${e.isTomorrow ? "(tomorrow)" : "(today)"} — ${e.label}`).join("\n")}
${hasRestaurantMeal ? "🍽️ RESTAURANT/PARTY MEAL DETECTED" : ""}
${missingEventTimes && !hasAnyEvent ? "⚠️ EVENTS MENTIONED BUT NO TIMES PROVIDED — ASK FOR TIMES" : ""}` : ""}
══════════════════════════════════════════
CRITICAL: ASK BEFORE ASSUMING
══════════════════════════════════════════
${hasTomorrowEvent || (message || "").toLowerCase().includes("tomorrow") ? `
PLANNING FOR TOMORROW — do NOT ask about today's meals.
Just plan the full day for tomorrow. No questions about what was eaten today.
` : nothingEatenYet ? `
NOTHING IS LOGGED TODAY and it's ${hour}:00.
NEVER assume the user hasn't eaten just because nothing is logged.
${unloggedPrompt || ""}
Before giving meal suggestions or planning the day, ALWAYS ask what they've eaten.
EXCEPTION: General nutrition questions can be answered without asking.
` : `Today's logged meals are shown above. Use this data for all coaching.`}
${eventStrategy}
══════════════════════════════════════════
AMBIGUOUS MESSAGE RULE
══════════════════════════════════════════
ONLY ask "Were you looking to log a meal, get a meal plan, or ask me a nutrition question?" if the message is truly ambiguous with NO food or nutrition context.
NEVER ask this clarifying question if the message contains ANY of:
- meal words: breakfast, lunch, dinner, snack, meal, food, eat
- macro words: calories, protein, carbs, fat, macros, nutrition
- planning words: what should I eat, help me decide, suggestions, recommendations, plan, ideas
- logging words: I had, I ate, I just had, I just ate
- swap words: I ran out of, don't have, something else, swap, replace, change it, another option
- goal words: hit my macros, stay on track, reach my goal, for the day, for tonight
If user is continuing a conversation about food (AI just suggested a meal, user responds about it) → continue the conversation naturally.
${hasRestaurantMeal ? `══════════════════════════════════════════
RESTAURANT / PARTY MEALS — CRITICAL RULE
══════════════════════════════════════════
The user is eating at a restaurant, dinner party, or someone's home.
- DO NOT create a Dinner block — you don't know the menu
- DO NOT guess specific dishes
- Plan only Breakfast, Lunch, Snack blocks (meals BEFORE the event)
- After the meal blocks, add plain text guidance:
 "For the dinner itself — I don't know the exact menu, so here's what to look for:
 - Lean protein: grilled or baked over fried
 - Light on heavy sauces and sides
 - Go easy on bread and alcohol
 - Watch portion sizes
 When you're there, take a photo of the menu and I'll help you choose."
- Say how many calories remain for the event in plain text only — no meal block` : ""}
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
Snack (pre-game) FORBIDDEN — no parentheses
Snack (post-game) FORBIDDEN — no parentheses
**Snack** FORBIDDEN — no markdown
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
CUISINE / RESTAURANT AMBIGUITY RULE:
If the user mentions a cuisine or food type (sushi, Italian, Mexican, etc.) without clearly stating if they're going out or want it planned:
- DO NOT guess — ask first
- Say: "Are you going out for sushi or would you like me to plan a sushi meal for you?"
- Wait for their answer before creating any meal block
Clear signals to plan it: "plan me sushi", "I want sushi for lunch", "add sushi to my plan"
Clear signals it's a restaurant: "going out for sushi", "sushi restaurant", "sushi date", "sushi place"
Ambiguous — always ask: "sushi lunch scheduled", "having sushi", "sushi at 12:30"

Coaching context: ${userName} has eaten ${totals.calories} cal today and has ${remaining.calories} cal remaining toward their ${goal.calories} goal. Reference this when coaching, but the Total planned line shows only the meals you wrote in THIS response — never add ${totals.calories} to the plan total.

══════════════════════════════════════════
CALORIE TARGETS FOR MEAL PLANS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${goal.calories} cal.
${isWeightLossConversation ? `Weight loss plan: ${weightLossCals} cal.` : ""}
Social event days: distribute so event meal is included in budget.
If plan is below 85% of target, flag the shortfall.
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal worth of meals.
OVER-BUDGET RULE:
If a meal plan comes in 1-10% over the calorie target, just mention it casually — do NOT suggest it's a problem.
Example: "This comes in just slightly over at 105% — totally fine, small buffer."
Only suggest adjustments if user asks, or if over 15%+.
══════════════════════════════════════════
MEAL SWAP / REPLACE RULE
══════════════════════════════════════════
If user rejects a suggestion or says they don't have an ingredient ("I ran out of X", "I don't have Y"):
1. Acknowledge briefly: "No problem — let me swap that out."
2. Suggest a NEW meal that hits similar macros
3. Use the same meal block format
4. Do NOT ask the clarifying question. Do NOT restart. Just swap.
If user CONFIRMS a suggestion ("yes", "yes please", "I like that", "let's do that", "perfect"):
- Respond warmly and briefly confirming the choice
- End with: "Ready to add it to your plan?"
- Do NOT output another meal block — the user already confirmed the previous one
- Do NOT offer adjustments or revisions unless the user asked for them
══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
CRITICAL: Only suggest meals for remaining time today.
${hour < 10 ? "All meals available: Breakfast, Lunch, Snack, Dinner" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner. DO NOT suggest Breakfast." : ""}
${hour >= 14 && hour < 17 ? "Breakfast and Lunch time have passed. Available: Snack, Dinner. DO NOT suggest Breakfast or Lunch." : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack only. DO NOT suggest Breakfast, Lunch, or early-day meals." : ""}
${hour >= 20 ? "Available: Snack only. DO NOT suggest any full meals." : ""}
If it's 6pm or later and user has a dinner event, suggest only light pre-dinner snack if anything.
Weight loss confirmations → plan TOMORROW full day.
══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
${isWeightLossConversation ? `Use weight amount THEY SAID — not profile target.
Push back if unrealistic (max 2 lbs/week safely).
${veryActive
  ? `Very active — just reduce food by ${foodCutAmount} cal. New target: ${weightLossCals} cal/day.`
  : `Split: eat ${foodCutAmount} cal less + burn 200 more (20-30 min walk). New target: ${weightLossCals} cal/day.`}
${weightToLose ? `Timeline: ${weightToLose} lbs ÷ 1/week = ${weeksToGoal} weeks.` : ""}
Ask: "Want a meal plan for tomorrow at ${weightLossCals} cal? Or a 2-3 day plan?"
When confirmed → plan TOMORROW at ${weightLossCals} cal, full day.` : `If user asks about losing weight, respond to that question directly.`}
══════════════════════════════════════════
MULTI-FOOD LOGGING
══════════════════════════════════════════
Ask for each food quantity one at a time.
Only return meal block when ALL quantities are known.
══════════════════════════════════════════
MACRO REFERENCE
══════════════════════════════════════════
Chicken breast: 1oz = 46 cal, 8.7g P, 0g C, 1g F
Ground beef lean: 1oz = 55 cal, 7g P, 0g C, 3g F
Salmon: 1oz = 58 cal, 8g P, 0g C, 3g F
Tuna canned: 1oz = 30 cal, 7g P, 0g C, 0g F
Turkey breast: 1oz = 35 cal, 7g P, 0g C, 0.5g F
Shrimp: 1oz = 28 cal, 6g P, 0g C, 0g F
Eggs: 1 large = 70 cal, 6g P, 0g C, 5g F
Egg whites: 1 large = 17 cal, 4g P, 0g C, 0g F
White rice cooked: 1 cup = 200 cal, 4g P, 44g C, 0g F
Brown rice cooked: 1 cup = 215 cal, 5g P, 45g C, 2g F
Pasta cooked: 1 cup = 220 cal, 8g P, 43g C, 1g F
Oatmeal cooked: 1 cup = 150 cal, 5g P, 27g C, 3g F
Bread whole wheat: 1 slice = 80 cal, 4g P, 15g C, 1g F
Sweet potato: 1 medium = 130 cal, 3g P, 30g C, 0g F
Banana: 1 medium = 105 cal, 1g P, 27g C, 0g F
Apple: 1 medium = 95 cal, 0g P, 25g C, 0g F
Blueberries: 1 cup = 85 cal, 1g P, 21g C, 0g F
Greek yogurt: 1 cup = 130 cal, 22g P, 9g C, 0g F
Cottage cheese: 1 cup = 200 cal, 28g P, 8g C, 4g F
Milk whole: 1 cup = 150 cal, 8g P, 12g C, 8g F
Protein shake: 1 scoop = 120 cal, 25g P, 3g C, 2g F
Broccoli: 1 cup = 55 cal, 4g P, 11g C, 0g F
Spinach: 1 cup = 7 cal, 1g P, 1g C, 0g F
Avocado: 1 medium = 240 cal, 3g P, 13g C, 22g F
Almonds: 1oz = 165 cal, 6g P, 6g C, 14g F
Peanut butter: 2 tbsp = 190 cal, 8g P, 6g C, 16g F
Olive oil: 1 tbsp = 120 cal, 0g P, 0g C, 14g F
Quinoa cooked: 1 cup = 222 cal, 8g P, 39g C, 4g F
Lentils cooked: 1 cup = 230 cal, 18g P, 40g C, 1g F
Rice cakes: 1 cake = 35 cal, 1g P, 7g C, 0g F
Cheddar cheese: 1oz = 113 cal, 7g P, 0g C, 9g F
Walnuts: 1oz = 185 cal, 4g P, 4g C, 18g F
Hummus: 2 tbsp = 70 cal, 2g P, 6g C, 4g F
UNITS: Always use US units — oz, cups, tbsp, tsp, slices, pieces`;

    if (context?.type === "food_log") {
      systemMessage += `
══════════════════════════════════════════
FOOD LOGGING MODE
══════════════════════════════════════════
${userName} is logging food they ate.
Original: "${context.originalMessage}"
${context.mealType ? `Meal type: ${context.mealType}` : `No meal type given — infer from time of day:
  Before 11am → Breakfast | 11am-2pm → Lunch | 2pm-5pm → Snack | 5pm+ → Dinner
  Use this inferred type in the meal block. NEVER skip logging because meal type is missing.`}
${context.followUpMessage ? `Follow-up: "${context.followUpMessage}"` : ""}
${dbFoodResults ? `
DATABASE LOOKUP — USE THESE EXACT NUMBERS (from USDA):
${dbFoodResults.map(r => `${r.food} (${r.amount} ${r.unit} = ${r.grams}g):
  Calories: ${r.calories} | Protein: ${r.protein}g | Carbs: ${r.carbs}g | Fat: ${r.fat}g`).join("\n")}
CRITICAL: Use the numbers above EXACTLY. Do not recalculate or estimate.
Return a meal block with these exact macro values.
` : `
RULE 1: NEVER ASK USER FOR CALORIES OR MACROS — YOU ARE THE EXPERT
WRONG: "How many calories are in the eggs?"
RIGHT: Use your nutrition knowledge to estimate. A standard sushi roll = ~300-350 cal. Eggs = 70 cal each.
`}
RULE 2 — QUANTITY CHECK:
These ALL count as valid quantities — never ask if any of these are present:
- Numbers: 2, 8, 0.5, 1.5
- Units: oz, lb, cup, tbsp, tsp, g, ml, pcs, pieces, slices
- Words: a, an, half, whole, one, two, three, medium, large, small, some
- "half an avocado" → half = quantity ✅ LOG IT
- "an apple" → an = 1 ✅ LOG IT
- "2 eggs" → 2 = quantity ✅ LOG IT
- "8oz chicken" → 8oz = quantity ✅ LOG IT
- "some rice" → some = quantity estimate 1 cup
ONLY ask when there is truly NOTHING:
- "sweet potatoes" alone with no descriptor = ask "How much sweet potato?"
- "chicken" alone with no descriptor = ask "How much chicken?"
- "beef and sweet potatoes" where beef has oz but sweet potatoes has NOTHING = ask only about sweet potatoes
KEY RULE: "half", "a", "an", "some", "whole" are ALL valid quantities. Never ask when these words are present.
MEAL BLOCK FORMAT — CRITICAL:
Use SINGLE TOTAL NUMBERS ONLY. Never breakdown math in the meal block.
WRONG: - Calories: 368 (chicken) + 130 (sweet potato) = 498
RIGHT: - Calories: 498
WRONG: - Protein: 56g (chicken) + 3g (sweet potato) = 59g
RIGHT: - Protein: 59g
ALWAYS include "g" on protein, carbs, fat:
WRONG: - Protein: 56 RIGHT: - Protein: 56g
WRONG: - Carbs: 30 RIGHT: - Carbs: 30g
WRONG: - Fat: 36 RIGHT: - Fat: 36g
AFTER the meal block, add a Breakdown line showing per-food contributions:
Breakdown: Ground beef — 480 cal, 53g P, 0g C, 29g F | Sweet potato — 160 cal, 3g P, 37g C, 0g F
This lets the user see what each food contributed without breaking the parser.
ADDING TO EXISTING MEAL ("I also had X", "I also ate X", "add X to my breakfast"):
When user adds a food to an existing meal type — ONLY log the NEW item.
Do NOT repeat the original meal. Do NOT create a combined block.
WRONG: "Breakfast - Foods: Eggs, 2 large; Avocado, half; Sourdough toast, 1 slice"
RIGHT: "Breakfast - Foods: Sourdough toast, 1 slice - Calories: 80..."
The dashboard will sum both entries automatically.
AFTER LOGGING — ALWAYS include:
1. The meal logged with single total numbers (new item only if adding to existing)
2. 📊 Updated totals: [sum]/${goal.calories} cal ([pct]%) | [sum]g protein | [sum]g carbs | [sum]g fat
3. ONLY DB baseline + this new meal — nothing else
4. 👉 One coaching tip
5. IF 300+ calories remaining: suggest a specific next meal or snack`;
    }

    if (context?.type === "meal_planning") {
      let timingGuide = "";
      if (events.length > 0) {
        const sortedEvents = [...events].sort((a, b) => a.hour - b.hour);
        sortedEvents.forEach((event, idx) => {
          if (isPhysicalEvent(event.type)) {
            if (event.hour <= 8) {
              timingGuide += `
${event.type.toUpperCase()} at ${event.hour}:00:
- If eating before: light snack at ${event.hour - 1}:30 (30 min before) — banana or toast ~150 cal
- Post-workout: Breakfast right after your workout (do NOT assign a specific time)
- DO NOT suggest a full 300+ cal meal before a ${event.hour}:00am workout — eating at ${event.hour - 1}:00am is unrealistic
- DO NOT present Option A / Option B choices — just include a light pre-workout Snack block + Breakfast after
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
Planning for: ${events.some(e => e.isTomorrow) ? "TOMORROW" : "TODAY"}
${events.length > 0 ? `Events detected: ${events.map(e => `${e.type} at ${e.hour}:00`).join(", ")}` : ""}
${missingEventTimes && !hasAnyEvent ? "MISSING TIMES: Ask user what time each event is before planning." : ""}
${hasRestaurantMeal && !hasPhysicalEvents ? "Restaurant/social event only — DO NOT create a Dinner block." : ""}
${timingGuide}
NO MARKDOWN IN THIS PLAN — REMINDER:
NEVER use ** or ## anywhere in this response. Not for workout labels, not for meal titles, not for section headers.
WRONG: **7:00 AM Workout** / **Post-Workout Recovery** / **Lunch (12:30 PM)**
RIGHT: Just write the plain meal block — Snack / Breakfast / Lunch / Dinner on their own lines
CALORIE FORMAT — CRITICAL:
NEVER use breakdown math format for macros. Always use single totals.
WRONG: - Calories: 150 (oatmeal) + 105 (banana) + 165 (almonds) = 420
RIGHT: - Calories: 420
WRONG: - Protein: 5g (oatmeal) + 1g (banana) + 6g (almonds) = 12g
RIGHT: - Protein: 12g
This applies to ALL meals in the plan. Single number only. No math shown.
NO OPTIONS FORMAT:
NEVER present "Option A" / "Option B" or "Fasted Workout" choices.
Just pick the best single plan and present it. User can ask for changes after.
RESPONSE STRUCTURE — FOLLOW THIS ORDER EVERY TIME:
STEP 1 — BIG PICTURE STRATEGY (2-4 lines, before any meal blocks)
Open with a brief coaching overview of the day. Name the key challenge or opportunity.
Examples:
- "You've got a workout + tennis back-to-back with a social lunch in between — this is a fuel timing challenge."
- "Two physical events today means carbs are your friend. We'll time them around your workout and game."
- "The danger zone today is 2-5pm — that gap between lunch and tennis where energy crashes. Don't skip the snack."
Be specific to THEIR day. Not generic. Reference their actual events and schedule.
STEP 2 — MEAL BLOCKS (in time order)
Present ALL meal blocks back to back. NO coaching notes or tips between blocks.
Each block format (exactly this — nothing extra between blocks):
[MealType] — [Time] ([context])
- Foods: [food1, amount]; [food2, amount]
- Calories: [total only — single number, no math]
- Protein: [X]g
- Carbs: [X]g
- Fat: [X]g
Breakdown: [food1] — [cal] cal, [P]g P, [C]g C, [F]g F | [food2] — [cal] cal, [P]g P, [C]g C, [F]g F
The Breakdown line is MANDATORY for every meal with 2+ foods.
WRONG — no breakdown:
Lunch — 12:00pm
- Foods: Chicken breast, 6oz; Quinoa, 1 cup; Broccoli, 1 cup
- Calories: 520
- Protein: 56g
- Carbs: 55g
- Fat: 8g
RIGHT — with breakdown:
Lunch — 12:00pm
- Foods: Chicken breast, 6oz; Quinoa, 1 cup; Broccoli, 1 cup
- Calories: 520
- Protein: 56g
- Carbs: 55g
- Fat: 8g
Breakdown: Chicken — 280 cal, 52g P, 0g C, 5g F | Quinoa — 185 cal, 8g P, 34g C, 3g F | Broccoli — 55 cal, 4g P, 11g C, 0g F
Then the next meal block immediately. No other text between blocks.
All coaching tips go in STEP 3 only.
MACRO FORMAT — ALWAYS include "g" on protein, carbs, fat:
WRONG: - Protein: 56 RIGHT: - Protein: 56g
WRONG: - Carbs: 30 RIGHT: - Carbs: 30g
WRONG: - Fat: 36 RIGHT: - Fat: 36g
Calories = number only (no "g"). All other macros always get "g".
For restaurant/social meals: include inline ordering guidance (NOT a meal block) — like:
"For sushi — you have ~${Math.round(remaining.calories * 0.45)} calories budgeted here. Smart picks:
- Sashimi or nigiri first (protein anchor)
- 1-2 rolls max, not 4+
- Avoid heavy sauces (spicy mayo overload)
- Take a photo of the menu and I'll help you pick the best options."
STEP 2.5 — TOTAL LINE (after all meal blocks, before rules)
After ALL meal blocks, add up ONLY the meals you just wrote above — nothing else.
TOTAL CALCULATION — MANDATORY:
Step 1: List each meal calorie from what you just wrote:
  Breakfast: X cal
  Lunch: X cal
  Snack 1: X cal
  Dinner: X cal
  Snack 2: X cal
Step 2: Add them: X + X + X + X + X = TOTAL
Step 3: Write: 📊 Total planned: [TOTAL]/${goal.calories} cal ([pct]%) | [P]g protein | [C]g carbs | [F]g fat
NEVER include:
- Meals from previous messages in this conversation
- Any number not from a meal block you wrote in THIS response
DOUBLE CHECK: If your total seems higher than the sum of your meals → you made an error. Recalculate.
STEP 3 — SIMPLE RULES (2-4 lines after the total)
End with 2-4 short rules specific to this day. Not generic advice.
Examples:
- "Don't let sushi turn into 1,200 calories"
- "The 3:30pm snack is non-negotiable — skip it and tennis suffers"
- "Protein every meal — non-negotiable"
- "Carbs before activity, not randomly at night"
STEP 4 — CONFIRM PROMPT (always last)
Reply "yes" to save this plan, or let me know if you'd like to change anything.
CRITICAL — TIMING RULES:
Pre-event snack time: calculate EXACTLY. Event at 7:30pm, 30 min before = 7:00pm NOT 6:00pm.
Post-event meal: NEVER use a specific time — always say "right after your [event]".
TOMORROW TIMING RULES — MANDATORY:
When planning tomorrow, EVERY meal block MUST have a specific time label.
Format: "Breakfast — 7:00am (before your walk)"
STEP 1: Extract schedule from user message:
- Start time (wake time, OR "get off work at 7am", OR "finish shift at X")
- Morning activities (walk, workout, commute)
- Work hours
- Event times (hockey at 7:30pm, workout at 6am etc)
CRITICAL: "I get off at 7am" = person just finished a night shift. First meal = immediately at 7am.
Do NOT assume they just woke up. Read the context.
STEP 2: Calculate meal times from schedule:
- First meal: at the START of their day (7am off work = eat at 7:00am, not 7:30am)
  → If morning walk/workout AFTER start: eat BEFORE the activity
  → "get off at 7am, walk before work at 9am" = eat at 7:00am, walk 8:00am
  → Label: "Breakfast — 7:00am (fuel up after your shift, before your walk)"
- Lunch: ~4-5hrs after first meal
  → Label: "Lunch — 12:00pm"
- Pre-event meal: 2-2.5hrs before physical event
  → "hockey at 7:00pm" = eat at 4:30-5:00pm
  → Label: "Dinner — 4:30pm (2.5hrs before your 7pm games)"
- Pre-game snack: 45-60min before event
  → Label: "Snack — 6:00pm (1hr before puck drop)"
- Post-event recovery: NEVER a specific time
  → Label: "Snack — right after your second game"
STEP 3: Every meal block title includes the time AND context:
WRONG: "Breakfast"
RIGHT: "Breakfast — 7:00am (fuel up after your shift)"
WRONG: "Snack"
RIGHT: "Snack — 6:00pm (1hr before puck drop)"
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
${imageCount === 1 ? `SINGLE LABEL / MENU:
IF it's a NUTRITION LABEL:
1. Read ALL values EXACTLY from the label: calories, protein, carbs, fat, serving size
2. ONLY use what you can read on the label — NEVER use your own estimates
3. Report clearly: "Got it — [Product name]: Calories X | Protein Xg | Carbs Xg | Fat Xg | Serving size: X"
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
   EXCEPTION: skip asking if user said "whole bag", "all of it", "I ate this" with clear single-serving intent
5. NEVER use whole-bag totals as the per-serving macros
Meal block from label MUST use PER-SERVING values + correct servings count:
WRONG (ate whole bag of 3 servings):
- Foods: Fitzels, 1 bag
- Calories: 370 ← wrong, this is whole bag total
- Servings: 1 ← wrong
RIGHT (ate whole bag of 3 servings):
- Foods: Fitzels, 1 serving
- Calories: 120 ← per serving value
- Protein: 5g ← per serving value
- Carbs: 19g ← per serving value
- Fat: 4g ← per serving value
- Servings: 3 ← actual servings consumed (dashboard calculates 120 × 3 = 360 cal)
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
2. Based on ${userName}'s remaining macros today:
   Remaining: ${remaining.calories} cal | ${remaining.protein}g protein | ${remaining.carbs}g carbs | ${remaining.fat}g fat
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
Key words that signal unhealthy: "crunchy" = fried, "spicy mayo" = heavy sauce, "cream cheese" = high fat
4. End with one specific ordering tip: portion size, what to skip, or what to ask for
5. Always add: "Note: these are estimates based on typical restaurant portions — actual macros will vary"
6. End with: "Let me know which one you pick and I'll log it for you"
NEVER give generic advice like "lean proteins are good choices" — always name the specific items.
` : `MULTIPLE LABELS — COMPARISON MODE (${imageCount} labels):
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
7. Declare a winner with clear reasoning — which fits best for their goals at the portion they plan to eat.
8. End with: "Want me to log the winner? And did you eat it or saving for later?"`}
NEVER make up macro numbers. Only report what you can clearly read on the label.`;
    }

    const conversationMessages = [{ role: "system", content: systemMessage }];
    if (history?.length > 0) {
      for (const msg of history.slice(-10)) {
        if (msg.role && msg.content) conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }

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

    console.log(`=== AI | ${userName} | ${hour}:00 | Goal: ${goal.calories} cal | Photos: ${images?.length || 0} ===`);
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