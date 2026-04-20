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
  return level.includes("very") || level.includes("extra") || level.includes("athlete") || level.includes("intense");
}

// ── Multi-event detection ──────────────────────────────────────────

function classifyEventType(text) {
  const lower = text.toLowerCase();
  if (/hockey|soccer|football|basketball|tennis|volleyball|baseball|rugby|lacrosse|cricket|pickleball|squash|badminton|golf/.test(lower)) return "sport";
  if (/gym|workout|training|crossfit|weightlift|lifting|exercise|run|running|cycling|swim|yoga|pilates|hiit|cardio|weights/.test(lower)) return "workout";
  if (/hike|hiking|bike ride|marathon|race|triathlon|spartan|10k|5k|half marathon|full marathon/.test(lower)) return "endurance";
  if (/dinner party|dinner date|dinner out|dinner with|dinner plans|lunch out|lunch with|brunch|breakfast with|restaurant|going out|eating out|wedding|birthday|celebration/.test(lower)) return "social_dining";
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

// Check if this event is for "tomorrow" vs "today".
// Uses a tight window and picks the closer qualifier if both appear.
function isNearTomorrow(text, idx, matchLen) {
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + matchLen + 25);
  const window = text.substring(start, end);
  const hasTomorrow = window.includes("tomorrow");
  const hasToday = window.includes("today") || window.includes("tonight");
  if (hasTomorrow && hasToday) {
    const matchCenter = idx + matchLen / 2;
    const tomorrowIdx = text.indexOf("tomorrow", start);
    const todayIdx = Math.max(text.indexOf("today", start), text.indexOf("tonight", start));
    const tomorrowDist = tomorrowIdx >= 0 ? Math.abs(tomorrowIdx - matchCenter) : 9999;
    const todayDist = todayIdx >= 0 ? Math.abs(todayIdx - matchCenter) : 9999;
    return tomorrowDist < todayDist;
  }
  return hasTomorrow;
}

// Keyword list. IMPORTANT: bare "dinner"/"lunch"/"breakfast" are NOT events —
// they're meal times. Only QUALIFIED forms ("dinner out", "dinner with") count
// as social events. A user saying "I want dinner at 8pm" is setting meal timing,
// not telling us about a restaurant.
const EVENT_KEYWORDS = [
  // Physical
  "workout", "gym", "run", "running", "swim", "swimming", "yoga", "pilates",
  "hiit", "cardio", "crossfit", "lifting", "training", "weights", "exercise",
  "hockey", "soccer", "football", "basketball", "tennis", "volleyball",
  "baseball", "rugby", "lacrosse", "cricket", "pickleball", "squash",
  "badminton", "golf", "hike", "hiking", "bike ride", "marathon", "race",
  "triathlon", "10k", "5k", "half marathon",
  // Social dining — qualified forms only
  "dinner party", "dinner date", "dinner out", "dinner with", "dinner plans",
  "lunch out", "lunch with", "lunch plans",
  "brunch", "breakfast with",
  "restaurant", "going out", "eating out", "wedding", "birthday", "celebration", "party",
  // Drinks / food events
  "drinks", "happy hour", "bar", "cocktail", "wine", "beer",
  "bbq", "barbecue", "cookout", "potluck", "picnic",
  // Work
  "meeting", "presentation", "interview", "conference", "work event",
];

// Build one big regex alternation from the keyword list
const EVENT_KEYWORD_ALT = EVENT_KEYWORDS
  .map(k => k.replace(/ /g, "\\s+"))
  .join("|");

