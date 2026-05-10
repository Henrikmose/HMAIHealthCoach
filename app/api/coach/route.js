export const runtime = "nodejs";

const FOOD_DB = [
{ aliases: ["egg", "eggs", "whole egg", "large egg"], name: "Large whole egg", grams: 50, calories: 70, protein: 6, carbs: 0, fat: 5 },
{ aliases: ["egg white", "egg whites"], name: "Large egg white", grams: 33, calories: 17, protein: 4, carbs: 0, fat: 0 },
{ aliases: ["avocado", "half avocado", "small avocado"], name: "Avocado", grams: 150, calories: 240, protein: 3, carbs: 13, fat: 22 },
{ aliases: ["banana", "medium banana"], name: "Banana", grams: 118, calories: 105, protein: 1, carbs: 27, fat: 0 },
{ aliases: ["apple", "fuji apple"], name: "Apple", grams: 182, calories: 95, protein: 0, carbs: 25, fat: 0 },
{ aliases: ["chicken", "chicken breast"], name: "Chicken breast", grams: 28, calories: 46, protein: 8.7, carbs: 0, fat: 1 },
{ aliases: ["rice", "white rice"], name: "White rice cooked", unit: "cup", calories: 200, protein: 4, carbs: 44, fat: 0 },
{ aliases: ["sourdough", "sourdough bread", "heb sourdough", "h-e-b sourdough"], name: "H-E-B Sourdough Bread", unit: "slice", calories: 150, protein: 5, carbs: 29, fat: 1 },
{ aliases: ["cottage cheese"], name: "Cottage cheese", unit: "cup", calories: 200, protein: 28, carbs: 8, fat: 4 },
{ aliases: ["fairlife", "fair life", "protein shake", "fairlife protein shake", "fair life protein shake"], name: "Fairlife Protein Shake", unit: "bottle", calories: 150, protein: 30, carbs: 4, fat: 2 },
{ aliases: ["turkey", "roasted turkey", "oven roasted turkey"], name: "Oven roasted turkey", unit: "slice", calories: 30, protein: 6, carbs: 1, fat: 0 },
{ aliases: ["shrimp"], name: "Shrimp", grams: 28, calories: 28, protein: 6, carbs: 0, fat: 0 },
{ aliases: ["pasta"], name: "Pasta cooked", unit: "cup", calories: 220, protein: 8, carbs: 43, fat: 1 },
{ aliases: ["broccoli"], name: "Broccoli", unit: "cup", calories: 55, protein: 4, carbs: 11, fat: 0 },
{ aliases: ["sweet potato", "sweet potatoes"], name: "Sweet potato", unit: "medium", calories: 130, protein: 3, carbs: 30, fat: 0 },
{ aliases: ["greek yogurt"], name: "Greek yogurt", unit: "cup", calories: 130, protein: 22, carbs: 9, fat: 0 },
{ aliases: ["pretzels"], name: "Pretzels", unit: "serving", calories: 110, protein: 3, carbs: 23, fat: 1 }
];

