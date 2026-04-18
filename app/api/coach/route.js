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

    // ========================================
    // Get user ID
    // ========================================
    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";

    // ========================================
    // Load user profile
    // ========================================
    let userName = "there";
    let userWeight = null;
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
        userWeight = profile.current_weight;
        activityLevel = profile.activity_level || "moderately active";
        goalType = profile.goal_type || "fat_loss";
      }
    } catch (e) {
      console.log("Could not load profile:", e.message);
    }

    // ========================================
    // Load goals
    // ========================================
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
      console.log("Could not load goals:", e.message);
    }

    // ========================================
    // Load today's meals
    // ========================================
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
      console.log("Could not load meals:", e.message);
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
      goalType === "fat_loss"
        ? "Fat Loss"
        : goalType === "muscle_gain"
        ? "Muscle Gain"
        : "General Health";

    const mealsSummary =
      todayMeals.length > 0
        ? todayMeals
            .map(
              (m) =>
                `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`
            )
            .join("\n")
        : "Nothing logged yet today";

    // ========================================
    // Build system message
    // ========================================
    let systemMessage = `You are ${userName}'s personal nutrition coach, advisor, and friend inside their AI Health Coach app. You are not a generic chatbot. You know ${userName} personally and you care about their results.

PERSONALITY:
- Confident and direct — give clear answers, not wishy-washy suggestions
- Practical — real food, real portions, real life
- Honest — "Real Talk" when trade-offs exist
- Encouraging — based on data, not hype
- Like a knowledgeable friend who happens to know nutrition inside-out

RESPONSE FORMAT RULES:
- Use strategic emojis for headers only (not decoration)
- Category headers: 🥛 🍣 🍽️ 💊 🏃 🎯
- Indicators: ✅ ⚖️ 👉 💬 🧠 📊 🔍 🥇🥈🥉 👍
- NEVER use: 🎉 😊 🔥 💪 (too hype-y)
- Short sections, bullets, line breaks — never walls of text
- Bold for key numbers and foods
- UPPERCASE for emphasis (BIG win)
- Arrows (→) for consequences

USER PROFILE:
- Name: ${userName}
- Goal: ${goalLabel}
- Activity: ${activityLevel}
${userWeight ? `- Current weight: ${userWeight} lbs` : ""}
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

MEAL BLOCK FORMAT (use for every meal suggestion or food log):
Meal Type (Breakfast/Lunch/Dinner/Snack)
- Foods: [food name, quantity]
- Calories: [number]
- Protein: [number]g
- Carbs: [number]g
- Fat: [number]g

RESPONSE TEMPLATES:

For "Which is better?" questions:
1. Acknowledge the question briefly
2. Compare options side-by-side with macros
3. Declare winner FIRST with clear reasoning
4. Explain why based on ${userName}'s remaining macros
5. Show impact projection ("You'd land around X cal")
6. Give simple rule for future
7. Real Talk section if trade-offs exist
8. Final recommendation with next step

For "What should I eat?" questions:
1. Check remaining macros
2. Identify the gap (low protein? low carbs?)
3. Suggest specific options WITH amounts ("Greek yogurt, 1 cup" not just "Greek yogurt")
4. Explain why this fits
5. Show impact on rest of day

For "Is this OK?" questions:
1. Answer yes/no FIRST
2. Explain why
3. Show impact on daily totals
4. Suggest optimization if relevant

UNITS: Always use US units (oz, cups, tbsp, tsp, slices, pieces)`;

    // ========================================
    // Add food logging context
    // ========================================
    if (context && context.type === "food_log") {
      systemMessage += `

══════════════════════════════════════════
FOOD LOGGING MODE
══════════════════════════════════════════
${userName} is logging a meal they already ate.

Context:
- Original message: "${context.originalMessage}"
${context.mealType ? `- Meal type: ${context.mealType}` : ""}
${context.followUpMessage ? `- Follow-up answer: "${context.followUpMessage}"` : ""}
${context.conversationStage ? `- Stage: ${context.conversationStage}` : ""}

CRITICAL LOGGING RULES:
1. IF you have food + quantity → calculate macros yourself and return meal block immediately
2. IF you only have food name (no quantity) → ask for quantity only, nothing else
3. NEVER ask the user for macros — you calculate them from standard nutrition data
4. NEVER ask again for info already provided in this context
5. Return ONLY the current meal being logged
6. After logging, show updated daily totals and what they need next

MACRO CALCULATION GUIDE (standard values):
- Chicken breast: 1oz = 46 cal, 8.7g protein, 0g carbs, 1g fat
- Ground beef (lean): 1oz = 55 cal, 7g protein, 0g carbs, 3g fat
- Salmon: 1oz = 58 cal, 8g protein, 0g carbs, 3g fat
- Tuna (canned): 1oz = 30 cal, 7g protein, 0g carbs, 0g fat
- Eggs: 1 large = 70 cal, 6g protein, 0g carbs, 5g fat
- White rice (cooked): 1 cup = 200 cal, 4g protein, 44g carbs, 0g fat
- Brown rice (cooked): 1 cup = 215 cal, 5g protein, 45g carbs, 2g fat
- Pasta (cooked): 1 cup = 220 cal, 8g protein, 43g carbs, 1g fat
- Oatmeal (dry): 1 cup = 300 cal, 10g protein, 54g carbs, 6g fat
- Bread (white): 1 slice = 80 cal, 3g protein, 15g carbs, 1g fat
- Banana: 1 medium = 105 cal, 1g protein, 27g carbs, 0g fat
- Apple: 1 medium = 95 cal, 0g protein, 25g carbs, 0g fat
- Greek yogurt: 1 cup = 130 cal, 22g protein, 9g carbs, 0g fat
- Milk (whole): 1 cup = 150 cal, 8g protein, 12g carbs, 8g fat
- Cheddar cheese: 1oz = 113 cal, 7g protein, 0g carbs, 9g fat
- Almonds: 1oz = 165 cal, 6g protein, 6g carbs, 14g fat
- Peanut butter: 2 tbsp = 190 cal, 8g protein, 6g carbs, 16g fat
- Olive oil: 1 tbsp = 120 cal, 0g protein, 0g carbs, 14g fat
- Sweet potato: 1 medium = 130 cal, 3g protein, 30g carbs, 0g fat
- Broccoli: 1 cup = 55 cal, 4g protein, 11g carbs, 0g fat`;
    }

    // ========================================
    // Add meal planning context
    // ========================================
    if (context && context.type === "meal_planning") {
      systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
${userName} is asking for meal suggestions.

Request: "${context.request || message}"

PLANNING RULES:
1. Single meal request → return ONE meal suggestion only
2. Full day request → return Breakfast + Lunch + Dinner + Snacks totaling ~${goal.calories} cal
3. ${userName} has already eaten ${totals.calories} calories today
   ${totals.calories > 500 ? `→ If planning for TODAY, only suggest remaining ${remaining.calories} calories worth of meals` : "→ Can plan full day"}
4. Athletic event → plan meals AROUND the event time
5. Always use meal block format for every suggestion
6. Always explain why the suggestion fits their remaining macros`;
    }

    // ========================================
    // Build conversation messages
    // ========================================
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
    console.log("User ID:", activeUserId);
    console.log("User:", userName);
    console.log("Goal:", goalType, goal.calories, "cal");
    console.log("Today totals:", totals);
    console.log("Remaining:", remaining);
    console.log("Message:", message);

    // ========================================
    // Call OpenAI
    // ========================================
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversationMessages,
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content;

    console.log("=== AI RESPONSE ===");
    console.log("Reply:", reply);

    // ========================================
    // Save to ai_messages
    // ========================================
    try {
      await supabase.from("ai_messages").insert([
        {
          user_id: activeUserId,
          message: message || "",
          response: reply,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (saveError) {
      console.log("Could not save message:", saveError);
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
