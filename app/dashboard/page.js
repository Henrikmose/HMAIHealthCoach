"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import HamburgerMenu from "../components/HamburgerMenu";

// ========================================
// UTILITIES
// ========================================

function getLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function getShiftedDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDateLabel(dateStr) {
  const today = getLocalDate();
  if (dateStr === today) return "Today";
  if (dateStr === getShiftedDate(today, 1)) return "Tomorrow";
  if (dateStr === getShiftedDate(today, -1)) return "Yesterday";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function sumMeals(meals) {
  return (meals || []).reduce(
    (t, m) => ({ calories: t.calories + Number(m.calories||0), protein: t.protein + Number(m.protein||0), carbs: t.carbs + Number(m.carbs||0), fat: t.fat + Number(m.fat||0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function groupByType(meals) {
  const order = ["breakfast","lunch","dinner","snack"];
  const map = {};
  for (const m of meals) {
    const k = m.meal_type || "snack";
    if (!map[k]) map[k] = [];
    map[k].push(m);
  }
  return Object.entries(map).sort((a,b) => (order.indexOf(a[0])??99) - (order.indexOf(b[0])??99));
}

const EMOJI = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };

// ========================================
// MEAL CARD
// ========================================

function MealCard({ meal, onDelete, onMarkEaten, isActual }) {
  const [busy, setBusy] = useState(false);

  async function handleAction(fn) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-2">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-snug">{meal.food}</p>
          <div className="flex gap-3 mt-1 flex-wrap">
            <span className="text-xs text-gray-500">🔥 {meal.calories} cal</span>
            <span className="text-xs text-blue-500">P {meal.protein}g</span>
            <span className="text-xs text-emerald-500">C {meal.carbs}g</span>
            <span className="text-xs text-amber-500">F {meal.fat}g</span>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0 mt-0.5">
          {!isActual && (
            <button
              onClick={() => handleAction(() => onMarkEaten(meal))}
              disabled={busy}
              className="text-xs px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 font-medium border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-40"
            >
              {busy ? "..." : "✓ Ate"}
            </button>
          )}
          <button
            onClick={() => handleAction(() => onDelete(meal.id))}
            disabled={busy}
            className="text-xs px-2.5 py-1.5 rounded-xl bg-red-50 text-red-400 border border-red-100 hover:bg-red-100 transition-colors disabled:opacity-40"
          >
            {busy ? "..." : "✕"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ========================================
// MAIN COMPONENT
// ========================================

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [goal, setGoal] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
  const [planned, setPlanned] = useState([]);
  const [actual, setActual] = useState([]);

  useEffect(() => {
    const uid = localStorage.getItem("user_id");
    const uname = localStorage.getItem("user_name");
    if (uid) setUserId(uid);
    if (uname) setUserName(uname);
    if (uid) load(uid, getLocalDate());
  }, []);

  useEffect(() => {
    if (userId) load(userId, selectedDate);
  }, [selectedDate, userId]);

  async function load(uid, date) {
    setLoading(true);
    try {
      const [g, p, a] = await Promise.all([
        supabase.from("goals").select("*").eq("user_id", uid).single(),
        supabase.from("planned_meals").select("*").eq("user_id", uid).eq("date", date),
        supabase.from("actual_meals").select("*").eq("user_id", uid).eq("date", date),
      ]);
      if (g.data) setGoal(g.data);
      setPlanned(p.data || []);
      setActual(a.data || []);
    } catch (e) {
      console.error("Dashboard load error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function deletePlanned(id) {
    await supabase.from("planned_meals").delete().eq("id", id);
    setPlanned((prev) => prev.filter((m) => m.id !== id));
  }

  async function deleteActual(id) {
    await supabase.from("actual_meals").delete().eq("id", id);
    setActual((prev) => prev.filter((m) => m.id !== id));
  }

  async function markEaten(meal) {
    const uid = userId || localStorage.getItem("user_id");
    try {
      await supabase.from("actual_meals").insert([{
        user_id: uid, date: selectedDate,
        meal_type: meal.meal_type, food: meal.food,
        calories: meal.calories, protein: meal.protein,
        carbs: meal.carbs, fat: meal.fat, servings: meal.servings || 1,
      }]);
      await supabase.from("planned_meals").delete().eq("id", meal.id);
      await load(uid, selectedDate);
    } catch (e) {
      console.error("Mark eaten error:", e);
    }
  }

  const actualTotals = sumMeals(actual);
  const remaining = {
    calories: Math.max(0, goal.calories - actualTotals.calories),
    protein: Math.max(0, goal.protein - actualTotals.protein),
    carbs: Math.max(0, goal.carbs - actualTotals.carbs),
    fat: Math.max(0, goal.fat - actualTotals.fat),
  };

  const groupedPlanned = groupByType(planned);
  const groupedActual = groupByType(actual);

  return (
    <div className="min-h-screen pb-8" style={{ background: "#f8f9fb" }}>
      <HamburgerMenu />

      {/* ── Header ── */}
      <div className="px-4 pt-14 pb-5" style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-white font-bold text-lg">Dashboard</h1>
            {userName && <p className="text-blue-300 text-xs mt-0.5">{userName}'s nutrition log</p>}
          </div>
          <div className="text-right">
            <p className="text-white font-bold text-xl">{Math.round(actualTotals.calories)}<span className="text-blue-300 text-sm font-normal">/{goal.calories}</span></p>
            <p className="text-blue-300 text-xs">calories eaten</p>
          </div>
        </div>

        {/* Macro pills */}
        <div className="flex gap-2">
          {[
            { label: "Protein", val: actualTotals.protein, goal: goal.protein, bg: "rgba(96,165,250,0.15)", text: "#93c5fd", bar: "#60a5fa" },
            { label: "Carbs", val: actualTotals.carbs, goal: goal.carbs, bg: "rgba(52,211,153,0.15)", text: "#6ee7b7", bar: "#34d399" },
            { label: "Fat", val: actualTotals.fat, goal: goal.fat, bg: "rgba(251,191,36,0.15)", text: "#fcd34d", bar: "#fbbf24" },
          ].map(({ label, val, goal: g, bg, text, bar }) => (
            <div key={label} className="flex-1 rounded-xl px-2 py-2" style={{ background: bg }}>
              <p className="text-xs font-bold" style={{ color: text }}>{Math.round(val)}g <span style={{ opacity: 0.6 }}>/ {g}g</span></p>
              <p className="text-xs mb-1.5" style={{ color: text, opacity: 0.7 }}>{label}</p>
              <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((val/g)*100))}%`, background: bar }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Date Nav ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <button onClick={() => setSelectedDate((d) => getShiftedDate(d, -1))}
          className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors">
          ← Prev
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-800">{formatDateLabel(selectedDate)}</p>
          {selectedDate !== getLocalDate() && (
            <button onClick={() => setSelectedDate(getLocalDate())} className="text-xs text-blue-500 mt-0.5">
              Back to today
            </button>
          )}
        </div>
        <button onClick={() => setSelectedDate((d) => getShiftedDate(d, 1))}
          className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors">
          Next →
        </button>
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex gap-1">
              {[0,150,300].map((d) => (
                <div key={d} className="w-2 h-2 rounded-full animate-bounce" style={{ background: "#60a5fa", animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-2 gap-2.5 mb-5">
              {[
                { label: "🎯 Daily Goal", val: goal.calories, color: "#dbeafe", border: "#93c5fd", text: "#1d4ed8" },
                { label: "✅ Eaten", val: Math.round(actualTotals.calories), color: "#d1fae5", border: "#6ee7b7", text: "#065f46" },
                { label: "📋 Planned", val: Math.round(sumMeals(planned).calories), color: "#ede9fe", border: "#c4b5fd", text: "#5b21b6" },
                { label: "⏳ Remaining", val: Math.round(remaining.calories), color: "#fef3c7", border: "#fcd34d", text: "#92400e" },
              ].map(({ label, val, color, border, text }) => (
                <div key={label} className="rounded-2xl p-3 border" style={{ background: color, borderColor: border }}>
                  <p className="text-xs font-medium mb-1" style={{ color: text }}>{label}</p>
                  <p className="text-xl font-bold" style={{ color: text }}>{val}</p>
                  <p className="text-xs" style={{ color: text, opacity: 0.7 }}>calories</p>
                </div>
              ))}
            </div>

            {/* Planned meals */}
            <div className="mb-5">
              <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
                📋 Planned Meals
                {planned.length > 0 && <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{planned.length}</span>}
              </h2>
              {groupedPlanned.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center">
                  <p className="text-sm text-gray-400">No planned meals for {formatDateLabel(selectedDate).toLowerCase()}.</p>
                  <p className="text-xs text-gray-400 mt-1">Ask your coach to plan your meals!</p>
                </div>
              ) : (
                groupedPlanned.map(([type, meals]) => (
                  <div key={type} className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-gray-600">{EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}</span>
                      <span className="text-xs text-gray-400">{Math.round(sumMeals(meals).calories)} cal</span>
                    </div>
                    {meals.map((m) => (
                      <MealCard key={m.id} meal={m} onDelete={deletePlanned} onMarkEaten={markEaten} isActual={false} />
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Actual meals */}
            <div>
              <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
                ✅ Eaten
                {actual.length > 0 && <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{actual.length}</span>}
              </h2>
              {groupedActual.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center">
                  <p className="text-sm text-gray-400">Nothing logged yet for {formatDateLabel(selectedDate).toLowerCase()}.</p>
                  <p className="text-xs text-gray-400 mt-1">Tell your coach what you ate!</p>
                </div>
              ) : (
                groupedActual.map(([type, meals]) => (
                  <div key={type} className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-gray-600">{EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}</span>
                      <span className="text-xs text-gray-400">{Math.round(sumMeals(meals).calories)} cal</span>
                    </div>
                    {meals.map((m) => (
                      <MealCard key={m.id} meal={m} onDelete={deleteActual} onMarkEaten={() => {}} isActual={true} />
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
