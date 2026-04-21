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

// ── Multi-event detection ──────────────────────────────────────────

function classifyEventType(text) {
  const lower = text.toLowerCase();
  if (/hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket/.test(lower)) return "sport";
  if (/gym|workout|training|crossfit|weightlift|lifting|exercise|run|running|cycling|swim|yoga|pilates|hiit|cardio/.test(lower)) return "workout";
  if (/hike|hiking|bike ride|marathon|race|triathlon|spartan|10k|5k|half marathon|full marathon/.test(lower)) return "endurance";
  if (/dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|lunch date|sushi|italian|chinese|mexican|thai|indian|steakhouse|dinner out|dinner tonight|dinner tomorrow|dinner at/.test(lower)) return "social_dining";
  if (/drinks|bar|cocktail|wine|beer|happy hour/.test(lower)) return "social_drinks";
  if (/bbq|barbecue|cookout|potluck|picnic/.test(lower)) return "social_food";
  if (/long day|work event|conference|meeting|presentation|interview|all.?day/.test(lower)) return "work";
  if (/travel|flight|airport|long drive|road trip/.test(lower)) return "travel";
  return null;
}

function isPhysicalEvent(type) {
  return ["sport", "workout", "endurance"].includes(type);
}

function isSocialEvent(type) {
  return ["social_dining", "social_drinks", "social_food"].includes(type);
}

function parseHour(hourStr, ampm) {
  let h = parseInt(hourStr);
  const ap = (ampm || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h < 6) h += 12; // assume pm for ambiguous small numbers
  return h;
}

// Extract ALL events from text with their times
// Returns array sorted by hour: [{ type, hour, label, isTomorrow }]
function extractAllEvents(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const events = [];

  // Patterns to find time + event combinations
  // e.g. "workout at 7am", "tennis at 5pm", "dinner at 8"
  const timeEventPatterns = [
    // "X at TIME" pattern
    /((?:workout|gym|run|running|swim|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|bike ride|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|barbecue|potluck|picnic|lunch date)[^.!?]*?)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi,
    // "TIME + X" pattern  
    /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?((?:workout|gym|run|running|swim|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|bike ride|dinner party|dinner date|restaurant|going out|eating out|wedding|birthday|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|barbecue|potluck|picnic|lunch date))/gi,
  ];

  // Try pattern 1: "event at time"
  let match;
  const re1 = /(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|spartan|10k|5k|golf|cycling|dinner|sushi|italian|chinese|mexican|thai|indian|steakhouse|restaurant|going out|eating out|birthday|wedding|celebration|gala|banquet|brunch|drinks|bar|cocktail|happy hour|bbq|potluck|picnic|lunch)\b[^.!?]{0,30}?)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  
  while ((match = re1.exec(lower)) !== null) {
    const eventText = match[1].trim();
    const h = parseHour(match[2], match[4]);
    const type = classifyEventType(eventText);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = lower.includes("tomorrow");
      events.push({ type, hour: h, label: eventText.trim(), isTomorrow });
    }
  }

  // Try pattern 2: "at time for/event"  
  const re2 = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:for\s+)?(\b(?:workout|gym|run|running|swim|swimming|yoga|pilates|hiit|cardio|crossfit|lifting|training|weightlift|hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|hike|hiking|marathon|race|triathlon|10k|5k|golf|cycling|dinner|restaurant|brunch|drinks|bar|party|bbq)\b)/gi;
  
  while ((match = re2.exec(lower)) !== null) {
    const h = parseHour(match[1], match[3]);
    const type = classifyEventType(match[4]);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = lower.includes("tomorrow");
      // Avoid duplicates at same hour
      if (!events.find(e => e.hour === h && e.type === type)) {
        events.push({ type, hour: h, label: match[4].trim(), isTomorrow });
      }
    }
  }

  // Sort by hour
  events.sort((a, b) => a.hour - b.hour);
  return events;
}

