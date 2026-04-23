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
  const p1 = /(\d+\.?\d*)\s*(oz|lb|lbs|g|kg|cup|cups|tbsp|tsp|ml|fl oz|piece|pieces|slice|slices|scoop|scoops)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi;
  const p2 = /(\d+\.?\d*)\s+(?:of\s+)?([a-z][a-z\s]+?)(?:\s*[,;]|$)/gi;
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
    results.push({ food: food.name, amount: item.amount, unit: item.unit, grams: Math.round(grams), ...macros, source: 'usda_db' });
  }
  return results.length > 0 ? results : null;
}

function classifyEventType(text) {
  const lower = text.toLowerCase();
  if (/hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket/.test(lower)) return "sport";
  if (/gym|workout|training|crossfit|weightlift|lifting|exercise|run|running|cycling|swim|yoga|pilates|hiit|cardio/.test(lower)) return "workout";
  if (/hike|hiking|bike ride|marathon|race|triathlon|spartan|10k|5k|half marathon|full marathon/.test(lower)) return "endurance";
  if (/dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala/.test(lower)) return "social_dining";
  if (/drinks|bar|cocktail|wine|beer|happy hour/.test(lower)) return "social_drinks";
  if (/bbq|barbecue|cookout|potluck|picnic/.test(lower)) return "social_food";
  if (/long day|work event|conference|meeting|presentation|interview|all.?day/.test(lower)) return "work";
  if (/travel|flight|airport|long drive|road trip/.test(lower)) return "travel";
  return null;
}

