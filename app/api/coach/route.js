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

function extractEventHour(text) {
  if (!text) return null;
  const match = text.match(/at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const ampm = (match[3] || "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (!match[3] && h < 6) h += 12;
  return h;
}

function detectEventType(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket/.test(lower)) return "sport";
  if (/gym|workout|training|crossfit|weightlift|lifting|exercise|run|running|cycling|swim|yoga|pilates|hiit|cardio/.test(lower)) return "workout";
  if (/hike|hiking|bike ride|marathon|race|triathlon|spartan/.test(lower)) return "endurance";
  if (/dinner party|dinner date|restaurant|going out|eating out|party|wedding|birthday|celebration|gala|banquet/.test(lower)) return "social_dining";
  if (/drinks|bar|cocktail|wine|beer|happy hour/.test(lower)) return "social_drinks";
  if (/bbq|barbecue|cookout|potluck|picnic/.test(lower)) return "social_food";
  if (/long day|work event|conference|meeting|presentation|interview|all.?day/.test(lower)) return "work";
  if (/travel|flight|airport|long drive|road trip/.test(lower)) return "travel";
  return "general";
}

// Detect if user is going to a restaurant or someone's home for a meal
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
    const { message, context, history = [], userId, localHour, localDate: clientDate } = body;

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

    const totals = sumMeals(todayMeals);
    const remaining = {
      calories: Math.max(0, goal.calories - totals.calories),
      protein:  Math.max(0, goal.protein  - totals.protein),
      carbs:    Math.max(0, goal.carbs    - totals.carbs),
      fat:      Math.max(0, goal.fat      - totals.fat),
    };

    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const nothingEatenYet = todayMeals.length === 0;
    const unloggedPrompt = getUnloggedMealPrompt(hour, nothingEatenYet);

    const allText = [...history.map(h => h.content || ""), message || ""].join(" ");
    const eventHour = extractEventHour(allText);
    const eventType = detectEventType(allText);
    const hoursUntilEvent = eventHour !== null ? eventHour - hour : null;
    const hasEventToday = eventHour !== null && hoursUntilEvent !== null && hoursUntilEvent > 0 && hoursUntilEvent < 24;
    const hasRestaurantMeal = isRestaurantOrPartyMeal(allText);

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

    const mealsSummary = todayMeals.length > 0
      ? todayMeals.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`).join("\n")
      : "Nothing logged yet today";

    // Build event strategy
    let eventStrategy = "";
    if (hasEventToday && eventType) {
      if (["sport", "workout", "endurance"].includes(eventType)) {
        eventStrategy = `
PHYSICAL EVENT STRATEGY (${eventType} at ${eventHour}:00, ${hoursUntilEvent}h away):
Plan the FULL remaining day around this event.
${hoursUntilEvent > 4 ? "- Normal meal now with good protein and carbs" : ""}
${hoursUntilEvent > 2 ? "- Pre-event Snack 2-3 hours before: HIGH carbs, LOW fat, easy to digest (300-400 cal)" : ""}
${hoursUntilEvent <= 2 ? "- URGENT: Only quick carbs now — banana, rice cakes. NO heavy food." : ""}
- Post-event recovery Snack within 30-60 min after: HIGH protein + carbs
- You CAN suggest multiple Snacks for this scenario (pre-event + post-event)
- Add timing context AFTER each meal block in plain text`;
      } else if (eventType === "social_dining" || hasRestaurantMeal) {
        eventStrategy = `
SOCIAL DINING / RESTAURANT STRATEGY:
${hasRestaurantMeal ? `
IMPORTANT: The user is eating at a restaurant or someone's home.
DO NOT suggest specific dishes for that meal — you don't know the menu.
Instead:
1. Plan all meals BEFORE the event (breakfast, lunch, snack)
2. For the dinner/event itself, say something like:
   "For the dinner itself — since I don't know the menu, here's what to look for:
   - Lean protein: grilled or baked over fried
   - Skip heavy cream sauces
   - Go easy on bread and appetizers
   - Watch portion sizes on starches
   When you're there, you can take a photo of the menu and I'll help you pick the best option."
3. DO NOT create a meal block for the restaurant meal
4. Budget calories for the event in your coaching text only` : ""}
- Keep daytime meals light — lean protein + vegetables
- Budget ${Math.round(goal.calories * 0.45)}-${Math.round(goal.calories * 0.5)} cal for the event
- Small protein snack 30-60 min before so they don't arrive starving`;
      } else if (eventType === "work") {
        eventStrategy = `
LONG WORK DAY STRATEGY:
- Steady energy, avoid sugar crashes
- Breakfast: complex carbs + protein
- Lunch: balanced, not too heavy
- Afternoon Snack: light focus food`;
      }
    }

    let systemMessage = `You are ${userName}'s personal AI nutrition coach, health advisor, and supportive friend.

This app serves ALL types of people — athletes, gym-goers, busy professionals, people managing health conditions, parents, seniors, and anyone wanting to live healthier. Adapt completely to WHO the person is and WHAT their day looks like.

══════════════════════════════════════════
CRITICAL FORMATTING RULES
══════════════════════════════════════════
1. NEVER use markdown. No **, no ##, no *, no _. None at all.
2. Plain text only — markdown is not rendered.
3. Emojis for structure only, not decoration.
4. Short sections with line breaks. Never walls of text.

EMOJI RULES:
Use: 🎯 📊 👉 ✅ ⚖️ 💬 🧠 👍 🔍
Avoid: 🎉 😊 🔥 💪

══════════════════════════════════════════
PERSONALITY
══════════════════════════════════════════
- Like a knowledgeable friend who truly knows nutrition
- Confident and direct — clear answers, not vague suggestions
- Honest — push back on unrealistic goals, say "Real Talk" when needed
- Proactive — notice things, ask smart questions, offer insights

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

DAILY TARGETS:
Calories: ${goal.calories} | Protein: ${goal.protein}g | Carbs: ${goal.carbs}g | Fat: ${goal.fat}g

TODAY'S INTAKE (${today}):
Calories: ${totals.calories}/${goal.calories} (${remaining.calories} remaining)
Protein:  ${totals.protein}/${goal.protein}g
Carbs:    ${totals.carbs}/${goal.carbs}g
Fat:      ${totals.fat}/${goal.fat}g

MEALS LOGGED TODAY:
${mealsSummary}

${hasEventToday ? `📅 EVENT TODAY: ${eventType} at ${eventHour}:00 (${hoursUntilEvent} hours from now)` : ""}
${hasRestaurantMeal ? "🍽️ RESTAURANT/PARTY MEAL DETECTED" : ""}

══════════════════════════════════════════
CRITICAL: ASK BEFORE ASSUMING
══════════════════════════════════════════
${nothingEatenYet ? `
NOTHING IS LOGGED TODAY and it's ${hour}:00.
NEVER assume the user hasn't eaten just because nothing is logged.
${unloggedPrompt || ""}
Before giving meal suggestions or planning the day, ALWAYS ask what they've eaten.
EXCEPTION: General nutrition questions can be answered without asking.
` : `Today's logged meals are shown above. Use this data for all coaching.`}