// Check if we have events but are missing times — need to ask user
function eventsMissingTimes(text) {
  const lower = text.toLowerCase();
  const hasEventKeywords = /workout|gym|tennis|hockey|soccer|football|basketball|marathon|race|triathlon|golf|yoga|run|swim|dinner party|dinner date|restaurant|going out|eating out|birthday|wedding|brunch|drinks|bar/.test(lower);
  const hasTimeKeywords = /\d+\s*(am|pm)|at\s+\d+|\d+:\d+|morning|afternoon|evening|night/.test(lower);
  return hasEventKeywords && !hasTimeKeywords;
}

// Build the day strategy from multiple events
function buildMultiEventStrategy(events, currentHour, goal) {
  if (events.length === 0) return "";

  const physicalEvents = events.filter(e => isPhysicalEvent(e.type));
  const socialEvents = events.filter(e => isSocialEvent(e.type));
  const hasPhysical = physicalEvents.length > 0;
  const hasSocial = socialEvents.length > 0;

  let strategy = `
MULTI-EVENT DAY DETECTED — ${events.length} event(s):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 (${e.label})`).join("\n")}

CALORIE TARGET: Aim for 85-95% of ${goal.calories} cal (${Math.round(goal.calories * 0.85)}-${Math.round(goal.calories * 0.95)} cal). Never below 80% (${Math.round(goal.calories * 0.8)} cal) on active days.

MEAL TIMELINE RULES:
`;

  // Add rules for each event in order
  events.forEach((event, idx) => {
    const prevEvent = idx > 0 ? events[idx - 1] : null;
    const nextEvent = idx < events.length - 1 ? events[idx + 1] : null;

    if (isPhysicalEvent(event.type)) {
      // Smart timing logic - don't suggest eating at 3-4am for early events!
      let preEventAdvice;
      if (event.hour <= 8) {
        // Early morning event (7am, 8am)
        preEventAdvice = "30-60 minutes before OR eat after: light snack (banana, toast) 200-300 cal OR have your main meal after the workout";
      } else if (event.hour <= 12) {
        // Late morning event  
        preEventAdvice = "1-2 hours before: light snack — HIGH carbs, LOW fat (banana, rice cakes) 250-350 cal";
      } else {
        // Afternoon/evening event
        preEventAdvice = "2-3 hours before: pre-event Snack — HIGH carbs, LOW fat, easy to digest (banana, rice cakes, oatmeal) 300-400 cal";
      }
      
      strategy += `
${event.type.toUpperCase()} at ${event.hour}:00 (${event.label}):
- ${preEventAdvice}
- Within 1 hour after: recovery meal — HIGH protein + carbs
${nextEvent && isSocialEvent(nextEvent.type) ? `- NOTE: Social event follows at ${nextEvent.hour}:00 — recovery meal should be lighter since social eating comes next` : "- Include a full Dinner block for post-event recovery"}
`;
    } else if (isSocialEvent(event.type)) {
      strategy += `
SOCIAL EVENT at ${event.hour}:00 (${event.label}):
${prevEvent && isPhysicalEvent(prevEvent.type) ? `- Follows physical event at ${prevEvent.hour}:00 — budget remaining calories for this meal` : "- Keep meals before this event LIGHT (lean protein + veg)"}
- DO NOT create a meal block for this event — unknown menu
- After all planned meal blocks, add plain text:
  "For the ${event.label} — I don\'t know the exact menu, so here\'s what to look for:
  - Lean protein: grilled or baked over fried
  - Light on heavy sauces and rich sides  
  - Go easy on bread and alcohol
  - Watch portion sizes
  When you\'re there, take a photo of the menu and I\'ll help you pick the best option."
- Budget remaining calories for this event in plain text only
`;
    }
  });

  strategy += `