// Extract ALL events from text with their times
// Returns array sorted by hour: [{ type, hour, label, isTomorrow }]
function extractAllEvents(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const events = [];

  // Pattern 1: "event ... at TIME"  e.g. "tennis at 6pm", "dinner out at 8"
  // Limit the gap between event and time to 30 chars so we don't cross events
  const re1 = new RegExp(
    `\\b(${EVENT_KEYWORD_ALT})\\b[^.!?]{0,30}?\\bat\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?`,
    "gi"
  );

  // Pattern 2: "TIME ... event"  e.g. "at 7am workout", "7pm tennis"
  const re2 = new RegExp(
    `\\b(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\s+[^.!?]{0,15}?(${EVENT_KEYWORD_ALT})\\b`,
    "gi"
  );

  let match;

  // Try pattern 1
  while ((match = re1.exec(lower)) !== null) {
    const eventText = match[1].trim();
    const h = parseHour(match[2], match[4]);
    const type = classifyEventType(eventText);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = isNearTomorrow(lower, match.index, match[0].length);
      events.push({ type, hour: h, label: eventText, isTomorrow, _idx: match.index });
    }
  }

  // Try pattern 2
  while ((match = re2.exec(lower)) !== null) {
    const h = parseHour(match[1], match[3]);
    const eventText = match[4].trim();
    const type = classifyEventType(eventText);
    if (type && h >= 0 && h <= 23) {
      const isTomorrow = isNearTomorrow(lower, match.index, match[0].length);
      // Avoid duplicates at same hour + type
      if (!events.find(e => e.hour === h && e.type === type)) {
        events.push({ type, hour: h, label: eventText, isTomorrow, _idx: match.index });
      }
    }
  }

  // De-duplicate: if two events at same hour, keep the more specific one (physical > social > work)
  const deduped = [];
  for (const e of events) {
    const existing = deduped.find(d => d.hour === e.hour);
    if (!existing) {
      deduped.push(e);
    } else {
      // Prefer physical > social > work > other
      const rank = t => isPhysicalEvent(t) ? 3 : isSocialEvent(t) ? 2 : t === "work" ? 1 : 0;
      if (rank(e.type) > rank(existing.type)) {
        deduped.splice(deduped.indexOf(existing), 1, e);
      }
    }
  }

  // Sort by hour
  deduped.sort((a, b) => a.hour - b.hour);

  // Strip internal index before returning
  return deduped.map(({ _idx, ...rest }) => rest);
}

// Check if we have events but are missing times — need to ask user
function eventsMissingTimes(text) {
  const lower = text.toLowerCase();
  const hasEventKeywords = /workout|gym|tennis|hockey|soccer|football|basketball|marathon|race|game|match|dinner|restaurant|party|wedding/.test(lower);
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

  const minCal = Math.round(goal.calories * 0.85);

  let strategy = `
MULTI-EVENT DAY DETECTED — ${events.length} event(s):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 (${e.label})${e.isTomorrow ? " [TOMORROW]" : ""}`).join("\n")}

CALORIE TARGET — READ CAREFULLY:
- Aim for 100% of ${goal.calories} cal. This is the goal.
- If the day's structure makes 100% genuinely impossible (e.g. social dinner with unknown menu, tight timing), land as close as possible.
- NEVER plan below ${minCal} cal (85% of goal). That is the floor, not the target.
- If your plan comes in under ${goal.calories}, tell the user in plain text after the meal blocks. Example: "This plan comes in at 2,450 / ${goal.calories} cal (87%) — hard to hit 100% with a restaurant dinner in the mix. That's fine for today."

MEAL TIMELINE RULES:
`;

  // Add rules for each event in order
  events.forEach((event, idx) => {
    const prevEvent = idx > 0 ? events[idx - 1] : null;
    const nextEvent = idx < events.length - 1 ? events[idx + 1] : null;

    if (isPhysicalEvent(event.type)) {
      strategy += `
${event.type.toUpperCase()} at ${event.hour}:00 (${event.label}):
- 2-3 hours before: pre-event Snack — HIGH carbs, LOW fat, easy to digest (banana, rice cakes, oatmeal)
- Within 1 hour after: recovery meal — HIGH protein + carbs
${nextEvent && isSocialEvent(nextEvent.type) ? `- NOTE: Social event follows at ${nextEvent.hour}:00 — keep recovery snack SMALL, save room for dinner` : ""}
`;
    } else if (isSocialEvent(event.type)) {
      strategy += `