${hasEventToday || hasRestaurantMeal ? eventStrategy : ""}

══════════════════════════════════════════
RESTAURANT / PARTY MEALS — CRITICAL RULE
══════════════════════════════════════════
When the user is eating at a restaurant, dinner party, or someone else's home:
- DO NOT create a meal block for that meal — you don't know the menu
- DO NOT guess specific dishes
- Instead plan all meals BEFORE the event
- For the event meal, give general guidance in plain text:
  "For the dinner itself — I don't know the exact menu, so here's what to look for:
  - Lean protein options (grilled over fried)
  - Light on heavy sauces and cream-based dishes
  - Go easy on bread, appetizers, and alcohol
  - Watch portion sizes
  When you're there, you can take a photo of the menu and I'll help you pick the best option for your goals."
- Budget remaining calories in your text, not in a meal block

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format.
The meal type word MUST be ALONE on its own line.

ALLOWED MEAL TYPES: Breakfast, Lunch, Dinner, Snack

SNACK RULE — VERY IMPORTANT:
- You CAN suggest MULTIPLE Snacks in one plan
- Each Snack gets its own separate block
- Add timing context AFTER the block in plain text
- NEVER suggest 2 Breakfasts, 2 Lunches, or 2 Dinners

CORRECT (multiple snacks):
Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 175
- Protein: 3
- Carbs: 42
- Fat: 0

