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

// Determine if user is already very active based on profile
function isVeryActive(activityLevel) {
  const level = (activityLevel || "").toLowerCase();
  return level.includes("very") || level.includes("extra") || level.includes("athlete") || level.includes("high");
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
    const adjustedCals = goal.calories - 500; // full 500 from food for very active users
    const veryActive = isVeryActive(activityLevel);

    // For very active users, cut 500 from food (they already burn plenty)
    // For moderately active users, split 300 food + 200 exercise
    const foodCutAmount = veryActive ? 500 : 300;
    const exerciseBurnAmount = veryActive ? 0 : 200;
    const weightLossCals = goal.calories - foodCutAmount;

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
- Say "Real Talk" when something isn't possible.

══════════════════════════════════════════
USER PROFILE
══════════════════════════════════════════
Name: ${userName}
Goal: ${goalLabel}
Activity level: ${activityLevel}
Very active: ${veryActive ? "YES — already burns a lot, no need to add more exercise for deficit" : "NO — moderate activity"}
Current time: ${hour}:00 (${timeOfDay})
${currentWeight ? `Current weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight  ? `Profile target: ${targetWeight} ${weightUnit}` : ""}

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

REMAINING MEALS FOR TODAY (current time ${hour}:00):
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
NEVER add parentheses, descriptions, or labels after the meal type.
"Snack (post-game)" is FORBIDDEN. Just write "Snack".
"Snack (pre-game)" is FORBIDDEN. Just write "Snack".
Add context in the coaching text AFTER the meal block, not in the meal type line.

CORRECT:
Snack
- Foods: Protein shake, 1 scoop; Banana, 1 medium
- Calories: 225
- Protein: 26
- Carbs: 30
- Fat: 2

👉 Have this within 30 minutes after your game for recovery.

WRONG:
Snack (post-game)     FORBIDDEN
Snack (pre-game)      FORBIDDEN
**Snack**             FORBIDDEN

TOTAL FORMAT — plain text only:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [coaching note]

══════════════════════════════════════════
CALORIE TARGETS
══════════════════════════════════════════
Standard plans: aim for ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} cal.
Weight loss plans: use ${weightLossCals} cal (${foodCutAmount} cal less than goal).
If plan is below 85% of target, note the shortfall.
If ${userName} has already eaten ${totals.calories} cal, only plan remaining ${remaining.calories} cal.

══════════════════════════════════════════
TIME-AWARE MEAL PLANNING
══════════════════════════════════════════
Current time is ${hour}:00.
Only suggest meals still relevant for today.
For athletic events: plan meals leading up to AND a recovery Snack after.
IMPORTANT: For weight loss meal plans ("yes please", "create a plan"), 
default to planning TOMORROW'S full day (Breakfast + Lunch + Dinner + Snack)
unless the user specifically says "today" or "tonight".

══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
When user mentions wanting to lose a specific amount:
1. Use the weight amount THEY SAID — not profile target
2. Check if realistic (max 2 lbs/week safely)
3. Calculate deficit based on activity level:

${veryActive
  ? `${userName} is VERY ACTIVE — they already burn plenty through exercise.
   DO NOT suggest adding more exercise.
   Instead: just reduce food by ${foodCutAmount} cal/day → new target: ${weightLossCals} cal
   Say: "Since you're already very active, you don't need extra exercise. Just eat ${foodCutAmount} cal less per day."`
  : `${userName} is moderately active. Split the deficit:
   - Eat ${foodCutAmount} cal less per day → new target: ${weightLossCals} cal  
   - Burn ${exerciseBurnAmount} cal more per day (20-30 min walk)`}

4. Estimate timeline: ${weightToLose || "X"} lbs ÷ 1 lb/week = ${weeksToGoal || "X"} weeks
5. Ask: "Want me to create a meal plan for tomorrow based on your ${weightLossCals} cal target? Or a 2-3 day plan?"
6. When they confirm → plan TOMORROW at ${weightLossCals} cal, full day (Breakfast + Lunch + Dinner + Snack)

══════════════════════════════════════════
MULTIPLE FOODS RULE
══════════════════════════════════════════
Ask for each food quantity one at a time.
Only return meal block when you have ALL quantities.

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

UNITS: Always use US units — oz, cups, tbsp, tsp, slices, pieces`;

    // ── Food logging mode ──
    if (context && context.type === "food_log") {
      systemMessage += `

══════════════════════════════════════════
FOOD LOGGING MODE
══════════════════════════════════════════
${userName} is logging food they already ate.

Context:
- Original message: "${context.originalMessage}"
${context.mealType ? `- Meal type: ${context.mealType}` : "- Meal type: unknown"}
${context.followUpMessage ? `- Follow-up answer: "${context.followUpMessage}"` : ""}

DECISION TREE:
1. Multiple foods? Ask about each quantity one at a time
2. Single food + quantity? Return meal block immediately
3. Single food, no quantity? Ask for quantity only
4. All info? Return complete meal block

AFTER LOGGING:
📊 Today: X/${goal.calories} cal | protein update
👉 One coaching tip`;
    }

    // ── Meal planning mode ──
    if (context && context.type === "meal_planning") {
      systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
Request: "${context.request || message}"
Current time: ${hour}:00

PLANNING RULES:
1. For weight loss confirmations ("yes please", "sure", "create a plan") → plan TOMORROW full day
2. For "today" or "tonight" requests → only plan remaining meals for today
3. For athletic events → plan pre-event and post-event meals for today
4. Each meal type word MUST be alone on its own line — no parentheses ever
5. For weight loss plans: target ${weightLossCals} cal
6. For standard plans: target ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} cal
7. After meal blocks: show total as plain text only
8. Always include a post-event recovery Snack for athletic events

TOTAL FORMAT:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [one coaching note]`;
    }

    // ── Build conversation ──
    const conversationMessages = [{ role: "system", content: systemMessage }];
    if (history && history.length > 0) {
      for (const msg of history.slice(-8)) {
        if (msg.role && msg.content) {
          conversationMessages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    conversationMessages.push({ role: "user", content: message || "" });

    console.log("=== AI REQUEST ===");
    console.log("User:", userName, "| Activity:", activityLevel, "| VeryActive:", veryActive);
    console.log("Time:", hour, timeOfDay, "| Context:", context?.type);
    console.log("Weight mentioned:", mentionedWeight, "| Loss cals:", weightLossCals);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversationMessages,
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content;
    console.log("=== AI RESPONSE ===\n", reply);

    try {
      await supabase.from("ai_messages").insert([{
        user_id: activeUserId,
        message: message || "",
        response: reply,
        created_at: new Date().toISOString(),
      }]);
    } catch (e) { console.log("Could not save message:", e); }

    return Response.json({ reply });

  } catch (error) {
    console.error("AI ERROR:", error);
    return Response.json({ reply: "Something went wrong. Please try again." }, { status: 500 });
  }
}