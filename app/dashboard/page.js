"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

// ── Date helpers ────────────────────────────────────────────────────
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

// ── Meal helpers ────────────────────────────────────────────────────
function sumMeals(meals) {
  return (meals || []).reduce((t, m) => {
    const s = Number(m.servings || 1);
    return {
      calories: t.calories + Number(m.calories||0) * s,
      protein:  t.protein  + Number(m.protein||0)  * s,
      carbs:    t.carbs    + Number(m.carbs||0)    * s,
      fat:      t.fat      + Number(m.fat||0)      * s,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}
function groupByType(meals) {
  const order = ["breakfast","lunch","dinner","snack"];
  const map = {};
  for (const m of meals) { const k = m.meal_type||"snack"; if (!map[k]) map[k]=[]; map[k].push(m); }
  return Object.entries(map).sort((a,b) => (order.indexOf(a[0])??99)-(order.indexOf(b[0])??99));
}
const MEAL_EMOJI = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };

// ── Theme ───────────────────────────────────────────────────────────
function getTheme(dark) {
  return dark ? {
    bg:"#1c1c1e", surface:"#242424", card:"#2a2a2a", border:"#2c2c2c",
    text:"#f0f0f0", sub:"#888888", muted:"#3a3a3a", input:"#333333",
  } : {
    bg:"#f5f5f5", surface:"#ffffff", card:"#ffffff", border:"#ebebeb",
    text:"#111111", sub:"#aaaaaa", muted:"#f0f0f0", input:"#f8f8f8",
  };
}

// ── Calorie Ring ────────────────────────────────────────────────────
function CalRing({ eaten, planned, goal, dark, t }) {
  const R = 52, CIRC = 2 * Math.PI * R;
  const eatenPct    = Math.min(1, eaten / goal);
  const combinedPct = Math.min(1, (eaten + planned) / goal);
  const pct = Math.round((eaten / goal) * 100);
  return (
    <svg width="136" height="136" viewBox="0 0 136 136">
      <circle cx="68" cy="68" r={R} fill="none" stroke={t.muted} strokeWidth="9" />
      <circle cx="68" cy="68" r={R} fill="none"
        stroke={dark ? "#3a3a3a" : "#bfdbfe"} strokeWidth="9"
        strokeDasharray={`${combinedPct * CIRC} ${CIRC}`}
        strokeDashoffset={CIRC * 0.25} strokeLinecap="round"
        style={{ transition: "stroke-dasharray .6s ease" }} />
      <circle cx="68" cy="68" r={R} fill="none"
        stroke="#2563eb" strokeWidth="9"
        strokeDasharray={`${eatenPct * CIRC} ${CIRC}`}
        strokeDashoffset={CIRC * 0.25} strokeLinecap="round"
        style={{ transition: "stroke-dasharray .6s ease" }} />
      <text x="68" y="60" textAnchor="middle" fontSize="21" fontWeight="800"
        fill={t.text} fontFamily="'DM Sans', sans-serif">{eaten.toLocaleString()}</text>
      <text x="68" y="76" textAnchor="middle" fontSize="10" fontWeight="500"
        fill={t.sub} fontFamily="'DM Sans', sans-serif">of {goal.toLocaleString()} cal</text>
      <text x="68" y="92" textAnchor="middle" fontSize="11" fontWeight="700"
        fill="#2563eb" fontFamily="'DM Sans', sans-serif">{pct}%</text>
    </svg>
  );
}

// ── Macro Pill ──────────────────────────────────────────────────────
function MacroPill({ label, eaten, goal, color, t }) {
  const pct = Math.min(100, Math.round((eaten / goal) * 100));
  return (
    <div style={{ background: t.muted, borderRadius: 12, padding: "9px 11px", flex: 1 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: t.sub, letterSpacing:".05em", textTransform:"uppercase" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: t.text }}>{pct}%</span>
      </div>
      <div style={{ height: 3, background: t.card, borderRadius: 9999, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background: color, borderRadius: 9999, transition:"width .5s ease" }} />
      </div>
      <div style={{ marginTop: 5, fontSize: 12, fontWeight: 700, color: t.text }}>
        {Math.round(eaten)}g <span style={{ fontWeight: 400, color: t.sub }}>/ {goal}g</span>
      </div>
    </div>
  );
}

// ── Summary Card ────────────────────────────────────────────────────
function SummaryCard({ label, value, icon, accent, t }) {
  return (
    <div style={{ background: t.card, border:`1px solid ${t.border}`, borderRadius: 16, padding:"12px 10px", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 16, marginBottom: 3 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent, lineHeight: 1.1, letterSpacing:"-.02em" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: 9, fontWeight: 600, color: t.sub, marginTop: 2, textTransform:"uppercase", letterSpacing:".06em" }}>{label}</div>
    </div>
  );
}

// ── Meal Card ───────────────────────────────────────────────────────
function MealCard({ meal, onDelete, onMarkEaten, onUpdateServings, onCopy, isActual, t }) {
  const [busy, setBusy]           = useState(false);
  const [showConfirm, setConfirm] = useState(false);
  const [showCopy, setCopy]       = useState(false);

  const [servings, setServings]       = useState(meal.servings || 1);
  const [servingsInput, setServingsInput] = useState(String(meal.servings || 1));

  const [copyDate, setCopyDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split("T")[0];
  });
  const [copyType, setCopyType] = useState(meal.meal_type || "lunch");

  async function act(fn) { setBusy(true); await fn(); setBusy(false); }

  async function handleDelete() {
    if (!showConfirm) { setConfirm(true); return; }
    await act(() => onDelete(meal.id)); setConfirm(false);
  }

  function handleServingsChange(v) {
    setServingsInput(v);
  }

  async function handleServingsBlur() {
    const val = parseFloat(servingsInput);
    if (isNaN(val) || val <= 0) {
      setServingsInput(String(servings));
      return;
    }
    const rounded = Math.round(val * 4) / 4;
    setServings(rounded);
    setServingsInput(String(rounded));
    if (onUpdateServings) await onUpdateServings(meal.id, rounded, isActual);
  }

  async function handleCopy() {
    await act(() => onCopy({ ...meal, meal_type: copyType }, copyDate));
    setCopy(false);
  }

  async function handleMarkEaten() {
    await act(() => onMarkEaten(meal.id));
  }

  const cal = Math.round((meal.calories||0) * servings);
  const prot = Math.round((meal.protein||0) * servings * 100) / 100;
  const carb = Math.round((meal.carbs||0) * servings * 100) / 100;
  const f = Math.round((meal.fat||0) * servings * 100) / 100;

  return (
    <div style={{ background: t.card, border:`1px solid ${t.border}`, borderRadius: 14, padding: "10px 12px", marginBottom: 10, position:"relative" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 4 }}>{meal.food}</div>
          <div style={{ display:"flex", gap: 12, fontSize: 12, color: t.sub }}>
            <span>{cal} cal</span>
            <span>P: {prot}g</span>
            <span>C: {carb}g</span>
            <span>F: {f}g</span>
          </div>
        </div>
        <div style={{ display:"flex", gap: 6, alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap: 4 }}>
            <input type="text" value={servingsInput} onChange={(e) => handleServingsChange(e.target.value)}
              onBlur={handleServingsBlur} style={{ width: 40, padding: "4px 6px", background: t.input,
              border:`1px solid ${t.border}`, borderRadius: 6, color: t.text, fontSize: 12, fontFamily: "inherit" }} />
            <span style={{ fontSize: 11, color: t.sub }}>×</span>
          </div>
          <div style={{ display:"flex", gap: 4 }}>
            {!isActual ? (
              <>
                {/* PLANNED: Mark as Eaten */}
                <button onClick={handleMarkEaten} disabled={busy}
                  style={{ width: 24, height: 24, display:"flex", alignItems:"center", justifyContent:"center",
                  background:"transparent", border:"none", color: "#10b981", cursor:"pointer", fontSize: 12 }}>✓</button>
                
                {/* PLANNED: Copy to another date */}
                {showCopy ? (
                  <div style={{ position:"absolute", top: -120, right: 0, background: t.surface, border:`1px solid ${t.border}`,
                    borderRadius: 10, padding: 10, zIndex: 10, minWidth: 140 }}>
                    <div style={{ fontSize: 10, color: t.sub, marginBottom: 6 }}>Copy to:</div>
                    <input type="date" value={copyDate} onChange={(e) => setCopyDate(e.target.value)}
                      style={{ width:"100%", padding: "4px 6px", background: t.input, border:`1px solid ${t.border}`,
                      borderRadius: 6, color: t.text, fontSize: 11, marginBottom: 6, fontFamily: "inherit" }} />
                    <select value={copyType} onChange={(e) => setCopyType(e.target.value)}
                      style={{ width:"100%", padding: "4px 6px", background: t.input, border:`1px solid ${t.border}`,
                      borderRadius: 6, color: t.text, fontSize: 11, marginBottom: 6, fontFamily: "inherit" }}>
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                    <button onClick={handleCopy} disabled={busy}
                      style={{ width:"100%", padding: "6px", background: "#2563eb", color: "#fff",
                      border:"none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor:"pointer" }}>
                      Copy
                    </button>
                  </div>
                ) : null}
                <button onClick={() => setCopy(!showCopy)} disabled={busy}
                  style={{ width: 24, height: 24, display:"flex", alignItems:"center", justifyContent:"center",
                  background:"transparent", border:"none", color: "#2563eb", cursor:"pointer", fontSize: 12 }}>📋</button>
              </>
            ) : (
              <>
                {/* EATEN: Copy to another date */}
                {showCopy ? (
                  <div style={{ position:"absolute", top: -120, right: 0, background: t.surface, border:`1px solid ${t.border}`,
                    borderRadius: 10, padding: 10, zIndex: 10, minWidth: 140 }}>
                    <div style={{ fontSize: 10, color: t.sub, marginBottom: 6 }}>Copy to:</div>
                    <input type="date" value={copyDate} onChange={(e) => setCopyDate(e.target.value)}
                      style={{ width:"100%", padding: "4px 6px", background: t.input, border:`1px solid ${t.border}`,
                      borderRadius: 6, color: t.text, fontSize: 11, marginBottom: 6, fontFamily: "inherit" }} />
                    <select value={copyType} onChange={(e) => setCopyType(e.target.value)}
                      style={{ width:"100%", padding: "4px 6px", background: t.input, border:`1px solid ${t.border}`,
                      borderRadius: 6, color: t.text, fontSize: 11, marginBottom: 6, fontFamily: "inherit" }}>
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                    <button onClick={handleCopy} disabled={busy}
                      style={{ width:"100%", padding: "6px", background: "#2563eb", color: "#fff",
                      border:"none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor:"pointer" }}>
                      Copy
                    </button>
                  </div>
                ) : null}
                <button onClick={() => setCopy(!showCopy)} disabled={busy}
                  style={{ width: 24, height: 24, display:"flex", alignItems:"center", justifyContent:"center",
                  background:"transparent", border:"none", color: "#2563eb", cursor:"pointer", fontSize: 12 }}>📋</button>
              </>
            )}
            
            {/* DELETE - shows for both */}
            <button onClick={handleDelete} disabled={busy}
              style={{ width: 24, height: 24, display:"flex", alignItems:"center", justifyContent:"center",
              background: showConfirm ? "#dc2626" : "transparent", border:"none", color: showConfirm ? "#fff" : "#888",
              cursor:"pointer", fontSize: 12, borderRadius: 4 }}>
              {showConfirm ? "✓" : "✕"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bottom Nav ──────────────────────────────────────────────────────
function BottomNav({ t }) {
  const router = useRouter();
  const tabs = [
    { id:"coach", icon:"💬", label:"Coach", path:"/" },
    { id:"dashboard", icon:"📊", label:"Dashboard", path:"/dashboard" },
    { id:"profile", icon:"⚙️", label:"Profile", path:"/profile" },
  ];
  return (
    <div style={{ position:"fixed", bottom: 0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth: 430, background: t.surface, borderTop:`1px solid ${t.border}`,
      display:"flex", zIndex: 100, paddingBottom:"env(safe-area-inset-bottom, 8px)" }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => router.push(tab.path)}
          style={{ flex: 1, display:"flex", flexDirection:"column", alignItems:"center", gap: 3, padding:"10px 0 4px",
          border:"none", background:"transparent", cursor:"pointer" }}>
          <span style={{ fontSize: 20 }}>{tab.icon}</span>
          <span style={{ fontSize: 10, fontWeight: tab.id === "dashboard" ? 700 : 500,
            color: tab.id === "dashboard" ? "#2563eb" : t.sub, letterSpacing:".03em", fontFamily:"'DM Sans', sans-serif" }}>
            {tab.label}
          </span>
          {tab.id === "dashboard" && (
            <div style={{ width: 18, height: 2, background:"#2563eb", borderRadius: 9999 }} />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main Dashboard Component ────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [dark, setDark] = useState(true);
  const t = getTheme(dark);

  const [userId, setUserId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [actual, setActual] = useState([]);
  const [planned, setPlanned] = useState([]);
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState({ calories: 2800, protein: 220, carbs: 305, fat: 78 });

  // ── Load Goals from Database ──
  async function loadGoals(uid) {
    try {
      const { data } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", uid)
        .single();
      
      if (data) {
        setGoal({
          calories: data.calories || 2800,
          protein: data.protein || 220,
          carbs: data.carbs || 305,
          fat: data.fat || 78,
        });
      }
    } catch (e) {
      console.log("Goals load error:", e);
    }
  }

  // ── Load Meals for Selected Date ──
  async function loadMeals(uid, date) {
    try {
      setLoading(true);
      const { data: actualData } = await supabase
        .from("actual_meals")
        .select("*")
        .eq("user_id", uid)
        .eq("date", date);

      const { data: plannedData } = await supabase
        .from("planned_meals")
        .select("*")
        .eq("user_id", uid)
        .eq("date", date);

      setActual(actualData || []);
      setPlanned(plannedData || []);
      setLoading(false);
    } catch (e) {
      console.log("Meals load error:", e);
      setLoading(false);
    }
  }

  // ── Auth Setup ──
  useEffect(() => {
    async function initAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        await loadGoals(user.id);
        await loadMeals(user.id, getLocalDate());
      }
    }
    initAuth();
  }, []);

  // ── Load Meals on Date Change ──
  useEffect(() => {
    if (userId) {
      loadMeals(userId, selectedDate);
    }
  }, [selectedDate, userId]);

  // ── Delete Actual Meal ──
  async function deleteActual(mealId) {
    await supabase.from("actual_meals").delete().eq("id", mealId);
    setActual(a => a.filter(m => m.id !== mealId));
  }

  // ── Delete Planned Meal ──
  async function deletePlanned(mealId) {
    await supabase.from("planned_meals").delete().eq("id", mealId);
    setPlanned(p => p.filter(m => m.id !== mealId));
  }

  // ── Mark Planned as Eaten ──
  async function markEaten(mealId) {
    const meal = planned.find(m => m.id === mealId);
    if (!meal) return;

    await supabase.from("planned_meals").delete().eq("id", mealId);
    await supabase.from("actual_meals").insert({
      user_id: userId,
      food: meal.food,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      servings: meal.servings || 1,
      meal_type: meal.meal_type,
      date: selectedDate,
    });

    setPlanned(p => p.filter(m => m.id !== mealId));
    setActual(a => [...a, { ...meal, id: Math.random(), date: selectedDate }]);
  }

  // ── Update Servings ──
  async function updateServings(mealId, newServings, isActualMeal) {
    const table = isActualMeal ? "actual_meals" : "planned_meals";
    await supabase.from(table).update({ servings: newServings }).eq("id", mealId);
    
    if (isActualMeal) {
      setActual(a => a.map(m => m.id === mealId ? { ...m, servings: newServings } : m));
    } else {
      setPlanned(p => p.map(m => m.id === mealId ? { ...m, servings: newServings } : m));
    }
  }

  // ── Copy Meal to Another Date ──
  async function copyMeal(meal, newDate) {
    const table = meal.id && actual.find(m => m.id === meal.id) ? "actual_meals" : "planned_meals";
    
    await supabase.from(table).insert({
      user_id: userId,
      food: meal.food,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      servings: meal.servings || 1,
      meal_type: meal.meal_type,
      date: newDate,
    });

    if (newDate === selectedDate) {
      await loadMeals(userId, selectedDate);
    }
  }

  // ── Calculate Totals ──
  const actualTotals = sumMeals(actual);
  const plannedTotals = sumMeals(planned);
  const remaining = {
    calories: Math.max(0, goal.calories - actualTotals.calories - plannedTotals.calories),
    protein: Math.max(0, goal.protein - actualTotals.protein - plannedTotals.protein),
    carbs: Math.max(0, goal.carbs - actualTotals.carbs - plannedTotals.carbs),
    fat: Math.max(0, goal.fat - actualTotals.fat - plannedTotals.fat),
  };

  return (
    <>
      <div style={{ width: "100%", height: "100vh", maxWidth: 430, margin:"0 auto",
        background: t.bg, display:"flex", flexDirection:"column", fontFamily:"'DM Sans', sans-serif" }}>

        {/* ── Header ── */}
        <div style={{ background: t.surface, borderBottom:`1px solid ${t.border}`,
          padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top: 0, zIndex: 50 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color:"#2563eb", letterSpacing:".1em", textTransform:"uppercase" }}>CURA</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.text, lineHeight: 1.1 }}>Dashboard</div>
          </div>
          <button onClick={() => setDark(!dark)}
            style={{ background:"transparent", border:"none", cursor:"pointer", fontSize: 20 }}>
            {dark ? "☀️" : "🌙"}
          </button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 100px",
          display:"flex", flexDirection:"column", gap:12, background: t.bg }}>

          {/* ── Ring + Macros ── */}
          <div style={{ background: t.surface, borderRadius: 20, padding:"18px 14px 14px",
            border:`1px solid ${t.border}`, marginBottom: 10 }}>
            <div style={{ display:"flex", alignItems:"center", gap: 14 }}>
              <CalRing eaten={Math.round(actualTotals.calories)}
                planned={Math.round(plannedTotals.calories)}
                goal={goal.calories} dark={dark} t={t} />
              <div style={{ flex: 1, display:"flex", flexDirection:"column", gap: 6 }}>
                <MacroPill label="Protein" eaten={actualTotals.protein} goal={goal.protein} color="#3b82f6" t={t} />
                <MacroPill label="Carbs"   eaten={actualTotals.carbs}   goal={goal.carbs}   color="#10b981" t={t} />
                <MacroPill label="Fat"     eaten={actualTotals.fat}     goal={goal.fat}     color="#f59e0b" t={t} />
              </div>
            </div>
            <div style={{ display:"flex", gap: 16, marginTop: 12, justifyContent:"center" }}>
              {[
                { label:"Eaten",   color:"#2563eb" },
                { label:"Planned", color: dark ? "#3a3a3a" : "#bfdbfe" },
                { label:"Left",    color: t.muted },
              ].map(l => (
                <div key={l.label} style={{ display:"flex", alignItems:"center", gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius:"50%", background: l.color }} />
                  <span style={{ fontSize: 10, color: t.sub, fontWeight: 500 }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Summary Cards ── */}
          <div style={{ display:"flex", gap: 8, marginBottom: 14 }}>
            <SummaryCard label="Goal"    value={goal.calories}                     icon="🎯" accent="#2563eb" t={t} />
            <SummaryCard label="Eaten"   value={Math.round(actualTotals.calories)} icon="✅" accent="#10b981" t={t} />
            <SummaryCard label="Planned" value={Math.round(plannedTotals.calories)} icon="📋" accent="#8b5cf6" t={t} />
            <SummaryCard label="Left"    value={Math.round(remaining.calories)}    icon="⏳" accent="#f59e0b" t={t} />
          </div>

          {/* ── Date Nav ── */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom: 18, background: t.surface, borderRadius: 14,
            border:`1px solid ${t.border}`, padding:"8px 12px" }}>
            <button onClick={() => setSelectedDate(d => getShiftedDate(d, -1))}
              style={{ fontSize: 12, fontWeight: 600, color: t.sub, background:"transparent",
                border:"none", cursor:"pointer", padding:"4px 8px", borderRadius: 8 }}>← Prev</button>
            <div style={{ textAlign:"center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                {formatDateLabel(selectedDate)}
              </span>
              {selectedDate !== getLocalDate() && (
                <button onClick={() => setSelectedDate(getLocalDate())}
                  style={{ display:"block", fontSize: 10, color:"#2563eb", background:"transparent",
                    border:"none", cursor:"pointer", margin:"2px auto 0", fontWeight: 600 }}>
                  Back to today
                </button>
              )}
            </div>
            <button onClick={() => setSelectedDate(d => getShiftedDate(d, 1))}
              style={{ fontSize: 12, fontWeight: 600, color: t.sub, background:"transparent",
                border:"none", cursor:"pointer", padding:"4px 8px", borderRadius: 8 }}>Next →</button>
          </div>

          {loading ? (
            <div style={{ display:"flex", justifyContent:"center", paddingTop: 60 }}>
              <div style={{ display:"flex", gap: 6 }}>
                {[0,150,300].map(d => (
                  <div key={d} style={{ width: 8, height: 8, borderRadius:"50%", background:"#2563eb",
                    animation:"bounce 1s infinite", animationDelay:`${d}ms` }} />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* ── Planned Meals ── */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display:"flex", alignItems:"center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: t.text }}>📋 Planned</span>
                  {planned.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 600, background: t.muted,
                      color: t.sub, borderRadius: 20, padding:"2px 8px" }}>{planned.length}</span>
                  )}
                </div>
                {groupByType(planned).length === 0 ? (
                  <div style={{ background: t.surface, border:`1px solid ${t.border}`, borderRadius: 16,
                    padding:"24px 16px", textAlign:"center" }}>
                    <p style={{ fontSize: 13, color: t.sub }}>No planned meals for {formatDateLabel(selectedDate).toLowerCase()}.</p>
                    <p style={{ fontSize: 11, color: t.sub, marginTop: 4 }}>Ask your coach to plan your meals!</p>
                  </div>
                ) : groupByType(planned).map(([type, meals]) => (
                  <div key={type} style={{ marginBottom: 14 }}>
                    <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t.sub }}>
                        {MEAL_EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}
                      </span>
                      <span style={{ fontSize: 11, color: t.sub }}>
                        {Math.round(sumMeals(meals).calories)} cal
                      </span>
                    </div>
                    {meals.map(m => (
                      <MealCard key={m.id} meal={m} onDelete={deletePlanned}
                        onMarkEaten={markEaten} onUpdateServings={updateServings}
                        onCopy={copyMeal} isActual={false} t={t} />
                    ))}
                  </div>
                ))}
              </div>

              {/* ── Eaten Meals ── */}
              <div>
                <div style={{ display:"flex", alignItems:"center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: t.text }}>✅ Eaten</span>
                  {actual.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 600, background: t.muted,
                      color: t.sub, borderRadius: 20, padding:"2px 8px" }}>{actual.length}</span>
                  )}
                </div>
                {groupByType(actual).length === 0 ? (
                  <div style={{ background: t.surface, border:`1px solid ${t.border}`, borderRadius: 16,
                    padding:"24px 16px", textAlign:"center" }}>
                    <p style={{ fontSize: 13, color: t.sub }}>Nothing logged yet for {formatDateLabel(selectedDate).toLowerCase()}.</p>
                    <p style={{ fontSize: 11, color: t.sub, marginTop: 4 }}>Tell your coach what you ate!</p>
                  </div>
                ) : groupByType(actual).map(([type, meals]) => (
                  <div key={type} style={{ marginBottom: 14 }}>
                    <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t.sub }}>
                        {MEAL_EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}
                      </span>
                      <span style={{ fontSize: 11, color: t.sub }}>
                        {Math.round(sumMeals(meals).calories)} cal
                      </span>
                    </div>
                    {meals.map(m => (
                      <MealCard key={m.id} meal={m} onDelete={deleteActual}
                        onMarkEaten={() => {}} onUpdateServings={updateServings}
                        onCopy={copyMeal} isActual={true} t={t} />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <BottomNav t={t} />
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  );
}