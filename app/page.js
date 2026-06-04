"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import HamburgerMenu from "./components/HamburgerMenu";

// ========================================
// DATE UTILITIES
// ========================================

function getLocalDate() {
const now = new Date();
return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, days) {
const d = new Date(dateStr + "T12:00:00");
d.setDate(d.getDate() + days);
return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function extractTargetDate(text, surroundingTexts) {
// Check all provided texts for tomorrow/yesterday
const allTexts = [text, ...(surroundingTexts || [])].join(" ").toLowerCase();
if (allTexts.includes("tomorrow")) return addDays(getLocalDate(), 1);
if (allTexts.includes("yesterday")) return addDays(getLocalDate(), -1);
return getLocalDate();
}

// ========================================
// INTENT DETECTION
// ========================================

function isLogMessage(text) {
if (!text) return false;
return [
/\bi\s+(\w+\s+)?(ate|had|drank|consumed)/i,
/\bi'?ve\s+(just\s+)?(had|eaten|consumed)/i,
/\bjust\s+(ate|had|eaten)/i,
].some((p) => p.test(text));
}

function isMealPlanningRequest(text) {
if (!text) return false;
return [
/what\s+should\s+i\s+eat/i,
/what\s+can\s+i\s+eat/i,
/what\s+do\s+i\s+eat/i,
/what\s+should\s+i\s+have/i,
/what\s+should\s+i\s+make/i,
/what\s+can\s+i\s+make/i,
/what\s+can\s+i\s+cook/i,
/what\s+to\s+make/i,
/i\s+have\s+(some\s+)?(chicken|beef|fish|salmon|turkey|pork|tofu|eggs|rice|pasta|potatoes|vegetables|veggies)/i,
/plan\s+my\s+meals/i,
/meal\s+plan/i,
/create.*meal/i,
/make.*meal/i,
/suggest.*meal/i,
/suggest.*eat/i,
/recommend.*eat/i,
/recommend.*meal/i,
/what.*eat.*game/i,
/what.*eat.*race/i,
/what.*eat.*before/i,
/what.*eat.*today/i,
/what.*eat.*tonight/i,
/ideal\s+meal/i,
/give.*meal/i,
/yes\s+please/i, /yes.*plan/i,
/sure.*plan/i,
/create.*plan/i,
/make.*plan/i,
/build.*plan/i,
/great.*plan/i,
/can you.*plan/i,
/help.*plan/i,
/put together.*plan/i,
/plan.*today/i,
/plan.*tonight/i,
/plan.*tomorrow/i,
/plan.*game/i,
/plan.*race/i,
/plan.*match/i,
/plan.*event/i,
/plan.*for.*me/i,
/plan.*my.*day/i,
/plan.*my.*week/i,
/fuel.*race/i,
/fuel.*game/i,
/eat.*race\s+day/i,
/race\s+day.*eat/i,
/how.*eat.*race/i,
/how.*eat.*game/i,
// Broader dinner/meal suggestion patterns
/help.*deciding.*dinner/i,
/help.*deciding.*lunch/i,
/help.*deciding.*breakfast/i,
/what.*have.*dinner/i,
/what.*have.*lunch/i,
/what.*have.*breakfast/i,
/dinner.*macros/i,
/lunch.*macros/i,
/hit.*macros/i,
/reach.*macros/i,
/recommendations.*eat/i,
/what.*recommendations/i,
/ideas.*eat/i,
/ideas.*dinner/i,
/ideas.*lunch/i,
/tell me.*dinner/i,
/tell me.*eat/i,
/deciding.*eat/i,
/for\s+dinner\b/i,
/for\s+lunch\b/i,
/for\s+breakfast\b/i,
].some((p) => p.test(text));
}

function isConfirmation(text) {
if (!text) return false;
return /\b(yes|yeah|yep|yup|yew|yea|ya|ye|sure|perfect|great|sounds good|i like that|let'?s do|that one|i'?ll have|add it|can we do that|looks good|works for me|do that one|i want that|i'?ll take|love it|that works|go with that|do it|let'?s go with|as planned|as actual|for later|plan it|log it|save it|add (it |this )?(to my )?(plan|log)|confirm|correct|right|exactly|absolutely|i'?ll go|i will go|go over|i'?ll take that|i choose|going with|i'?ll have that|that one|the (protein|shake|fitzels|first|second|last|other) one)\b/i.test(text);
}

function isMealSwap(text) {
if (!text) return false;
return /i ran out|don'?t have|don'?t want|out of|no more|something else|another option|another suggestion|swap|give me another|can'?t make|different option|instead of|instead|replace|substitute|change it|can you change|no (salmon|chicken|beef|fish|meat|that)/i.test(text);
}

function isFutureMeal(text) {
if (!text) return false;
return /\b(i'?ll have|i will have|i'?m (going to|gonna) have|i'?m planning (to have|on having)|planning to eat|going to eat|will eat|i'?ll eat|having .* (tonight|later|for dinner|for lunch|for breakfast|after|tomorrow))\b/i.test(text);
}

function detectPhotoIntent(text) {
if (!text) return "unknown";
const lower = text.toLowerCase();
if (/i (just |already )?(had|ate|drank|consumed|finished)/i.test(lower)) return "eaten";
if (/for (dinner|lunch|breakfast|snack|later|tonight|tomorrow)/i.test(lower)) return "planned";
if (/(going to|will have|planning|saving|for when i get home|store|shopping|found this)/i.test(lower)) return "planned";
if (/(which|better|compare|vs|versus|best for|recommend|should i (get|buy|choose))/i.test(lower)) return "compare";
if (/(menu|order|what (should|can) i (get|order|have)|restaurant)/i.test(lower)) return "menu";
return "unknown";
}

function isWeightGoalRequest(text) {
if (!text) return false;
return [
/want.*lose/i,
/want.*drop/i,
/want.*shed/i,
/trying.*lose/i,
/lose.*pounds/i,
/drop.*pounds/i,
/lose.*weight/i,
/gain.*weight/i,
/bulk.*up/i,
].some((p) => p.test(text));
}

function extractMealType(text) {
if (!text) return null;
const lower = text.toLowerCase();
if (lower.includes("breakfast")) return "breakfast";
if (lower.includes("lunch")) return "lunch";
if (lower.includes("dinner")) return "dinner";
if (lower.includes("snack")) return "snack";
return null;
}

function inferMealTypeFromHour(hour) {
if (hour < 11) return "breakfast";
if (hour < 14) return "lunch";
if (hour < 17) return "snack";
return "dinner";
}

// ========================================
// MEAL PARSER
// Supports multiple Snacks (pre-game, post-game etc.)
// Only one Breakfast, Lunch, or Dinner per plan.
// ========================================

function parseAllMeals(text) {
if (!text) return [];

const meals = [];
const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
const mealCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
const lines = text.split("\n").map((l) => l.trim());
let i = 0;

while (i < lines.length) {
const line = lines[i];
const lineLower = line.toLowerCase().trim();

let matchedType = null;
for (const type of mealTypes) {
const startsWithType =
lineLower === type ||
lineLower.startsWith(type + " ") ||
lineLower.startsWith(type + "(");
const isNotDataLine =
!lineLower.includes("total") &&
!lineLower.includes("calories:") &&
!line.startsWith("-");

if (startsWithType && isNotDataLine) {
matchedType = type;
break;
}
}

if (matchedType) {
let foods = null, calories = null, protein = null, carbs = null, fat = null;
let j = i + 1;

while (j < lines.length && j < i + 15) {
const fl = lines[j];
const fll = fl.toLowerCase().trim();

const isNextMeal = mealTypes.some(
(t) => fll === t || fll.startsWith(t + " ") || fll.startsWith(t + "(")
);
const isTotal =
fll.startsWith("total") ||
fll.includes("📊") ||
fll.startsWith("this plan") ||
fll.startsWith("---");

if (isNextMeal || isTotal) break;

if (fll.startsWith("- foods:")) foods = fl.replace(/^-\s*foods:\s*/i, "").trim();
else if (fll.startsWith("- calories:")) { const m = fl.match(/[\d.]+/); if (m) calories = parseFloat(m[0]); }
else if (fll.startsWith("- protein:")) { const m = fl.match(/[\d.]+/); if (m) protein = parseFloat(m[0]); }
else if (fll.startsWith("- carbs:")) { const m = fl.match(/[\d.]+/); if (m) carbs = parseFloat(m[0]); }
else if (fll.startsWith("- fat:")) { const m = fl.match(/[\d.]+/); if (m) fat = parseFloat(m[0]); }

j++;
}

if (foods && calories !== null) {
mealCounts[matchedType]++;
const count = mealCounts[matchedType];

// Deduplicate — only one Breakfast, Lunch, Dinner allowed per plan
// Snacks can repeat freely
if (matchedType !== "snack" && count > 1) {
i = j;
continue; // skip duplicate non-snack blocks
}

const displayType =
matchedType === "snack" && count > 1
? `snack_${count}`
: matchedType;

meals.push({
mealType: matchedType,
displayType,
food: foods,
calories: Math.round(calories),
protein: Math.round(protein || 0),
carbs: Math.round(carbs || 0),
fat: Math.round(fat || 0),
});
}

i = j;
} else {
i++;
}
}

// Inline fallback
if (meals.length === 0) {
const re = /(breakfast|lunch|dinner|snack)\s*[-–]\s*foods?:\s*([^-\n]+?)\s*[-–]\s*calories?:\s*(\d+)\s*[-–]\s*protein?:\s*(\d+)\s*[-–]\s*carbs?:\s*(\d+)\s*[-–]\s*fat?:\s*(\d+)/gi;
const inlineCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
let m;
while ((m = re.exec(text)) !== null) {
const type = m[1].toLowerCase();
inlineCounts[type]++;
const displayType =
type === "snack" && inlineCounts[type] > 1
? `snack_${inlineCounts[type]}`
: type;

meals.push({
mealType: type,
displayType,
food: m[2].trim(),
calories: Math.round(parseFloat(m[3])),
protein: Math.round(parseFloat(m[4])),
carbs: Math.round(parseFloat(m[5])),
fat: Math.round(parseFloat(m[6])),
});
}
}

return meals;
}

// ========================================
// STRUCTURED MEAL DATA (JSON) — Batch 2.1 output, Session 1 consumer
// ========================================
// Claude appends <<<MEAL_DATA>>>{...}<<<END_MEAL_DATA>>> to food-log responses.
// The JSON contains per-food items with canonical names and DB-resolved or AI-estimated macros.
// We extract it for accurate per-food saves, strip it from the displayed message,
// and fall back to parseAllMeals if the JSON is missing or malformed.

const MEAL_DATA_REGEX = /<<<MEAL_DATA>>>\s*([\s\S]*?)\s*<<<END_MEAL_DATA>>>/;

function extractMealData(text) {
  if (!text) return null;
  const match = text.match(MEAL_DATA_REGEX);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    // Minimal shape validation — must have meal_type and items[] with at least one entry
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.meal_type || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch (err) {
    console.warn("MEAL_DATA JSON parse failed:", err.message, match[1].slice(0, 200));
    return null;
  }
}

function stripMealData(text) {
  if (!text) return text;
  return text.replace(MEAL_DATA_REGEX, "").trim();
}

// Convert MEAL_DATA into save-ready meal rows — one per food item.
// Each row matches the shape that saveMealViaAPI expects (mealType, food, calories, protein, carbs, fat).
// This is what kills the merged-row bug: a multi-food meal becomes N rows in actual_meals/planned_meals.
function mealDataToSaveRows(mealData) {
  if (!mealData || !Array.isArray(mealData.items)) return [];
  return mealData.items.map((item, idx) => {
    // Build a clean food string from the item parts.
    // Prefer canonical_name + amount + unit. Fall back to user_text if canonical is missing.
    const namePart = item.canonical_name || item.user_text || "Unknown food";
    const qtyPart = item.amount && item.unit ? `${item.amount} ${item.unit}` : (item.amount ? `${item.amount}` : "");
    const food = qtyPart ? `${namePart}, ${qtyPart}` : namePart;
    return {
      mealType: mealData.meal_type,
      displayType: mealData.meal_type, // single meal_type per JSON; suffix logic not needed here
      food,
      calories: Math.round(Number(item.calories) || 0),
      protein: Math.round(Number(item.protein) || 0),
      carbs: Math.round(Number(item.carbs) || 0),
      fat: Math.round(Number(item.fat) || 0),
    };
  });
}

// ========================================
// MEAL KEY AND LABEL HELPERS
// ========================================

function getMealKey(msgIdx, meal) {
const foodKey = meal.food.substring(0, 20).replace(/\s/g, "_");
return `${msgIdx}-${meal.displayType}-${meal.calories}-${foodKey}`;
}

function getMealLabel(displayType) {
const labels = {
breakfast: "Breakfast",
lunch: "Lunch",
dinner: "Dinner",
snack: "Snack",
snack_2: "Snack 2",
snack_3: "Snack 3",
};
return labels[displayType] || displayType.charAt(0).toUpperCase() + displayType.slice(1);
}

// ========================================
// API SAVE (server-side route bypasses RLS)
// ========================================

async function saveMealViaAPI(table, meal, userId) {
  const res = await fetch("/api/save-meals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, meal, userId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    console.error(`Save failed (${table}): ${msg}`, parsed);
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data.success) {
    console.error(`Save rejected (${table}):`, data);
    throw new Error(data.error || "Save rejected by server");
  }
  return true;
}

// ========================================
// MACRO PROGRESS BAR COMPONENT
// ========================================

function MacroBar({ label, value, goal, color }) {
const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
return (
<div className="flex-1">
<div className="flex justify-between mb-1">
<span className="text-xs text-gray-500 font-medium">{label}</span>
<span className="text-xs font-bold text-gray-700">
{Math.round(value)}
<span className="text-gray-400 font-normal">/{goal}g</span>
</span>
</div>
<div className="h-2 bg-gray-100 rounded-full overflow-hidden">
<div
className="h-2 rounded-full transition-all duration-500"
style={{ width: `${pct}%`, backgroundColor: color }}
/>
</div>
</div>
);
}

// ========================================
// MAIN PAGE COMPONENT
// ========================================

export default function HomePage() {
const router = useRouter();
const [message, setMessage] = useState("");
const [history, setHistory] = useState([]);
const [isLoading, setIsLoading] = useState(false);
const [activeMealLog, setActiveMealLog] = useState(null);
const [todayMeals, setTodayMeals] = useState([]);
const [plannedMeals, setPlannedMeals] = useState([]);
const [userId, setUserId] = useState(null);
const [userName, setUserName] = useState("");
const [goals, setGoals] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
const [pendingImages, setPendingImages] = useState([]); // max 4: [{ base64, mimeType, preview }]
const [showPhotoMenu, setShowPhotoMenu] = useState(false);
const [loadingStage, setLoadingStage] = useState("");

// Session 2: dismissedPlanKeys persists to localStorage scoped to today's date.
// NOT a database — purely a UI marker so cancelled meal cards stay hidden across navigation.
// Nothing about cancelled meals touches actual_meals or planned_meals. Clears at midnight.
const [dismissedPlanKeys, setDismissedPlanKeys] = useState(() => {
if (typeof window !== "undefined") {
const storedDate = localStorage.getItem("dismissedPlanKeysDate");
if (storedDate === getLocalDate()) {
const stored = localStorage.getItem("dismissedPlanKeys");
if (stored) {
try { return new Set(JSON.parse(stored)); } catch { return new Set(); }
}
}
}
return new Set();
});

// Session 2: dismissedReviewIds persists the same way — ephemeral UI markers for 4-button review Cancel/Edit.
// Note: these are message indices, which are stable within a session but reset when message order changes.
// For best behavior, we also store a content-hash so reloads can recover dismissals.
const [dismissedReviewIds, setDismissedReviewIds] = useState(() => {
if (typeof window !== "undefined") {
const storedDate = localStorage.getItem("dismissedReviewIdsDate");
if (storedDate === getLocalDate()) {
const stored = localStorage.getItem("dismissedReviewIds");
if (stored) {
try { return new Set(JSON.parse(stored)); } catch { return new Set(); }
}
}
}
return new Set();
});

// Persist dismissedPlanKeys whenever it changes
useEffect(() => {
if (typeof window !== "undefined") {
localStorage.setItem("dismissedPlanKeysDate", getLocalDate());
localStorage.setItem("dismissedPlanKeys", JSON.stringify([...dismissedPlanKeys]));
}
}, [dismissedPlanKeys]);

// Persist dismissedReviewIds whenever it changes
useEffect(() => {
if (typeof window !== "undefined") {
localStorage.setItem("dismissedReviewIdsDate", getLocalDate());
localStorage.setItem("dismissedReviewIds", JSON.stringify([...dismissedReviewIds]));
}
}, [dismissedReviewIds]);

const messagesEndRef = useRef(null);
const textareaRef = useRef(null);
const cameraInputRef = useRef(null);
const libraryInputRef = useRef(null);

useEffect(() => {
  async function initAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      router.push("/signin");
      return;
    }
    setUserId(user.id);
    setUserName(user.user_metadata?.name || "");
  }
  initAuth();
}, []);

useEffect(() => {
if (userId) {
loadGoals(userId);
loadTodayMeals(userId);
loadPlannedMeals(userId);
loadTodayMessages(userId);
}
}, [userId]);

// Session 2: refresh DB-derived state when user returns to Coach tab from Dashboard or background.
// This is what fixes the orphan-button / re-tappable / cancelled-reappearing / edited-reverting symptoms.
// Without this, todayMeals + plannedMeals stay stale (loaded once on mount), so mealAlreadyInDb
// keeps returning false for meals saved in a different tab/screen.
useEffect(() => {
if (!userId) return;

const refresh = () => {
if (document.visibilityState === "visible") {
loadTodayMeals(userId);
loadPlannedMeals(userId);
loadTodayMessages(userId);
}
};

window.addEventListener("focus", refresh);
document.addEventListener("visibilitychange", refresh);

return () => {
window.removeEventListener("focus", refresh);
document.removeEventListener("visibilitychange", refresh);
};
}, [userId]);

useEffect(() => {
messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [history]);

useEffect(() => {
if (textareaRef.current) {
textareaRef.current.style.height = "auto";
textareaRef.current.style.height =
Math.min(textareaRef.current.scrollHeight, 140) + "px";
}
}, [message]);

async function loadGoals(uid) {
try {
const { data } = await supabase
.from("goals").select("*").eq("user_id", uid).single();
if (data) {
setGoals({
calories: data.calories,
protein: data.protein,
carbs: data.carbs,
fat: data.fat,
});
}
} catch (e) {
console.log("Goals load error:", e);
}
}

async function loadTodayMeals(uid) {
try {
const { data } = await supabase
.from("actual_meals").select("*")
.eq("user_id", uid)
.eq("date", getLocalDate());
setTodayMeals(data || []);
} catch (e) {
console.log("Meals load error:", e);
}
}

async function loadPlannedMeals(uid) {
try {
// Fix: load today AND all future planned meals so mealAlreadyInDb can match
// tomorrow/future plans (was: .eq("date", getLocalDate()) which only loaded today,
// causing duplicates when planning for future dates because cards never recognized as saved).
const { data } = await supabase
.from("planned_meals").select("*")
.eq("user_id", uid)
.gte("date", getLocalDate());
setPlannedMeals(data || []);
} catch (e) {
console.log("Planned meals load error:", e);
}
}

async function loadTodayMessages(uid) {
try {
// Session 2: filter to today's messages only (was: last 20 messages across all days).
// Avoids yesterday's stale meal cards reappearing in chat after midnight.
const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);
const todayStartIso = todayStart.toISOString();

const { data } = await supabase
.from("ai_messages").select("*")
.eq("user_id", uid)
.gte("created_at", todayStartIso)
.order("created_at", { ascending: false })
.limit(20);

if (data && data.length > 0) {
const rebuilt = [];
for (const row of data.reverse()) {
if (row.message) rebuilt.push({ role: "user", content: row.message });
if (row.response) {
  // Session 1 fix: re-extract structured MEAL_DATA from the stored raw response and strip it from the displayed content.
  // The JSON is persisted raw in ai_messages.response (for debuggability and re-extraction), but never shown to the user.
  const rawResponse = row.response;
  const reloadedMealData = extractMealData(rawResponse);
  const displayResponse = stripMealData(rawResponse);
  // Session 2.5 fix: count meal blocks to decide reconstruction strategy.
  // 1 meal → 4-button review (single-meal log)
  // 2+ meals → null, let multi-meal planning UI render with per-card buttons + Add all
  const reloadedMealCount = parseAllMeals(displayResponse).length;
  rebuilt.push({
    role: "assistant",
    content: displayResponse,
    mealData: reloadedMealData || null,
    // Resolved fix (Session 2.5): carry the ai_messages row id + resolved flag forward.
    // When resolved === true, render NO buttons of any kind for this message (action already taken).
    aiMessageId: row.id,
    resolved: row.resolved === true,
    // Reconstruct mealReview ONLY for single-meal messages, and only if not resolved.
    // Multi-meal plans get null so they fall through to the per-card planning UI.
    mealReview: row.resolved === true ? null : (
      reloadedMealCount === 1
        ? { actions: ["add_to_eaten", "add_to_planned", "edit", "cancel"] }
        : null
    ),
  });
}
}
setHistory(rebuilt);
}
} catch (e) {
console.log("Messages load error:", e);
}
}

const totals = todayMeals.reduce(
(t, m) => ({
calories: t.calories + Number(m.calories || 0),
protein: t.protein + Number(m.protein || 0),
carbs: t.carbs + Number(m.carbs || 0),
fat: t.fat + Number(m.fat || 0),
}),
{ calories: 0, protein: 0, carbs: 0, fat: 0 }
);

const calPct = goals.calories > 0
? Math.min(100, Math.round((totals.calories / goals.calories) * 100))
: 0;

async function handleSend() {
const trimmed = message.trim();
if ((!trimmed && pendingImages.length === 0) || isLoading) return;

const uid = userId;
setMessage("");
setIsLoading(true);

const userMsg = {
role: "user",
content: trimmed || (pendingImages.length > 0 ? `📷 ${pendingImages.length > 1 ? pendingImages.length + " photos" : "Photo"}` : ""),
imagePreviews: pendingImages.map(img => img.preview),
};
let newHistory = [...history, userMsg];
setHistory(newHistory);

const imagesToSend = [...pendingImages];
setPendingImages([]);

// Set loading stage based on what's being sent
if (imagesToSend.length > 1) {
setLoadingStage("Comparing labels...");
} else if (imagesToSend.length === 1) {
setLoadingStage("Scanning label...");
} else {
setLoadingStage("Thinking...");
}

// Progressive messages for photo calls
let stageTimer;
if (imagesToSend.length > 0) {
stageTimer = setTimeout(() => setLoadingStage("Reading nutrition values..."), 2500);
setTimeout(() => setLoadingStage("Almost done..."), 5500);
}

try {
let context = {};
let newActiveMealLog = activeMealLog;

// Check if user is confirming a previously suggested meal — MUST check before planning detection
// Look at last 4 AI messages in case the most recent was a text-only response
const recentAiMsgs = [...history].reverse().filter(m => m.role === "assistant").slice(0, 4);
const anyRecentAiHadMeals = recentAiMsgs.some(m => parseAllMeals(m.content).length > 0);
const lastAiHadMeals = anyRecentAiHadMeals;

if (isLogMessage(trimmed)) {
// DB-FIRST ARCHITECTURE: Try USDA lookup before calling AI
setLoadingStage("Looking up foods in database...");

try {
const lookupResponse = await fetch("/api/lookup-foods", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ message: trimmed }),
});

const lookupData = await lookupResponse.json();

// If ALL foods found in DB, skip AI entirely
// If ALL foods found in DB, build a meal review (same 4-button UI as the AI path) — skip Claude entirely.
// The user still confirms via Add to Eaten / Add to Planned / Edit / Cancel.
if (lookupData.found && lookupData.found.length > 0 && lookupData.missing.length === 0) {
  const mealType = extractMealType(trimmed) || inferMealTypeFromHour(hour);
  const mealTypeLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1).toLowerCase();

  // Build the meal block text in the exact format parseAllMeals expects.
  const foodsLine = lookupData.found.map(f => `${f.food}, ${f.amount} ${f.unit}`).join("; ");
  const totalCals = lookupData.found.reduce((s, f) => s + f.calories, 0);
  const totalProtein = lookupData.found.reduce((s, f) => s + f.protein, 0);
  const totalCarbs = lookupData.found.reduce((s, f) => s + f.carbs, 0);
  const totalFat = lookupData.found.reduce((s, f) => s + f.fat, 0);

  const breakdown = lookupData.found.map(f =>
    `${f.food} — ${f.calories} cal, ${f.protein}g P, ${f.carbs}g C, ${f.fat}g F`
  ).join(" | ");

  const mealBlock =
    `${mealTypeLabel}\n` +
    `- Foods: ${foodsLine}\n` +
    `- Calories: ${Math.round(totalCals)}\n` +
    `- Protein: ${Math.round(totalProtein)}g\n` +
    `- Carbs: ${Math.round(totalCarbs)}g\n` +
    `- Fat: ${Math.round(totalFat)}g\n\n` +
    `Breakdown: ${breakdown}`;

  // Assistant message attaches the standard mealReview actions so the existing 4-button UI renders.
  const reviewMessage = {
    role: "assistant",
    content: `Review this meal before saving:\n\n${mealBlock}`,
    mealReview: { actions: ["add_to_eaten", "add_to_planned", "edit", "cancel"] },
  };

  setHistory([...newHistory, reviewMessage]);
  setIsLoading(false);
  setLoadingStage("");
  return; // Skip AI call entirely — DB had everything we needed

}
} catch (lookupError) {
console.log("DB lookup failed, falling back to AI:", lookupError);
}