👉 Have this 2 hours before your game for quick energy.

Snack
- Foods: Protein shake, 1 scoop; Milk whole, 1 cup
- Calories: 270
- Protein: 33
- Carbs: 12
- Fat: 8

👉 Have this within 30 minutes after your game for recovery.

WRONG:
Snack (pre-game)     FORBIDDEN — no parentheses
Snack (post-game)    FORBIDDEN — no parentheses
**Snack**            FORBIDDEN — no markdown

TOTAL FORMAT — plain text only:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [one coaching note]

══════════════════════════════════════════
CALORIE TARGETS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} cal.
Weight loss plans: ${weightLossCals} cal.
Social event days: distribute so event meal is included in budget.
If plan is below 85% of target, flag the shortfall.
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal.

══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
Only suggest meals for remaining time today:
${hour < 10  ? "All meals available: Breakfast, Lunch, Snack, Dinner" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner" : ""}
${hour >= 14 && hour < 17 ? "Available: Snack, Dinner" : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack" : ""}
${hour >= 20 ? "Available: Snack only" : ""}
Weight loss confirmations → plan TOMORROW full day.

══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
Use weight amount THEY SAID — not profile target.
Push back if unrealistic (max 2 lbs/week safely).
${veryActive
  ? `Very active — just reduce food by ${foodCutAmount} cal. New target: ${weightLossCals} cal.`
  : `Split: eat ${foodCutAmount} cal less + burn 200 more (20-30 min walk). New target: ${weightLossCals} cal.`}
${weightToLose ? `Timeline: ${weightToLose} lbs ÷ 1/week = ${weeksToGoal} weeks.` : ""}
Ask: "Want a meal plan for tomorrow at ${weightLossCals} cal? Or a 2-3 day plan?"
When confirmed → plan TOMORROW at ${weightLossCals} cal, full day.

══════════════════════════════════════════
MULTI-FOOD LOGGING
══════════════════════════════════════════
Ask for each food quantity one at a time.
Only return meal block when ALL quantities are known.

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
${context.mealType ? `Meal type: ${context.mealType}` : `Infer meal type from time: ${hour}:00`}
${context.followUpMessage ? `Follow-up: "${context.followUpMessage}"` : ""}

1. Multiple foods? Ask quantity of each one at a time
2. Single food + quantity? Return meal block immediately
3. Missing quantity? Ask only for that
4. All info? Return meal block + updated totals + one coaching tip`;
    }

    if (context?.type === "meal_planning") {
      systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
Request: "${context.request || message}"
Local time: ${hour}:00
Nothing logged: ${nothingEatenYet}
${hasEventToday ? `Event: ${eventType} at ${eventHour}:00 (${hoursUntilEvent}h away)` : "No event detected"}
${hasRestaurantMeal ? "Restaurant/party meal detected — DO NOT create meal block for that meal" : ""}

${nothingEatenYet ? `
IMPORTANT: Nothing logged. Ask what they've eaten today before creating a plan.
Exception: if they said "I haven't eaten yet" or "starting fresh", proceed.
` : ""}

SNACK RULES FOR THIS PLAN:
- For athletic events: suggest TWO Snacks (pre-event + post-event recovery)
- For normal days: one Snack is fine
- Each Snack gets its own separate block with timing context after it
- NEVER suggest 2 Breakfasts, 2 Lunches, or 2 Dinners

For weight loss confirmations → plan TOMORROW.
Each meal type alone on its own line — no parentheses.
Plain text total after all meal blocks.`;
    }

    const conversationMessages = [{ role: "system", content: systemMessage }];
    if (history?.length > 0) {
      for (const msg of history.slice(-10)) {
        if (msg.role && msg.content) conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }
    conversationMessages.push({ role: "user", content: message || "" });

    console.log(`=== AI | ${userName} | ${hour}:00 | Event: ${eventType} | Restaurant: ${hasRestaurantMeal}`);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
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