function isPhysicalEvent(type) { return ["sport", "workout", "endurance"].includes(type); }
function isSocialEvent(type) { return ["social_dining", "social_drinks", "social_food"].includes(type); }

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
      events.push({ type, hour: h, label: eventText.trim(), isTomorrow: lower.includes("tomorrow") });
    }
  }
  const re2 = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon)\b)/gi;
  while ((match = re2.exec(lower)) !== null) {
    const h = parseHour(match[1], match[3]);
    const type = classifyEventType(match[4]);
    if (type && h >= 0 && h <= 23) {
      if (!events.find(e => e.hour === h && e.type === type)) {
        events.push({ type, hour: h, label: match[4].trim(), isTomorrow: lower.includes("tomorrow") });
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
      if (event.hour <= 8) preEventAdvice = "30-60 minutes before OR eat after: light snack (banana, toast) 200-250 cal";
      else if (event.hour <= 12) preEventAdvice = "1-2 hours before: light snack — HIGH carbs, LOW fat";
      else preEventAdvice = "2-3 hours before: pre-event Snack — HIGH carbs, LOW fat, easy to digest (300-400 cal)";
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
${prevEvent && isPhysicalEvent(prevEvent.type) ? `- Follows physical event at ${prevEvent.hour}:00` : ""}
- DO NOT create a meal block for this event — unknown menu
- Budget approximately ${eventCalBudget} cal for this event — state this in plain text
`;
    }
  });
  strategy += `
MEAL BLOCK STRUCTURE FOR THIS DAY:
Only create blocks for meals YOU control. For social dining: plain text guidance only, NO meal block.
Total planned meals should add up to 85-95% of ${goal.calories} cal.
`;
  return strategy;
}

function isRestaurantOrPartyMeal(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /dinner party|dinner date|restaurant|going out|eating out|party|wedding|birthday|someone'?s (place|house|home)|their place|her place|his place/.test(lower);
}

// Detect cuisine meals that imply unknown menu (e.g. "sushi lunch")
function hasCuisineMeal(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(sushi|ramen|pho|thai|italian|mexican|chinese|japanese|korean|indian|greek|mediterranean|french|tapas|dim sum|hibachi)\s*(lunch|dinner|brunch|restaurant|place|spot)\b/.test(lower)
    || /\b(lunch|dinner|brunch)\b.{0,20}\b(sushi|ramen|pho|thai|italian|mexican|chinese|japanese|korean|indian)\b/.test(lower)
    || /\bhave\s+(sushi|ramen|pho|thai food|italian|mexican food|chinese|japanese food|korean food|indian food)\b/.test(lower);
}

function getUnloggedMealPrompt(hour, nothingLogged) {
  if (!nothingLogged) return null;
  if (hour >= 7 && hour < 11) return "It's morning and nothing is logged yet. Ask: 'Have you had breakfast yet?'";
  if (hour >= 11 && hour < 14) return "It's lunchtime and nothing is logged. Ask: 'Have you eaten anything today yet?'";
  if (hour >= 14 && hour < 18) return "It's afternoon and nothing is logged. Ask: 'Have you eaten today yet?'";
  if (hour >= 18) return "It's evening and nothing is logged. Ask: 'What have you eaten so far today?'";
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { message, context, history = [], userId, localHour, localDate: clientDate, images } = body;
    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";
    const hour = typeof localHour === "number" ? localHour : new Date().getHours();
    const today = getLocalDate(clientDate);

    // ── Load profile ──
    let userName = "there", currentWeight = null, targetWeight = null;
    let weightUnit = "lbs", activityLevel = "moderately active", goalType = "fat_loss";
    let healthConditions = "";
    try {
      const { data: profile } = await supabase.from("user_profiles").select("*").eq("user_id", activeUserId).single();
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
      const { data: g } = await supabase.from("goals").select("*").eq("user_id", activeUserId).single();
      if (g) goal = { calories: g.calories||2200, protein: g.protein||180, carbs: g.carbs||220, fat: g.fat||70 };
    } catch (e) { console.log("Goals error:", e.message); }

    // ── Load today's meals ──
    let todayMeals = [];
    try {
      const { data: meals } = await supabase.from("actual_meals").select("*").eq("user_id", activeUserId).eq("date", today);
      todayMeals = meals || [];
    } catch (e) { console.log("Meals error:", e.message); }

    // ── Load today's planned meals ──
    let todayPlanned = [];
    try {
      const { data: planned } = await supabase.from("planned_meals").select("*").eq("user_id", activeUserId).eq("date", today);
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

    // ── DB Food Lookup ──
    let dbFoodResults = null;
    if (context?.type === "food_log") {
      const lookupMsg = context.followUpMessage || context.originalMessage || message;
      dbFoodResults = await lookupFoodMacros(lookupMsg);
      if (dbFoodResults) {
        console.log(`=== DB FOOD LOOKUP: found ${dbFoodResults.length} food(s) ===`);
      } else {
        console.log("=== DB FOOD LOOKUP: no match — AI will estimate ===");
      }
    }

    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const nothingEatenYet = todayMeals.length === 0;
    const unloggedPrompt = getUnloggedMealPrompt(hour, nothingEatenYet);
    const allText = [...history.map(h => h.content || ""), message || ""].join(" ");

    const events = extractAllEvents(allText);
    const hasMultipleEvents = events.length > 1;
    const hasAnyEvent = events.length > 0;
    const hasPhysicalEvents = events.some(e => isPhysicalEvent(e.type));
    const hasRestaurantMeal = isRestaurantOrPartyMeal(allText);
    const hasCuisineAtMeal = hasCuisineMeal(allText);
    const missingEventTimes = eventsMissingTimes(allText);

    const primaryEvent = events[0] || null;
    const eventType = primaryEvent?.type || null;
    const eventHour = primaryEvent?.hour || null;
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
Ask them: "What time is each event? I need the times to plan your meals properly."
Do NOT guess or plan without times. Just ask.`;
    } else if (hasMultipleEvents) {
      eventStrategy = buildMultiEventStrategy(events, hour, goal);
    } else if (hasRestaurantMeal && !hasPhysicalEvents) {
      eventStrategy = `
RESTAURANT / UNKNOWN MENU STRATEGY — MANDATORY:
You DO NOT know the menu. You CANNOT guess what they will eat.
1. Create meal blocks ONLY for meals BEFORE the event
2. Do NOT create a Dinner block. Not even an estimate.
3. After the pre-event meal blocks, write plain text guidance only
4. Budget ${Math.round(goal.calories * 0.45)}-${Math.round(goal.calories * 0.5)} cal for the event`;
    } else if ((hasEventToday || hasTomorrowEvent) && eventType) {
      if (["sport", "workout", "endurance"].includes(eventType)) {
        eventStrategy = `
PHYSICAL EVENT STRATEGY (${eventType} at ${eventHour !== null ? eventHour + ":00" : "scheduled time"}):
Aim for 85-95% of the ${goal.calories} calorie target.
Include pre-event snack (high carbs, low fat) and post-event Dinner for recovery — MANDATORY.
Total across all meals should reach ${goal.calories} cal.`;
      } else if (eventType === "work") {
        eventStrategy = `LONG WORK DAY: Steady energy — complex carbs + protein at each meal. Light afternoon snack.`;
      }
    }

    let systemMessage = `STOP — READ THIS FIRST — NO MARKDOWN EVER
══════════════════════════════════════════
NEVER use ** or ## or * or _ or any markdown. EVER. In ANY response.
Write plain text only. Markdown breaks the app display.
WRONG: **Breakfast — 7:30am** RIGHT: Breakfast — 7:30am
THE MEAL BLOCK HEADER MUST BE EXACTLY: [MealType] — [Time] ([context])
NO asterisks. NO bold. NO ##. The meal type word ALONE starts the line.
══════════════════════════════════════════
You are ${userName}'s personal AI nutrition coach, health advisor, and supportive friend.
══════════════════════════════════════════
FORMATTING RULES
══════════════════════════════════════════
1. Plain text only — NO markdown
2. Emojis for structure only: 🎯 📊 👉 ✅ ⚖️ 💬 🧠 👍 🔍
3. Avoid: 🎉 😊 🔥 💪
══════════════════════════════════════════
PERSONALITY
══════════════════════════════════════════
- Like a knowledgeable friend — confident, direct, honest, specific
- Never generic — "eat healthy" or "stay hydrated" is not coaching
══════════════════════════════════════════
TIME-AWARE TONE — CRITICAL
══════════════════════════════════════════
Current local time: ${hour}:00 (${timeOfDay})
NEVER use meal-specific farewells that contradict the time of day.
WRONG at 10pm: "Enjoy your lunch!" or "Have a great breakfast!"
WRONG at 8am: "Enjoy your dinner tonight!"
RIGHT: Use neutral closings like "Let me know if you need anything else."
Never mention a specific meal in your closing unless it matches the actual time of day.
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
CRITICAL CALORIE RULE
══════════════════════════════════════════
${userName}'s daily calorie target is ${goal.calories}. SET BY THE USER. Final. Do not change it.
Do NOT invent a different number. Do NOT apply your own deficit.
When telling the user how many calories they have left, ALWAYS calculate from ${goal.calories}.
TODAY'S INTAKE (${today}):
Calories: ${totals.calories}/${goal.calories} (${Math.round((totals.calories/goal.calories)*100)}%)
Protein: ${totals.protein}/${goal.protein}g
Carbs: ${totals.carbs}/${goal.carbs}g
Fat: ${totals.fat}/${goal.fat}g
MEALS LOGGED TODAY:
${mealsSummary}
PLANNED MEALS TODAY:
${plannedSummary}
${hasPlannedMeals ? `
PLANNED MEALS ALREADY EXIST (${todayPlanned.length} meals: ${plannedTypes.join(", ")}):
- Do NOT re-generate these meals
- If user confirms → acknowledge, do NOT create new meal blocks
- If user asks to change something specific → make ONLY that change
` : ""}
${events.length > 0 ? `📅 EVENTS DETECTED:
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 ${e.isTomorrow ? "(tomorrow)" : "(today)"} — ${e.label}`).join("\n")}` : ""}
${hasRestaurantMeal ? "🍽️ RESTAURANT/PARTY MEAL DETECTED" : ""}
${hasCuisineAtMeal ? "🍣 CUISINE MEAL DETECTED — treat as unknown menu (see CUISINE MEAL RULE)" : ""}
══════════════════════════════════════════
CRITICAL: ASK BEFORE ASSUMING
══════════════════════════════════════════
${hasTomorrowEvent || (message || "").toLowerCase().includes("tomorrow") ? `
PLANNING FOR TOMORROW — do NOT ask about today's meals. Just plan the full day for tomorrow.
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
ONLY ask for clarification if the message is truly ambiguous with NO food or nutrition context.
NEVER ask if the message contains meal words, macro words, planning words, or logging words.
${hasRestaurantMeal ? `══════════════════════════════════════════
RESTAURANT / PARTY MEALS — CRITICAL
══════════════════════════════════════════
- DO NOT create a Dinner block — you don't know the menu
- Plan only meals BEFORE the event
- Give plain text guidance and calorie budget for the event meal
- No meal block for the event itself` : ""}
${hasCuisineAtMeal ? `══════════════════════════════════════════
CUISINE MEAL RULE — MANDATORY
══════════════════════════════════════════
The user mentioned eating a specific cuisine (sushi, Italian, Thai, etc.) for a meal.
This is an UNKNOWN MENU — you do NOT know what they will order.
1. Do NOT create a meal block for this meal — no invented macros
2. After any other meal blocks, give plain text ordering guidance for that cuisine:
   "For the sushi lunch — I don't know the exact menu. Here's what to look for:
   - Sashimi and nigiri first — lean protein, no heavy sauce
   - 1-2 rolls max — avoid spicy mayo and cream cheese rolls
   - Skip tempura and fried options
   Snap a photo of the menu when you get there and I'll help you pick."
3. State the calorie budget: "Budget around X-Y cal for this meal."
4. Do NOT guess the macros. Do NOT create a Lunch/Dinner block for this meal.` : ""}
══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format. Meal type word ALONE on its own line.
ALLOWED MEAL TYPES: Breakfast, Lunch, Dinner, Snack
ONE PER TYPE: max 1 Breakfast, 1 Lunch, 1 Dinner. Snack can repeat.
POST-EVENT TIMING: NEVER guess a specific time after an event.
RIGHT: "Have this right after your workout" / "Have this right after your game"
══════════════════════════════════════════
CONFIRM PROMPT — NON-NEGOTIABLE
══════════════════════════════════════════
EVERY meal plan MUST end with this EXACT line, word for word, as the very last line:
Reply "yes" to save this plan, or let me know if you'd like to change anything.

Do NOT replace this with any other wording. Not "Let me know if you want to adjust!"
Not "Hope this helps!" Not any variation. The exact phrase above. Always. No exceptions.
══════════════════════════════════════════
TOTAL LINE — CRITICAL
══════════════════════════════════════════
After all meal blocks, write ONE total line. Calculate only the meals in THIS response.
Do NOT include already-eaten calories. Do NOT include meals from previous messages.

Write ONLY:
📊 Total planned: [TOTAL]/${goal.calories} cal ([pct]%) | [P]g protein | [C]g carbs | [F]g fat

NEVER show calculation working. NEVER write:
- "Step 1:" / "Step 2:" / "TOTAL CALCULATION:"
- "Breakfast: X cal, Lunch: X cal" breakdown lists
- "X + X + X = TOTAL" math
Just calculate silently and write the single line above.

Coaching reference only (never add to plan total): ${userName} has eaten ${totals.calories} cal today, ${remaining.calories} cal remaining toward ${goal.calories} goal.
══════════════════════════════════════════
CALORIE TARGETS FOR MEAL PLANS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${goal.calories} cal.
${isWeightLossConversation ? `Weight loss plan: ${weightLossCals} cal.` : ""}
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal.
Over-budget by 1-10%: mention casually. Only suggest adjustments if over 15%+.
══════════════════════════════════════════
MEAL SWAP / REPLACE RULE
══════════════════════════════════════════
If user rejects a suggestion: acknowledge briefly, swap, use same format, no clarifying question.
If user CONFIRMS: respond warmly, end with "Ready to add it to your plan?", no new meal block.
══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
${hour < 10 ? "All meals available: Breakfast, Lunch, Snack, Dinner" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner." : ""}
${hour >= 14 && hour < 17 ? "Available: Snack, Dinner only." : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack only." : ""}
${hour >= 20 ? "Available: Snack only." : ""}
══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
${isWeightLossConversation ? `Use weight amount THEY SAID. Push back if unrealistic (max 2 lbs/week).
${veryActive ? `Very active — reduce food by ${foodCutAmount} cal. New target: ${weightLossCals} cal/day.` : `Split: eat ${foodCutAmount} cal less + burn 200 more. New target: ${weightLossCals} cal/day.`}
${weightToLose ? `Timeline: ${weightToLose} lbs ÷ 1/week = ${weeksToGoal} weeks.` : ""}
Ask: "Want a meal plan for tomorrow at ${weightLossCals} cal?"
When confirmed → plan TOMORROW at ${weightLossCals} cal, full day.` : `Respond to weight questions directly.`}
══════════════════════════════════════════
MULTI-FOOD LOGGING
══════════════════════════════════════════
Ask for each food quantity one at a time. Only return meal block when ALL quantities are known.
══════════════════════════════════════════
MACRO REFERENCE
══════════════════════════════════════════
Chicken breast: 1oz = 46 cal, 8.7g P, 0g C, 1g F
Ground beef lean: 1oz = 55 cal, 7g P, 0g C, 3g F
Salmon: 1oz = 58 cal, 8g P, 0g C, 3g F
Tuna canned: 1oz = 30 cal, 7g P, 0g C, 0g F
Turkey breast: 1oz = 35 cal, 7g P, 0g C, 0.5g F
Eggs: 1 large = 70 cal, 6g P, 0g C, 5g F
Egg whites: 1 large = 17 cal, 4g P, 0g C, 0g F
White rice cooked: 1 cup = 200 cal, 4g P, 44g C, 0g F
Brown rice cooked: 1 cup = 215 cal, 5g P, 45g C, 2g F
Oatmeal cooked: 1 cup = 150 cal, 5g P, 27g C, 3g F
Sweet potato: 1 medium = 130 cal, 3g P, 30g C, 0g F
Banana: 1 medium = 105 cal, 1g P, 27g C, 0g F
Greek yogurt: 1 cup = 130 cal, 22g P, 9g C, 0g F
Cottage cheese: 1 cup = 200 cal, 28g P, 8g C, 4g F
Milk whole: 1 cup = 150 cal, 8g P, 12g C, 8g F
Protein shake: 1 scoop = 120 cal, 25g P, 3g C, 2g F
Broccoli: 1 cup = 55 cal, 4g P, 11g C, 0g F
Avocado: 1 medium = 240 cal, 3g P, 13g C, 22g F
Almonds: 1oz = 165 cal, 6g P, 6g C, 14g F
Peanut butter: 2 tbsp = 190 cal, 8g P, 6g C, 16g F
Rice cakes: 1 cake = 35 cal, 1g P, 7g C, 0g F
Quinoa cooked: 1 cup = 222 cal, 8g P, 39g C, 4g F
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
  NEVER skip logging because meal type is missing — always infer it.`}
${context.followUpMessage ? `Follow-up: "${context.followUpMessage}"` : ""}
${dbFoodResults ? `
DATABASE LOOKUP — USE THESE EXACT NUMBERS (from USDA):
${dbFoodResults.map(r => `${r.food} (${r.amount} ${r.unit} = ${r.grams}g):
  Calories: ${r.calories} | Protein: ${r.protein}g | Carbs: ${r.carbs}g | Fat: ${r.fat}g`).join("\n")}
CRITICAL: Use the numbers above EXACTLY. Do not recalculate or estimate.
` : `
RULE 1: NEVER ASK USER FOR CALORIES OR MACROS — YOU ARE THE EXPERT
Use your knowledge to estimate. Eggs = 70 cal each. Sushi roll = ~300-350 cal.
`}
RULE 2 — QUANTITY CHECK:
Valid quantities — never ask if any of these are present:
- Numbers: 2, 8, 0.5, 1.5 | Units: oz, lb, cup, tbsp, tsp, g, ml, pcs, pieces, slices
- Words: a, an, half, whole, one, two, three, medium, large, small, some
ONLY ask when there is truly NOTHING — bare food name with zero quantity descriptor.

MEAL BLOCK IS MANDATORY — CRITICAL:
You MUST always output a properly formatted meal block when logging food.
NEVER just describe macros conversationally without the block.
WRONG: "Got it! Calories: 25, Protein: 0g... I'll log this as a snack for you!"
RIGHT: Output the full meal block format FIRST, then your coaching note.
If you say "I'll log this" — you MUST include the meal block in the SAME response. No exceptions.

BEVERAGES: Log as Snack type. Label the food as "Drink: [product name]".
Example meal block for a drink: Foods: Drink: sparkling water, 1 can

ADDING TO EXISTING MEAL — CRITICAL:
When user says "I also had X", "add X to my breakfast" — ONLY log the NEW item.
Do NOT repeat or combine with the original meal. Do NOT create a combined block.
WRONG: User had eggs then says "I also had toast" →
  Breakfast - Foods: Eggs, 2 large; Toast, 1 slice ← WRONG, repeating original
RIGHT: User had eggs then says "I also had toast" →
  Breakfast - Foods: Toast, 1 slice ← CORRECT, new item only
The dashboard automatically sums all entries for the same meal type.

MEAL BLOCK FORMAT: Single total numbers only. No math shown.
WRONG: - Calories: 368 (chicken) + 130 (sweet potato) = 498
RIGHT: - Calories: 498
Always include "g" on protein, carbs, fat.
After the block, add Breakdown line for 2+ foods:
Breakdown: Food1 — X cal, Xg P, Xg C, Xg F | Food2 — X cal, Xg P, Xg C, Xg F

AFTER LOGGING — ALWAYS include:
1. The full properly formatted meal block
2. 📊 Updated totals: [sum]/${goal.calories} cal ([pct]%) | [sum]g P | [sum]g C | [sum]g F
3. 👉 One coaching tip
4. IF 300+ calories remaining: suggest a specific next meal or snack`;
    }

    if (context?.type === "meal_planning") {
      let timingGuide = "";
      if (events.length > 0) {
        const sortedEvents = [...events].sort((a, b) => a.hour - b.hour);
        sortedEvents.forEach((event) => {
          if (isPhysicalEvent(event.type)) {
            if (event.hour <= 8) {
              timingGuide += `\n${event.type.toUpperCase()} at ${event.hour}:00: light snack before OR fasted, post-workout Breakfast (no specific time).`;
            } else {
              timingGuide += `\n${event.type.toUpperCase()} at ${event.hour}:00: pre-event snack at ${event.hour - 2}:00, post-event recovery right after (no specific time).`;
            }
          } else if (isSocialEvent(event.type)) {
            timingGuide += `\nSOCIAL at ${event.hour}:00: keep prior meals light, budget ${Math.round(goal.calories * 0.4)}-${Math.round(goal.calories * 0.5)} cal, NO meal block for event.`;
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
${events.length > 0 ? `Events: ${events.map(e => `${e.type} at ${e.hour}:00`).join(", ")}` : ""}
${missingEventTimes && !hasAnyEvent ? "MISSING TIMES: Ask user what time each event is before planning." : ""}
${hasRestaurantMeal && !hasPhysicalEvents ? "Restaurant/social event — DO NOT create a Dinner block." : ""}
${hasCuisineAtMeal ? "CUISINE MEAL DETECTED — NO meal block for that meal. Plain text guidance only." : ""}
${timingGuide}

NO MARKDOWN — NEVER use ** or ## anywhere.
CALORIE FORMAT: single totals only. No math shown. No "X + Y = Z".
NO OPTIONS FORMAT: Never present Option A / Option B. Pick the best single plan.

RESPONSE STRUCTURE:
STEP 1 — BIG PICTURE STRATEGY (2-4 lines, specific to their day and events)

STEP 2 — MEAL BLOCKS (back to back, no coaching notes between blocks)
Format:
[MealType] — [Time] ([context])
- Foods: [food1, amount]; [food2, amount]
- Calories: [single number]
- Protein: [X]g
- Carbs: [X]g
- Fat: [X]g
Breakdown: [food1] — [cal] cal, [P]g P, [C]g C, [F]g F | [food2] — [cal] cal, [P]g P, [C]g C, [F]g F
(Breakdown line mandatory for 2+ foods)

For cuisine/restaurant meals: plain text ordering guidance only, NO meal block.

STEP 2.5 — TOTAL LINE (write ONLY this, no math working shown):
📊 Total planned: [TOTAL]/${goal.calories} cal ([pct]%) | [P]g protein | [C]g carbs | [F]g fat

STEP 3 — SIMPLE RULES (2-4 short rules specific to this day)

STEP 4 — CONFIRM PROMPT (EXACT WORDING, LAST LINE, MANDATORY):
Reply "yes" to save this plan, or let me know if you'd like to change anything.

TIMING:
- Pre-event snack: calculate exactly (7:30pm event, 30 min before = 7:00pm)
- Post-event: NEVER a specific time ("right after your game")
- Tomorrow plans: every block MUST have a time label

TOMORROW SCHEDULE READING:
"I get off at 7am" = night shift ending. First meal = 7:00am immediately.
Read context carefully. Do NOT assume they just woke up.

SNACK RULES: TWO snacks for athletic events (pre + post). Each gets own block.`;
    }

    if (context?.type === "photo" && images?.length > 0) {
      const photoIntent = context.photoIntent || "unknown";
      const imageCount = images.length;
      systemMessage += `
══════════════════════════════════════════
PHOTO MODE — ${imageCount} image(s) received
══════════════════════════════════════════
User message: "${context.message || "(no message)"}"
Intent: ${photoIntent} | Images: ${imageCount}

${imageCount === 1 ? `SINGLE LABEL / DRINK CAN / MENU:

IF NUTRITION LABEL OR DRINK:
STEP 1 — Always show this format first, no exceptions:
[Product name]
Per serving: [X] cal | [X]g protein | [X]g carbs | [X]g fat | Serving: [size]
Servings per container: [X] — full container = [X × servings] cal total

STEP 2 — If servings per container > 1, ALWAYS flag it clearly:
"This has [X] servings per container. If you eat the whole thing that's [total] cal, not [per serving] cal."

STEP 3 — Ask or log:
- If user said "I'm going to drink/eat this" → log immediately as Snack (or infer type from time)
- If intent unclear → ask: "Want me to log this or add it to your plan?"
- When user says "log it", "plan it", or "yes" → output a full meal block immediately

SERVINGS DEFAULT: Always default to 1 serving unless user said "whole bag", "all of it", etc.
MEAL BLOCK FORMAT FOR LABELS: Use per-serving macros. Set servings = how many they ate.
WRONG: Calories: 370 (whole bag), Servings: 1
RIGHT: Calories: 120 (per serving), Servings: 3 (dashboard shows 360 total)

BEVERAGES: Log as Snack type. Food field = "Drink: [product name]"

WHEN USER SAYS "log it" OR "plan it" OR "yes" AFTER SEEING LABEL INFO:
Output a FULL PROPER MEAL BLOCK immediately. No more questions. No more descriptions.
Use exact label values. Default 1 serving. Infer meal type from time.
Before 11am → Breakfast | 11-2pm → Lunch | 2-5pm → Snack | 5pm+ → Dinner

IF RESTAURANT MENU:
1. Read every item carefully
2. Remaining: ${remaining.calories} cal | ${remaining.protein}g P | ${remaining.carbs}g C | ${remaining.fat}g F
3. Name specific items — no generic advice
4. Structure: Best picks → Worth considering → Avoid (with specific reasons)
5. End: "Let me know which one you pick and I'll log it for you"
` : `MULTIPLE LABELS — COMPARISON MODE:
For EACH label show:
Label [N]: [name]
Per serving: [X] cal | [X]g P | [X]g C | [X]g F
Servings per container: [X] — full container = [X] cal total

Always flag multi-serving containers.
Ask: "Are you planning 1 serving or the full container?"
Remaining: ${remaining.calories} cal | ${remaining.protein}g P | ${remaining.carbs}g C | ${remaining.fat}g F
Declare a winner with clear reasoning.
End: "Want me to log the winner? And did you eat it or saving for later?"

WHEN USER PICKS A WINNER:
Output a FULL PROPER MEAL BLOCK immediately using per-serving macros. Default 1 serving.`}

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
        image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" },
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