// If DB lookup failed or foods missing, proceed with AI
setLoadingStage("Asking coach...");
newActiveMealLog = {
type: "food_log",
originalMessage: trimmed,
mealType: extractMealType(trimmed),
conversationStage: "initial",
};
setActiveMealLog(newActiveMealLog);
context = newActiveMealLog;
} else if (isFutureMeal(trimmed) && !isMealPlanningRequest(trimmed)) {
// Future tense food statement → treat as planned meal
newActiveMealLog = null;
setActiveMealLog(null);
context = { type: "meal_planning", request: trimmed, isFutureMeal: true };
} else if (imagesToSend.length > 0) {
const photoIntent = detectPhotoIntent(trimmed);
newActiveMealLog = null;
setActiveMealLog(null);
context = {
type: "photo",
photoIntent,
imageCount: imagesToSend.length,
message: trimmed,
};
} else if (isConfirmation(trimmed) && lastAiHadMeals) {
// User confirmed — save meals from previous AI message directly, skip AI call
const mostRecentAiMsg = recentAiMsgs[0];
const meals = mostRecentAiMsg ? parseAllMeals(mostRecentAiMsg.content) : [];

if (meals.length > 0) {
const uid = userId;

// Detect target date from context (today vs tomorrow)
const surroundingTexts = history.slice(Math.max(0, history.length - 6)).map(m => m.content || "");
const targetDate = extractTargetDate(trimmed, surroundingTexts);

let savedCount = 0;

for (const meal of meals) {
const saved = await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
if (saved) savedCount++;
}

if (savedCount > 0) {
await loadPlannedMeals(uid);
const confirmMsg = savedCount === 1
? `Done — ${meals[0].displayType} added to your plan.`
: `Done — all ${savedCount} meals added to your plan.`;
setHistory([...newHistory, { role: "assistant", content: confirmMsg }]);

// Close the meal plan message so it's never looked up again
const mostRecentAiIdx = history.lastIndexOf(mostRecentAiMsg);

} else {
setHistory([...newHistory, { role: "assistant", content: "Sorry, couldn't save. Please try again." }]);
}

setIsLoading(false);
setLoadingStage("");
return; // Skip AI call entirely
}

// Fallback: if no meals found, route to AI
newActiveMealLog = null;
setActiveMealLog(null);
context = { type: "meal_planning", request: trimmed, isConfirmation: true };
} else if (isMealPlanningRequest(trimmed) || isWeightGoalRequest(trimmed) || isMealSwap(trimmed)) {
// CRITICAL: Check meal planning/swap BEFORE activeMealLog fallback
// This prevents meal planning requests from being treated as food log follow-ups

if (isMealSwap(trimmed) && history.some(m => m.role === "assistant" && parseAllMeals(m.content).length > 0)) {
// Delete the previous AI message with meals to avoid confusion
const lastAiMealIdx = history.findLastIndex(m => m.role === "assistant" && parseAllMeals(m.content).length > 0);
if (lastAiMealIdx >= 0) {
newHistory = [...history.slice(0, lastAiMealIdx), ...history.slice(lastAiMealIdx + 1)];
}
context = { type: "meal_planning", request: trimmed, isSwap: true };
} else {
context = { type: "meal_planning", request: trimmed };
}

newActiveMealLog = null;
setActiveMealLog(null);
} else if (activeMealLog) {
newActiveMealLog = {
...activeMealLog,
followUpMessage: trimmed,
conversationStage: "followup",
};
setActiveMealLog(newActiveMealLog);
context = newActiveMealLog;
}