MEAL BLOCK STRUCTURE FOR THIS DAY:
Only create blocks for meals YOU control (before events or between events).
For social dining events: plain text guidance only, NO meal block.
For physical events: include Dinner block for post-event recovery UNLESS a social event follows soon after.
Total planned meals should add up to 85-95% of ${goal.calories} cal.
`;

  return strategy;
}

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
    // Multi-event detection
    const events = extractAllEvents(allText);
    const hasMultipleEvents = events.length > 1;
    const hasAnyEvent = events.length > 0;
    const hasPhysicalEvents = events.some(e => isPhysicalEvent(e.type));
    const hasSocialEvents = events.some(e => isSocialEvent(e.type));
    const hasRestaurantMeal = isRestaurantOrPartyMeal(allText);
    const missingEventTimes = eventsMissingTimes(allText);

    // Legacy single-event vars for backward compat with prompt sections
    const primaryEvent = events[0] || null;
    const eventType = primaryEvent?.type || null;
    const eventHour = primaryEvent?.hour || null;
    const hoursUntilEvent = eventHour !== null ? eventHour - hour : null;
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

    // Only show weight loss deficit coaching if user is explicitly asking about losing weight
    const allLower = (message || "").toLowerCase();
    const isWeightLossConversation = weightToLose !== null ||
      /lose weight|losing weight|lose \d|drop \d|cut calories|deficit|slim down/.test(allLower);

    const mealsSummary = todayMeals.length > 0
      ? todayMeals.map(m => `${m.meal_type}: ${m.food} (${m.calories} cal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F)`).join("\n")
      : "Nothing logged yet today";

    // Build event strategy
    let eventStrategy = "";

    // If user mentioned events but no times — ask for times
    if (missingEventTimes && !hasAnyEvent) {
      eventStrategy = `
MISSING EVENT TIMES:
The user mentioned events but didn't provide specific times.
Ask them: "What time is each event? I need the times to plan your meals properly around them."
Do NOT guess or plan without times. Just ask.`;
    } else if (hasMultipleEvents) {
      // Multi-event day — use new timeline builder
      eventStrategy = buildMultiEventStrategy(events, hour, goal);
    } else if (hasRestaurantMeal && !hasPhysicalEvents) {
      eventStrategy = `
RESTAURANT / UNKNOWN MENU STRATEGY — MANDATORY:
The user is eating at a restaurant, dinner party, or someone's home.
You DO NOT know the menu. You CANNOT guess what they will eat.

RULES — NO EXCEPTIONS:
1. Create meal blocks ONLY for meals BEFORE the event (Breakfast, Lunch, Snack)
2. Do NOT create a Dinner block. Not even an estimate. Not steak, not anything.
3. After the pre-event meal blocks, write this in plain text:
   "For the dinner itself — I don't know the exact menu, so here's what to look for:
   - Go for grilled or baked protein over fried
   - Skip heavy cream sauces and rich sides
   - Go easy on bread and appetizers
   - Watch portion sizes on starches
   When you're there, take a photo of the menu and I'll help you pick the best option for your goals."
4. Tell them how many calories they have budgeted for the event in plain text only
5. Keep pre-event meals light — lean protein + vegetables
6. Budget ${Math.round(goal.calories * 0.45)}-${Math.round(goal.calories * 0.5)} cal for the event`;
    } else if ((hasEventToday || hasTomorrowEvent) && eventType) {
      if (["sport", "workout", "endurance"].includes(eventType)) {
        eventStrategy = `
PHYSICAL EVENT STRATEGY (${eventType} at ${eventHour !== null ? eventHour + ":00" : "scheduled time"}, ${hoursUntilEvent !== null ? hoursUntilEvent + "h away" : ""}):

CALORIE RULE FOR SPORT/RACE DAY: Aim for 85-95% of the ${goal.calories} calorie target (${Math.round(goal.calories * 0.85)}-${Math.round(goal.calories * 0.95)} cal minimum). Athletes need solid fuel. Never plan below 80% (${Math.round(goal.calories * 0.8)} cal) on a race or game day unless user explicitly asks for a deficit.

