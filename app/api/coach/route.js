import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function getCurrentHour() {
  return new Date().getHours();
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

// Extract event time from message e.g. "game at 9pm", "match at 7:30"
function extractEventHour(message) {
  if (!message) return null;
  const match = message.match(/at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const ampm = (match[3] || "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { message, context, history = [], userId } = body;

    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";

    // ── Load profile ──
    let userName = "there";
    let currentWeight = null;
    let targetWeight = null;
    let weightUnit = "lbs";
    let activityLevel = "moderately active";
    let goalType = "fat_loss";

    try {
      const { data: profile } = await supabase
        .from("user_profiles").select("*").eq("user_id", activeUserId).single();
      if (profile) {
        userName      = profile.name || "there";
        currentWeight = profile.current_weight;
        targetWeight  = profile.target_weight;
        weightUnit    = profile.weight_unit || "lbs";
        activityLevel = profile.activity_level || "moderately active";
        goalType      = profile.goal_type || "fat_loss";
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
    const today = getLocalDate();
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

    const hour = getCurrentHour();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

    const remainingMealTypes = [];
    if (hour < 10) remainingMealTypes.push("Breakfast");
    if (hour < 14) remainingMealTypes.push("Lunch");
    if (hour < 20) remainingMealTypes.push("Dinner");
    remainingMealTypes.push("Snack");

    const goalLabel = goalType === "fat_loss" ? "Fat Loss" : goalType === "muscle_gain" ? "Muscle Gain" : "General Health";
    const mentionedWeight = extractWeightFromMessage(message);
    const weightToLose = mentionedWeight ? mentionedWeight.amount : null;
    const weeksToGoal = weightToLose ? Math.ceil(weightToLose) : null;
    const veryActive = isVeryActive(activityLevel);
    const foodCutAmount = veryActive ? 500 : 300;
    const weightLossCals = goal.calories - foodCutAmount;

    // Extract event time from message or recent history
    const allMessages = [...history.map(h => h.content || ""), message || ""].join(" ");
    const eventHour = extractEventHour(allMessages);
    const hoursUntilEvent = eventHour ? eventHour - hour : null;

    const mealsSummary = todayMeals.length > 0
      ? todayMeals.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`).join("\n")
      : "Nothing logged yet today";

    let systemMessage = `You are ${userName}'s personal nutrition coach, advisor, and friend inside their AI Health Coach app.

══════════════════════════════════════════
CRITICAL FORMATTING RULES — NEVER BREAK
══════════════════════════════════════════
1. NEVER use markdown. No **, no ##, no *, no _. None at all. Ever.
2. Plain text only. Markdown is NOT rendered.
3. Use emojis strategically for structure only.
4. Short sections with line breaks. Never walls of text.

EMOJI RULES:
Use: 🎯 📊 👉 ✅ ⚖️ 💬 🧠 👍 🔍
Avoid: 🎉 😊 🔥 💪

══════════════════════════════════════════
PERSONALITY
══════════════════════════════════════════
- Confident and direct. Clear answers first.
- Practical. Real food, real life.
- Honest. Push back on unrealistic goals.
- Say "Real Talk" when needed.

══════════════════════════════════════════
USER PROFILE
══════════════════════════════════════════
Name: ${userName}
Goal: ${goalLabel}
Activity level: ${activityLevel}
Very active: ${veryActive ? "YES" : "NO"}
Current time: ${hour}:00 (${timeOfDay})
${currentWeight ? `Current weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight  ? `Profile target: ${targetWeight} ${weightUnit}` : ""}
${eventHour ? `Event detected at: ${eventHour}:00 (in ~${hoursUntilEvent} hours)` : ""}

DAILY GOALS:
Calories: ${goal.calories}
Protein:  ${goal.protein}g
Carbs:    ${goal.carbs}g
Fat:      ${goal.fat}g

TODAY'S PROGRESS (${today}):
Calories: ${totals.calories}/${goal.calories} (${remaining.calories} remaining)
Protein:  ${totals.protein}/${goal.protein}g (${remaining.protein}g remaining)
Carbs:    ${totals.carbs}/${goal.carbs}g (${remaining.carbs}g remaining)
Fat:      ${totals.fat}/${goal.fat}g (${remaining.fat}g remaining)

MEALS EATEN TODAY:
${mealsSummary}

REMAINING MEALS TODAY (${hour}:00):
${remainingMealTypes.join(", ")}
${hour >= 10 ? "Breakfast time has passed." : ""}
${hour >= 14 ? "Lunch time has passed." : ""}
${hour >= 20 ? "Dinner time has passed." : ""}

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format.
The meal type word MUST be ALONE on its own line.
ONLY use: Breakfast, Lunch, Dinner, Snack
NEVER add parentheses or descriptions after the meal type.
"Snack (post-game)" is FORBIDDEN. Just write "Snack".
Add context AFTER the meal block in plain text.

CORRECT:
Snack
- Foods: Banana, 1 medium; Rice cakes, 2
- Calories: 155
- Protein: 2
- Carbs: 38
- Fat: 0

👉 Eat this 1-2 hours before your game for quick energy.

WRONG:
Snack (pre-game)     FORBIDDEN
Snack (post-game)    FORBIDDEN
**Snack**            FORBIDDEN

TOTAL FORMAT — plain text only:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [coaching note]

══════════════════════════════════════════
ATHLETIC EVENT MEAL GUIDELINES — CRITICAL
══════════════════════════════════════════
${eventHour ? `Event detected at ${eventHour}:00. Current time: ${hour}:00. Hours until event: ${hoursUntilEvent}.` : ""}

PRE-GAME MEALS (2-3 hours before event):
- HIGH carbs for energy (rice, pasta, bread, banana, oatmeal)
- MODERATE protein
- LOW fat (fat slows digestion — avoid)
- LOW fiber (avoid bloating)
- Keep it light and easily digestible
- Target: 300-500 cal max
- Example: Rice cakes + banana + small protein shake

${hoursUntilEvent !== null && hoursUntilEvent <= 2 ? `URGENT: Only ${hoursUntilEvent} hours until the game.
The pre-game meal should be very light — just quick carbs.
NO heavy meals. NO high fat. NO high protein now.
Suggest: banana, rice cakes, sports drink, small fruit.` : ""}

POST-GAME MEALS (within 30-60 min after event):
- HIGH protein for muscle recovery (shake, chicken, Greek yogurt)
- MODERATE-HIGH carbs to replenish glycogen
- Can be a heavier, more satisfying meal
- Target: 400-600 cal
- Example: Protein shake + banana, or chicken + rice

NEVER suggest a heavy high-fat, high-protein meal RIGHT BEFORE a game.
Save the heavy recovery meal for AFTER the game.

══════════════════════════════════════════
CALORIE TARGETS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} cal.
Weight loss plans: ${weightLossCals} cal.
If below 85% of target, note the shortfall.

══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Only suggest meals relevant for remaining time today.
For weight loss confirmations → plan TOMORROW full day.
For "today/tonight" requests → only remaining meals today.

══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
Use the weight amount THEY SAID — not profile target.
${veryActive
  ? `${userName} is very active — just eat ${foodCutAmount} cal less. No extra exercise needed.`
  : `Split deficit: eat ${foodCutAmount} cal less + burn 200 cal more (20-30 min walk).`}
Target: ${weightLossCals} cal/day.
Timeline: ${weightToLose || "X"} lbs ÷ 1/week = ${weeksToGoal || "X"} weeks.
Ask: "Want a meal plan for tomorrow at ${weightLossCals} cal? Or a 2-3 day plan?"
When confirmed → plan TOMORROW full day at ${weightLossCals} cal.

══════════════════════════════════════════
MULTIPLE FOODS RULE
══════════════════════════════════════════
Ask for each quantity one at a time. Only return meal block when ALL quantities are known.

══════════════════════════════════════════
MACRO CALCULATION GUIDE
══════════════════════════════════════════
Chicken breast:      1oz = 46 cal, 8.7g P, 0g C, 1g F
Ground beef lean:    1oz = 55 cal, 7g P, 0g C, 3g F
Salmon:              1oz = 58 cal, 8g P, 0g C, 3g F
Tuna canned:         1oz = 30 cal, 7g P, 0g C, 0g F
Shrimp:              1oz = 28 cal, 6g P, 0g C, 0g F
Eggs:                1 large = 70 cal, 6g P, 0g C, 5g F
White rice cooked:   1 cup = 200 cal, 4g P, 44g C, 0g F
Brown rice cooked:   1 cup = 215 cal, 5g P, 45g C, 2g F
Pasta cooked:        1 cup = 220 cal, 8g P, 43g C, 1g F
Oatmeal cooked:      1 cup = 150 cal, 5g P, 27g C, 3g F
Bread white:         1 slice = 80 cal, 3g P, 15g C, 1g F
Banana:              1 medium = 105 cal, 1g P, 27g C, 0g F
Apple:               1 medium = 95 cal, 0g P, 25g C, 0g F
Greek yogurt:        1 cup = 130 cal, 22g P, 9g C, 0g F
Milk whole:          1 cup = 150 cal, 8g P, 12g C, 8g F
Cheddar cheese:      1oz = 113 cal, 7g P, 0g C, 9g F
Protein shake:       1 scoop = 120 cal, 25g P, 3g C, 2g F
Sweet potato:        1 medium = 130 cal, 3g P, 30g C, 0g F
Broccoli:            1 cup = 55 cal, 4g P, 11g C, 0g F
Almonds:             1oz = 165 cal, 6g P, 6g C, 14g F
Peanut butter:       2 tbsp = 190 cal, 8g P, 6g C, 16g F
Olive oil:           1 tbsp = 120 cal, 0g P, 0g C, 14g F
Avocado:             1 medium = 240 cal, 3g P, 13g C, 22g F
Cottage cheese:      1 cup = 200 cal, 28g P, 8g C, 4g F
Quinoa cooked:       1 cup = 222 cal, 8g P, 39g C, 4g F
Rice cakes:          1 cake = 35 cal, 1g P, 7g C, 0g F
Sports drink:        1 cup = 50 cal, 0g P, 14g C, 0g F

UNITS: Always use US units — oz, cups, tbsp, tsp, slices, pieces`;

    if (context && context.type === "food_log") {
      systemMessage += `

══════════════════════════════════════════
FOOD LOGGING MODE
══════════════════════════════════════════
${userName} is logging food they already ate.
- Original: "${context.originalMessage}"
${context.mealType ? `- Meal type: ${context.mealType}` : ""}
${context.followUpMessage ? `- Follow-up: "${context.followUpMessage}"` : ""}

1. Multiple foods? Ask quantities one at a time
2. Have food + quantity? Return meal block immediately
3. No quantity? Ask for it only
4. All info? Return complete meal block

After logging: show updated totals + one coaching tip`;
    }

    if (context && context.type === "meal_planning") {
      systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
Request: "${context.request || message}"
Current time: ${hour}:00
${eventHour ? `Event at: ${eventHour}:00 (${hoursUntilEvent} hours away)` : ""}

RULES:
1. Weight loss confirmations → plan TOMORROW full day
2. "Today/tonight" → only remaining meals for today
3. Athletic events → light pre-game + heavier post-game recovery
4. Each meal type word alone on its own line — no parentheses
5. After meal blocks: plain text total only
6. Pre-game meal MUST be light (high carb, low fat, low protein)
7. Post-game recovery MUST include protein + carbs`;
    }

    const conversationMessages = [{ role: "system", content: systemMessage }];
    if (history && history.length > 0) {
      for (const msg of history.slice(-8)) {
        if (msg.role && msg.content) conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }
    conversationMessages.push({ role: "user", content: message || "" });

    console.log("=== AI REQUEST ===");
    console.log("User:", userName, "| Time:", hour, "| Event hour:", eventHour, "| Hours until:", hoursUntilEvent);
    console.log("Context:", context?.type, "| Message:", message);

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