SOCIAL EVENT at ${event.hour}:00 (${event.label}):
${prevEvent && isPhysicalEvent(prevEvent.type) ? `- Follows physical event at ${prevEvent.hour}:00 — recovery snack should be modest so appetite is intact` : ""}
- DO NOT create a meal block for this event — unknown menu
- After all planned meal blocks, add plain text:
  "For the ${event.label} — I don't know the exact menu, so here's what to look for:
  - Lean protein: grilled or baked over fried
  - Light on heavy sauces and rich sides
  - Go easy on bread and alcohol
  - Watch portion sizes
  When you're there, take a photo of the menu and I'll help you pick the best option."
- Budget the REMAINING calories for this event in plain text. Example: "You have ~800 cal budgeted for the ${event.label}."
`;
    } else if (event.type === "work") {
      strategy += `
WORK at ${event.hour}:00 (${event.label}):
- Steady energy across the day, no special block needed unless work is the ONLY event
`;
    }
  });

  strategy += `
MEAL BLOCK STRUCTURE FOR THIS DAY:
- Only create meal blocks for meals YOU control (before events or between events).
- For social dining events: plain text guidance only, NO meal block, but INCLUDE the estimated dinner calories in your total calculation.
- For physical events: include pre-event Snack + post-event recovery block.
- Fill gaps between events with normal meals (Breakfast, Lunch) at sensible times.
- Total of planned blocks + estimated social-event calories should aim for 100% of ${goal.calories} cal. Never below ${minCal}.
`;

  return strategy;
}

function isRestaurantOrPartyMeal(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /dinner party|dinner date|restaurant|going out|eating out|party|wedding|birthday|someone.{0,3}s place|friend.{0,3}s place/.test(lower);
}

function getUnloggedMealPrompt(hour, nothingLogged) {
  if (!nothingLogged) return null;
  if (hour >= 7 && hour < 11) return "It's morning and nothing is logged yet. Ask: 'Have you had breakfast yet today?'";
  if (hour >= 11 && hour < 14) return "It's late morning/lunchtime and nothing is logged. Ask: 'I don't have anything logged yet — did you have breakfast? What about lunch?'";
  if (hour >= 14 && hour < 18) return "It's afternoon and nothing is logged. Ask: 'I don't have any meals logged yet — have you eaten today?'";
  if (hour >= 18) return "It's evening and nothing is logged. Say: 'I don't see anything logged today — have you not had a chance to log, or is today a lighter eating day?'";
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
        userName = profile.name || "there";
        currentWeight = profile.current_weight;
        targetWeight = profile.target_weight;
        weightUnit = profile.weight_unit || "lbs";
        activityLevel = profile.activity_level || "moderately active";
        goalType = profile.goal_type || "fat_loss";
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
      protein:  Math.max(0, goal.protein - totals.protein),
      carbs:    Math.max(0, goal.carbs - totals.carbs),
      fat:      Math.max(0, goal.fat - totals.fat),
    };

    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const nothingEatenYet = todayMeals.length === 0;
    const unloggedPrompt = getUnloggedMealPrompt(hour, nothingEatenYet);

    // Use only the CURRENT message for event detection to avoid stale history picking up old events.
    // Fall back to recent history only if current message has no events.
    const currentText = message || "";
    let events = extractAllEvents(currentText);
    if (events.length === 0) {
      const recentHistory = history.slice(-4).map(h => h.content || "").join(" ");
      events = extractAllEvents(recentHistory + " " + currentText);
    }

    const hasMultipleEvents = events.length > 1;
    const hasAnyEvent = events.length > 0;
    const hasPhysicalEvents = events.some(e => isPhysicalEvent(e.type));
    const hasSocialEvents = events.some(e => isSocialEvent(e.type));
    const allText = [...history.map(h => h.content || ""), currentText].join(" ");
    const hasRestaurantMeal = isRestaurantOrPartyMeal(allText) || hasSocialEvents;
    const missingEventTimes = eventsMissingTimes(currentText);

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
      const minCal = Math.round(goal.calories * 0.85);
      const dinnerBudget = Math.round(goal.calories * 0.35);
      eventStrategy = `
