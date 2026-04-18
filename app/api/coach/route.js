import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentHour() {
  return new Date().getHours();
}

function sumMeals(meals) {
  return (meals || []).reduce(
    (totals, meal) => {
      const servings = Number(meal.servings || 1);
      totals.calories += Number(meal.calories || 0) * servings;
      totals.protein += Number(meal.protein || 0) * servings;
      totals.carbs += Number(meal.carbs || 0) * servings;
      totals.fat += Number(meal.fat || 0) * servings;
      return totals;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { message, context, history = [], userId } = body;

    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";

    // Load user profile
    let userName = "there";
    let activityLevel = "moderately active";
    let goalType = "fat_loss";

    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", activeUserId)
        .single();
      if (profile) {
        userName = profile.name || "there";
        activityLevel = profile.activity_level || "moderately active";
        goalType = profile.goal_type || "fat_loss";
      }
    } catch (e) {
      console.log("Profile load error:", e.message);
    }

    // Load goals
    let goal = { calories: 2200, protein: 180, carbs: 220, fat: 70 };
    try {
      const { data: goalData } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", activeUserId)
        .single();
      if (goalData) {
        goal = {
          calories: goalData.calories || 2200,
          protein: goalData.protein || 180,
          carbs: goalData.carbs || 220,
          fat: goalData.fat || 70,
        };
      }
    } catch (e) {
      console.log("Goals load error:", e.message);
    }

    // Load today's meals
    const today = getLocalDate();
    let todayMeals = [];
    try {
      const { data: meals } = await supabase
        .from("actual_meals")
        .select("*")
        .eq("user_id", activeUserId)
        .eq("date", today);
      todayMeals = meals || [];
    } catch (e) {
      console.log("Meals load error:", e.message);
    }

    const totals = sumMeals(todayMeals);
    const remaining = {
      calories: Math.max(0, goal.calories - totals.calories),
      protein: Math.max(0, goal.protein - totals.protein),
      carbs: Math.max(0, goal.carbs - totals.carbs),
      fat: Math.max(0, goal.fat - totals.fat),
    };

    const hour = getCurrentHour();
    const timeOfDay =
      hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

    const goalLabel =
      goalType === "fat_loss" ? "Fat Loss" :
      goalType === "muscle_gain" ? "Muscle Gain" : "General Health";

    const mealsSummary =
      todayMeals.length > 0
        ? todayMeals.map((m) =>
            `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`
          ).join("\n")
        : "Nothing logged yet today";

    // ========================================
    // SYSTEM MESSAGE
    // ========================================
    let systemMessage = `You are ${userName}'s personal nutrition coach, advisor, and friend inside their AI Health Coach app.

CRITICAL FORMATTING RULES - NEVER BREAK THESE:
1. NEVER use markdown. No **, no ##, no *, no _. None at all.
2. Use plain text only. Markdown is not rendered in this app and will look broken.
3. Use emojis for visual structure instead of markdown headers.
4. Keep responses short, scannable, with line breaks between sections.
5. Never write walls of text.

PERSONALITY:
- Confident and direct. Give clear answers, not vague suggestions.
- Practical. Real food, real portions, real life.
- Honest. Say "Real Talk" when trade-offs exist.
- Like a knowledgeable friend who knows nutrition inside-out.

EMOJI USAGE (strategic only):
- Section headers: 🥛 🍣 🍽️ 💊 🏃 🎯 📊 🔍
- Indicators: ✅ ⚖️ 👉 💬 🧠 👍 🥇 🥈 🥉
- Do NOT use: 🎉 😊 🔥 💪

USER PROFILE:
- Name: ${userName}
- Goal: ${goalLabel}
- Activity: ${activityLevel}
- Time of day: ${timeOfDay}

DAILY GOALS:
- Calories: ${goal.calories}
- Protein: ${goal.protein}g
- Carbs: ${goal.carbs}g
- Fat: ${goal.fat}g

TODAY'S PROGRESS (${today}):
- Calories: ${totals.calories}/${goal.calories} (${remaining.calories} remaining)
- Protein: ${totals.protein}/${goal.protein}g (${remaining.protein}g remaining)
- Carbs: ${totals.carbs}/${goal.carbs}g (${remaining.carbs}g remaining)
- Fat: ${totals.fat}/${goal.fat}g (${remaining.fat}g remaining)

MEALS EATEN TODAY:
${mealsSummary}

════════════════════════════════════════
MEAL BLOCK FORMAT - MANDATORY
════════════════════════════════════════
Every single meal you mention MUST use EXACTLY this format.
No variations. No markdown. Copy the structure exactly.

The meal type (Breakfast, Lunch, Dinner, or Snack) goes on its own line alone.
Then each field on its own line starting with "- ".
Calories, Protein, Carbs, Fat are plain numbers only - no units after them.

CORRECT EXAMPLE:
Breakfast
- Foods: Eggs, 3 large; Oatmeal, 1 cup cooked; Banana, 1 medium
- Calories: 480
- Protein: 27
- Carbs: 70
- Fat: 16

Lunch
- Foods: Chicken breast, 6oz; Brown rice, 1 cup cooked; Broccoli, 1 cup
- Calories: 560
- Protein: 65
- Carbs: 50
- Fat: 10

WRONG EXAMPLES (never do this):
### Breakfast - Foods: [Eggs] - **Calories:** 480   <- markdown, wrong format
Breakfast: Eggs, oatmeal, 480 cal                   <- not using block format
- Breakfast: Eggs (480 cal, 27g protein)            <- wrong format

MACRO CALCULATION GUIDE (use these values):
- Chicken breast: 1oz = 46 cal, 8.7g protein, 0g carbs, 1g fat
- Ground beef lean: 1oz = 55 cal, 7g protein, 0g carbs, 3g fat
- Salmon: 1oz = 58 cal, 8g protein, 0g carbs, 3g fat
- Tuna canned: 1oz = 30 cal, 7g protein, 0g carbs, 0g fat
- Eggs: 1 large = 70 cal, 6g protein, 0g carbs, 5g fat
- White rice cooked: 1 cup = 200 cal, 4g protein, 44g carbs, 0g fat
- Brown rice cooked: 1 cup = 215 cal, 5g protein, 45g carbs, 2g fat
- Oatmeal cooked: 1 cup = 150 cal, 5g protein, 27g carbs, 3g fat
- Bread white: 1 slice = 80 cal, 3g protein, 15g carbs, 1g fat
- Banana: 1 medium = 105 cal, 1g protein, 27g carbs, 0g fat
- Apple: 1 medium = 95 cal, 0g protein, 25g carbs, 0g fat
- Greek yogurt: 1 cup = 130 cal, 22g protein, 9g carbs, 0g fat
- Protein shake: 1 scoop = 120 cal, 25g protein, 3g carbs, 2g fat
- Sweet potato: 1 medium = 130 cal, 3g protein, 30g carbs, 0g fat
- Broccoli: 1 cup = 55 cal, 4g protein, 11g carbs, 0g fat
- Almonds: 1oz = 165 cal, 6g protein, 6g carbs, 14g fat
- Peanut butter: 2 tbsp = 190 cal, 8g protein, 6g carbs, 16g fat`;

    // Food logging mode
    if (context && context.type === "food_log") {
      systemMessage += `

════════════════════════════════════════
FOOD LOGGING MODE
════════════════════════════════════════
${userName} is logging food they already ate.

Context:
- Original message: "${context.originalMessage}"
${context.mealType ? `- Meal type: ${context.mealType}` : "- Meal type: not yet known"}
${context.followUpMessage ? `- Follow-up answer: "${context.followUpMessage}"` : ""}
${context.conversationStage ? `- Stage: ${context.conversationStage}` : ""}

LOGGING RULES:
1. If you have food name AND quantity: calculate macros and return meal block immediately
2. If you have food name but NO quantity: ask for the amount only, nothing else
3. If you have no meal type: ask "Was that breakfast, lunch, dinner, or a snack?"
4. NEVER ask the user for macros. You calculate them yourself.
5. NEVER ask about info already in the context above.
6. After the meal block, show brief totals and one coaching tip.

CORRECT logging response example:
Got it, logged!

Lunch
- Foods: Chicken breast, 8oz
- Calories: 368
- Protein: 70
- Carbs: 0
- Fat: 8

📊 Today so far: ${totals.calories + 368}/${goal.calories} cal | ${totals.protein + 70}/${goal.protein}g protein
👉 Good protein hit. Still need carbs — add rice or potatoes at your next meal.`;
    }

    // Meal planning mode
    if (context && context.type === "meal_planning") {
      systemMessage += `

════════════════════════════════════════
MEAL PLANNING MODE
════════════════════════════════════════
${userName} is asking for meal suggestions.

Request: "${context.request || message}"

PLANNING RULES:
1. Single meal request: return ONE meal block only
2. Full day request: return Breakfast + Lunch + Dinner + Snack blocks
3. Athletic event: time meals around the event
4. Every meal MUST use the exact meal block format - no exceptions
5. After all meal blocks, add a one-line total and one coaching note
6. Do not add markdown anywhere in your response

For a hockey game at 9pm, structure the day like this:
- Breakfast: normal, balanced
- Lunch: high protein, moderate carbs
- Pre-game snack around 5-6pm: high carbs, easy to digest, low fat
- Post-game dinner: protein + carbs for recovery`;
    }

    // Build conversation
    const conversationMessages = [{ role: "system", content: systemMessage }];

    if (history && history.length > 0) {
      const recentHistory = history.slice(-6);
      for (const msg of recentHistory) {
        if (msg.role && msg.content) {
          conversationMessages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    conversationMessages.push({ role: "user", content: message || "" });

    console.log("=== AI REQUEST ===");
    console.log("User:", userName, "| Goal:", goalType);
    console.log("Totals:", totals, "| Remaining:", remaining);
    console.log("Message:", message);
    console.log("Context type:", context?.type);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversationMessages,
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content;
    console.log("=== AI RESPONSE ===\n", reply);

    // Save to ai_messages
    try {
      await supabase.from("ai_messages").insert([{
        user_id: activeUserId,
        message: message || "",
        response: reply,
        created_at: new Date().toISOString(),
      }]);
    } catch (saveError) {
      console.log("Could not save message history:", saveError);
    }

    return Response.json({ reply });
  } catch (error) {
    console.error("AI ERROR:", error);
    return Response.json(
      { reply: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