MEAL STRUCTURE FOR THE FULL DAY:
1. Breakfast: balanced, good carbs + protein (up at ${hour}:00 so plan accordingly)
2. Lunch: high carbs, moderate protein, low fat — fuel loading
3. Pre-event timing (smart approach based on event time):
   ${eventHour <= 8 ? "Early event — eat 30-60 min before OR after the event" : eventHour <= 12 ? "Mid-morning — eat 1-2 hours before" : "Afternoon/evening — eat 2-3 hours before"}
   HIGH carbs, LOW fat, easy to digest (300-400 cal) — banana, rice cakes, oatmeal
4. Post-event Dinner (within 1-2 hours after): HIGH protein + carbs for recovery — this is MANDATORY, do not skip it

ATHLETIC EVENT FOOD EXAMPLES — USE THESE FOR RECOVERY DINNER:
- Grilled chicken with pasta or quinoa
- Salmon with sweet potato and rice  
- Turkey with mashed potato
- Lean beef with rice and vegetables
- NOT steak or heavy/fatty foods — keep it digestible for recovery

IMPORTANT:
- You MUST include a Dinner block for post-race/game recovery. This is NOT a restaurant meal — create the Dinner block with recovery-focused foods.
- Total across all meals should reach ${goal.calories} cal
- Add timing notes AFTER each meal block in plain text
- You CAN use two Snack blocks (pre-event + post-event if needed)`;
      } else if (eventType === "work") {
        eventStrategy = `
LONG WORK DAY STRATEGY:
- Steady energy, avoid sugar crashes
- Breakfast: complex carbs + protein
- Lunch: balanced, not too heavy
- Afternoon Snack: light focus food`;
      }
    }

    let systemMessage = `STOP — READ THIS FIRST — NO MARKDOWN EVER
══════════════════════════════════════════
NEVER use ** or ## or * or _ or any markdown. EVER.
Write plain text only. Markdown breaks the app display.

MOST COMMON VIOLATIONS — NEVER DO THESE:
WRONG: **Pre-Workout Snack**     RIGHT: (nothing — just write the meal block)
WRONG: **Post-Workout Recovery** RIGHT: (nothing — just write the meal block)
WRONG: **Lunch**                 RIGHT: Lunch
WRONG: **Breakfast**             RIGHT: Breakfast
WRONG: **Dinner**                RIGHT: Dinner

Do NOT add descriptive labels before meal blocks. Just write the meal type alone.
WRONG: **Pre-Tennis Snack**\nSnack     RIGHT: Snack
WRONG: **Recovery Dinner**\nDinner     RIGHT: Dinner

This rule overrides everything else. No exceptions.
══════════════════════════════════════════

You are ${userName}'s personal AI nutrition coach, health advisor, and supportive friend.

This app serves ALL types of people — athletes, gym-goers, busy professionals, people managing health conditions, parents, seniors, and anyone wanting to live healthier. Adapt completely to WHO the person is and WHAT their day looks like.

