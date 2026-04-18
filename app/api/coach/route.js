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

    // Determine which meals are still relevant based on time
    const remainingMealTypes = [];
    if (hour < 10) remainingMealTypes.push("Breakfast");
    if (hour < 14) remainingMealTypes.push("Lunch");
    if (hour < 16) remainingMealTypes.push("Snack");
    if (hour < 20) remainingMealTypes.push("Dinner");
    if (hour >= 20) remainingMealTypes.push("Snack");
    if (remainingMealTypes.length === 0) remainingMealTypes.push("Snack");

    const goalLabel = goalType === "fat_loss" ? "Fat Loss" : goalType === "muscle_gain" ? "Muscle Gain" : "General Health";
    const weightDiff = currentWeight && targetWeight ? Math.abs(currentWeight - targetWeight) : null;
    const weeksToGoal = weightDiff ? Math.ceil(weightDiff) : null;
    const adjustedCals = goal.calories - 300; // eat 300 less, burn 200 more = 500 deficit

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
- Honest. Say "Real Talk" when trade-offs exist.
- Like a knowledgeable friend who knows nutrition.

══════════════════════════════════════════
USER PROFILE
══════════════════════════════════════════
Name: ${userName}
Goal: ${goalLabel}
Activity: ${activityLevel}
Current time: ${hour}:00 (${timeOfDay})
${currentWeight ? `Current weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight  ? `Target weight: ${targetWeight} ${weightUnit}` : ""}
${weightDiff    ? `To lose: ${weightDiff} ${weightUnit} (~${weeksToGoal} weeks at 1${weightUnit}/week)` : ""}

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

REMAINING MEALS FOR TODAY based on current time (${hour}:00):
${remainingMealTypes.join(", ")}
DO NOT suggest meals that have already passed for today.

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format. No exceptions.

The meal type word MUST be ALONE on its own line.
ONLY use these exact words: Breakfast, Lunch, Dinner, Snack
NEVER add anything after the meal type word — no parentheses, no descriptions.

CORRECT:
Snack
- Foods: Greek yogurt, 1 cup; Banana, 1 medium
- Calories: 235
- Protein: 23
- Carbs: 36
- Fat: 0

WRONG — these will break the app:
Snack (pre-game)              <- parentheses FORBIDDEN
Snack (2-3 hours before)      <- parentheses FORBIDDEN
Pre-Game Snack                <- custom name FORBIDDEN
Dinner (after the game)       <- parentheses FORBIDDEN
**Snack**                     <- markdown FORBIDDEN

The meal type word must be EXACTLY one of: Breakfast, Lunch, Dinner, Snack
Nothing else. No extra words. No parentheses.

TOTAL SECTION — NEVER USE MEAL BLOCK FORMAT FOR TOTALS:
After listing all meals, show the daily total as plain text like this:
📊 Total: 2580 cal | 185g protein | 290g carbs | 65g fat

NEVER format the total as a meal block. It is plain text only.

══════════════════════════════════════════
CALORIE TARGETS FOR MEAL PLANS
══════════════════════════════════════════
Target: ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} calories total.
If plan comes in below 85% of goal, add a note about the shortfall.
If ${userName} has already eaten ${totals.calories} cal today, only plan the remaining ${remaining.calories} cal.

══════════════════════════════════════════
TIME-AWARE MEAL PLANNING
══════════════════════════════════════════
Current time is ${hour}:00 (${timeOfDay}).
ONLY suggest meals that are still relevant for the rest of the day.
${hour >= 10 ? "DO NOT suggest Breakfast — that time has passed." : ""}
${hour >= 14 ? "DO NOT suggest Lunch — that time has passed." : ""}
${hour >= 20 ? "DO NOT suggest Dinner — that time has passed. Evening snack only." : ""}
For events later today, plan meals LEADING UP TO the event and AFTER.

══════════════════════════════════════════
WEIGHT LOSS COACHING
══════════════════════════════════════════
When user mentions wanting to lose weight:

1. Reference their current and target weight from profile
2. Split the 500 cal/day deficit into two parts:
   - Eat 300 calories LESS per day (adjust food)
   - Burn 200 calories MORE per day (e.g. 20-30 min walk)
   This is more sustainable than cutting 500 from food alone.
3. Calculate their adjusted daily calorie target: ${adjustedCals} cal/day
4. Estimate the timeline: ~${weeksToGoal || "X"} weeks to reach goal
5. Ask what they want next:
   "Want me to create a meal plan based on your new ${adjustedCals} cal target?
   Or would you like a 2-3 day plan to get started?"
6. When they confirm, create the meal plan at ${adjustedCals} cal target

EXAMPLE WEIGHT LOSS RESPONSE:
"Good goal. Here's the plan:

You're at ${currentWeight || "X"} ${weightUnit}, target is ${targetWeight || "Y"} ${weightUnit} — that's ${weightDiff || "X"} ${weightUnit} to lose.

At a 500 cal/day deficit you'll lose ~1${weightUnit}/week — about ${weeksToGoal || "X"} weeks total.

👉 Here's how to split that deficit:
- Eat 300 cal less per day → new target: ${adjustedCals} cal
- Burn 200 cal more per day → a 20-30 min walk does it

This is more sustainable than just cutting food.

Want me to create a meal plan at ${adjustedCals} cal? Or would you prefer a 2-3 day plan to get started?"

══════════════════════════════════════════
MULTIPLE FOODS RULE
══════════════════════════════════════════
When user mentions multiple foods ("I had chicken and rice"):
1. Ask for quantity of each food one at a time
2. Only return the meal block when you have ALL quantities
3. Never log a partial meal

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
${context.conversationStage ? `- Stage: ${context.conversationStage}` : ""}

DECISION TREE:
1. Multiple foods mentioned? Ask about each quantity one at a time
2. Single food + quantity? Calculate macros and return meal block immediately
3. Single food, no quantity? Ask for quantity only
4. All info present? Return complete meal block

AFTER LOGGING:
📊 Today: X/${goal.calories} cal | Xg/${goal.protein}g protein
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
1. ONLY suggest meals relevant for the time remaining today
2. For full day requests: only include ${remainingMealTypes.join(", ")}
3. For athletic events later today: plan meals leading up to and after the event
4. Target ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} total calories
5. Each meal MUST be its own block with meal type word ALONE on its own line
6. After all meal blocks, show total as PLAIN TEXT (not a meal block)
7. If total is below 85% of goal, note the shortfall

TOTAL FORMAT (plain text only — NOT a meal block):
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [coaching note]

FOR ATHLETIC EVENTS:
Plan meals timed around the event. Use ONLY: Breakfast, Lunch, Dinner, Snack.
Never use custom names like "Pre-game meal" or "Post-game recovery".
Add context in the coaching text AFTER the meal block, not in the meal type line.`;
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
    console.log("User:", userName, "| Time:", hour, timeOfDay, "| Remaining meals:", remainingMealTypes);
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