const res = await fetch("/api/coach", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
message: trimmed,
context,
history: newHistory.slice(-1).map((m) => ({ role: m.role, content: m.content })),
userId: uid,
localHour: new Date().getHours(),
localDate: getLocalDate(),
images: imagesToSend.length > 0 ? imagesToSend.map(img => ({ base64: img.base64, mimeType: img.mimeType })) : null,
}),
});

const data = await res.json();
const reply = data.reply || "Sorry, could not get a response.";

// Session 1: extract the structured MEAL_DATA JSON block (if present) and strip it from the displayed text.
// The JSON is for the save handler; the user should never see it in chat.
const mealData = extractMealData(reply);
const displayReply = stripMealData(reply);

const parsedReplyMeals = parseAllMeals(displayReply);
const shouldForceMealReview =
isLogMessage(trimmed) &&
(
parsedReplyMeals.length > 0 ||
/foods:|calories:|protein:|carbs:|fat:|breakdown:/i.test(displayReply)
);

const cleanedReplyForReview = displayReply
.replace(/you'?ve logged this meal\.?\s*✅?/gi, "")
.replace(/meal logged\.?\s*✅?/gi, "")
.replace(/logged as eaten\.?/gi, "")
.trim();

const assistantMessage = {
role: "assistant",
content: shouldForceMealReview && !displayReply.includes("Review this meal before saving:")
? `Review this meal before saving:

${cleanedReplyForReview}`
: displayReply,
mealReview: data.mealReview || (
shouldForceMealReview
? { actions: ["add_to_eaten", "add_to_planned", "edit", "cancel"] }
: null
),
needsConfirmation: data.needsConfirmation || shouldForceMealReview,
mealData: mealData || null, // Session 1: attach structured items for per-food save in handleMealReviewAction
};

setHistory([
...newHistory,
assistantMessage,
]);

// The AI response index in history — used to close it after saving
const aiMsgIdx = newHistory.length;

if (false && newActiveMealLog?.type === "food_log") {
const parsed = parseAllMeals(reply);
if (parsed.length > 0) {
const meal = { ...parsed[0], date: getLocalDate() };
if (!meal.mealType && newActiveMealLog.mealType) {
meal.mealType = newActiveMealLog.mealType;
}
const saved = await saveMealViaAPI("actual_meals", meal, uid);
if (saved) {
setActiveMealLog(null);
await loadTodayMeals(uid);

}
}
}

// Photo logs now flow through the same 4-button review as text logs (Rule 1: no auto-save, ever).
// Previously had an auto-save block here that wrote to actual_meals without user confirmation.
// Removed — the photo response goes through shouldForceMealReview / planning UI just like text.
} catch (err) {
console.error("Send error:", err);
setHistory([
...newHistory,
{ role: "assistant", content: "Something went wrong. Please try again." },
]);
} finally {
setIsLoading(false);
setLoadingStage("");
if (stageTimer) clearTimeout(stageTimer);
}
}