RESTAURANT / UNKNOWN MENU STRATEGY — MANDATORY:
The user is eating at a restaurant, dinner party, or someone's home.
You DO NOT know the menu. You CANNOT guess what they will eat.

CALORIE TARGET:
- Aim for 100% of ${goal.calories} cal across the whole day (pre-event meals + estimated dinner budget).
- Never plan below ${minCal} cal (85% floor).
- If your plan falls short of 100%, flag it in plain text. Example: "This plan comes in at 2,450 / ${goal.calories} cal (87%) — hard to hit 100% with a restaurant dinner. That's fine for today."

RULES — NO EXCEPTIONS:
1. Create meal blocks ONLY for meals BEFORE the event (Breakfast, Lunch, Snack)
2. Do NOT create a Dinner block. Not even an estimate. Not steak, not anything.
3. After the pre-event meal blocks, write this in plain text:
   "For the dinner itself — I don't know the exact menu, so here's what to look for:
   - Go for grilled or baked protein over fried
   - Skip heavy cream sauces and rich sides
   - Go easy on bread and appetizers
   - Watch portion sizes on starches
   When you're there, take a photo of the menu and I'll help you pick the best option for your day."
4. Tell them how many calories they have budgeted for the event in plain text only.
5. Keep pre-event meals light-to-moderate — lean protein + vegetables + some carbs.
6. Budget ~${dinnerBudget} cal for the dinner, but adjust so pre-event + dinner budget = ${goal.calories}.`;
    } else if ((hasEventToday || hasTomorrowEvent) && eventType) {
      const minCal = Math.round(goal.calories * 0.85);
      if (["sport", "workout", "endurance"].includes(eventType)) {
        eventStrategy = `
PHYSICAL EVENT STRATEGY (${eventType} at ${eventHour !== null ? eventHour + ":00" : "scheduled time"}):

CALORIE TARGET:
- Aim for 100% of ${goal.calories} cal. This is the goal, not a ceiling.
- Never plan below ${minCal} cal (85% floor).
- If the plan falls short of 100%, flag it in plain text at the end.

MEAL STRUCTURE FOR THE FULL DAY:
1. Breakfast: balanced, good carbs + protein (up at ${hour}:00 so plan accordingly)
2. Lunch: high carbs, moderate protein, low fat — fuel loading
3. Pre-event Snack (2-3 hours before event): HIGH carbs, LOW fat, easy to digest (300-400 cal)
4. Post-event Dinner (within 1-2 hours after): HIGH protein + carbs for recovery — this is MANDATORY
5. Optional late Snack if still under calorie goal

IMPORTANT:
- You MUST include a Dinner block for post-race/game recovery. This is NOT a restaurant meal — it's a planned recovery meal.
- Total across all meals should aim for ${goal.calories} cal.
- Add timing notes AFTER each meal block in plain text.
- You CAN use two Snack blocks (pre-event + post-event if needed).`;
      } else if (eventType === "work") {
        eventStrategy = `
LONG WORK DAY STRATEGY:
- Target ${goal.calories} cal, never below ${minCal}.
- Steady energy, avoid sugar crashes.
- Breakfast: complex carbs + protein
- Lunch: balanced, not too heavy
- Afternoon Snack: light focus food
- Dinner: normal recovery meal`;
      }
    }

    let systemMessage = `You are ${userName}'s personal AI nutrition coach, health advisor, and friend.
This app serves ALL types of people — athletes, gym-goers, busy professionals, people managing health conditions. Meet them where they are.

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
${currentWeight ? `Current Weight: ${currentWeight} ${weightUnit}` : ""}
${targetWeight ? `Target Weight: ${targetWeight} ${weightUnit}` : ""}
${healthConditions ? `Health Notes: ${healthConditions}` : ""}
Local Time: ${hour}:00 (${timeOfDay})

