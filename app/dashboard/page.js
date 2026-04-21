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
    bg:      "#1c1c1e",
    surface: "#242424",
    card:    "#2a2a2a",
    border:  "#2c2c2c",
    text:    "#f0f0f0",
    sub:     "#888888",
    muted:   "#3a3a3a",
    input:   "#333333",
  } : {
    bg:      "#f5f5f5",
    surface: "#ffffff",
    card:    "#ffffff",
    border:  "#ebebeb",
    text:    "#111111",
    sub:     "#aaaaaa",
    muted:   "#f0f0f0",
    input:   "#f8f8f8",
  };
}

// ── Calorie Ring ────────────────────────────────────────────────────
function CalRing({ eaten, planned, goal, dark, t }) {
  const R = 52, CIRC = 2 * Math.PI * R;
  const eatenPct   = Math.min(1, eaten / goal);
  const combinedPct= Math.min(1, (eaten + planned) / goal);
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
  const [servings, setServings]   = useState(meal.servings || 1);
  const [copyDate, setCopyDate]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split("T")[0];
  });
  const [copyType, setCopyType] = useState(meal.meal_type || "lunch");

  async function act(fn) { setBusy(true); await fn(); setBusy(false); }

  async function handleDelete() {
    if (!showConfirm) { setConfirm(true); return; }
    await act(() => onDelete(meal.id)); setConfirm(false);
  }
  async function handleServings(v) {
    const val = parseFloat(v);
    if (isNaN(val) || val <= 0) return;
    setServings(val);
    if (onUpdateServings) await onUpdateServings(meal.id, val, isActual);
  }
  async function handleCopy() {
    await act(() => onCopy({ ...meal, meal_type: copyType }, copyDate));
    setCopy(false);
  }

  const cal = Math.round((meal.calories||0) * servings);
  const P   = Math.round((meal.protein||0)  * servings);
  const C   = Math.round((meal.carbs||0)    * servings);
  const F   = Math.round((meal.fat||0)      * servings);

  return (
    <div style={{ background: t.card, border:`1px solid ${t.border}`, borderRadius: 16, padding:"12px 14px", marginBottom: 8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: t.text, margin: 0, lineHeight: 1.4 }}>{meal.food}</p>
          <div style={{ display:"flex", gap: 10, marginTop: 6, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: t.sub }}>🔥 {cal} cal</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>P {P}g</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981" }}>C {C}g</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>F {F}g</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: t.sub }}>Servings</span>
            <input type="number" min="0.25" step="0.25" value={servings}
              onChange={e => handleServings(e.target.value)}
              style={{ width: 56, fontSize: 12, padding:"4px 8px", border:`1px solid ${t.border}`, borderRadius: 8,
                textAlign:"center", background: t.input, color: t.text, outline:"none" }} />
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap: 5, flexShrink: 0 }}>
          {!isActual && (
            <button onClick={() => act(() => onMarkEaten(meal))} disabled={busy}
              style={{ fontSize: 11, padding:"6px 10px", borderRadius: 10, background:"#10b981",
                color:"#fff", border:"none", fontWeight: 700, cursor:"pointer", opacity: busy ? .4 : 1 }}>
              {busy ? "…" : "✓ Ate"}
            </button>
          )}
          <button onClick={() => { setCopy(!showCopy); setConfirm(false); }} disabled={busy}
            style={{ fontSize: 11, padding:"6px 8px", borderRadius: 10, background: t.muted,
              color:"#3b82f6", border:"none", cursor:"pointer", opacity: busy ? .4 : 1 }}>
            📋
          </button>
          {showConfirm ? (
            <div style={{ display:"flex", gap: 4 }}>
              <button onClick={handleDelete} disabled={busy}
                style={{ fontSize: 11, padding:"5px 8px", borderRadius: 9, background:"#ef4444",
                  color:"#fff", border:"none", fontWeight: 700, cursor:"pointer" }}>
                {busy ? "…" : "Yes"}
              </button>
              <button onClick={() => setConfirm(false)}
                style={{ fontSize: 11, padding:"5px 8px", borderRadius: 9, background: t.muted,
                  color: t.sub, border:"none", cursor:"pointer" }}>
                No
              </button>
            </div>
          ) : (
            <button onClick={handleDelete} disabled={busy}
              style={{ fontSize: 11, padding:"6px 8px", borderRadius: 10, background: t.muted,
                color: t.sub, border:"none", cursor:"pointer", opacity: busy ? .4 : 1 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {showCopy && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop:`1px solid ${t.border}` }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: t.sub, marginBottom: 8 }}>📋 Copy to...</p>
          <div style={{ display:"flex", gap: 6, marginBottom: 8 }}>
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate()+1); setCopyDate(d.toISOString().split("T")[0]); }}
              style={{ fontSize: 11, padding:"6px 10px", borderRadius: 10, background:"#2563eb22",
                color:"#3b82f6", border:"1px solid #2563eb44", cursor:"pointer", fontWeight: 600 }}>
              Tomorrow
            </button>
            <input type="date" value={copyDate} onChange={e => setCopyDate(e.target.value)}
              style={{ flex: 1, fontSize: 11, padding:"6px 8px", border:`1px solid ${t.border}`,
                borderRadius: 10, background: t.input, color: t.text, outline:"none" }} />
          </div>
          <div style={{ display:"flex", gap: 6 }}>
            <select value={copyType} onChange={e => setCopyType(e.target.value)}
              style={{ flex: 1, fontSize: 11, padding:"6px 8px", border:`1px solid ${t.border}`,
                borderRadius: 10, background: t.input, color: t.text, outline:"none" }}>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
            </select>
            <button onClick={handleCopy} disabled={busy}
              style={{ fontSize: 11, padding:"6px 14px", borderRadius: 10, background:"#2563eb",
                color:"#fff", border:"none", fontWeight: 700, cursor:"pointer", opacity: busy ? .4 : 1 }}>
              {busy ? "…" : "Copy"}
            </button>
            <button onClick={() => setCopy(false)}
              style={{ fontSize: 11, padding:"6px 10px", borderRadius: 10, background: t.muted,
                color: t.sub, border:"none", cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bottom Nav ──────────────────────────────────────────────────────
function BottomNav({ t, dark }) {
  const router = useRouter();
  const tabs = [
    { id:"coach",     icon:"💬", label:"Coach",     path:"/"          },
    { id:"dashboard", icon:"📊", label:"Dashboard", path:"/dashboard" },
    { id:"plan",      icon:"📋", label:"Plan",      path:"/plan"      },
    { id:"profile",   icon:"⚙️", label:"Profile",   path:"/profile"   },
  ];
  return (
    <div style={{ position:"fixed", bottom: 0, left:"50%", transform:"translateX(-50%)", width:"100%",
      maxWidth: 430, background: t.surface, borderTop:`1px solid ${t.border}`,
      display:"flex", zIndex: 100, paddingBottom:"env(safe-area-inset-bottom, 8px)" }}>
      {tabs.map(tab => {
        const active = tab.id === "dashboard";
        return (
          <button key={tab.id} onClick={() => router.push(tab.path)}
            style={{ flex: 1, display:"flex", flexDirection:"column", alignItems:"center",
              gap: 3, padding:"10px 0 4px", border:"none", background:"transparent", cursor:"pointer" }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500,
              color: active ? "#2563eb" : t.sub, letterSpacing:".03em" }}>{tab.label}</span>
            {active && <div style={{ width: 18, height: 2, background:"#2563eb", borderRadius: 9999 }} />}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────
export default function DashboardPage() {
  const [dark, setDark]               = useState(true);
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [loading, setLoading]         = useState(true);
  const [userId, setUserId]           = useState(null);
  const [userName, setUserName]       = useState("");
  const [goal, setGoal]               = useState({ calories:2800, protein:220, carbs:305, fat:78 });
  const [planned, setPlanned]         = useState([]);
  const [actual, setActual]           = useState([]);

  const t = getTheme(dark);

  // Load dark preference
  useEffect(() => {
    const saved = localStorage.getItem("cura_dark");
    if (saved !== null) setDark(saved === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem("cura_dark", dark);
  }, [dark]);

  useEffect(() => {
    const uid   = localStorage.getItem("user_id");
    const uname = localStorage.getItem("user_name");
    if (uname) setUserName(uname);
    if (uid)   setUserId(uid);
  }, []);

  useEffect(() => {
    if (userId) load(userId, selectedDate);
  }, [userId, selectedDate]);

  async function load(uid, date) {
    setLoading(true);
    try {
      const [g, p, a] = await Promise.all([
        supabase.from("goals").select("*").eq("user_id", uid).single(),
        supabase.from("planned_meals").select("*").eq("user_id", uid).eq("date", date).order("created_at", { ascending:true }),
        supabase.from("actual_meals").select("*").eq("user_id", uid).eq("date", date).order("created_at", { ascending:true }),
      ]);
      if (g.data) setGoal(g.data);
      setPlanned(p.data || []);
      setActual(a.data  || []);
    } catch(e) { console.error("Load error:", e); }
    finally { setLoading(false); }
  }

  async function deletePlanned(id) {
    await supabase.from("planned_meals").delete().eq("id", id);
    setPlanned(prev => prev.filter(m => m.id !== id));
  }
  async function deleteActual(id) {
    await supabase.from("actual_meals").delete().eq("id", id);
    setActual(prev => prev.filter(m => m.id !== id));
  }
  async function markEaten(meal) {
    const uid = userId || localStorage.getItem("user_id");
    const { error } = await supabase.from("actual_meals").insert([{
      user_id: uid, date: selectedDate, meal_type: meal.meal_type,
      food: meal.food, calories: meal.calories, protein: meal.protein,
      carbs: meal.carbs, fat: meal.fat, servings: meal.servings || 1,
    }]);
    if (error) { console.error("Mark eaten:", error); return; }
    await supabase.from("planned_meals").delete().eq("id", meal.id);
    await load(uid, selectedDate);
  }
  async function updateServings(id, newServings, isActual) {
    const table = isActual ? "actual_meals" : "planned_meals";
    await supabase.from(table).update({ servings: newServings }).eq("id", id);
    const setter = isActual ? setActual : setPlanned;
    setter(prev => prev.map(m => m.id === id ? { ...m, servings: newServings } : m));
  }
  async function copyMeal(meal, targetDate) {
    const uid = userId || localStorage.getItem("user_id");
    const { error } = await supabase.from("planned_meals").insert([{
      user_id: uid, date: targetDate, meal_type: meal.meal_type,
      food: meal.food, calories: meal.calories, protein: meal.protein,
      carbs: meal.carbs, fat: meal.fat, servings: meal.servings || 1,
    }]);
    if (error) { console.error("Copy meal:", error); alert("Could not copy meal."); return; }
    if (targetDate === selectedDate) await load(uid, selectedDate);
  }

  const actualTotals  = sumMeals(actual);
  const plannedTotals = sumMeals(planned);
  const remaining = {
    calories: Math.max(0, goal.calories - actualTotals.calories - plannedTotals.calories),
    protein:  Math.max(0, goal.protein  - actualTotals.protein  - plannedTotals.protein),
    carbs:    Math.max(0, goal.carbs    - actualTotals.carbs    - plannedTotals.carbs),
    fat:      Math.max(0, goal.fat      - actualTotals.fat      - plannedTotals.fat),
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${t.bg}; }
      `}</style>

      <div style={{ minHeight:"100vh", background: t.bg, fontFamily:"'DM Sans', sans-serif",
        maxWidth: 430, margin:"0 auto", position:"relative", transition:"background .3s" }}>

        {/* ── Sticky Header ── */}
        <div style={{ position:"sticky", top: 0, zIndex: 50, background: t.surface,
          borderBottom:`1px solid ${t.border}`, padding:"52px 20px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color:"#2563eb", textTransform:"uppercase",
                letterSpacing:".1em", margin: 0 }}>CURA</p>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin:"2px 0 0",
                letterSpacing:"-.02em" }}>
                {userName ? `${userName}'s day` : "Dashboard"}
              </h1>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap: 10 }}>
              <span style={{ fontSize: 11, color: t.sub }}>
                {formatDateLabel(selectedDate)}
              </span>
              {/* Dark toggle */}
              <button onClick={() => setDark(!dark)}
                style={{ width: 42, height: 24, borderRadius: 12,
                  background: dark ? "#2563eb" : "#e5e5e5", border:"none",
                  cursor:"pointer", position:"relative", transition:"background .3s", flexShrink: 0 }}>
                <div style={{ position:"absolute", top: 3, left: dark ? 20 : 3, width: 18, height: 18,
                  borderRadius:"50%", background:"#fff", transition:"left .3s",
                  boxShadow:"0 1px 3px rgba(0,0,0,.3)" }} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding:"14px 14px 100px" }}>

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
            {/* Legend */}
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
            <SummaryCard label="Goal"      value={goal.calories}                    icon="🎯" accent="#2563eb" t={t} />
            <SummaryCard label="Eaten"     value={Math.round(actualTotals.calories)} icon="✅" accent="#10b981" t={t} />
            <SummaryCard label="Planned"   value={Math.round(plannedTotals.calories)} icon="📋" accent="#8b5cf6" t={t} />
            <SummaryCard label="Left"      value={Math.round(remaining.calories)}   icon="⏳" accent="#f59e0b" t={t} />
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

        <BottomNav t={t} dark={dark} />
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