══════════════════════════════════════════
FORMATTING RULES
══════════════════════════════════════════
1. Plain text only — NO markdown (no **, ##, *, _)
2. Emojis for structure only, not decoration.
3. Short sections with line breaks. Never walls of text.

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

DAILY TARGETS — SET BY USER, DO NOT CHANGE:
Calories: ${goal.calories} | Protein: ${goal.protein}g | Carbs: ${goal.carbs}g | Fat: ${goal.fat}g

══════════════════════════════════════════
CRITICAL CALORIE RULE — READ THIS CAREFULLY
══════════════════════════════════════════
${userName}'s daily calorie target is ${goal.calories}. This number was SET BY THE USER in their profile.

You MUST use ${goal.calories} as the daily calorie goal in ALL coaching and meal plans.
Do NOT say "your new target for fat loss is 2300" or any invented number.
Do NOT use ${weightLossCals} as the plan target unless user explicitly asks to lose weight TODAY.
If user says "stay within my macros" or "plan my meals" → use ${goal.calories}. Full stop.
Do NOT calculate a different number based on their goal type.
Do NOT apply your own deficit to arrive at a different target.
Do NOT say "for fat loss you should eat X" if X is different from ${goal.calories}.

The ${goal.calories} target ALREADY reflects their goals — it is the number they want to eat each day.

When telling the user how many calories they have left, ALWAYS calculate from ${goal.calories}.
Example: if ${userName} has eaten ${totals.calories} cal, they have ${remaining.calories} cal remaining — not any other number.

TODAY'S INTAKE (${today}):
Calories: ${totals.calories}/${goal.calories} (${Math.round((totals.calories/goal.calories)*100)}% — ${remaining.calories} remaining)
Protein:  ${totals.protein}/${goal.protein}g (${Math.round((totals.protein/goal.protein)*100)}%)
Carbs:    ${totals.carbs}/${goal.carbs}g (${Math.round((totals.carbs/goal.carbs)*100)}%)
Fat:      ${totals.fat}/${goal.fat}g (${Math.round((totals.fat/goal.fat)*100)}%)

MEALS LOGGED TODAY:
${mealsSummary}

${events.length > 0 ? `📅 EVENTS DETECTED (${events.length}):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 ${e.isTomorrow ? "(tomorrow)" : "(today)"} — ${e.label}`).join("\n")}` : ""}
${hasRestaurantMeal ? "🍽️ RESTAURANT/PARTY MEAL DETECTED" : ""}
${missingEventTimes && !hasAnyEvent ? "⚠️ EVENTS MENTIONED BUT NO TIMES PROVIDED — ASK FOR TIMES BEFORE PLANNING" : ""}

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

${eventStrategy}

══════════════════════════════════════════
AMBIGUOUS MESSAGE RULE
══════════════════════════════════════════
ONLY ask "Were you looking to log a meal, get a meal plan, or ask me a nutrition question?" if the message is truly impossible to interpret — like a single word with zero nutrition context ("hey", "ok", "cool").

NEVER ask this clarifying question if the message contains ANY of:
- meal words: breakfast, lunch, dinner, snack, meal, food, eat
- macro words: calories, protein, carbs, fat, macros, nutrition
- planning words: what should I eat, help me decide, suggestions, recommendations, plan, ideas
- logging words: I had, I ate, I just had, I just ate
- swap words: I ran out of, don't have, something else, swap, replace, change it, another option
- goal words: hit my macros, stay on track, reach my goal, for the day, for tonight

If user is continuing a conversation about food (AI just suggested a meal, user responds about it) → ALWAYS treat as continuation. Never restart with the clarifying question mid-conversation.

${hasRestaurantMeal ? `══════════════════════════════════════════
RESTAURANT / PARTY MEALS — CRITICAL RULE
══════════════════════════════════════════
The user is eating at a restaurant, dinner party, or someone's home.
- DO NOT create a Dinner block — you don't know the menu
- DO NOT guess specific dishes
- Plan only Breakfast, Lunch, Snack blocks (meals BEFORE the event)
- After the meal blocks, add plain text guidance:
  "For the dinner itself — I don't know the exact menu, so here's what to look for:
  - Lean protein: grilled or baked over fried
  - Light on heavy sauces and sides
  - Go easy on bread and alcohol
  - Watch portion sizes
  When you're there, take a photo of the menu and I'll help you choose."
