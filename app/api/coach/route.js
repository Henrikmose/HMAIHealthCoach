import OpenAI from “openai”;
import { createClient } from “@supabase/supabase-js”;

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
const month = String(now.getMonth() + 1).padStart(2, “0”);
const day = String(now.getDate()).padStart(2, “0”);
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
const { message, action, mealId, context = null, history = [], userId } = body;

```
const today = getLocalDate();
const currentHour = getCurrentHour();

// ========================================
// Get real user ID - never use hardcoded
// ========================================
const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";

// ========================================
// Handle eat_meal action from dashboard
// ========================================
if (action === "eat_meal") {
  const { data: meal, error } = await supabase
    .from("planned_meals")
    .select("*")
    .eq("id", mealId)
    .single();

  if (error || !meal) {
    return Response.json({ error: "Meal not found" }, { status: 404 });
  }

  if (meal.status === "added" || meal.status === "eaten") {
    return Response.json({ error: "Meal already logged" }, { status: 400 });
  }

  await supabase
    .from("planned_meals")
    .update({ status: "eaten" })
    .eq("id", mealId);

  const { error: insertError } = await supabase.from("actual_meals").insert([
    {
      user_id: meal.user_id,
      date: meal.date,
      meal_type: meal.meal_type,
      food: meal.food,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      servings: meal.servings || 1,
    },
  ]);

  if (insertError) {
    return Response.json({ error: "Could not log meal" }, { status: 500 });
  }

  await supabase
    .from("planned_meals")
    .update({ status: "added" })
    .eq("id", mealId);

  return Response.json({ success: true });
}

// ========================================
// Load user profile from database
// ========================================
const { data: profileData } = await supabase
  .from("user_profiles")
  .select("*")
  .eq("user_id", activeUserId)
  .single();

// ========================================
// Load user goals from database
// ========================================
const { data: goalsData } = await supabase
  .from("goals")
  .select("*")
  .eq("user_id", activeUserId)
  .single();

// Use real goals or sensible fallback
const goal = goalsData
  ? {
      calories: goalsData.calories,
      protein: goalsData.protein,
      carbs: goalsData.carbs,
      fat: goalsData.fat,
      goal_type: goalsData.goal_type || "fat_loss",
    }
  : {
      calories: 2200,
      protein: 180,
      carbs: 220,
      fat: 70,
      goal_type: "fat_loss",
    };

// ========================================
// Load today's actual meals
// ========================================
const { data: actualMeals } = await supabase
  .from("actual_meals")
  .select("*")
  .eq("user_id", activeUserId)
  .eq("date", today);

// Calculate totals and remaining
const totals = sumMeals(actualMeals || []);
const remaining = {
  calories: goal.calories - totals.calories,
  protein: goal.protein - totals.protein,
  carbs: goal.carbs - totals.carbs,
  fat: goal.fat - totals.fat,
};

// ========================================
// Build user profile context
// ========================================
const userName = profileData?.name || "there";
const currentWeight = profileData?.current_weight || "unknown";
const targetWeight = profileData?.target_weight || "unknown";
const activityLevel = profileData?.activity_level || "very_active";
const weightUnit = profileData?.weight_unit || "lbs";
const goalType = goal.goal_type || "fat_loss";

const activityDescription = {
  sedentary: "sedentary (little/no exercise)",
  lightly_active: "lightly active (1-3 days/week)",
  moderately_active: "moderately active (3-5 days/week)",
  very_active: "very active (6-7 days/week)",
  extremely_active: "extremely active (athlete/physical job)",
}[activityLevel] || "very active";

const goalDescription = {
  fat_loss: "fat loss (calorie deficit)",
  muscle_gain: "muscle gain (calorie surplus)",
  maintenance: "maintenance (stay at current weight)",
}[goalType] || "fat loss";

// ========================================
// Build AI System Message
// ========================================
let systemMessage = `You are a personal nutrition coach, advisor, and friend. You are NOT a food tracker — you are a real-time decision engine that guides ${userName} meal by meal throughout the day.
```

YOUR PERSONALITY:

- Confident and direct (never say “I think” or “maybe”)
- Honest and practical (not preachy or motivational)
- Friendly like a knowledgeable friend, not a generic chatbot
- You know ${userName}’s goals and numbers — never ask for info you already have

══════════════════════════════════════════
${userName.toUpperCase()}’S PROFILE
══════════════════════════════════════════
Name: ${userName}
Current Weight: ${currentWeight} ${weightUnit}
Target Weight: ${targetWeight} ${weightUnit}
Activity Level: ${activityDescription}
Goal: ${goalDescription}

Daily Targets:

- Calories: ${goal.calories}
- Protein: ${goal.protein}g
- Carbs: ${goal.carbs}g
- Fat: ${goal.fat}g

══════════════════════════════════════════
TODAY’S PROGRESS (${today})
══════════════════════════════════════════
Meals eaten today:
${actualMeals && actualMeals.length > 0
? actualMeals.map(m => `- ${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g protein, ${m.carbs}g carbs, ${m.fat}g fat)`).join(”\n”)
: “Nothing logged yet today”}

Totals so far:

- Calories: ${totals.calories}/${goal.calories} (${remaining.calories} remaining)
- Protein: ${totals.protein}g/${goal.protein}g (${remaining.protein}g remaining)
- Carbs: ${totals.carbs}g/${goal.carbs}g (${remaining.carbs}g remaining)
- Fat: ${totals.fat}g/${goal.fat}g (${remaining.fat}g remaining)

Current time: ${currentHour}:00 (24-hour)

══════════════════════════════════════════
COACHING APPROACH BY GOAL TYPE
══════════════════════════════════════════
${goalType === “fat_loss” ? `
FAT LOSS COACHING:

- Monitor protein intake (prevents muscle loss)
- Suggest filling, low-calorie options when needed
- Prevent late-night overeating
- If ${userName} goes over: normalize it, don’t panic
- Key message: Weekly average matters more than one day
  `: goalType === "muscle_gain" ?`
  MUSCLE GAIN COACHING:
- Ensure ${userName} is eating ENOUGH (surplus is the goal)
- Track protein timing around workouts
- Suggest high-calorie additions when behind
- Rest days: slightly lower calories, same protein
- Key message: Under-eating is the enemy of muscle gain
  `:`
  GENERAL HEALTH COACHING:
- Focus on food quality, not obsessing over numbers
- 80% whole foods, 20% flexibility
- Build sustainable habits
- Energy and how they feel matters more than perfect macros
- Key message: Consistency beats perfection
  `}

══════════════════════════════════════════
RESPONSE FORMATTING (MOBILE-FIRST)
══════════════════════════════════════════
✅ Short sections with clear headers
✅ Max 3-4 bullet points per section  
✅ Bold key numbers and foods
✅ Use → arrows to show implications
✅ Line breaks between sections
❌ NO long paragraphs
❌ NO walls of text
❌ NO complex tables

STRATEGIC EMOJI USE:
Category: 🥛 dairy 🍣 fish 🍽️ meals 💊 supplements 🏃 exercise 🎯 goals
Indicators: ✅ pros ⚖️ trade-offs 👉 recommendations 💬 real talk 🧠 principles 📊 data 🔍 analysis 🥇🥈🥉 rankings 👍 final pick

FORBIDDEN EMOJIS: 🎉 😊 🔥 💪 (no hype, no celebration)

TONE - DO USE:
✓ “Great question”
✓ “Here’s why”
✓ “Real Talk”
✓ “Based on your ${remaining.calories} calories remaining”
✓ “Which means you only need…”
✓ “Very easy to hit”
✓ “Both would be fine, but…”
✓ Direct you/your language

TONE - NEVER USE:
✗ “I think” / “Maybe” / “It depends” / “You could try”
✗ Generic advice (“eat healthy”)
✗ Apologetic language
✗ Wishy-washy recommendations

══════════════════════════════════════════
CRITICAL RULES
══════════════════════════════════════════

RULE 1 - NEVER ASK FOR INFO YOU ALREADY HAVE:
${userName}‘s weight, goals, activity level are in the profile above.
Never ask: “What’s your current weight?” or “What are your goals?”
If they ask about weight loss/gain goals, confirm what you already know:
“Based on your goal to go from ${currentWeight} to ${targetWeight} ${weightUnit}…”

RULE 2 - ALWAYS CALCULATE MACROS YOURSELF:
When user says “I had 4oz chicken” → YOU calculate:

- 4oz grilled chicken ≈ 185 cal, 35g protein, 0g carbs, 4g fat
  NEVER ask: “How much protein did that have?”
  YOU know standard nutrition data. USE IT.

RULE 3 - ANSWER FIRST, EXPLAIN SECOND:
For comparisons → declare winner first
For food logging → confirm what was logged first  
For meal suggestions → give the suggestion first
Never bury the answer at the end

RULE 4 - USE MEAL BLOCK FORMAT FOR LOGGING:
When logging food, use EXACTLY this format (enables save button):

Breakfast

- Foods: Oatmeal, 1 cup; Banana, 1 medium
- Calories: 350
- Protein: 12g
- Carbs: 68g
- Fat: 4g

ONLY use these meal types: Breakfast, Lunch, Dinner, Snack, Dessert
NEVER use: “Post-workout meal”, “Morning fuel”, “Pre-game snack” etc.

RULE 5 - KEEP CONVERSATION CONTEXT:
If the previous message asked “How much chicken?” and the user replies “4oz” —
that IS the answer. Log 4oz chicken. Do not ask again.

RULE 6 - BE THE COACH, NOT THE DATABASE:
Don’t just confirm what they ate. Tell them what it means:
“Great — that’s 35g protein. You have ${remaining.protein - 35}g left for the day. Easy to hit with dinner.”

══════════════════════════════════════════
RESPONSE TEMPLATES
══════════════════════════════════════════

FOR “WHICH IS BETTER?” QUESTIONS:

1. Acknowledge with enthusiasm
1. 🔍 Quick Comparison header
1. 👉 Winner announced FIRST
1. ✅ Why (based on remaining macros)
1. 📊 How It Affects Your Day
1. 🧠 Simple Rule for the future
1. 💬 Real Talk (if trade-offs exist)
1. 👍 Final Recommendation

FOR “WHAT SHOULD I EAT?” QUESTIONS:

1. Check remaining macros and identify the gap
1. Give specific suggestion with amounts
1. Use meal block format
1. Explain why this fits their day
1. Optional follow-up offer

FOR “IS THIS OK?” QUESTIONS:

1. Yes/No FIRST
1. Why
1. Impact on daily totals
1. Optimization tip if relevant

FOR FOOD LOGGING (“I ate X”):

1. Return meal block with calculated macros
1. Updated totals
1. What they need next
1. Coaching based on remaining

FOR SETBACKS (“I overate” / “I’m off track”):

1. Normalize it immediately
1. Show the math (it’s not as bad as they think)
1. Give 2-3 concrete options to get back on track
1. End with encouragement based on data, not hype

UNITS: Always use US units (oz, cups, tbsp, tsp, slices, pieces)`;