async function handleAddToPlan(meal, msgIdx, targetDate) {
const uid = userId;

// Session 2: check if this meal already exists in DB instead of in savedPlanKeys.
// mealAlreadyInDb logic is duplicated here as a guard (the function is defined in render scope).
const alreadyExists = (rows) => rows.some(r =>
r.date === targetDate &&
r.meal_type === meal.mealType &&
r.food === meal.food &&
Math.abs(Number(r.calories) - Number(meal.calories)) < 5
);
if (alreadyExists(plannedMeals) || alreadyExists(todayMeals)) {
return; // Already saved to DB — no-op, render will hide the button on next paint
}

// Only replace for Breakfast/Lunch/Dinner — Snacks can stack
if (meal.mealType !== "snack") {
const { data: existing } = await supabase
.from("planned_meals")
.select("id")
.eq("user_id", uid)
.eq("meal_type", meal.mealType)
.eq("date", targetDate);

if (existing && existing.length > 0) {
for (const e of existing) {
await supabase.from("planned_meals").delete().eq("id", e.id);
}
}
}

try {
      await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
     
      await loadPlannedMeals(uid);
    } catch (err) {
      alert(`Could not save to plan: ${err.message || "Please try again."}`);
    }
}

async function handleAddAllToPlan(meals, msgIdx, targetDate) {
    const uid = userId;
    const failures = [];
    for (const meal of meals) {
      // Session 2: skip meals already in DB instead of using savedPlanKeys.
      const alreadyExists = (rows) => rows.some(r =>
        r.date === targetDate &&
        r.meal_type === meal.mealType &&
        r.food === meal.food &&
        Math.abs(Number(r.calories) - Number(meal.calories)) < 5
      );
      if (alreadyExists(plannedMeals) || alreadyExists(todayMeals)) {
        continue;
      }
      try {
          await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
        } catch (err) {
          failures.push(`${meal.food}: ${err.message}`);
        }
    }
    // Session 2: always refetch — even partial successes affect plannedMeals.
    await loadPlannedMeals(uid);
    if (failures.length > 0) {
      alert(`Some meals could not be saved:\n${failures.join("\n")}`);
    }
  }


