"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import HamburgerMenu from "../components/HamburgerMenu";

// ========================================
// UTILITIES
// ========================================

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getShiftedDate(dateStr, days) {
  const date = new Date(dateStr + "T12:00:00");
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateStr) {
  const today = getLocalDate();
  const tomorrow = getShiftedDate(today, 1);
  const yesterday = getShiftedDate(today, -1);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function sumMeals(meals) {
  return (meals || []).reduce(
    (t, meal) => {
      const s = Number(meal.servings || 1);
      t.calories += Number(meal.calories || 0) * s;
      t.protein += Number(meal.protein || 0) * s;
      t.carbs += Number(meal.carbs || 0) * s;
      t.fat += Number(meal.fat || 0) * s;
      return t;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function groupByMealType(meals) {
  const order = ["breakfast", "lunch", "dinner", "snack"];
  const grouped = {};
  for (const meal of meals) {
    const key = meal.meal_type || "snack";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(meal);
  }
  return Object.entries(grouped).sort((a, b) => {
    return (order.indexOf(a[0]) ?? 99) - (order.indexOf(b[0]) ?? 99);
  });
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ========================================
// SUB-COMPONENTS
// ========================================

function MacroRing({ label, value, goal, color }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const remaining = Math.max(0, goal - value);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={color} strokeWidth="3"
            strokeDasharray={`${pct} 100`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white text-xs font-bold">{pct}%</span>
        </div>
      </div>
      <span className="text-blue-200 text-xs font-medium">{label}</span>
      <span className="text-white text-xs font-bold">{Math.round(value)}g</span>
      <span className="text-blue-300 text-xs">{Math.round(remaining)}g left</span>
    </div>
  );
}

function MealCard({ meal, onDelete, onMarkEaten, isActual }) {
  const [deleting, setDeleting] = useState(false);
  const [marking, setMarking] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete(meal.id);
    setDeleting(false);
  }

  async function handleMarkEaten() {
    setMarking(true);
    await onMarkEaten(meal);
    setMarking(false);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-2">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-snug truncate">{meal.food}</p>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className="text-xs text-gray-500">🔥 {meal.calories} cal</span>
            <span className="text-xs text-blue-500">P {meal.protein}g</span>
            <span className="text-xs text-emerald-500">C {meal.carbs}g</span>
            <span className="text-xs text-amber-500">F {meal.fat}g</span>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {!isActual && (
            <button
              onClick={handleMarkEaten}
              disabled={marking}
              className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 font-medium hover:bg-emerald-100 transition-colors disabled:opacity-40"
            >
              {marking ? "..." : "✓ Ate"}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition-colors disabled:opacity-40"
          >
            {deleting ? "..." : "✕"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MealSection({ title, emoji, meals, onDelete, onMarkEaten, isActual }) {
  if (meals.length === 0) return null;
  const sectionTotals = sumMeals(meals);
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-700">{emoji} {title}</span>
        <span className="text-xs text-gray-400">{Math.round(sectionTotals.calories)} cal</span>
      </div>
      {meals.map((meal) => (
        <MealCard
          key={meal.id}
          meal={meal}
          onDelete={onDelete}
          onMarkEaten={onMarkEaten}
          isActual={isActual}
        />
      ))}
    </div>
  );
}

const MEAL_EMOJIS = {
  breakfast: "🌅",
  lunch: "☀️",
  dinner: "🌙",
  snack: "🍎",
};

// ========================================
// MAIN COMPONENT
// ========================================

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [goal, setGoal] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
  const [plannedMeals, setPlannedMeals] = useState([]);
  const [actualMeals, setActualMeals] = useState([]);

  useEffect(() => {
    const storedId = localStorage.getItem("user_id");
    const storedName = localStorage.getItem("user_name");
    if (storedId) setUserId(storedId);
    if (storedName) setUserName(storedName);
    loadDashboard(storedId, selectedDate);
  }, []);

  useEffect(() => {
    if (userId) loadDashboard(userId, selectedDate);
  }, [selectedDate, userId]);

  async function loadDashboard(uid, date) {
    const activeId = uid || userId;
    if (!activeId) return;
    setLoading(true);
    try {
      const [goalsRes, plannedRes, actualRes] = await Promise.all([
        supabase.from("goals").select("*").eq("user_id", activeId).single(),
        supabase.from("planned_meals").select("*").eq("user_id", activeId).eq("date", date),
        supabase.from("actual_meals").select("*").eq("user_id", activeId).eq("date", date),
      ]);
      if (goalsRes.data) setGoal(goalsRes.data);
      setPlannedMeals(plannedRes.data || []);
      setActualMeals(actualRes.data || []);
    } catch (e) {
      console.error("Dashboard load error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeletePlanned(id) {
    await supabase.from("planned_meals").delete().eq("id", id);
    setPlannedMeals((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleDeleteActual(id) {
    await supabase.from("actual_meals").delete().eq("id", id);
    setActualMeals((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleMarkEaten(meal) {
    const activeId = userId || localStorage.getItem("user_id");
    try {
      await supabase.from("actual_meals").insert([{
        user_id: activeId,
        date: selectedDate,
        meal_type: meal.meal_type,
        food: meal.food,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        servings: meal.servings || 1,
      }]);
      await supabase.from("planned_meals").delete().eq("id", meal.id);
      await loadDashboard(activeId, selectedDate);
    } catch (e) {
      console.error("Mark eaten error:", e);
    }
  }

  const plannedTotals = sumMeals(plannedMeals);
  const actualTotals = sumMeals(actualMeals);
  const remaining = {
    calories: Math.max(0, goal.calories - actualTotals.calories),
    protein: Math.max(0, goal.protein - actualTotals.protein),
    carbs: Math.max(0, goal.carbs - actualTotals.carbs),
    fat: Math.max(0, goal.fat - actualTotals.fat),
  };

  const calPct = goal.calories > 0
    ? Math.min(100, Math.round((actualTotals.calories / goal.calories) * 100))
    : 0;

  const groupedPlanned = groupByMealType(plannedMeals);
  const groupedActual = groupByMealType(actualMeals);

  return (
    <div className="min-h-screen" style={{ background: "#f8f9fb" }}>
      <HamburgerMenu />

      {/* ── Header ── */}
      <div
        className="px-4 pt-14 pb-5"
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-white font-bold text-lg">Dashboard</h1>
            {userName && (
              <p className="text-blue-300 text-xs mt-0.5">{userName}'s nutrition log</p>
            )}
          </div>
          {/* Calorie ring */}
          <div className="flex flex-col items-center">
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke="#60a5fa" strokeWidth="3"
                  strokeDasharray={`${calPct} 100`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white text-xs font-bold">{calPct}%</span>
              </div>
            </div>
            <span className="text-blue-300 text-xs mt-1">
              {Math.round(actualTotals.calories)}/{goal.calories} cal
            </span>
          </div>
        </div>

        {/* Macro rings */}
        <div className="flex justify-around">
          <MacroRing label="Protein" value={actualTotals.protein} goal={goal.protein} color="#60a5fa" />
          <MacroRing label="Carbs" value={actualTotals.carbs} goal={goal.carbs} color="#34d399" />
          <MacroRing label="Fat" value={actualTotals.fat} goal={goal.fat} color="#fbbf24" />
        </div>
      </div>

      {/* ── Date nav ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
        <button
          onClick={() => setSelectedDate((d) => getShiftedDate(d, -1))}
          className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          ← Prev
        </button>
        <div className="flex flex-col items-center">
          <span className="text-sm font-bold text-gray-800">{formatDate(selectedDate)}</span>
          {selectedDate !== getLocalDate() && (
            <button
              onClick={() => setSelectedDate(getLocalDate())}
              className="text-xs text-blue-500 mt-0.5"
            >
              Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => setSelectedDate((d) => getShiftedDate(d, 1))}
          className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          Next →
        </button>
      </div>

      {/* ── Content ── */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <div
                  key={d}
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: "#60a5fa", animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { label: "🎯 Goal", cal: goal.calories, color: "border-blue-200 bg-blue-50" },
                { label: "📋 Planned", cal: Math.round(plannedTotals.calories), color: "border-purple-200 bg-purple-50" },
                { label: "✅ Eaten", cal: Math.round(actualTotals.calories), color: "border-emerald-200 bg-emerald-50" },
                { label: "⏳ Remaining", cal: Math.round(remaining.calories), color: "border-amber-200 bg-amber-50" },
              ].map(({ label, cal, color }) => (
                <div key={label} className={`rounded-2xl border p-3 ${color}`}>
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="text-lg font-bold text-gray-800">{cal}</p>
                  <p className="text-xs text-gray-400">calories</p>
                </div>
              ))}
            </div>

            {/* Planned meals */}
            <div className="mb-5">
              <h2 className="text-base font-bold text-gray-800 mb-3">
                📋 Planned Meals
                {plannedMeals.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {plannedMeals.length} meal{plannedMeals.length !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              {groupedPlanned.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center text-sm text-gray-400">
                  No planned meals for {formatDate(selectedDate).toLowerCase()}.
                  <br />Ask your coach to plan your meals!
                </div>
              ) : (
                groupedPlanned.map(([type, meals]) => (
                  <MealSection
                    key={type}
                    title={capitalize(type)}
                    emoji={MEAL_EMOJIS[type] || "🍽️"}
                    meals={meals}
                    onDelete={handleDeletePlanned}
                    onMarkEaten={handleMarkEaten}
                    isActual={false}
                  />
                ))
              )}
            </div>

            {/* Actual meals */}
            <div>
              <h2 className="text-base font-bold text-gray-800 mb-3">
                ✅ Eaten Today
                {actualMeals.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {actualMeals.length} meal{actualMeals.length !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              {groupedActual.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center text-sm text-gray-400">
                  Nothing logged yet.
                  <br />Tell your coach what you ate!
                </div>
              ) : (
                groupedActual.map(([type, meals]) => (
                  <MealSection
                    key={type}
                    title={capitalize(type)}
                    emoji={MEAL_EMOJIS[type] || "🍽️"}
                    meals={meals}
                    onDelete={handleDeleteActual}
                    onMarkEaten={() => {}}
                    isActual={true}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
