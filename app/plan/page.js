"use client";

// ═══ [v97] PLAN TAB — STEP A: THE SHELL ══════════════════════════════════════
// The week view for meal planning. This step is READ + NAVIGATE only:
//   - 7-day strip starting today; tap a day to see its planned meals
//   - meals grouped exactly like the dashboard (meal_group_id = one coach card)
//   - day total vs. the user's calorie goal
// Generation (status='proposed' → accept → 'planned') lands in a later step,
// AFTER the status-filtering pass across every planned_meals reader. The
// Generate button is visible but disabled so the UI shape is already real.
// Same coach, two views: everything planned in chat shows up here instantly,
// because both paths read/write the same planned_meals table.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import BottomNav from "../components/BottomNav";

// ── Date helpers (same conventions as the dashboard) ────────────────
function getLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
function getShiftedDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dayLabel(dateStr) {
  const today = getLocalDate();
  if (dateStr === today) return "Today";
  if (dateStr === getShiftedDate(today, 1)) return "Tmrw";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}
function dayNumber(dateStr) {
  return new Date(dateStr + "T12:00:00").getDate();
}

// ── Meal helpers (same as dashboard) ────────────────────────────────
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

// ── Theme (house style) ─────────────────────────────────────────────
function getTheme(dark) {
  return dark ? {
    bg:"#1c1c1e", surface:"#242424", card:"#2a2a2a", border:"#2c2c2c",
    text:"#f0f0f0", sub:"#888888", muted:"#3a3a3a", input:"#333333",
  } : {
    bg:"#f5f5f5", surface:"#ffffff", card:"#ffffff", border:"#ebebeb",
    text:"#111111", sub:"#aaaaaa", muted:"#f0f0f0", input:"#f8f8f8",
  };
}