function handleEditPlanMeal(meal) {
const label = getMealLabel(meal.displayType || meal.mealType || "meal");
setHistory(prev => [
...prev,
{
role: "assistant",
content: `Got it — tell me what you'd like instead for ${label}.`,
},
]);
}

function handleCancelPlanMeal(meal, msgIdx) {
const key = getMealKey(msgIdx, meal);
setDismissedPlanKeys(prev => new Set([...prev, key]));
}

// Session 2.5: persist resolution to ai_messages.resolved so buttons disappear permanently.
// Called from all 4 action paths (eat / plan / edit / cancel) after the action is processed.
async function markMessageResolved(msg) {
let id = msg?.aiMessageId;

// Fresh in-session messages don't have an ID yet (route.js inserts but doesn't return id).
// Fallback: find the most recent unresolved row for this user — that's almost certainly the one
// the user is acting on (only one assistant message at a time can be in review state).
if (!id && userId) {
try {
const { data } = await supabase
.from("ai_messages")
.select("id")
.eq("user_id", userId)
.eq("resolved", false)
.order("created_at", { ascending: false })
.limit(1);
if (data && data.length > 0) id = data[0].id;
} catch (e) {
console.warn("Could not look up ai_messages row for resolution:", e.message);
}
}

if (!id) return;
try {
await supabase
.from("ai_messages")
.update({ resolved: true })
.eq("id", id);
} catch (e) {
console.warn("Could not mark message resolved:", e.message);
}
}

async function handleMealReviewAction(action, msg, idx) {
// Session 2.5: resolved=true survives reload via ai_messages column. All 4 action paths set it.

if (action === "cancel") {
setDismissedReviewIds(prev => new Set([...prev, idx]));
await markMessageResolved(msg);
setHistory(prev => prev.map((m, i) => 
i === idx ? { ...m, mealReview: null, reviewCompleted: true, resolved: true } : m
));
setHistory(prev => [
...prev,
{ role: "assistant", content: "Canceled — I won't save that meal." },
]);
return;
}

if (action === "edit") {
setDismissedReviewIds(prev => new Set([...prev, idx]));
await markMessageResolved(msg);
setHistory(prev => prev.map((m, i) => 
i === idx ? { ...m, mealReview: null, reviewCompleted: true, resolved: true } : m
));
setHistory(prev => [
...prev,
{ role: "assistant", content: "Got it — tell me what you actually had instead." },
]);
return;
}

try {
const uid = userId;

// Session 1: prefer structured MEAL_DATA when available (saves N rows for N foods).
// Fall back to parseAllMeals for legacy messages or when JSON is missing/malformed.
let meals = [];
if (msg.mealData) {
meals = mealDataToSaveRows(msg.mealData);
console.log("💾 Using structured MEAL_DATA — items count:", meals.length);
}
if (meals.length === 0) {
meals = parseAllMeals(msg.content);
console.log("💾 Fallback to parseAllMeals — meals count:", meals.length);
}

if (!meals.length) {
alert("No meal found to save.");
return;
}

const table = action === "eat" ? "actual_meals" : "planned_meals";

const reviewTargetDate = msg.mealReview?.targetDate || getLocalDate();

console.log("💾 Attempting to save meals:", {
  count: meals.length,
  table,
  date: reviewTargetDate,
  userId: uid,
  meals: meals
});

for (const meal of meals) {
        await saveMealViaAPI(table, {
          ...meal,
          date: reviewTargetDate,
        }, uid);
      }

// Session 2: refetch DB state immediately so render's mealAlreadyInDb returns true on next paint.
// This hides the buttons without needing a separate completion tracking set.
if (action === "eat") {
await loadTodayMeals(uid);
} else {
await loadPlannedMeals(uid);
}

// Session 2.5: persist resolution to DB so buttons stay hidden on reload.
await markMessageResolved(msg);

// Keep the in-memory mutation for immediate visual feedback this session.
// On reload, the resolved flag from ai_messages will handle the same purpose.
setHistory(prev => prev.map((m, i) => 
i === idx ? { ...m, mealReview: null, reviewCompleted: true, resolved: true } : m
));

setHistory(prev => [
...prev,
{
role: "assistant",
content: action === "eat"
? "✅ Added to your eaten food"
: "✅ Added to your planned meals",
},
]);
} catch (err) {
console.error("❌ MEAL SAVE ERROR:", err);
console.error("Error details:", {
  message: err.message,
  stack: err.stack,
  userId: userId,
  table: action === "eat" ? "actual_meals" : "planned_meals"
});
alert(`Could not save meal: ${err.message || 'Unknown error'}. Please try again.`);
}
}

