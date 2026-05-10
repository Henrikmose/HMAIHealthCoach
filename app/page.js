"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

const DAILY_GOAL = { calories: 2200, protein: 180, carbs: 220, fat: 70 };

function getLocalDate() {
const now = new Date();
const offset = now.getTimezoneOffset();
return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
const d = new Date(dateStr + "T12:00:00");
d.setDate(d.getDate() + days);
return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toNumber(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function round(value) {
return Math.round(toNumber(value));
}

function macroTotals(meals) {
return (meals || []).reduce((totals, meal) => {
const servings = toNumber(meal.servings, 1);
totals.calories += toNumber(meal.calories) * servings;
totals.protein += toNumber(meal.protein) * servings;
totals.carbs += toNumber(meal.carbs) * servings;
totals.fat += toNumber(meal.fat) * servings;
return totals;
}, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function extractTargetDate(text, selectedDate) {
const lower = String(text || "").toLowerCase();
if (lower.includes("tomorrow")) return addDays(getLocalDate(), 1);
if (lower.includes("yesterday")) return addDays(getLocalDate(), -1);
const dateMatch = lower.match(/\b(\d{1,2})[\/-](\d{1,2})\b/);
if (dateMatch) {
const year = new Date().getFullYear();
return `${year}-${String(dateMatch[1]).padStart(2, "0")}-${String(dateMatch[2]).padStart(2, "0")}`;
}
return selectedDate || getLocalDate();
}

function formatDateLabel(dateStr) {
const today = getLocalDate();
if (dateStr === today) return "Today";
if (dateStr === addDays(today, 1)) return "Tomorrow";
if (dateStr === addDays(today, -1)) return "Yesterday";
return dateStr;
}

function storageKey(kind, userId, date) {
return `${kind}:${userId}:${date}`;
}

function getMealKey(meal) {
return `${meal.date || ""}|${meal.mealType || ""}|${meal.food || meal.name || ""}|${meal.calories || 0}`;
}

function normalizeMealForStorage(meal, date) {
return {
id: meal.id || crypto.randomUUID(),
date,
mealType: meal.mealType || meal.meal_type || "snack",
name: meal.name || meal.food || "Meal",
food: meal.food || meal.name || "Meal",
servings: toNumber(meal.servings, 1),
calories: round(meal.calories),
protein: round(meal.protein),
carbs: round(meal.carbs),
fat: round(meal.fat),
breakdown: meal.breakdown || [],
createdAt: meal.createdAt || new Date().toISOString(),
};
}

function ProgressRow({ label, value, goal, unit = "g", color = "bg-blue-600" }) {
const percent = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
return (
<div className="space-y-1">
<div className="flex justify-between text-sm">
<span className="font-medium text-gray-700">{label}</span>
<span className="text-gray-600">{round(value)} / {goal} {unit}</span>
</div>
<div className="h-3 w-full rounded-full bg-gray-200">
<div className={`h-3 rounded-full ${color}`} style={{ width: `${percent}%` }} />
</div>
</div>
);
}

function MealCard({ title, meal, children }) {
return (
<div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
<div className="flex items-start justify-between gap-3">
<div>
<p className="text-xs font-bold uppercase tracking-wide text-blue-600">{title}</p>
<h3 className="mt-1 text-lg font-bold text-gray-900">{meal.food || meal.name}</h3>
</div>
<div className="rounded-xl bg-blue-50 px-3 py-2 text-right">
<p className="text-lg font-extrabold text-blue-700">{round(meal.calories)}</p>
<p className="text-xs font-semibold text-blue-500">cal</p>
</div>
</div>
<div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
<div className="rounded-xl bg-gray-50 p-2"><p className="font-bold text-gray-900">{round(meal.protein)}g</p><p className="text-xs text-gray-500">Protein</p></div>
<div className="rounded-xl bg-gray-50 p-2"><p className="font-bold text-gray-900">{round(meal.carbs)}g</p><p className="text-xs text-gray-500">Carbs</p></div>
<div className="rounded-xl bg-gray-50 p-2"><p className="font-bold text-gray-900">{round(meal.fat)}g</p><p className="text-xs text-gray-500">Fat</p></div>
</div>
{meal.breakdown?.length > 0 && (
<div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
{meal.breakdown.map((item, idx) => (
<div key={`${item.food}-${idx}`}>{item.food} — {round(item.calories)} cal, {round(item.protein)}g P, {round(item.carbs)}g C, {round(item.fat)}g F</div>
))}
</div>
)}
{children && <div className="mt-4">{children}</div>}
</div>
);
}

export default function HomePage() {
const [activeTab, setActiveTab] = useState("coach");
const [date, setDate] = useState(getLocalDate());
const [actualMeals, setActualMeals] = useState([]);
const [plannedMeals, setPlannedMeals] = useState([]);
const [history, setHistory] = useState([]);
const [message, setMessage] = useState("");
const [loadingCoach, setLoadingCoach] = useState(false);
const [error, setError] = useState("");
const [completedActionIds, setCompletedActionIds] = useState(new Set());
const endRef = useRef(null);

const totals = useMemo(() => macroTotals(actualMeals), [actualMeals]);
const plannedTotals = useMemo(() => macroTotals(plannedMeals), [plannedMeals]);

useEffect(() => {
try { setActualMeals(JSON.parse(localStorage.getItem(storageKey("actual_meals", TEST_USER_ID, date)) || "[]")); } catch { setActualMeals([]); }
try { setPlannedMeals(JSON.parse(localStorage.getItem(storageKey("planned_meals", TEST_USER_ID, date)) || "[]")); } catch { setPlannedMeals([]); }
}, [date]);

useEffect(() => { localStorage.setItem(storageKey("actual_meals", TEST_USER_ID, date), JSON.stringify(actualMeals)); }, [date, actualMeals]);
useEffect(() => { localStorage.setItem(storageKey("planned_meals", TEST_USER_ID, date), JSON.stringify(plannedMeals)); }, [date, plannedMeals]);
useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, loadingCoach]);

function saveMealToStorage(kind, meal, targetDate) {
const normalized = normalizeMealForStorage(meal, targetDate);
const key = getMealKey(normalized);
const setter = kind === "actual" ? setActualMeals : setPlannedMeals;
const store = kind === "actual" ? "actual_meals" : "planned_meals";

if (targetDate === date) {
setter((current) => current.some((m) => getMealKey(m) === key) ? current : [normalized, ...current]);
} else {
const stored = JSON.parse(localStorage.getItem(storageKey(store, TEST_USER_ID, targetDate)) || "[]");
if (!stored.some((m) => getMealKey(m) === key)) {
localStorage.setItem(storageKey(store, TEST_USER_ID, targetDate), JSON.stringify([normalized, ...stored]));
}
}
return normalized;
}

function removeMeal(kind, id) {
if (kind === "actual") setActualMeals((current) => current.filter((m) => m.id !== id));
else setPlannedMeals((current) => current.filter((m) => m.id !== id));
}

function markDone(actionId) { setCompletedActionIds((prev) => new Set([...prev, actionId])); }
function isDone(actionId) { return completedActionIds.has(actionId); }

function afterSaveSummary(savedMeal, updatedTotals, targetDate) {
const remaining = {
calories: DAILY_GOAL.calories - updatedTotals.calories,
protein: DAILY_GOAL.protein - updatedTotals.protein,
carbs: DAILY_GOAL.carbs - updatedTotals.carbs,
fat: DAILY_GOAL.fat - updatedTotals.fat,
};
let focus = "Keep balancing protein, carbs, and fat through the rest of the day.";
if (remaining.protein > 50) focus = "Protein is the main thing to prioritize next.";
else if (remaining.carbs > 80) focus = "You still have room for quality carbs later.";
else if (remaining.fat < 20) focus = "Keep the next meal lower fat and leaner.";

return `Logged ✅\n\n${savedMeal.food || savedMeal.name} added to ${formatDateLabel(targetDate)}.\n\nYou are now at:\nCalories: ${round(updatedTotals.calories)} / ${DAILY_GOAL.calories}\nProtein: ${round(updatedTotals.protein)}g / ${DAILY_GOAL.protein}g\nCarbs: ${round(updatedTotals.carbs)}g / ${DAILY_GOAL.carbs}g\nFat: ${round(updatedTotals.fat)}g / ${DAILY_GOAL.fat}g\n\n${focus}`;
}

function handleAddToEaten(meal, targetDate, actionId) {
if (isDone(actionId)) return;
const saved = saveMealToStorage("actual", meal, targetDate);
markDone(actionId);
const stored = targetDate === date ? [saved, ...actualMeals] : JSON.parse(localStorage.getItem(storageKey("actual_meals", TEST_USER_ID, targetDate)) || "[]");
setHistory((prev) => [...prev, { role: "assistant", content: afterSaveSummary(saved, macroTotals(stored), targetDate) }]);
}

function handleAddToPlan(meal, targetDate, actionId) {
if (isDone(actionId)) return;
const saved = saveMealToStorage("planned", meal, targetDate);
markDone(actionId);
setHistory((prev) => [...prev, { role: "assistant", content: `Added to plan ✅\n\n${saved.food || saved.name} was added to ${formatDateLabel(targetDate)} as ${saved.mealType}.` }]);
}

function handleAddAllToPlan(meals, targetDate, parentId) {
if (isDone(parentId)) return;
meals.forEach((meal) => saveMealToStorage("planned", meal, targetDate));
markDone(parentId);
setHistory((prev) => [...prev, { role: "assistant", content: `Added full plan ✅\n\n${meals.length} meal(s) were added to ${formatDateLabel(targetDate)}.` }]);
}

function handleEdit() {
setHistory((prev) => [...prev, { role: "assistant", content: "Got it — tell me what you actually had or what you want instead." }]);
}

function handleCancel(actionId) {
markDone(actionId);
setHistory((prev) => [...prev, { role: "assistant", content: "Canceled. Nothing was saved." }]);
}

async function sendMessage() {
const trimmed = message.trim();
if (!trimmed || loadingCoach) return;
setError(""); setMessage(""); setLoadingCoach(true);
const targetDate = extractTargetDate(trimmed, date);
const newHistory = [...history, { role: "user", content: trimmed }];
setHistory(newHistory);

try {
const response = await fetch("/api/coach", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ userId: TEST_USER_ID, date, targetDate, question: trimmed, meals: actualMeals, plannedMeals, totals, plannedTotals, goals: DAILY_GOAL, history: newHistory.slice(-8) }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error || "Coach request failed.");
setHistory((current) => [...current, { role: "assistant", content: data.answer || "", type: data.type || "advice", targetDate: data.targetDate || targetDate, meal: data.meal || null, meals: data.meals || [], defaultAction: data.defaultAction || null }]);
} catch (err) {
setError(err.message || "Something went wrong.");
setHistory((current) => [...current, { role: "assistant", content: "Something went wrong. Please try again." }]);
} finally { setLoadingCoach(false); }
}

function handleKeyDown(event) {
if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
}

function renderMealReview(msg, idx) {
if (!msg.meal) return null;
const actionId = `review-${idx}`;
const done = isDone(actionId);
const targetDate = msg.targetDate || date;
const plannedOnly = msg.defaultAction === "plan";
return (
<MealCard title={`${msg.meal.mealType || "Meal"} · ${formatDateLabel(targetDate)}`} meal={msg.meal}>
<div className="flex flex-wrap gap-2">
{!plannedOnly && <button disabled={done} onClick={() => handleAddToEaten(msg.meal, targetDate, actionId)} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${done ? "bg-gray-400" : "bg-green-600"}`}>{done ? "Added" : "Add to Eaten"}</button>}
<button disabled={done} onClick={() => handleAddToPlan(msg.meal, targetDate, actionId)} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${done ? "bg-gray-400" : "bg-blue-600"}`}>{done ? "Added" : plannedOnly ? `Add ${msg.meal.mealType || "Meal"} to Planned` : "Add to Planned"}</button>
<button disabled={done} onClick={handleEdit} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">Edit</button>
<button disabled={done} onClick={() => handleCancel(actionId)} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">Cancel</button>
</div>
</MealCard>
);
}

function renderMealPlan(msg, idx) {
const meals = msg.meals || [];
if (!meals.length) return null;
const targetDate = msg.targetDate || date;
const allId = `plan-all-${idx}`;
const allDone = isDone(allId);
return (
<div className="space-y-3">
{meals.map((meal, mealIdx) => {
const actionId = `plan-${idx}-${mealIdx}`;
const done = isDone(actionId);
return (
<MealCard key={actionId} title={`${meal.mealType || "Meal"} · ${formatDateLabel(targetDate)}`} meal={meal}>
<div className="flex flex-wrap gap-2">
<button disabled={done || allDone} onClick={() => handleAddToPlan(meal, targetDate, actionId)} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${done || allDone ? "bg-gray-400" : "bg-blue-600"}`}>{done || allDone ? "Added" : `Add ${meal.mealType || "Meal"} to Plan`}</button>
<button disabled={done || allDone} onClick={handleEdit} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">Edit</button>
<button disabled={done || allDone} onClick={() => handleCancel(actionId)} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">Cancel</button>
</div>
</MealCard>
);
})}
<button disabled={allDone} onClick={() => handleAddAllToPlan(meals, targetDate, allId)} className={`w-full rounded-2xl px-4 py-3 text-sm font-extrabold text-white ${allDone ? "bg-gray-400" : "bg-green-600"}`}>{allDone ? "Full Plan Added" : `Add All ${meals.length} Meals to Planned`}</button>
</div>
);
}

function renderMessage(msg, idx) {
const isUser = msg.role === "user";
return (
<div key={`${idx}-${msg.content?.slice?.(0, 20)}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
<div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${isUser ? "bg-blue-600 text-white" : "bg-white text-gray-900 border border-gray-200"}`}>
{msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
{!isUser && msg.type === "meal_review" && <div className="mt-3">{renderMealReview(msg, idx)}</div>}
{!isUser && msg.type === "meal_plan" && <div className="mt-3">{renderMealPlan(msg, idx)}</div>}
</div>
</div>
);
}

return (
<main className="min-h-screen bg-gray-50 text-gray-900">
<div className="mx-auto flex min-h-screen max-w-5xl flex-col">
<header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 shadow-sm">
<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
<div><h1 className="text-2xl font-extrabold">CURA AI Coach</h1><p className="text-sm text-gray-600">One coach box for logging, planning, photos, and advice.</p></div>
<div className="flex items-center gap-2"><label className="text-sm font-bold text-gray-700">Date</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2" /></div>
</div>
<div className="mt-4 grid grid-cols-4 gap-2">
{["coach", "dashboard", "planned", "profile"].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-xl px-3 py-2 text-sm font-bold capitalize ${activeTab === tab ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>{tab}</button>)}
</div>
</header>

<section className="grid gap-4 p-4 md:grid-cols-4">
<div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-gray-500">Calories</p><p className="text-2xl font-extrabold">{round(totals.calories)} / {DAILY_GOAL.calories}</p></div>
<div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-gray-500">Protein</p><p className="text-2xl font-extrabold">{round(totals.protein)}g</p></div>
<div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-gray-500">Carbs</p><p className="text-2xl font-extrabold">{round(totals.carbs)}g</p></div>
<div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-gray-500">Fat</p><p className="text-2xl font-extrabold">{round(totals.fat)}g</p></div>
</section>

<section className="flex-1 p-4">
{activeTab === "coach" && <div className="flex h-[calc(100vh-260px)] flex-col rounded-3xl bg-gray-100 p-3"><div className="flex-1 space-y-3 overflow-y-auto p-1">{history.length === 0 && <div className="rounded-2xl bg-white p-5 text-sm text-gray-600 shadow-sm">Try: “I had two eggs and half an avocado for breakfast”, “Plan lunch and dinner tomorrow”, or “Tomorrow I have two hockey games, plan my food.”</div>}{history.map(renderMessage)}{loadingCoach && <div className="flex justify-start"><div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">Thinking...</div></div>}<div ref={endRef} /></div>{error && <div className="mb-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="mt-3 flex gap-2"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask your coach, log food, or plan meals..." rows={1} className="min-h-[52px] flex-1 resize-none rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500" /><button onClick={sendMessage} disabled={loadingCoach || !message.trim()} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white disabled:bg-gray-400">Send</button></div></div>}

{activeTab === "dashboard" && <div className="space-y-4"><div className="rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-xl font-extrabold">Dashboard · {formatDateLabel(date)}</h2><div className="mt-4 space-y-4"><ProgressRow label="Calories" value={totals.calories} goal={DAILY_GOAL.calories} unit="cal" color="bg-blue-600" /><ProgressRow label="Protein" value={totals.protein} goal={DAILY_GOAL.protein} color="bg-green-600" /><ProgressRow label="Carbs" value={totals.carbs} goal={DAILY_GOAL.carbs} color="bg-amber-500" /><ProgressRow label="Fat" value={totals.fat} goal={DAILY_GOAL.fat} color="bg-red-500" /></div></div><div className="rounded-3xl bg-white p-5 shadow-sm"><h3 className="text-lg font-bold">Eaten Meals</h3><div className="mt-3 space-y-2">{actualMeals.length === 0 ? <p className="text-sm text-gray-500">No eaten meals logged for this date.</p> : actualMeals.map((meal) => <div key={meal.id} className="flex items-center justify-between rounded-2xl bg-gray-50 p-3"><div><p className="font-bold">{meal.mealType}: {meal.food}</p><p className="text-sm text-gray-600">{round(meal.calories)} cal · {round(meal.protein)}g P · {round(meal.carbs)}g C · {round(meal.fat)}g F</p></div><button onClick={() => removeMeal("actual", meal.id)} className="rounded-xl bg-red-100 px-3 py-2 text-sm font-bold text-red-700">Delete</button></div>)}</div></div></div>}

{activeTab === "planned" && <div className="rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-xl font-extrabold">Planned Meals · {formatDateLabel(date)}</h2><p className="mt-1 text-sm text-gray-600">Planned: {round(plannedTotals.calories)} cal · {round(plannedTotals.protein)}g P · {round(plannedTotals.carbs)}g C · {round(plannedTotals.fat)}g F</p><div className="mt-4 space-y-2">{plannedMeals.length === 0 ? <p className="text-sm text-gray-500">No planned meals for this date.</p> : plannedMeals.map((meal) => <div key={meal.id} className="flex items-center justify-between rounded-2xl bg-gray-50 p-3"><div><p className="font-bold">{meal.mealType}: {meal.food}</p><p className="text-sm text-gray-600">{round(meal.calories)} cal · {round(meal.protein)}g P · {round(meal.carbs)}g C · {round(meal.fat)}g F</p></div><button onClick={() => removeMeal("planned", meal.id)} className="rounded-xl bg-red-100 px-3 py-2 text-sm font-bold text-red-700">Delete</button></div>)}</div></div>}

{activeTab === "profile" && <div className="rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-xl font-extrabold">Profile</h2><p className="mt-2 text-sm text-gray-600">Test profile using fixed MVP goals. Later this connects back to Supabase profile settings.</p><div className="mt-4 grid gap-3 md:grid-cols-4"><div className="rounded-2xl bg-gray-50 p-4"><p className="text-xs font-bold text-gray-500">Calories</p><p className="text-xl font-extrabold">{DAILY_GOAL.calories}</p></div><div className="rounded-2xl bg-gray-50 p-4"><p className="text-xs font-bold text-gray-500">Protein</p><p className="text-xl font-extrabold">{DAILY_GOAL.protein}g</p></div><div className="rounded-2xl bg-gray-50 p-4"><p className="text-xs font-bold text-gray-500">Carbs</p><p className="text-xl font-extrabold">{DAILY_GOAL.carbs}g</p></div><div className="rounded-2xl bg-gray-50 p-4"><p className="text-xs font-bold text-gray-500">Fat</p><p className="text-xl font-extrabold">{DAILY_GOAL.fat}g</p></div></div></div>}
</section>
</div>
</main>
);
}