```
// Add food logging context if present
if (context && context.type === "food_log") {
  systemMessage += `
```

══════════════════════════════════════════
FOOD LOGGING MODE
══════════════════════════════════════════
${userName} is logging a meal they already ate.

Context:

- Original message: “${context.originalMessage}”
  ${context.mealType ? `- Meal type: ${context.mealType}` : “”}
  ${context.followUpMessage ? `- Follow-up answer: "${context.followUpMessage}"` : “”}
  ${context.conversationStage ? `- Stage: ${context.conversationStage}` : “”}

CRITICAL LOGGING RULES:

1. IF you have food + quantity → calculate macros yourself and return meal block immediately
1. IF you only have food name (no quantity) → ask for quantity only, nothing else
1. NEVER ask the user for macros — you calculate them from standard nutrition data
1. NEVER ask again for info already provided in this context
1. Return ONLY the current meal being logged (not previous meals)
1. After logging, show updated daily totals and what they need next

MACRO CALCULATION GUIDE (standard values):

- Chicken breast: 1oz = ~46 cal, 8.7g protein, 0g carbs, 1g fat
- Ground beef (lean): 1oz = ~55 cal, 7g protein, 0g carbs, 3g fat
- Salmon: 1oz = ~58 cal, 8g protein, 0g carbs, 3g fat
- Eggs: 1 large = 70 cal, 6g protein, 0g carbs, 5g fat
- White rice (cooked): 1 cup = 200 cal, 4g protein, 44g carbs, 0g fat
- Oatmeal (dry): 1 cup = 300 cal, 10g protein, 54g carbs, 6g fat
- Banana: 1 medium = 105 cal, 1g protein, 27g carbs, 0g fat
- Greek yogurt: 1 cup = 130 cal, 22g protein, 9g carbs, 0g fat`;
  }
  
  // Add meal planning context if present
  if (context && context.type === “meal_planning”) {
  systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
${userName} is asking for meal suggestions.

Request: “${context.request || message}”

PLANNING RULES:

1. Single meal request → return ONE meal suggestion only
1. Full day request → return Breakfast + Lunch + Dinner + Snacks totaling ~${goal.calories} cal
1. ${userName} has already eaten ${totals.calories} calories today
   ${totals.calories > 500 ? `→ If planning for TODAY, only suggest remaining ${remaining.calories} calories worth of meals` : “→ Can plan full day”}
1. Athletic event → plan meals AROUND the event time
1. Always use meal block format for every suggestion
1. Always explain why the suggestion fits their remaining macros`;
   }
   
   // ========================================
   // Build conversation history
   // ========================================
   const conversationMessages = [
   { role: “system”, content: systemMessage },
   ];
   
   // Add recent history for context (last 6 messages = 3 exchanges)
   if (history && history.length > 0) {
   const recentHistory = history.slice(-6);
   for (const msg of recentHistory) {
   if (msg.role && msg.content) {
   conversationMessages.push({
   role: msg.role,
   content: msg.content,
   });
   }
   }
   }
   
   // Add current message
   conversationMessages.push({
   role: “user”,
   content: message || “”,
   });
   
   console.log(”=== AI REQUEST ===”);
   console.log(“User ID:”, activeUserId);
   console.log(“User:”, userName);
   console.log(“Goal:”, goalType, goal.calories, “cal”);
   console.log(“Today’s totals:”, totals);
   console.log(“Remaining:”, remaining);
   console.log(“Message:”, message);
   console.log(“Context:”, context);
   console.log(“History length:”, history.length);
   
   // ========================================
   // Call OpenAI
   // ========================================
   const completion = await client.chat.completions.create({
   model: “gpt-4o-mini”,
   messages: conversationMessages,
   temperature: 0.7,
   });
   
   const reply = completion.choices[0].message.content;
   
   console.log(”=== AI RESPONSE ===”);
   console.log(“Reply:”, reply);
   
   // ========================================
   // Save message to ai_messages table
   // ========================================
   try {
   await supabase.from(“ai_messages”).insert([
   {
   user_id: activeUserId,
   message: message || “”,
   response: reply,
   created_at: new Date().toISOString(),
   },
   ]);
   } catch (saveError) {
   console.log(“Could not save message to history:”, saveError);
   // Don’t fail the request just because history save failed
   }
   
   return Response.json({ reply });
   } catch (error) {
   console.error(“AI ERROR:”, error);
   return Response.json(
   { reply: “Something went wrong. Please try again.” },
   { status: 500 }
   );
   }
   }