function toNumber(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function roundMacro(n) {
return Math.round(toNumber(n) * 10) / 10;
}

function addDays(dateStr, days) {
const d = new Date(dateStr + "T12:00:00");
d.setDate(d.getDate() + days);
return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function extractTargetDate(text, selectedDate) {
const lower = String(text || "").toLowerCase();
const base = selectedDate || new Date().toISOString().slice(0, 10);
if (lower.includes("tomorrow")) return addDays(base, 1);
if (lower.includes("yesterday")) return addDays(base, -1);
const dateMatch = lower.match(/\b(\d{1,2})[\/-](\d{1,2})\b/);
if (dateMatch) {
const year = new Date().getFullYear();
return `${year}-${String(dateMatch[1]).padStart(2, "0")}-${String(dateMatch[2]).padStart(2, "0")}`;
}
return base;
}

function detectMealType(text, fallback = "snack") {
const lower = String(text || "").toLowerCase();
if (lower.includes("breakfast")) return "breakfast";
if (lower.includes("lunch")) return "lunch";
if (lower.includes("dinner")) return "dinner";
if (lower.includes("snack")) return "snack";
if (lower.includes("pre-game") || lower.includes("pregame")) return "snack";
if (lower.includes("post-game") || lower.includes("postgame")) return "snack";
return fallback;
}

function isFoodLog(text) {
const lower = String(text || "").toLowerCase();
return /\b(i had|i ate|i just had|i just ate|i drank|i consumed)\b/.test(lower);
}

function isPlanning(text) {
const lower = String(text || "").toLowerCase();
return /\b(plan|planning|tomorrow|later|will have|going to have|what should i eat|meal plan|hockey|workout|game|lunch tomorrow|dinner tomorrow|breakfast tomorrow)\b/.test(lower);
}

function cleanFoodText(text) {
return String(text || "")
.replace(/\b(i had|i ate|i just had|i just ate|i drank|i consumed)\b/gi, "")
.replace(/\b(for breakfast|for lunch|for dinner|as a snack|for snack|tomorrow|today|tonight)\b/gi, "")
.replace(/\b(correction:|instead|please|can you|log|add)\b/gi, "")
.trim();
}

function wordToNumber(word) {
const map = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, whole: 1 };
return map[String(word || "").toLowerCase()] || null;
}

function splitFoodParts(text) {
let cleaned = cleanFoodText(text)
.replace(/\b(two|three|four|five|six|\d+)\s+eggs?\b/gi, " and $&")
.replace(/\b(a|an|one|two|three|four|five|six|\d+)\s+(banana|apple|avocado|fairlife|protein shake|sourdough|rice|chicken|cottage cheese)\b/gi, " and $&")
.replace(/^and\s+/i, "");

return cleaned.split(/\s+and\s+|,\s*|\s+plus\s+|\s+with\s+/i).map((p) => p.trim()).filter((p) => p.length > 1);
}

function parsePart(part) {
const lower = part.toLowerCase();
let amount = 1;
let unit = "serving";
let food = part;

const fractionCup = lower.match(/\b(half|1\/2|0\.5)\s+(a\s+)?cup\s+(of\s+)?(.+)/);
if (fractionCup) return { amount: 0.5, unit: "cup", food: fractionCup[4] };

const cup = lower.match(/\b(\d+(\.\d+)?|one|two|three|four)\s+cups?\s+(of\s+)?(.+)/);
if (cup) return { amount: wordToNumber(cup[1]) || Number(cup[1]), unit: "cup", food: cup[4] };

const oz = lower.match(/\b(\d+(\.\d+)?)\s*oz\s+(.+)/);
if (oz) return { amount: Number(oz[1]), unit: "oz", food: oz[3] };

const slices = lower.match(/\b(\d+|one|two|three|four|five|six)\s+slices?\s+(of\s+)?(.+)/);
if (slices) return { amount: wordToNumber(slices[1]) || Number(slices[1]), unit: "slice", food: slices[3] };

const numberFood = lower.match(/\b(\d+|a|an|one|two|three|four|five|six|half|whole)\s+(.+)/);
if (numberFood) {
amount = wordToNumber(numberFood[1]) || Number(numberFood[1]);
food = numberFood[2];
if (food.includes("egg")) unit = "egg";
else if (food.includes("slice")) unit = "slice";
else if (food.includes("bottle")) unit = "bottle";
else unit = numberFood[1] === "half" ? "half" : "serving";
}
return { amount, unit, food };
}

function findFood(foodText) {
const lower = String(foodText || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
if (/\begg whites?\b/.test(lower)) return FOOD_DB.find((f) => f.aliases.includes("egg white"));
if (/\beggs?\b/.test(lower) && !lower.includes("eggplant")) return FOOD_DB.find((f) => f.aliases.includes("egg"));
return FOOD_DB.find((item) => item.aliases.some((alias) => lower.includes(alias) || alias.includes(lower)));
}

function calculateItem(parsed) {
const food = findFood(parsed.food);
if (!food) return null;
let multiplier = parsed.amount || 1;
if (parsed.unit === "half" && food.name.toLowerCase().includes("avocado")) multiplier = 0.5;
if (parsed.unit === "oz" && food.grams === 28) multiplier = parsed.amount;
if (parsed.unit === "cup" && food.unit === "cup") multiplier = parsed.amount;
if (parsed.unit === "slice" && food.unit === "slice") multiplier = parsed.amount;
if (parsed.unit === "egg" && food.name.toLowerCase().includes("egg")) multiplier = parsed.amount;
if (food.unit === "bottle") multiplier = parsed.amount || 1;

return {
food: food.name,
amount: parsed.amount,
unit: parsed.unit,
calories: Math.round(food.calories * multiplier),
protein: roundMacro(food.protein * multiplier),
carbs: roundMacro(food.carbs * multiplier),
fat: roundMacro(food.fat * multiplier)
};
}

function sumItems(items, mealType) {
const totals = items.reduce((acc, item) => {
acc.calories += item.calories;
acc.protein += item.protein;
acc.carbs += item.carbs;
acc.fat += item.fat;
return acc;
}, { calories: 0, protein: 0, carbs: 0, fat: 0 });

return {
mealType,
food: items.map((i) => `${i.food}${i.amount ? `, ${i.amount} ${i.unit}` : ""}`).join("; "),
servings: 1,
calories: Math.round(totals.calories),
protein: roundMacro(totals.protein),
carbs: roundMacro(totals.carbs),
fat: roundMacro(totals.fat),
breakdown: items
};
}

function buildMealFromText(text, fallbackMealType = "snack") {
const parts = splitFoodParts(text);
const parsed = parts.map(parsePart);
const calculated = parsed.map(calculateItem);
const missing = parsed.filter((_, idx) => !calculated[idx]).map((p) => p.food);
const found = calculated.filter(Boolean);
if (!found.length) return { meal: null, missing };
if (missing.length > 0) return { meal: null, missing, found };
const mealType = detectMealType(text, fallbackMealType);
return { meal: sumItems(found, mealType), missing: [] };
}

function planForHockeyDay() {
return [
sumItems([calculateItem({ food: "eggs", amount: 3, unit: "egg" }), calculateItem({ food: "H-E-B sourdough", amount: 2, unit: "slice" }), calculateItem({ food: "greek yogurt", amount: 1, unit: "cup" }), calculateItem({ food: "banana", amount: 1, unit: "serving" })].filter(Boolean), "breakfast"),
sumItems([calculateItem({ food: "fairlife protein shake", amount: 1, unit: "bottle" }), calculateItem({ food: "apple", amount: 1, unit: "serving" })].filter(Boolean), "snack"),
sumItems([calculateItem({ food: "chicken", amount: 7, unit: "oz" }), calculateItem({ food: "rice", amount: 1.5, unit: "cup" }), calculateItem({ food: "broccoli", amount: 1, unit: "cup" })].filter(Boolean), "lunch"),
sumItems([calculateItem({ food: "turkey", amount: 4, unit: "slice" }), calculateItem({ food: "H-E-B sourdough", amount: 2, unit: "slice" }), calculateItem({ food: "banana", amount: 1, unit: "serving" })].filter(Boolean), "snack"),
sumItems([calculateItem({ food: "fairlife protein shake", amount: 1, unit: "bottle" }), calculateItem({ food: "pretzels", amount: 1, unit: "serving" })].filter(Boolean), "snack")
];
}

function buildSimplePlan(question) {
const lower = String(question || "").toLowerCase();
const meals = [];
if (lower.includes("hockey") || lower.includes("game")) return planForHockeyDay();
if (lower.includes("breakfast")) meals.push(sumItems([calculateItem({ food: "eggs", amount: 2, unit: "egg" }), calculateItem({ food: "H-E-B sourdough", amount: 1, unit: "slice" }), calculateItem({ food: "apple", amount: 1, unit: "serving" })].filter(Boolean), "breakfast"));
if (lower.includes("lunch") || lower.includes("chicken and rice")) meals.push(sumItems([calculateItem({ food: "chicken", amount: 6, unit: "oz" }), calculateItem({ food: "rice", amount: 1, unit: "cup" }), calculateItem({ food: "broccoli", amount: 1, unit: "cup" })].filter(Boolean), "lunch"));
if (lower.includes("dinner")) meals.push(sumItems([calculateItem({ food: "shrimp", amount: 7, unit: "oz" }), calculateItem({ food: "pasta", amount: 1, unit: "cup" }), calculateItem({ food: "broccoli", amount: 1, unit: "cup" })].filter(Boolean), "dinner"));
if (lower.includes("snack")) meals.push(sumItems([calculateItem({ food: "fairlife protein shake", amount: 1, unit: "bottle" }), calculateItem({ food: "banana", amount: 1, unit: "serving" })].filter(Boolean), "snack"));
if (!meals.length) meals.push(sumItems([calculateItem({ food: "chicken", amount: 6, unit: "oz" }), calculateItem({ food: "rice", amount: 1, unit: "cup" }), calculateItem({ food: "broccoli", amount: 1, unit: "cup" })].filter(Boolean), "lunch"));
return meals;
}

function coachSummary(totals, goals) {
const remaining = {
calories: toNumber(goals.calories) - toNumber(totals.calories),
protein: toNumber(goals.protein) - toNumber(totals.protein),
carbs: toNumber(goals.carbs) - toNumber(totals.carbs),
fat: toNumber(goals.fat) - toNumber(totals.fat)
};
return `Current dashboard:\nCalories: ${Math.round(totals.calories || 0)} / ${goals.calories}\nProtein: ${Math.round(totals.protein || 0)}g / ${goals.protein}g\nCarbs: ${Math.round(totals.carbs || 0)}g / ${goals.carbs}g\nFat: ${Math.round(totals.fat || 0)}g / ${goals.fat}g\n\nRemaining:\nCalories: ${Math.round(remaining.calories)}\nProtein: ${Math.round(remaining.protein)}g\nCarbs: ${Math.round(remaining.carbs)}g\nFat: ${Math.round(remaining.fat)}g`;
}

async function askOpenAI(question, totals, goals, meals) {
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) return `I can help with that.\n\n${coachSummary(totals, goals)}`;
const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
method: "POST",
headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
body: JSON.stringify({
model: process.env.OPENAI_MODEL || "gpt-4o-mini",
temperature: 0.3,
messages: [
{ role: "system", content: "You are a nutrition coach. Do not invent daily totals. Use only supplied dashboard totals. Give concise practical coaching. Do not calculate meal macros." },
{ role: "user", content: `Dashboard totals:\n${coachSummary(totals, goals)}\n\nMeals:\n${JSON.stringify(meals || [])}\n\nQuestion:\n${question}` }
]
})
});
const data = await openAiResponse.json();
if (!openAiResponse.ok) return `I can help with that.\n\n${coachSummary(totals, goals)}`;
return data?.choices?.[0]?.message?.content || `I can help with that.\n\n${coachSummary(totals, goals)}`;
}

