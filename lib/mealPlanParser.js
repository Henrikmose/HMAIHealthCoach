export function parseMealPlan(text) {
try {
const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

const meals = [];
let currentMeal = null;

function cleanLine(line) {
return line.replace(/#/g, "").trim();
}

function isMealHeader(line) {
const l = cleanLine(line).toLowerCase();
return (
l.startsWith("breakfast") ||
l.startsWith("lunch") ||
l.startsWith("dinner") ||
l.startsWith("snack")
);
}

function isDailyTotal(line) {
return cleanLine(line).toLowerCase().startsWith("daily total");
}

for (let i = 0; i < lines.length; i++) {
let line = cleanLine(lines[i]);

// ===== NEW MEAL =====
if (isMealHeader(line)) {
if (currentMeal) meals.push(currentMeal);

currentMeal = {
meal_type: line.toLowerCase(),
food: "",
calories: 0,
protein: 0,
carbs: 0,
fat: 0,
servings: 1,
};

continue;
}

// ===== DAILY TOTAL → STOP PARSING =====
if (isDailyTotal(line)) {
break;
}

if (!currentMeal) continue;

// ===== FOODS =====
if (line.toLowerCase().startsWith("- foods")) {
currentMeal.food = line.replace(/- foods:\s*/i, "").trim();
}

// ===== CALORIES =====
if (line.toLowerCase().includes("calories")) {
const match = line.match(/\d+/);
if (match) currentMeal.calories = parseInt(match[0]);
}

// ===== PROTEIN =====
if (line.toLowerCase().includes("protein")) {
const match = line.match(/\d+/);
if (match) currentMeal.protein = parseInt(match[0]);
}

// ===== CARBS =====
if (line.toLowerCase().includes("carbs")) {
const match = line.match(/\d+/);
if (match) currentMeal.carbs = parseInt(match[0]);
}

// ===== FAT =====
if (line.toLowerCase().includes("fat")) {
const match = line.match(/\d+/);
if (match) currentMeal.fat = parseInt(match[0]);
}
}

if (currentMeal) meals.push(currentMeal);

// 🚨 SAFETY CHECK
if (meals.length === 0) {
throw new Error("No meals parsed");
}

return meals;
} catch (err) {
console.error("PARSE ERROR:", err);
return null;
}
}
export function getLocalDate(){
    const now = new Date ();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2,"0");
    const day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
}