export default function PlanPage() {
  const [dark] = useState(true);
  const t = getTheme(dark);

  const [userId, setUserId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [weekMeals, setWeekMeals] = useState({});   // { "YYYY-MM-DD": [rows] }
  const [goalCalories, setGoalCalories] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = getLocalDate();
  const weekDates = Array.from({ length: 7 }, (_, i) => getShiftedDate(today, i));

  // ── Load the whole week in ONE query — 7 day-queries would be waste ──
  async function loadWeek(uid) {
    try {
      setLoading(true);
      const [{ data: rows }, { data: goalRow }] = await Promise.all([
        supabase.from("planned_meals").select("*")
          .eq("user_id", uid)
          .eq("status", "planned")          // [v97] forward-compatible: proposed rows (future) never show here as accepted
          .gte("date", weekDates[0])
          .lte("date", weekDates[6]),
        supabase.from("goals").select("calories").eq("user_id", uid).single(),
      ]);
      const byDate = {};
      for (const d of weekDates) byDate[d] = [];
      for (const m of rows || []) {
        if (byDate[m.date]) byDate[m.date].push(m);
      }
      setWeekMeals(byDate);
      if (goalRow?.calories) setGoalCalories(goalRow.calories);
      setLoading(false);
    } catch (e) {
      console.log("Plan week load error:", e);
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (user) {
        setUserId(user.id);
        await loadWeek(user.id);
      }
    }
    init();
  }, []);

  const dayMeals = weekMeals[selectedDate] || [];
  const dayTotals = sumMeals(dayMeals);

  // ── Group rows by meal_group_id within a type (one coach card = one meal) ──
  function groupRows(meals) {
    const groups = [];
    const byGid = new Map();
    for (const m of meals) {
      const gid = m.meal_group_id || null;
      if (!gid) { groups.push({ gid: `solo-${m.id}`, rows: [m] }); continue; }
      if (!byGid.has(gid)) { const g = { gid, rows: [] }; byGid.set(gid, g); groups.push(g); }
      byGid.get(gid).rows.push(m);
    }
    return groups;
  }

  return (
    <>
      <div style={{
        minHeight: "100dvh", background: t.bg, fontFamily: "'DM Sans', sans-serif",
        maxWidth: 430, margin: "0 auto", paddingBottom: 90,
      }}>
        {/* ── Header ── */}
        <div style={{ padding: "18px 16px 10px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>📅 Plan</h1>
          <p style={{ fontSize: 12, color: t.sub, margin: "4px 0 0" }}>
            Your week ahead — planned in chat or generated here.
          </p>
        </div>

        {/* ── Week strip ── */}
        <div style={{ display: "flex", gap: 6, padding: "6px 16px 14px", overflowX: "auto" }}>
          {weekDates.map(d => {
            const isSelected = d === selectedDate;
            const count = (weekMeals[d] || []).length;
            return (
              <button key={d} onClick={() => setSelectedDate(d)}
                style={{
                  flex: "0 0 auto", minWidth: 52, padding: "8px 4px 6px",
                  borderRadius: 14, cursor: "pointer",
                  border: `1px solid ${isSelected ? "#2563eb" : t.border}`,
                  background: isSelected ? "#2563eb" : t.surface,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                }}>
                <span style={{ fontSize: 10, fontWeight: 700,
                  color: isSelected ? "#dbeafe" : t.sub }}>{dayLabel(d)}</span>
                <span style={{ fontSize: 15, fontWeight: 800,
                  color: isSelected ? "#fff" : t.text }}>{dayNumber(d)}</span>
                <div style={{
                  width: 5, height: 5, borderRadius: 9999,
                  background: count > 0 ? (isSelected ? "#fff" : "#10b981") : "transparent",
                }} />
              </button>
            );
          })}
        </div>

        {/* ── Day summary ── */}
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`,
            borderRadius: 16, padding: "12px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>
                {Math.round(dayTotals.calories)}{goalCalories ? ` / ${goalCalories}` : ""} cal planned
              </div>
              <div style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>
                {Math.round(dayTotals.protein)}g P · {Math.round(dayTotals.carbs)}g C · {Math.round(dayTotals.fat)}g F
              </div>
            </div>
            {/* [v97] Generation lands in the next step — visible but honest about it */}
            <button disabled
              style={{ fontSize: 11, fontWeight: 700, color: t.sub,
                background: t.muted, border: "none", borderRadius: 10,
                padding: "8px 12px", cursor: "not-allowed", opacity: 0.7 }}>
              ⚡ Generate — coming next
            </button>
          </div>
        </div>

        {/* ── Meals for the selected day ── */}
        <div style={{ padding: "0 16px" }}>
          {loading ? (
            <p style={{ fontSize: 13, color: t.sub, textAlign: "center", padding: "24px 0" }}>Loading…</p>
          ) : dayMeals.length === 0 ? (
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
              padding: "28px 16px", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: t.sub, margin: 0 }}>Nothing planned for this day yet.</p>
              <p style={{ fontSize: 11, color: t.sub, marginTop: 4 }}>
                Ask your coach to plan it — or generate it here once generation ships.
              </p>
            </div>
          ) : groupByType(dayMeals).map(([type, meals]) => (
            <div key={type} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.sub }}>
                  {MEAL_EMOJI[type]||"🍽️"} {type.charAt(0).toUpperCase()+type.slice(1)}
                </span>
                <span style={{ fontSize: 11, color: t.sub }}>
                  {Math.round(sumMeals(meals).calories)} cal
                </span>
              </div>
              {groupRows(meals).map(g => (
                <div key={g.gid} style={{
                  background: t.surface, border: `1px solid ${t.border}`,
                  borderRadius: 14, padding: "10px 12px", marginBottom: 8,
                }}>
                  {g.rows.length > 1 && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: t.sub, marginBottom: 6 }}>
                      {g.rows.length} items · {Math.round(sumMeals(g.rows).calories)} cal
                    </div>
                  )}
                  {g.rows.map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between",
                      gap: 8, padding: "3px 0" }}>
                      <span style={{ fontSize: 13, color: t.text }}>{m.food}</span>
                      <span style={{ fontSize: 12, color: t.sub, flexShrink: 0 }}>
                        {Math.round(Number(m.calories||0) * Number(m.servings||1))} cal
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        <BottomNav active="plan" t={t} />
      </div>
    </>
  );
}