export async function POST(request) {
try {
const body = await request.json();
const { date, targetDate: incomingTargetDate, question, meals = [], plannedMeals = [], totals = {}, goals = { calories: 2200, protein: 180, carbs: 220, fat: 70 } } = body;
if (!question || typeof question !== "string") return Response.json({ error: "Missing coach question." }, { status: 400 });
const targetDate = incomingTargetDate || extractTargetDate(question, date);

if (isFoodLog(question)) {
const { meal, missing } = buildMealFromText(question, detectMealType(question, "snack"));
if (!meal) {
return Response.json({ type: "advice", targetDate, answer: `I could not match every food confidently.\n\nMissing or unclear:\n${(missing || []).map((m) => `- ${m}`).join("\n")}\n\nPlease tell me the full food again, like “1 cup cottage cheese” or “2 whole eggs and half avocado.”` });
}
return Response.json({ type: "meal_review", targetDate, defaultAction: "eat", meal, answer: "Review this meal before saving. The numbers below are calculated by the app food database, not by AI." });
}

if (isPlanning(question)) {
const mealsPlanned = buildSimplePlan(question).filter(Boolean);
return Response.json({
type: mealsPlanned.length === 1 ? "meal_review" : "meal_plan",
targetDate,
defaultAction: "plan",
meal: mealsPlanned.length === 1 ? mealsPlanned[0] : null,
meals: mealsPlanned,
answer: mealsPlanned.length === 1 ? "Review this planned meal before saving." : `Here is a planned meal set for ${targetDate}. Add individual meals or add the full plan.`
});
}

const answer = await askOpenAI(question, totals, goals, meals);
return Response.json({ type: "advice", targetDate, answer });
} catch (error) {
return Response.json({ error: error.message || "Unexpected server error." }, { status: 500 });
}
}