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
  if (/blood pressure|heart|cholesterol|diabetes|low.?sodium/.test(lower)) return "health_condition";
  return "general";
}

// What the AI should ask/say based on time and what's logged
function getUnloggedMealPrompt(hour, nothingLogged) {
  if (!nothingLogged) return null;
  if (hour >= 7  && hour < 11) return "It's morning and nothing is logged yet. Ask: 'Have you had breakfast yet? If so, what did you have? I want to make sure I account for it before planning your day.'";
  if (hour >= 11 && hour < 14) return "It's late morning / lunchtime and nothing is logged. Ask: 'Before I plan your meals, what have you eaten so far today? Even a rough idea helps me give you accurate advice.'";
  if (hour >= 14 && hour < 18) return "It's afternoon and nothing is logged. Ask: 'I don't have any food logged for you today. What have you eaten so far? Knowing this is important before I suggest anything for the rest of the day.'";
  if (hour >= 18 && hour < 21) return "It's evening and nothing is logged. Say: 'I don't see anything logged today. What did you eat earlier? I want to make sure I factor that in before suggesting anything for tonight.'";
  if (hour >= 21) return "It's late and nothing is logged. Say: 'Nothing is logged for today — what did you eat? It's still worth tracking so we can learn from today and plan better tomorrow.'";
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    // localHour and localDate now come FROM THE BROWSER — always accurate regardless of timezone
    const { message, context, history = [], userId, localHour, localDate: clientDate } = body;

    const activeUserId = userId || "de52999b-7269-43bd-b205-c42dc381df5d";

    // Use browser-provided time — fall back to server time only if not provided
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

    // Event detection
    const allText = [...history.map(h => h.content || ""), message || ""].join(" ");
    const eventHour = extractEventHour(allText);
    const eventType = detectEventType(allText);
    const hoursUntilEvent = eventHour !== null ? eventHour - hour : null;
    const hasEventToday = eventHour !== null && hoursUntilEvent !== null && hoursUntilEvent > 0 && hoursUntilEvent < 24;

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
Plan the FULL remaining day around this event:
${hoursUntilEvent > 4 ? "- Normal meal now with good protein and carbs" : ""}
${hoursUntilEvent > 2 ? "- Pre-event meal 2-3 hours before: HIGH carbs, LOW fat, MODERATE protein (300-500 cal). Easy to digest." : ""}
${hoursUntilEvent <= 2 ? "- URGENT: Event is very soon. Quick carbs only — banana, rice cakes, sports drink. NO heavy food." : ""}
- Post-event recovery within 30-60 min after: HIGH protein + carbs (protein shake + banana, or chicken + rice)
- Hydration reminder throughout the day
- Never suggest high-fat or heavy meals within 2 hours of any physical event`;
      } else if (eventType === "social_dining") {
        eventStrategy = `
SOCIAL DINING STRATEGY (dinner/event at ${eventHour}:00, ${hoursUntilEvent}h away):
- Eat LIGHT all day — lean protein + vegetables, low calorie
- Keep daytime meals together under 900 cal
- Small protein snack 30-60 min before event to avoid arriving starving
- Budget ${Math.round(goal.calories * 0.45)}-${Math.round(goal.calories * 0.5)} cal for the event itself
- If alcohol likely: each drink = 100-150 cal — factor this in
- Day total should still hit calorie goal when event meal is included`;
      } else if (eventType === "social_drinks") {
        eventStrategy = `
SOCIAL DRINKS STRATEGY (${eventHour}:00, ${hoursUntilEvent}h away):
- Eat a solid protein-rich meal BEFORE going out (reduces alcohol absorption)
- Normal balanced meals during the day
- Each drink = ~100-150 cal (beer ~150, wine ~120, spirits ~100)
- Remind them to hydrate well during the day`;
      } else if (eventType === "work") {
        eventStrategy = `
LONG WORK DAY STRATEGY:
- Steady energy focus — avoid sugar spikes and crashes
- Breakfast: complex carbs + protein
- Lunch: balanced, avoid heavy/fatty meals (cause afternoon fatigue)
- Afternoon snack: light focus food (apple + peanut butter, Greek yogurt)
- Never skip meals — hunger kills focus`;
      } else if (eventType === "travel") {
        eventStrategy = `
TRAVEL DAY STRATEGY:
- Pack portable protein-rich snacks (nuts, protein bars, jerky)
- Avoid high-sodium airport food (causes bloating)
- Hydrate extra — travel is dehydrating
- Keep meals simple and easy to digest`;
      }
    }

    let systemMessage = `You are ${userName}'s personal AI nutrition coach, health advisor, and supportive friend.

This app serves ALL types of people — elite athletes, casual gym-goers, busy professionals, people managing health conditions like high blood pressure or diabetes, parents, seniors, and anyone wanting to live healthier. Your coaching must adapt completely to WHO the person is and WHAT their day looks like.

══════════════════════════════════════════
CRITICAL FORMATTING RULES
══════════════════════════════════════════
1. NEVER use markdown. No **, no ##, no *, no _. None at all.
2. Plain text only — markdown is not rendered and looks broken.
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
- Adaptable — a 65-year-old managing blood pressure gets different advice than a 25-year-old athlete
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
Local Time: ${hour}:00 (${timeOfDay}) — THIS IS THE USER'S ACTUAL LOCAL TIME

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

══════════════════════════════════════════
CRITICAL RULE — ASK BEFORE ASSUMING
══════════════════════════════════════════
${nothingEatenYet ? `
NOTHING IS LOGGED TODAY and it's ${hour}:00.

NEVER assume the user hasn't eaten just because nothing is logged.
People forget to log. New users especially don't log everything yet.

${unloggedPrompt || ""}

BEFORE giving meal suggestions or planning the day, ALWAYS ask what they've eaten so far.
This is non-negotiable — coaching without knowing what was eaten is guessing, not coaching.

EXCEPTION: If the user is explicitly asking a general nutrition question (not a meal plan or food suggestion),
you can answer without asking. But if they want a meal plan, day plan, or food suggestion — ASK FIRST.
` : `
Today's logged meals are shown above. Use this data for all coaching.
`}

${hasEventToday ? eventStrategy : ""}

══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
Only suggest meals relevant for the remaining time today:
${hour < 10  ? "Breakfast, Lunch, Snack, Dinner all available" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner" : ""}
${hour >= 14 && hour < 17 ? "Available: Snack, Dinner" : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack" : ""}
${hour >= 20 ? "Available: Snack only" : ""}

For weight loss confirmations ("yes please", "create a plan") → plan TOMORROW full day.
For "today/tonight" requests → only remaining meals today.
For event days → build the FULL day around the event with proper timing.

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format. No exceptions.
The meal type word MUST be ALONE on its own line.
ONLY use: Breakfast, Lunch, Dinner, Snack
NEVER add parentheses, descriptions, or labels after the meal type word.

CORRECT:
Lunch
- Foods: Grilled chicken, 6oz; Brown rice, 1 cup; Broccoli, 1 cup
- Calories: 615
- Protein: 54
- Carbs: 65
- Fat: 7

👉 Add timing or context notes here in plain text AFTER the block.

WRONG:
Lunch (pre-game)      FORBIDDEN
**Lunch**             FORBIDDEN
Snack (recovery)      FORBIDDEN
Snack (post-game)     FORBIDDEN

TOTAL FORMAT — plain text only, never a meal block:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [one coaching note]

══════════════════════════════════════════
CALORIE TARGETS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${Math.round(goal.calories * 0.95)} cal.
Weight loss plans: ${weightLossCals} cal.
Social event days: distribute so event meal is accounted for in daily total.
If plan is below 85% of target, flag the gap.
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal.

══════════════════════════════════════════
HEALTH CONDITION COACHING
══════════════════════════════════════════
Adapt to any health context the user mentions:

Blood pressure / heart health:
- Low sodium (under 1500mg/day), high potassium (banana, sweet potato, spinach)
- Heart-healthy fats (olive oil, avocado, salmon), DASH diet principles

Diabetes / blood sugar:
- Low glycemic index, pair carbs with protein, consistent meal timing
- Avoid sugary drinks and refined carbs

High cholesterol:
- Low saturated fat, high fiber (oats, legumes), plant sterols

Anti-inflammatory:
- Omega-3 rich foods, colorful vegetables, minimize processed foods

Energy / fatigue:
- Complex carbs for sustained energy, iron-rich foods, avoid sugar crashes

══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
Use weight amount THEY SAID — not profile target.
Push back if unrealistic (max 2 lbs/week safely).
${veryActive
  ? `${userName} is very active — just reduce food by ${foodCutAmount} cal. New target: ${weightLossCals} cal.`
  : `Split deficit: eat ${foodCutAmount} cal less + burn 200 more (20-30 min walk). New target: ${weightLossCals} cal.`}
${weightToLose ? `Timeline: ${weightToLose} lbs ÷ 1/week = ${weeksToGoal} weeks.` : ""}
Ask: "Want a full meal plan for tomorrow at ${weightLossCals} cal? Or a 2-3 day plan?"
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

${nothingEatenYet ? `
IMPORTANT: Nothing is logged. Before creating a meal plan, ask what they've eaten today.
Do NOT skip this step. A meal plan without knowing current intake is inaccurate.
Exception: if they explicitly said they haven't eaten anything ("I haven't eaten yet", "starting fresh"), proceed with planning from scratch.
` : ""}

When planning:
- Build around any event detected
- Each meal type word alone on its own line
- Plain text total after all meal blocks
- Weight loss confirmations → plan TOMORROW
- Apply event strategy if event detected`;
    }

    // Build conversation
    const conversationMessages = [{ role: "system", content: systemMessage }];
    if (history?.length > 0) {
      for (const msg of history.slice(-10)) {
        if (msg.role && msg.content) conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }
    conversationMessages.push({ role: "user", content: message || "" });

    console.log(`=== AI REQUEST | ${userName} | ${hour}:00 local | ${today} ===`);
    console.log(`Nothing eaten: ${nothingEatenYet} | Event: ${eventType} at ${eventHour} (${hoursUntilEvent}h)`);
    console.log(`Context: ${context?.type} | Msg: ${message}`);

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