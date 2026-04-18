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

// Extract weight amount mentioned in message e.g. "10 pounds", "5 lbs", "20 kg"
function extractWeightFromMessage(message) {
  if (!message) return null;
  const match = message.match(/(\d+)\s*(pounds?|lbs?|kg|kilograms?)/i);
  if (match) return { amount: parseInt(match[1]), unit: match[2].toLowerCase().startsWith("k") ? "kg" : "lbs" };
  return null;
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

    // Extract weight mentioned in message (use this instead of profile target)
    const mentionedWeight = extractWeightFromMessage(message);
    const weightToLose = mentionedWeight ? mentionedWeight.amount : (currentWeight && targetWeight ? Math.abs(currentWeight - targetWeight) : null);
    const weeksToGoal = weightToLose ? Math.ceil(weightToLose) : null;
    const adjustedCals = goal.calories - 300;

    const mealsSummary = todayMeals.length > 0
      ? todayMeals.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`).join("\n")
      : "Nothing logged yet today";

    let systemMessage = `You are ${userName}'s personal nutrition coach, advisor, and friend inside their AI Health Coach app.

══════════════════════════════════════════
CRITICAL FORMATTING RULES — NEVER BREAK
══════════════════════════════════════════
1. NEVER use markdown. No **, no ##, no *, no _. No "Day 1", no "Day 2". None at all. Ever.
2. Plain text only. Markdown is NOT rendered and looks broken.
3. Use emojis strategically for structure only.
4. Short sections with line breaks. Never walls of text.
5. For multi-day plans, separate days with a simple line like "--- Day 2 ---" not markdown.

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
- Like a knowledgeable friend who knows nutrition.

══════════════════════════════════════════
USER PROFILE
══════════════════════════════════════════
Name: ${userName}
Goal: ${goalLabel}
Activity: ${activityLevel}
Current time: ${hour}:00 (${timeOfDay})
${currentWeight ? `Current weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight  ? `Profile target weight: ${targetWeight} ${weightUnit}` : ""}

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
${hour >= 10 ? "DO NOT suggest Breakfast — that time has passed." : ""}
${hour >= 14 ? "DO NOT suggest Lunch — that time has passed." : ""}
${hour >= 20 ? "DO NOT suggest Dinner — that time has passed. Evening snack only." : ""}

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format. No exceptions.
The meal type word MUST be ALONE on its own line.
ONLY use: Breakfast, Lunch, Dinner, Snack
NEVER add anything after the meal type — no parentheses, no descriptions, no day numbers.

CORRECT:
Snack
- Foods: Greek yogurt, 1 cup; Banana, 1 medium
- Calories: 235
- Protein: 23
- Carbs: 36
- Fat: 0

WRONG — these break the app:
Snack (pre-game)           parentheses FORBIDDEN
**Snack**                  markdown FORBIDDEN
Day 1 - Breakfast          day labels FORBIDDEN
Snack - post game          descriptions FORBIDDEN

TOTAL FORMAT — plain text only, never a meal block:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [coaching note]

══════════════════════════════════════════
CALORIE TARGETS
══════════════════════════════════════════
Standard plans: aim for ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} cal.
Weight loss plans: use the adjusted target (goal minus 300 cal = ${adjustedCals} cal).
If plan is below 85% of target, note the shortfall.
If ${userName} has already eaten ${totals.calories} cal today, only plan the remaining ${remaining.calories} cal.

══════════════════════════════════════════
TIME-AWARE MEAL PLANNING
══════════════════════════════════════════
Current time is ${hour}:00. Only suggest meals still relevant for today.
For athletic events: plan meals leading up to AND a recovery meal/snack after.
Always suggest a post-event recovery option (protein + carbs within 60 min after).

══════════════════════════════════════════
WEIGHT GOAL COACHING — CRITICAL RULE
══════════════════════════════════════════
IMPORTANT: When user mentions a specific weight amount (e.g. "I want to lose 10 pounds"),
USE THAT SPECIFIC NUMBER — not their profile target weight.
Only use profile target weight if the user doesn't mention a specific amount.

When user mentions wanting to lose/gain weight:
1. Use the weight amount THEY SAID (${mentionedWeight ? mentionedWeight.amount + " " + (mentionedWeight.unit || weightUnit) : "what they mention"})
2. Check if the goal is realistic — push back if not:
   - Losing more than 2 lbs/week is unsafe
   - Losing fat AND gaining significant muscle simultaneously is very difficult
   - Extreme calorie targets (very high or very low) are counterproductive
3. If goal IS realistic: split the 500 cal deficit:
   - Eat 300 cal less per day (new target: ${adjustedCals} cal)
   - Burn 200 cal more per day (20-30 min walk)
   - Calculate timeline: ${mentionedWeight ? mentionedWeight.amount : "X"} lbs ÷ 1 lb/week = ${mentionedWeight ? mentionedWeight.amount : "X"} weeks
4. Ask what they want next: meal plan, 2-3 day plan, or just the strategy
5. When they confirm, create the meal plan at the adjusted calorie target

══════════════════════════════════════════
MULTIPLE FOODS RULE
══════════════════════════════════════════
When user mentions multiple foods, ask for each quantity one at a time.
Only return the meal block when you have ALL quantities.

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
📊 Today: ${totals.calories + "→X"}/${goal.calories} cal | protein update
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
1. Only suggest meals relevant for the remaining time today
2. Meals available now: ${remainingMealTypes.join(", ")}
3. Target ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} total calories
4. Each meal type word MUST be alone on its own line — no parentheses, no day labels
5. After all meal blocks, show total as PLAIN TEXT only
6. For athletic events: always include a post-event recovery Snack
7. For weight loss plans: use adjusted target of ${adjustedCals} cal

TOTAL FORMAT (plain text, not a meal block):
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
    console.log("User:", userName, "| Time:", hour, timeOfDay);
    console.log("Mentioned weight:", mentionedWeight);
    console.log("Context:", context?.type, "| Message:", message);

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