DAILY TARGETS — SET BY USER, DO NOT CHANGE:
Calories: ${goal.calories} | Protein: ${goal.protein}g | Carbs: ${goal.carbs}g | Fat: ${goal.fat}g

══════════════════════════════════════════
CRITICAL CALORIE RULE — READ THIS CAREFULLY
══════════════════════════════════════════
${userName}'s daily calorie target is ${goal.calories}. This number was SET BY THE USER in their goals.

You MUST use ${goal.calories} as the daily calorie goal in ALL coaching and meal plans.
Do NOT say "your new target for fat loss is 2300" or any invented number.
Do NOT use ${weightLossCals} as the plan target unless user explicitly asks to lose weight TODAY in the current message.
If user says "stay within my macros" or "plan my meals" → use ${goal.calories}. Full stop.
Do NOT calculate a different number based on their goal type.
Do NOT apply your own deficit to arrive at a different target.
Do NOT say "for fat loss you should eat X" if X is different from ${goal.calories}.

The ${goal.calories} target ALREADY reflects their goals — it is the number they want to eat.

WHEN PLANNING MEALS:
- Aim for 100% of ${goal.calories} cal. That is the target.
- Never plan below 85% (${Math.round(goal.calories * 0.85)} cal). That is the floor.
- If the day's structure makes 100% genuinely impossible (restaurant dinner, tight event timing), land as close as you can and tell the user in plain text.

When telling the user how many calories they have left, ALWAYS calculate from ${goal.calories}.
Example: if ${userName} has eaten ${totals.calories} cal, they have ${remaining.calories} cal left for today.

TODAY'S INTAKE (${today}):
Calories: ${totals.calories}/${goal.calories} (${remaining.calories} remaining)
Protein:  ${totals.protein}/${goal.protein}g
Carbs:    ${totals.carbs}/${goal.carbs}g
Fat:      ${totals.fat}/${goal.fat}g

MEALS LOGGED TODAY:
${mealsSummary}

${events.length > 0 ? `📅 EVENTS DETECTED (${events.length}):
${events.map(e => `- ${e.type.toUpperCase()} at ${e.hour}:00 ${e.isTomorrow ? "(tomorrow)" : "(today)"} — "${e.label}"`).join("\n")}` : ""}
${hasRestaurantMeal ? "🍽️ RESTAURANT/PARTY MEAL DETECTED" : ""}
${missingEventTimes && !hasAnyEvent ? "⚠️ EVENTS MENTIONED BUT NO TIMES PROVIDED — ASK FOR TIMES" : ""}

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
If the user's message doesn't clearly fit food logging, meal planning, or a nutrition question, ask:
"Were you looking to log a meal, get a meal plan, or ask me a nutrition question?"

Do NOT give a generic response. Do NOT guess. Just ask that single clarifying question.