function handleKeyDown(e) {
if (e.key === "Enter" && !e.shiftKey) {
e.preventDefault();
handleSend();
}
}

async function handleImageSelected(e) {
const file = e.target.files?.[0];
if (!file) return;
setShowPhotoMenu(false);

// Compress image using canvas before sending — prevents Vercel 4.5MB limit
const compressImage = (file) => new Promise((resolve) => {
const img = new Image();
const url = URL.createObjectURL(file);
img.onload = () => {
const MAX = 1024;
let { width, height } = img;
if (width > MAX || height > MAX) {
if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
else { width = Math.round(width * MAX / height); height = MAX; }
}
const canvas = document.createElement("canvas");
canvas.width = width; canvas.height = height;
canvas.getContext("2d").drawImage(img, 0, 0, width, height);
const preview = canvas.toDataURL("image/jpeg", 0.85);
const base64 = preview.split(",")[1];
URL.revokeObjectURL(url);
resolve({ base64, mimeType: "image/jpeg", preview });
};
img.src = url;
});

const compressed = await compressImage(file);
setPendingImages(prev => {
if (prev.length >= 4) return prev;
return [...prev, compressed];
});
e.target.value = "";
}

function removeImage(idx) {
setPendingImages(prev => prev.filter((_, i) => i !== idx));
}

function clearImages() {
setPendingImages([]);
}

// ── CURA Theme ──────────────────────────────────────────────────
const dark = typeof window !== "undefined"
? localStorage.getItem("cura_dark") !== "false"
: true;

const T = dark ? {
bg: "#1c1c1e",
surface: "#242424",
border: "#2c2c2c",
text: "#f0f0f0",
sub: "#888888",
muted: "#3a3a3a",
input: "#2c2c2c",
userBubble: "#2563eb",
aiBubble: "#242424",
aiBorder: "#2c2c2c",
} : {
bg: "#f5f5f5",
surface: "#ffffff",
border: "#ebebeb",
text: "#111111",
sub: "#aaaaaa",
muted: "#f0f0f0",
input: "#f5f5f5",
userBubble: "#2563eb",
aiBubble: "#ffffff",
aiBorder: "#ebebeb",
};