- Say how many calories remain for the event in plain text only — no meal block` : ""}

══════════════════════════════════════════
MEAL BLOCK FORMAT — CRITICAL
══════════════════════════════════════════
Every meal MUST use EXACTLY this format.
The meal type word MUST be ALONE on its own line.
NEVER use **Breakfast** — just write Breakfast (plain text).

ALLOWED MEAL TYPES: Breakfast, Lunch, Dinner, Snack

ONE PER TYPE RULE — NO EXCEPTIONS:
- MAXIMUM 1 Breakfast block per plan
- MAXIMUM 1 Lunch block per plan
- MAXIMUM 1 Dinner block per plan
- Snack is the ONLY type that can repeat
WRONG: Two Dinner blocks in one plan — NEVER do this
WRONG: Two Lunch blocks in one plan — NEVER do this

SNACK RULE:
- You CAN suggest MULTIPLE Snacks in one plan
- Each Snack gets its own separate block
- Add timing context AFTER the block in plain text

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

👉 Have this right after your game for recovery.

WRONG:
Snack (pre-game)     FORBIDDEN — no parentheses
Snack (post-game)    FORBIDDEN — no parentheses
**Snack**            FORBIDDEN — no markdown

POST-EVENT TIMING RULE:
NEVER guess a specific time after an event. You don't know how long it lasts.
WRONG: "Have this at 8:30pm (after your workout)"
WRONG: "Have this at 9:00pm post-game"
RIGHT: "Have this right after your workout"
RIGHT: "Have this right after your game — within 1 hour of finishing"

TOTAL FORMAT — plain text only:
📊 Total planned: X/Y cal (Z%) | Xg protein | Xg carbs | Xg fat
👉 [one coaching note]

EVERY MEAL PLAN MUST END WITH THIS LINE:
Reply "yes" to save this plan, or let me know if you'd like to change anything.

CUISINE / RESTAURANT AMBIGUITY RULE:
If the user mentions a cuisine or food type (sushi, Italian, Mexican, etc.) without clearly stating whether they are going OUT or want it planned:
- DO NOT guess — ask first
- Say: "Are you going out for sushi or would you like me to plan a sushi meal for you?"
- Wait for their answer before creating any meal block
Clear signals to plan it: "plan me sushi", "I want sushi for lunch", "add sushi to my plan"
Clear signals it's a restaurant: "going out for sushi", "sushi restaurant", "sushi date", "sushi dinner out"
Ambiguous — always ask: "sushi lunch scheduled", "having sushi", "sushi at 12:30"

IMPORTANT: The total must include ALREADY EATEN calories too.
Already eaten today: ${totals.calories} cal | ${totals.protein}g P | ${totals.carbs}g C | ${totals.fat}g F
Total = already eaten + all planned meals in this plan.
Example: if eaten=545 and plan=1380, total = 1925/2800 cal (69%)

══════════════════════════════════════════
CALORIE TARGETS FOR MEAL PLANS
══════════════════════════════════════════
Standard plans: ${Math.round(goal.calories * 0.92)}-${goal.calories} cal.
${isWeightLossConversation ? `Weight loss plan: ${weightLossCals} cal.` : ""}
Social event days: distribute so event meal is included in budget.
If plan is below 85% of target, flag the shortfall.
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal.

OVER-BUDGET RULE:
If a meal plan comes in 1-10% over the calorie target, just mention it casually — do NOT suggest changes.
Example: "This comes in just slightly over at 105% — totally fine, small buffer."
Only suggest adjustments if user asks, or if over 15%+.

══════════════════════════════════════════
MEAL SWAP / REPLACE RULE
══════════════════════════════════════════
If user rejects a suggestion or says they don't have an ingredient ("I ran out of X", "I don't have X", "something else", "another option", "swap it", "can't make that"):
1. Acknowledge briefly: "No problem — let me swap that out."
2. Suggest a NEW meal that hits similar macros
3. Use the same meal block format
4. Do NOT ask the clarifying question. Do NOT restart. Just swap.

If user CONFIRMS a suggestion ("yes", "yes please", "I like that", "let's do that", "perfect", "sounds good", "that one", "I'll have that", "can we do that one", "sure", "great"):
- Respond warmly and briefly confirming the choice
- End with: "Ready to add it to your plan?"
- Do NOT output another meal block — the user already confirmed the previous one
- Do NOT offer adjustments or revisions unless the user asked for them

══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
CRITICAL: Only suggest meals for remaining time today.

${hour < 10  ? "All meals available: Breakfast, Lunch, Snack, Dinner" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner. DO NOT suggest Breakfast." : ""}
${hour >= 14 && hour < 17 ? "Breakfast and Lunch time have passed. Available: Snack, Dinner. DO NOT suggest Breakfast or Lunch." : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack only. DO NOT suggest Breakfast, Lunch, or afternoon Snacks." : ""}
${hour >= 20 ? "Available: Snack only. DO NOT suggest any full meals." : ""}

If it's 6pm or later and user has a dinner event, suggest only light pre-dinner snack if anything.
Weight loss confirmations → plan TOMORROW full day.

══════════════════════════════════════════
WEIGHT GOAL COACHING
══════════════════════════════════════════
${isWeightLossConversation ? `Use weight amount THEY SAID — not profile target.
Push back if unrealistic (max 2 lbs/week safely).
${veryActive
  ? `Very active — just reduce food by ${foodCutAmount} cal. New target: ${weightLossCals} cal.`
  : `Split: eat ${foodCutAmount} cal less + burn 200 more (20-30 min walk). New target: ${weightLossCals} cal.`}
