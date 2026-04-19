"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import HamburgerMenu from "../components/HamburgerMenu";

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

function groupByType(meals) {
  const order = ["breakfast","lunch","dinner","snack"];
  const map = {};
  for (const m of meals) { const k = m.meal_type||"snack"; if (!map[k]) map[k]=[]; map[k].push(m); }
  return Object.entries(map).sort((a,b) => (order.indexOf(a[0])??99)-(order.indexOf(b[0])??99));
}

const MEAL_EMOJI = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };

// ========================================
// CONFIRM DIALOG
// ========================================
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-xs">
        <p className="text-sm font-semibold text-gray-800 mb-1">Delete meal?</p>
        <p className="text-xs text-gray-500 mb-4">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ========================================
// COPY MEAL DIALOG — with date picker
// ========================================
function CopyMealDialog({ meal, currentDate, onCopy, onCancel }) {
  const today = getLocalDate();
  const [customDate, setCustomDate] = useState("");

  const quickOptions = [
    { label: "Tomorrow", date: getShiftedDate(today, 1) },
    { label: "Day after tomorrow", date: getShiftedDate(today, 2) },
  ].filter(o => o.date !== currentDate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-xs">
        <p className="text-sm font-semibold text-gray-800 mb-1">Copy meal to...</p>
        <p className="text-xs text-gray-500 mb-3 truncate">{meal.food}</p>

        {/* Quick options */}
        <div className="space-y-2 mb-3">
          {quickOptions.map((opt) => (
            <button key={opt.date} onClick={() => onCopy(opt.date)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors text-left px-4">
              📅 {opt.label}
            </button>
          ))}
        </div>

        {/* Date picker */}
        <div className="border border-gray-200 rounded-xl p-3 mb-3">
          <p className="text-xs text-gray-500 mb-1.5">Pick a specific date:</p>
          <input
            type="date"
            value={customDate}
            min={getShiftedDate(today, 1)}
            onChange={(e) => setCustomDate(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-400"
          />
          {customDate && (
            <button onClick={() => onCopy(customDate)}
              className="w-full mt-2 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors">
              Copy to {formatDateLabel(customDate)}
            </button>
          )}
        </div>

        <button onClick={onCancel}
          className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ========================================
// MACRO BAR
// ========================================
function MacroBar({ label, value, goal, color }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value/goal)*100)) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <span className="text-xs font-bold text-gray-700">{Math.round(value)}<span className="text-gray-400 font-normal">/{goal}g</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-2 rounded-full transition-all duration-500" style={{ width:`${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ========================================
// MEAL CARD
// ========================================
function MealCard({ meal, onDelete, onMarkEaten, onUpdateServings, onCopy, isActual }) {
  const [servings, setServings]       = useState(Number(meal.servings) || 1);
  const [servingInput, setServingInput] = useState(String(Number(meal.servings) || 1));
  const [busy, setBusy]               = useState(false);
  const [showDelete, setShowDelete]   = useState(false);
  const [showCopy, setShowCopy]       = useState(false);

  const effectiveCal     = Math.round(meal.calories * servings);
  const effectiveProtein = Math.round(meal.protein  * servings);
  const effectiveCarbs   = Math.round(meal.carbs    * servings);
  const effectiveFat     = Math.round(meal.fat      * servings);

  async function handleServingBlur() {
    const val = parseFloat(servingInput);
    if (!isNaN(val) && val > 0 && val !== servings) {
      setServings(val);
      await onUpdateServings(meal.id, val);
    } else {
      setServingInput(String(servings)); // reset if invalid
    }
  }

  return (
    <>
      {showDelete && (
        <ConfirmDialog
          message={`"${meal.food}" will be removed from your log.`}
          onConfirm={async () => { setShowDelete(false); setBusy(true); await onDelete(meal.id); setBusy(false); }}
          onCancel={() => setShowDelete(false)}
        />
      )}
      {showCopy && (
        <CopyMealDialog
          meal={meal}
          currentDate={meal.date}
          onCopy={async (targetDate) => { setShowCopy(false); await onCopy(meal, targetDate); }}
          onCancel={() => setShowCopy(false)}
        />
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-2">
        {/* Food name and action buttons */}
        <div className="flex justify-between items-start gap-2 mb-2">
          <p className="text-sm font-semibold text-gray-800 leading-snug flex-1">{meal.food}</p>
          <div className="flex gap-1.5 flex-shrink-0">
            {!isActual && (
              <button onClick={async () => { setBusy(true); await onMarkEaten(meal); setBusy(false); }} disabled={busy}
                className="text-xs px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-40 shadow-sm">
                {busy ? "..." : "✓ Ate"}
              </button>
            )}
            <button onClick={() => setShowCopy(true)} disabled={busy}
              className="text-xs px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-500 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-40">
              📋
            </button>
            <button onClick={() => setShowDelete(true)} disabled={busy}
              className="text-xs px-2.5 py-1.5 rounded-xl bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-400 transition-colors disabled:opacity-40">
              ✕
            </button>
          </div>
        </div>

        {/* Serving size — text input */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">Servings:</span>
          <input
            type="number"
            value={servingInput}
            onChange={(e) => setServingInput(e.target.value)}
            onBlur={handleServingBlur}
            min="0.1"
            step="0.25"
            className="w-16 text-sm text-center border border-gray-200 rounded-xl px-2 py-1 focus:outline-none focus:border-blue-400"
          />
          {servings !== 1 && (
            <span className="text-xs text-gray-400">({servings}x)</span>
          )}
        </div>

        {/* Macros */}
        <div className="flex gap-3 flex-wrap">
          <span className="text-xs font-medium text-gray-500">🔥 {effectiveCal} cal</span>
          <span className="text-xs font-medium text-blue-500">P {effectiveProtein}g</span>
          <span className="text-xs font-medium text-emerald-500">C {effectiveCarbs}g</span>
          <span className="text-xs font-medium text-amber-500">F {effectiveFat}g</span>
        </div>
      </div>
    </>
  );
}

// ========================================
// MAIN COMPONENT
// ========================================
export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [loading, setLoading]           = useState(true);
  const [userId, setUserId]             = useState(null);
  const [userName, setUserName]         = useState("");
  const [goal, setGoal]                 = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
  const [planned, setPlanned]           = useState([]);
  const [actual, setActual]             = useState([]);
  const [copySuccess, setCopySuccess]   = useState(null);

  useEffect(() => {
    const uid   = localStorage.getItem("user_id");
    const uname = localStorage.getItem("user_name");
    if (uname) setUserName(uname);
    if (uid) setUserId(uid);
  }, []);

  useEffect(() => { if (userId) load(userId, selectedDate); }, [userId, selectedDate]);

  async function load(uid, date) {
    setLoading(true);
    try {
      const [g, p, a] = await Promise.all([
        supabase.from("goals").select("*").eq("user_id", uid).single(),
        supabase.from("planned_meals").select("*").eq("user_id", uid).eq("date", date).order("created_at", { ascending: true }),
        supabase.from("actual_meals").select("*").eq("user_id", uid).eq("date", date).order("created_at", { ascending: true }),
      ]);
      if (g.data) setGoal(g.data);
      setPlanned(p.data || []);
      setActual(a.data  || []);
    } catch (e) { console.error("Dashboard load error:", e); }
    finally { setLoading(false); }
  }

  async function deletePlanned(id) {
    await supabase.from("planned_meals").delete().eq("id", id);
    setPlanned((prev) => prev.filter((m) => m.id !== id));
  }

  async function deleteActual(id) {
    await supabase.from("actual_meals").delete().eq("id", id);
    setActual((prev) => prev.filter((m) => m.id !== id));
  }

  async function updateServings(table, id, newServings, isActualMeal) {
    await supabase.from(table).update({ servings: newServings }).eq("id", id);
    if (isActualMeal) {
      setActual((prev) => prev.map((m) => m.id === id ? { ...m, servings: newServings } : m));
    } else {
      setPlanned((prev) => prev.map((m) => m.id === id ? { ...m, servings: newServings } : m));
    }
  }

  async function copyMeal(meal, targetDate, sourceTable) {
    const uid = userId || localStorage.getItem("user_id");
    const targetTable = sourceTable === "planned_meals" ? "planned_meals" : "actual_meals";
    try {
      await supabase.from(targetTable).insert([{
        user_id:   uid,
        date:      targetDate,
        meal_type: meal.meal_type,
        food:      meal.food,
        calories:  meal.calories,
        protein:   meal.protein,
        carbs:     meal.carbs,
        fat:       meal.fat,
        servings:  meal.servings || 1,
        ...(targetTable === "planned_meals" ? { status: "planned", suggested_time: null } : {}),
      }]);
      setCopySuccess(`Copied to ${formatDateLabel(targetDate)}!`);
      setTimeout(() => setCopySuccess(null), 2500);
    } catch (e) { console.error("Copy meal error:", e); }
  }

  async function markEaten(meal) {
    const uid = userId || localStorage.getItem("user_id");
    try {
      await supabase.from("actual_meals").insert([{
        user_id: uid, date: selectedDate, meal_type: meal.meal_type,
        food: meal.food, calories: meal.calories, protein: meal.protein,
        carbs: meal.carbs, fat: meal.fat, servings: meal.servings || 1,
      }]);
      await supabase.from("planned_meals").delete().eq("id", meal.id);
      await load(uid, selectedDate);
    } catch (e) { console.error("Mark eaten error:", e); }
  }

  const actualTotals  = sumMeals(actual);
  const plannedTotals = sumMeals(planned);
  const remaining     = {
    calories: Math.max(0, goal.calories - actualTotals.calories),
    protein:  Math.max(0, goal.protein  - actualTotals.protein),
    carbs:    Math.max(0, goal.carbs    - actualTotals.carbs),
    fat:      Math.max(0, goal.fat      - actualTotals.fat),
  };
  const calPct = goal.calories > 0 ? Math.min(100, Math.round((actualTotals.calories/goal.calories)*100)) : 0;

  return (
    <div className="min-h-screen pb-8 bg-gray-50">
      <HamburgerMenu />

      {/* ── Copy success toast ── */}
      {copySuccess && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-2xl shadow-lg">
          ✅ {copySuccess}
        </div>
      )}

      {/* ── Header ── */}
      <div className="px-4 pt-14 pb-4 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
            {userName && <p className="text-sm text-gray-400 mt-0.5">{userName}'s nutrition log</p>}
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-3 py-2 text-right">
            <p className="text-sm font-bold text-blue-700 leading-tight">
              {Math.round(actualTotals.calories)} <span className="font-normal text-blue-400">/ {goal.calories}</span>
            </p>
            <p className="text-xs text-blue-400">cal eaten · {calPct}%</p>
          </div>
        </div>
        <div className="flex gap-4">
          <MacroBar label="Protein" value={actualTotals.protein} goal={goal.protein} color="#3b82f6" />
          <MacroBar label="Carbs"   value={actualTotals.carbs}   goal={goal.carbs}   color="#10b981" />
          <MacroBar label="Fat"     value={actualTotals.fat}     goal={goal.fat}     color="#f59e0b" />
        </div>
      </div>

      {/* ── Date Nav ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <button onClick={() => setSelectedDate((d) => getShiftedDate(d, -1))}
          className="text-sm font-semibold text-gray-600 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors">
          ← Prev
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900">{formatDateLabel(selectedDate)}</p>
          {selectedDate !== getLocalDate() && (
            <button onClick={() => setSelectedDate(getLocalDate())} className="text-xs text-blue-500 font-medium">Back to today</button>
          )}
        </div>
        <button onClick={() => setSelectedDate((d) => getShiftedDate(d, 1))}
          className="text-sm font-semibold text-gray-600 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors">
          Next →
        </button>
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex gap-1">
              {[0,150,300].map((d) => <div key={d} className="w-2 h-2 rounded-full animate-bounce bg-blue-400" style={{ animationDelay:`${d}ms` }} />)}
            </div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { label:"Daily Goal",  val: goal.calories,                      icon:"🎯", bg:"bg-blue-50",    border:"border-blue-100",   text:"text-blue-700",    sub:"text-blue-400"    },
                { label:"Eaten",       val: Math.round(actualTotals.calories),  icon:"✅", bg:"bg-emerald-50", border:"border-emerald-100", text:"text-emerald-700", sub:"text-emerald-400" },
                { label:"Planned",     val: Math.round(plannedTotals.calories), icon:"📋", bg:"bg-purple-50",  border:"border-purple-100",  text:"text-purple-700",  sub:"text-purple-400"  },
                { label:"Remaining",   val: Math.round(remaining.calories),     icon:"⏳", bg:"bg-amber-50",   border:"border-amber-100",   text:"text-amber-700",   sub:"text-amber-400"   },
              ].map(({ label, val, icon, bg, border, text, sub }) => (
                <div key={label} className={`rounded-2xl p-3 border ${bg} ${border}`}>
                  <p className={`text-xs font-semibold mb-1 ${sub}`}>{icon} {label}</p>
                  <p className={`text-2xl font-bold ${text}`}>{val}</p>
                  <p className={`text-xs ${sub}`}>calories</p>
                </div>
              ))}
            </div>

            {/* Planned meals */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-gray-900">📋 Planned Meals</h2>
                {planned.length > 0 && <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{planned.length}</span>}
              </div>
              {groupByType(planned).length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center shadow-sm">
                  <p className="text-sm text-gray-400">No planned meals for {formatDateLabel(selectedDate).toLowerCase()}.</p>
                  <p className="text-xs text-gray-400 mt-1">Ask your coach to plan your meals!</p>
                </div>
              ) : groupByType(planned).map(([type, meals]) => (
                <div key={type} className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-gray-700">{MEAL_EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}</span>
                    <span className="text-xs text-gray-400">{Math.round(sumMeals(meals).calories)} cal</span>
                  </div>
                  {meals.map((m) => (
                    <MealCard key={m.id} meal={m}
                      onDelete={deletePlanned}
                      onMarkEaten={markEaten}
                      onUpdateServings={(id, s) => updateServings("planned_meals", id, s, false)}
                      onCopy={(meal, date) => copyMeal(meal, date, "planned_meals")}
                      isActual={false}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Actual meals */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-gray-900">✅ Eaten</h2>
                {actual.length > 0 && <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{actual.length}</span>}
              </div>
              {groupByType(actual).length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center shadow-sm">
                  <p className="text-sm text-gray-400">Nothing logged yet for {formatDateLabel(selectedDate).toLowerCase()}.</p>
                  <p className="text-xs text-gray-400 mt-1">Tell your coach what you ate!</p>
                </div>
              ) : groupByType(actual).map(([type, meals]) => (
                <div key={type} className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-gray-700">{MEAL_EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}</span>
                    <span className="text-xs text-gray-400">{Math.round(sumMeals(meals).calories)} cal</span>
                  </div>
                  {meals.map((m) => (
                    <MealCard key={m.id} meal={m}
                      onDelete={deleteActual}
                      onMarkEaten={() => {}}
                      onUpdateServings={(id, s) => updateServings("actual_meals", id, s, true)}
                      onCopy={(meal, date) => copyMeal(meal, date, "actual_meals")}
                      isActual={true}
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}