return (
<>
<style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
* { box-sizing: border-box; }
body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; }
`}</style>

<div style={{ display:"flex", flexDirection:"column", height:"100vh",
background: T.bg, fontFamily:"'DM Sans', sans-serif",
maxWidth: 430, margin:"0 auto" }}>

{/* Hidden file inputs */}
<input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
onChange={handleImageSelected} style={{ display:"none" }} />
<input ref={libraryInputRef} type="file" accept="image/*"
onChange={handleImageSelected} style={{ display:"none" }} />

{/* ── Sticky Header ── */}
<div style={{ position:"sticky", top:0, zIndex:50, background: T.surface,
borderBottom:`1px solid ${T.border}`, padding:"52px 20px 14px" }}>
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
<div>
<p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
textTransform:"uppercase", letterSpacing:".1em", margin:0 }}>CURA</p>
<h1 style={{ fontSize:20, fontWeight:800, color: T.text,
margin:"2px 0 0", letterSpacing:"-.02em" }}>
{userName ? `Hey ${userName} 👋` : "AI Coach"}
</h1>
</div>
<div style={{ background:"#2563eb22", border:"1px solid #2563eb44",
borderRadius:16, padding:"8px 12px", textAlign:"right" }}>
<p style={{ fontSize:15, fontWeight:800, color:"#2563eb",
margin:0, lineHeight:1.2 }}>
{totals.calories} <span style={{ fontWeight:400, color:"#3b82f6", fontSize:12 }}>/ {goals.calories}</span>
</p>
<p style={{ fontSize:10, color:"#3b82f6", margin:0, fontWeight:600 }}>
cal today · {calPct}%
</p>
</div>
</div>
{todayMeals.length > 0 && (
<div style={{ display:"flex", gap:8, marginTop:12 }}>
{[
{ label:"P", value:totals.protein, goal:goals.protein, color:"#3b82f6" },
{ label:"C", value:totals.carbs, goal:goals.carbs, color:"#10b981" },
{ label:"F", value:totals.fat, goal:goals.fat, color:"#f59e0b" },
].map(m => {
const pct = Math.min(100, Math.round((m.value/m.goal)*100));
return (
<div key={m.label} style={{ flex:1 }}>
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
<span style={{ fontSize:10, fontWeight:600, color: T.sub,
textTransform:"uppercase", letterSpacing:".05em" }}>{m.label}</span>
<span style={{ fontSize:10, fontWeight:700, color: T.text }}>
{Math.round(m.value)}g
</span>
</div>
<div style={{ height:3, background: T.muted, borderRadius:9999, overflow:"hidden" }}>
<div style={{ height:"100%", width:`${pct}%`, background: m.color,
borderRadius:9999, transition:"width .5s ease" }} />
</div>
</div>
);
})}
</div>
)}
</div>

{/* ── Messages ── */}
<div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px",
display:"flex", flexDirection:"column", gap:12, background: T.bg }}>

{history.length === 0 && (
<div style={{ display:"flex", flexDirection:"column", alignItems:"center",
justifyContent:"center", height:"100%", textAlign:"center", padding:"0 16px 80px" }}>
<div style={{ width:64, height:64, borderRadius:20, background:"#2563eb",
display:"flex", alignItems:"center", justifyContent:"center",
fontSize:28, marginBottom:16, boxShadow:"0 8px 24px #2563eb44" }}>
💬
</div>
<p style={{ fontWeight:800, color: T.text, fontSize:18, margin:"0 0 8px" }}>CURA</p>
<p style={{ fontSize:13, color: T.sub, lineHeight:1.5, maxWidth:260, margin:0 }}>
Tell me what you ate, ask for a meal plan, or get nutrition advice.
</p>
<div style={{ marginTop:20, display:"flex", flexDirection:"column",
gap:8, width:"100%", maxWidth:280 }}>
{[
"I had 8oz chicken and 1 cup rice for lunch",
"Create a meal plan for tomorrow",
"What should I eat for dinner?",
"I want to drop 10 pounds",
].map(s => (
<button key={s} onClick={() => setMessage(s)}
style={{ textAlign:"left", fontSize:13, padding:"12px 14px",
borderRadius:14, border:`1px solid ${T.border}`,
background: T.surface, color: T.sub, cursor:"pointer",
transition:"all .2s" }}>
{s}
</button>
))}
</div>
</div>
)}

{history.map((msg, idx) => {
const isUser = msg.role === "user";

// Find meals — only look back 3 messages 
const findRecentMeals = (beforeIdx) => {
const limit = Math.max(0, beforeIdx - 3);
for (let i = beforeIdx - 1; i >= limit; i--) {
if (history[i].role === "assistant") {

const m = parseAllMeals(history[i].content);
if (m.length > 0) return { meals: m, sourceIdx: i };
}
}
return { meals: [], sourceIdx: -1 };
};

const prevUserMsg = !isUser && history[idx - 1]?.role === "user" ? history[idx - 1].content : null;
const thisIsPostConfirmAI = !isUser && prevUserMsg && isConfirmation(prevUserMsg);

// Photo selection — winner pick OR "yes log it" after label advice
const isPhotoSelection = !isUser && prevUserMsg && (
/\b(whole bag|full bag|all of it|i'?ll go (with|over)|i will go (with|over)|i'?ll take that|i choose|going with|log it|add it|yes please log|want to log|add to plan|log this)\b/i.test(prevUserMsg)
|| (isConfirmation(prevUserMsg) && history.slice(Math.max(0, idx-4), idx)
.some(m => m.role === "assistant" && /want me to log|add it to your plan|log it or add/i.test(m.content)))
);

const { meals: confirmMeals, sourceIdx } = (thisIsPostConfirmAI || isPhotoSelection)
? findRecentMeals(idx) : { meals: [], sourceIdx: -1 };

const thisMeals = !isUser ? parseAllMeals(msg.content) : [];

const triggerText = !isUser && history[idx - 1]?.role === "user"
? history[idx - 1].content : "";
const surroundingTexts = history.slice(Math.max(0, idx - 6), idx).map(m => m.content || "");
const targetDate = extractTargetDate(triggerText, surroundingTexts);

// Meal-plan review buttons:
// If the assistant returned one or more meal blocks and this is NOT a food-log review,
// render each meal as its own planned-meal action.
// This supports full-day plans and partial plans like breakfast+lunch or snack+dinner.
// Session 2.5: if the message has been resolved (any of the 4 actions taken), show NO buttons.
// This is the rule the user articulated: once resolved, gone forever, no buttons of any kind.
const planMealsFromThisMessage =
!isUser && !msg.mealReview && !msg.reviewCompleted && !msg.resolved && thisMeals.length > 0
? thisMeals
: [];

const buttonMeals = planMealsFromThisMessage.length > 0
? planMealsFromThisMessage
: (thisIsPostConfirmAI && confirmMeals.length > 0)
? confirmMeals
: (isPhotoSelection && confirmMeals.length > 0)
? confirmMeals
: [];

const buttonSourceIdx = planMealsFromThisMessage.length > 0
? idx
: (sourceIdx >= 0 ? sourceIdx : idx);

// Hide buttons for meals already saved in the database (by content match).
            // This is the source of truth — survives reloads, sessions, devices.
            const mealAlreadyInDb = (m) => {
            
              const matches = (rows) => rows.some(r =>
                r.date === targetDate &&
                r.meal_type === m.mealType &&
                r.food === m.food &&
                Math.abs(Number(r.calories) - Number(m.calories)) < 5
              );
              return matches(todayMeals) || matches(plannedMeals);
            };

            const visibleButtonMeals = buttonMeals.filter((m) => {
              const key = getMealKey(buttonSourceIdx, m);
              if (dismissedPlanKeys.has(key)) return false;
              if (mealAlreadyInDb(m)) return false;
              return true;
            });

const showButtons = visibleButtonMeals.length > 0;
// Session 2: allSaved is implicit — when all meals are in DB, mealAlreadyInDb filters them all out,
// visibleButtonMeals becomes empty, and showButtons becomes false. The whole planning UI hides.
// No separate "all saved" indicator needed; the UI just collapses cleanly.
const allSaved = false;

return (
<div key={idx} style={{ display:"flex",
justifyContent: isUser ? "flex-end" : "flex-start",
alignItems:"flex-end", gap:8 }}>

{!isUser && (
<div style={{ width:32, height:32, borderRadius:10, background:"#2563eb",
display:"flex", alignItems:"center", justifyContent:"center",
fontSize:16, flexShrink:0, marginBottom:4,
boxShadow:"0 2px 8px #2563eb44" }}>
💬
</div>
)}

<div style={{ maxWidth:"82%", display:"flex", flexDirection:"column", gap:6 }}>
{/* Image previews */}
{msg.imagePreviews && msg.imagePreviews.length > 0 && (
<div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
{msg.imagePreviews.map((preview, i) => (
<img key={i} src={preview} alt={`Photo ${i+1}`}
style={{ height:90, width:90, objectFit:"cover",
borderRadius:12, border:`1px solid ${T.border}` }} />
))}
</div>
)}

{/* Message bubble */}
{msg.content && (
<div style={{
borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
padding:"12px 14px", fontSize:14, lineHeight:1.5,
whiteSpace:"pre-wrap",
background: isUser ? T.userBubble : T.aiBubble,
color: isUser ? "#fff" : T.text,
border: isUser ? "none" : `1px solid ${T.aiBorder}`,
}}>
{msg.content}
{!isUser && !msg.resolved && msg.mealReview?.actions?.length > 0 && (() => {
// Session 2: reviewDone is now DB-derived.
// A 4-button review is "done" when:
//   (a) the user dismissed it via Cancel/Edit this session (ephemeral, dismissedReviewIds), OR
//   (b) any meal extracted from this message already exists in todayMeals or plannedMeals (DB-derived, survives nav).
let reviewMeals = [];
if (msg.mealData) {
reviewMeals = mealDataToSaveRows(msg.mealData);
}
if (reviewMeals.length === 0) {
reviewMeals = parseAllMeals(msg.content);
}

const todayStr = getLocalDate();
const reviewTargetDate = msg.mealReview?.targetDate || todayStr;
const mealInDb = (m) => {
const matches = (rows) => rows.some(r =>
r.date === reviewTargetDate &&
r.meal_type === m.mealType &&
r.food === m.food &&
Math.abs(Number(r.calories) - Number(m.calories)) < 5
);
return matches(todayMeals) || matches(plannedMeals);
};

const allInDb = reviewMeals.length > 0 && reviewMeals.every(mealInDb);
const reviewDone = dismissedReviewIds.has(idx) || msg.reviewCompleted || allInDb;

// Don't show buttons if already completed
if (reviewDone) return null;

const buttonBase = {
color:"#fff",
border:"none",
borderRadius:10,
padding:"8px 12px",
fontWeight:600,
cursor:"pointer",
};

return (
<div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:12 }}>
<button
onClick={() => handleMealReviewAction("eat", msg, idx)}
style={{ ...buttonBase, background:"#10b981" }}
>
✅ Add to Eaten
</button>

<button
onClick={() => handleMealReviewAction("plan", msg, idx)}
style={{ ...buttonBase, background:"#2563eb" }}
>
📅 Add to Planned
</button>

<button
onClick={() => handleMealReviewAction("edit", msg, idx)}
style={{ ...buttonBase, background:"#f59e0b" }}
>
✏️ Edit
</button>

<button
onClick={() => handleMealReviewAction("cancel", msg, idx)}
style={{ ...buttonBase, background:"#ef4444" }}
>
❌ Cancel
</button>
</div>
);
})()}
</div>
)}

{/* Meal plan buttons */}
{showButtons && (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
{visibleButtonMeals.length > 1 && (
<button
onClick={() => handleAddAllToPlan(visibleButtonMeals, buttonSourceIdx, targetDate)}
disabled={allSaved}
style={{
fontSize:12,
padding:"10px 16px",
borderRadius:12,
fontWeight:700,
background: allSaved ? "#10b98122" : "#10b981",
color: allSaved ? "#10b981" : "#fff",
border:"none",
cursor: allSaved ? "default" : "pointer",
}}
>
{allSaved ? "✅ All selected meals added" : `+ Add all ${visibleButtonMeals.length} meals to plan`}
</button>
)}

{visibleButtonMeals.map(meal => {
const key = getMealKey(buttonSourceIdx, meal);
// Session 2: visibleButtonMeals already filters out DB-saved meals via mealAlreadyInDb.
// Belt-and-suspenders DB check here in case of any timing edge case.
const isSaved = mealAlreadyInDb(meal);
const label = getMealLabel(meal.displayType);
const hasExisting = meal.mealType !== "snack" && plannedMeals.some(
pm => pm.meal_type === meal.mealType && pm.date === targetDate
);

// Don't show buttons if already saved
                        if (isSaved) return null;

return (
<div key={key} style={{
display:"flex",
flexDirection:"column",
gap:6,
padding:"10px",
borderRadius:12,
border:`1px solid ${T.border}`,
background:T.surface,
}}>
<div style={{ fontSize:12, fontWeight:800, color:T.text }}>
{label} · {meal.calories} cal
</div>

<div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
<button
onClick={() => handleAddToPlan(meal, buttonSourceIdx, targetDate)}
style={{
fontSize:12,
padding:"8px 10px",
borderRadius:10,
fontWeight:700,
border:"none",
background: hasExisting ? "#f59e0b" : "#2563eb",
color:"#fff",
cursor:"pointer",
}}
>
{hasExisting ? `↺ Replace ${label}` : `+ Add ${label}`}
</button>

<button
onClick={() => handleEditPlanMeal(meal)}
style={{
fontSize:12,
padding:"8px 10px",
borderRadius:10,
fontWeight:700,
border:"none",
background:"#f59e0b",
color:"#fff",
cursor:"pointer",
}}
>
✏️ Edit
</button>

<button
onClick={() => handleCancelPlanMeal(meal, buttonSourceIdx)}
disabled={isSaved}
style={{
fontSize:12,
padding:"8px 10px",
borderRadius:10,
fontWeight:700,
border:"none",
background:"#ef4444",
color:"#fff",
cursor: isSaved ? "default" : "pointer",
opacity: isSaved ? 0.5 : 1,
}}
>
❌ Cancel
</button>
</div>
</div>
);
})}
</div>
)}
</div>
</div>
);
})}

{isLoading && (
<div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
<div style={{ width:32, height:32, borderRadius:10, background:"#2563eb",
display:"flex", alignItems:"center", justifyContent:"center",
fontSize:16, flexShrink:0, boxShadow:"0 2px 8px #2563eb44" }}>
💬
</div>
<div style={{ background: T.aiBubble, border:`1px solid ${T.aiBorder}`,
borderRadius:"18px 18px 18px 4px", padding:"12px 16px",
display:"flex", flexDirection:"column", gap:8 }}>
{/* Progressive status text */}
{loadingStage && (
<p style={{ fontSize:12, color: T.sub, margin:0, fontWeight:500 }}>
{loadingStage}
</p>
)}
{/* Bouncing dots */}
<div style={{ display:"flex", gap:5, alignItems:"center" }}>
{[0,150,300].map(d => (
<div key={d} style={{ width:7, height:7, borderRadius:"50%",
background:"#2563eb", animation:"bounce 1s infinite",
animationDelay:`${d}ms` }} />
))}
</div>
</div>
</div>
)}

<div ref={messagesEndRef} />
</div>

{/* ── Input ── */}
<div style={{ background: T.surface, borderTop:`1px solid ${T.border}`,
padding:"12px 14px", paddingBottom:"calc(12px + env(safe-area-inset-bottom, 0px))" }}>

{/* Photo menu */}
{showPhotoMenu && (
<div style={{ display:"flex", gap:8, marginBottom:10 }}>
<button onClick={() => { setShowPhotoMenu(false); cameraInputRef.current?.click(); }}
style={{ flex:1, fontSize:13, padding:"10px 12px", borderRadius:12,
background:"#2563eb22", color:"#2563eb", border:"1px solid #2563eb44",
fontWeight:600, cursor:"pointer" }}>
📷 Take Photo
</button>
<button onClick={() => { setShowPhotoMenu(false); libraryInputRef.current?.click(); }}
style={{ flex:1, fontSize:13, padding:"10px 12px", borderRadius:12,
background:"#2563eb22", color:"#2563eb", border:"1px solid #2563eb44",
fontWeight:600, cursor:"pointer" }}>
🖼️ Library
</button>
<button onClick={() => setShowPhotoMenu(false)}
style={{ fontSize:13, padding:"10px 12px", borderRadius:12,
background: T.muted, color: T.sub, border:"none", cursor:"pointer" }}>
✕
</button>
</div>
)}

{/* Image thumbnails */}
{pendingImages.length > 0 && (
<div style={{ display:"flex", gap:8, overflowX:"auto", marginBottom:10, paddingBottom:2 }}>
{pendingImages.map((img, i) => (
<div key={i} style={{ position:"relative", flexShrink:0 }}>
<img src={img.preview} alt={`Photo ${i+1}`}
style={{ width:72, height:72, objectFit:"cover", borderRadius:10,
border:`1px solid ${T.border}` }} />
<button onClick={() => removeImage(i)}
style={{ position:"absolute", top:-6, right:-6, width:18, height:18,
borderRadius:"50%", background:"#3a3a3a", color:"#fff",
border:"none", cursor:"pointer", fontSize:10,
display:"flex", alignItems:"center", justifyContent:"center" }}>
✕
</button>
</div>
))}
</div>
)}

<div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
{/* Camera button */}
<button onClick={() => pendingImages.length < 4 && setShowPhotoMenu(!showPhotoMenu)}
disabled={isLoading || pendingImages.length >= 4}
style={{ minHeight:52, minWidth:48, borderRadius:14, background: T.muted,
border:"none", cursor:"pointer", display:"flex", flexDirection:"column",
alignItems:"center", justifyContent:"center", gap:2, flexShrink:0,
opacity: pendingImages.length >= 4 ? .4 : 1 }}>
<span style={{ fontSize:20 }}>📷</span>
{pendingImages.length > 0 && (
<span style={{ fontSize:9, fontWeight:700, color:"#2563eb" }}>
{pendingImages.length}/4
</span>
)}
</button>

{/* Text input */}
<textarea ref={textareaRef} value={message}
onChange={e => setMessage(e.target.value)}
onKeyDown={handleKeyDown}
placeholder={pendingImages.length > 1 ? "Compare these or add a message..." :
pendingImages.length === 1 ? "Add a message or just send..." : "Ask your coach..."}
rows={1}
style={{ flex:1, resize:"none", borderRadius:14, padding:"14px 16px",
fontSize:14, border:`1px solid ${message ? "#2563eb" : T.border}`,
background: T.input, color: T.text, outline:"none",
minHeight:52, maxHeight:120, fontFamily:"'DM Sans', sans-serif",
transition:"border-color .2s" }}
/>

{/* Send button */}
<button onClick={handleSend}
disabled={isLoading || (!message.trim() && pendingImages.length === 0)}
style={{ minHeight:52, minWidth:52, borderRadius:14,
background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
border:"none", color:"#fff", fontWeight:700, fontSize:14,
cursor:"pointer", flexShrink:0, opacity: (isLoading || (!message.trim() && pendingImages.length === 0)) ? .4 : 1,
padding:"0 16px", boxShadow:"0 4px 12px #2563eb44" }}>
Send
</button>
</div>
</div>

{/* ── Bottom Nav ── */}
<div style={{ background: T.surface, borderTop:`1px solid ${T.border}`,
display:"flex", paddingBottom:"env(safe-area-inset-bottom, 8px)", zIndex:100 }}>
{[
{ id:"coach", icon:"💬", label:"Coach", path:"/" },
{ id:"dashboard", icon:"📊", label:"Dashboard", path:"/dashboard" },
{ id:"profile", icon:"⚙️", label:"Profile", path:"/profile" },
].map(tab => (
<button key={tab.id}
onClick={() => window.location.href = tab.path}
style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
gap:3, padding:"10px 0 4px", border:"none", background:"transparent", cursor:"pointer" }}>
<span style={{ fontSize:20 }}>{tab.icon}</span>
<span style={{ fontSize:10, fontWeight: tab.id === "coach" ? 700 : 500,
color: tab.id === "coach" ? "#2563eb" : T.sub, letterSpacing:".03em" }}>
{tab.label}
</span>
{tab.id === "coach" && (
<div style={{ width:18, height:2, background:"#2563eb", borderRadius:9999 }} />
)}
</button>
))}
</div>
</div>

<style>{`
@keyframes bounce {
0%, 100% { transform: translateY(0); }
50% { transform: translateY(-5px); }
}
`}</style>
</>
);

}