Examples of ambiguous messages that should trigger this:
- "hey" / "hi" / "hello" (unless it's a greeting at the start)
- "what do you think?" (with no context)
- Short messages with no nutrition intent

${hasRestaurantMeal && !hasMultipleEvents ? `══════════════════════════════════════════
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
Snack (pre-game)    FORBIDDEN — no parentheses
Snack (post-game)   FORBIDDEN — no parentheses
**Snack**           FORBIDDEN — no markdown

TOTAL FORMAT — plain text only:
📊 Total: X cal | Xg protein | Xg carbs | Xg fat
👉 [one coaching note]

SHORTFALL NOTE — If your total comes in under ${goal.calories}:
After the total line, add one plain-text sentence acknowledging the shortfall.
Example: "This plan lands at 2,450 / ${goal.calories} cal (87%) — hard to hit 100% with a restaurant dinner in the mix. That's fine for today."
Only add this if you're genuinely under. If you hit 95%+ just say so: "This plan hits ${goal.calories} cal on target."

══════════════════════════════════════════
CALORIE TARGETS FOR MEAL PLANS
══════════════════════════════════════════
Standard plans: aim for 100% of ${goal.calories} cal. Floor is ${Math.round(goal.calories * 0.85)} cal.
${isWeightLossConversation ? `Weight loss plan: ${weightLossCals} cal.` : ""}
Social event days: include event calorie budget in your total so the full day hits ${goal.calories}.
If plan is below 85% of target, flag the shortfall and explain why.
If ${userName} has eaten ${totals.calories} cal already, only plan remaining ${remaining.calories} cal.

══════════════════════════════════════════
TIME-AWARE PLANNING
══════════════════════════════════════════
Current local time: ${hour}:00
Only suggest meals for remaining time today:
${hour < 10 ? "All meals available: Breakfast, Lunch, Snack, Dinner" : ""}
${hour >= 10 && hour < 14 ? "Breakfast time has passed. Available: Lunch, Snack, Dinner" : ""}
${hour >= 14 && hour < 17 ? "Available: Snack, Dinner" : ""}
${hour >= 17 && hour < 20 ? "Available: Dinner, Snack" : ""}
${hour >= 20 ? "Available: Snack only" : ""}
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
When confirmed → plan TOMORROW at ${weightLossCals} cal, full day.` : `If user asks about losing weight, ask what timeline they have in mind and confirm before planning.`}

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
${context.mealType ? `Meal type: ${context.mealType}` : `Infer meal type from time: ${hour}:00 → ${hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 18 ? "snack" : "dinner"}`}
${context.followUpMessage ? `Follow-up: "${context.followUpMessage}"` : ""}

QUANTITY DETECTION — READ THIS FIRST:
These all count as quantities already provided:
- Numbers: "2 eggs", "6oz chicken", "1 cup rice"
- Fractions: "half an avocado", "half a banana", "1/2 cup"
- Portions: "a slice", "one slice", "a piece", "a medium", "a large"
- Descriptive: "a handful", "a small bowl"

DECISION TREE:
Step 1: Does the original message contain ALL foods WITH quantities (using any of the above)?
 → YES: Calculate macros immediately and return meal block. Do NOT ask anything.
 → NO: Ask for the FIRST missing quantity only. Nothing else.

Step 2 (after follow-up): Do you now have quantities for ALL foods?
 → YES: Return the complete meal block with all foods combined.
 → NO: Ask for the next missing quantity.

EXAMPLES:
"I had a slice of toast, half an avocado, and 2 eggs" → ALL quantities present → LOG IMMEDIATELY
"I had chicken and rice" → NO quantities → ask "How much chicken did you have?"
"I had 6oz chicken" → quantity present for chicken only → log chicken immediately

AFTER LOGGING — always show:
📊 Updated totals line
👉 One coaching tip`;
    }

    if (context?.type === "meal_planning") {
      systemMessage += `

══════════════════════════════════════════
MEAL PLANNING MODE
══════════════════════════════════════════
Request: "${context.request || message}"
Local time: ${hour}:00
Nothing logged: ${nothingEatenYet}
${events.length > 0 ? `Events detected: ${events.map(e => `${e.type} at ${e.hour}:00`).join(", ")}` : "No events detected"}
${missingEventTimes && !hasAnyEvent ? "MISSING TIMES: Ask user what time each event is before planning." : ""}
${hasRestaurantMeal && !hasPhysicalEvents && !hasMultipleEvents ? "Restaurant/social event only — DO NOT create a Dinner block." : ""}

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

    console.log(`=== AI | ${userName} | ${hour}:00 | Goal: ${goal.calories} cal | Events: ${events.length} | Restaurant: ${hasRestaurantMeal} ===`);
    if (events.length > 0) {
      console.log("Events:", events.map(e => `${e.type}@${e.hour}:00${e.isTomorrow ? "(tmrw)" : ""}`).join(", "));
    }

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