${weightToLose ? `Timeline: ${weightToLose} lbs ÷ 1/week = ${weeksToGoal} weeks.` : ""}
Ask: "Want a meal plan for tomorrow at ${weightLossCals} cal? Or a 2-3 day plan?"
When confirmed → plan TOMORROW at ${weightLossCals} cal, full day.` : `If user asks about losing weight or mentions lbs to lose, THEN calculate a deficit plan. Otherwise use ${goal.calories} cal for all plans.`}

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

RULE 1: NEVER ASK USER FOR CALORIES OR MACROS — YOU ARE THE EXPERT
WRONG: "How many calories are in the eggs?"
WRONG: "How much does the spicy tuna roll weigh?"
RIGHT: Use your nutrition knowledge to estimate. A standard sushi roll = ~300-350 cal. Eggs = 70 cal each.

RULE 2: IF THERE'S ANY NUMBER OR DESCRIPTOR, LOG IT
Quantities include: numbers (2, 8, .5), units (oz, pcs, cup), or words (a, half, whole, medium, large)
- "2 eggs" → LOG (has number)
- "8oz chicken" or "8 oz" → LOG (has number + unit)
- "8pcs cali roll" or "8 pcs" → LOG (has number + unit)
- ".5 cup rice" or "half cup" → LOG (has fraction)
- "a whole avocado" → LOG (has "a" and "whole")
- "a banana" → LOG (has "a")
- "3 salmon sashimi" → LOG (has number)

RULE 3: ONLY ASK IF TRULY NOTHING IS THERE
- "I had chicken" → no quantity at all → ask "How much chicken?"
- "I had rice" → no quantity at all → ask "How much rice?"

RULE 4: USE REASONABLE ESTIMATES WHEN EXACT IS UNKNOWN
Standard portions:
- Sushi roll = ~50-60 cal per piece, 8-piece roll = ~400-500 cal
- Sashimi = ~40 cal per piece
- Chicken breast = 46 cal/oz, 8.7g protein/oz
- Eggs = 70 cal, 6g protein each
- Avocado = 240 cal, 22g fat
- Toast = 80 cal per slice
Use the macro reference table. When in doubt, estimate reasonably and LOG IT.

AFTER LOGGING — ALWAYS include:
1. The meal you just logged (foods + macros)
2. Updated totals using ONLY this formula:
   - Calories: ${totals.calories} (from DB) + [new meal calories] = [sum]
   - Protein: ${totals.protein}g + [new meal protein]g = [sum]g
   - Carbs: ${totals.carbs}g + [new meal carbs]g = [sum]g
   - Fat: ${totals.fat}g + [new meal fat]g = [sum]g
   Format: 📊 Updated totals: [sum]/${goal.calories} cal ([pct]%) | [sum]g protein | [sum]g carbs | [sum]g fat
3. DO NOT add any other meals or history to the total — ONLY DB baseline + this new meal
4. 👉 One coaching tip
5. IF 300+ calories remaining after this meal: suggest a specific next meal or snack`;
    }

    if (context?.type === "meal_planning") {
      // Calculate suggested eating times based on events
      let timingGuide = "";
      if (events.length > 0) {
        const sortedEvents = [...events].sort((a, b) => a.hour - b.hour);
        sortedEvents.forEach((event, idx) => {
          if (isPhysicalEvent(event.type)) {
            if (event.hour <= 8) {
              // Early morning workout - don't suggest eating at 5am!
              timingGuide += `
${event.type.toUpperCase()} at ${event.hour}:00:
- OPTION A: Light snack 30 min before (${event.hour - 1}:30am) — banana or toast, ~150 cal
- OPTION B: Work out fasted, eat breakfast AFTER (${event.hour + 1}:00am)
- Post-workout recovery: ${event.hour + 1}:00-${event.hour + 2}:00am — eggs, oatmeal, protein shake
DO NOT suggest a full 300+ cal breakfast before a 7am or 8am workout. That means eating at 5-6am which is unrealistic.
`;
            } else {
              const preEventTime = event.hour - 2;
              const postEventTime = event.hour + 1;
              timingGuide += `
${event.type.toUpperCase()} at ${event.hour}:00:
- Pre-event snack: ${preEventTime}:00 (2 hours before)
- Post-event recovery: ${postEventTime}:00 (within 1 hour after)
`;
            }
          } else if (isSocialEvent(event.type)) {
            timingGuide += `
SOCIAL EVENT at ${event.hour}:00 (${event.label}):
- Keep meals before this LIGHT
- Budget ${Math.round(goal.calories * 0.4)}-${Math.round(goal.calories * 0.5)} cal for this event
- NO meal block — give plain text guidance only
`;
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
${events.length > 0 ? `Events detected: ${events.map(e => `${e.type} at ${e.hour}:00`).join(", ")}` : "No events detected"}
${missingEventTimes && !hasAnyEvent ? "MISSING TIMES: Ask user what time each event is before planning." : ""}
${hasRestaurantMeal && !hasPhysicalEvents ? "Restaurant/social event only — DO NOT create a Dinner block. Plain text guidance only." : ""}

${timingGuide}

CRITICAL — TIMING RULES:
Pre-event snack time: calculate EXACTLY. Event at 7:30pm, 30 min before = 7:00pm NOT 6:00pm.
Formula: snack_time = event_time minus buffer_minutes. Do the math explicitly.
Post-event meal: NEVER use a specific time — always say "right after your [event]" or "when you get home from your [event]".
No exceptions. You don't know how long the event lasts so never guess a post-event time.

CRITICAL — INCLUDE SPECIFIC TIMES FOR PRE-EVENT:
After each meal block, add a timing note like:
👉 Have this at 6:30am (30 min before workout)
👉 Lunch at 12:30pm during work
👉 Pre-tennis snack at 4:00pm (2 hours before your 6pm match)
👉 Right after your workout — have this within 1 hour of finishing
👉 Right after your game — recovery meal when you get home

Pre-event: always calculate exact time. Post-event: always say "right after".

SNACK RULES:
- For athletic events: suggest TWO Snacks (pre-event + post-event recovery)
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

    console.log(`=== AI | ${userName} | ${hour}:00 | Goal: ${goal.calories} cal | Events: ${events.length} | Restaurant: ${hasRestaurantMeal}`);

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