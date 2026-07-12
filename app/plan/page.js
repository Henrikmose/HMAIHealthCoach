"use client";

// ═══ [v98] PLAN TAB — GENERATION LIVE ════════════════════════════════════════
// Week view + gap-filling generation:
//   - Generate fills ONLY missing meals; the user's own planned meals and kept
//     drafts are fixed points the engine budgets around. Nothing is ever deleted.
//   - Generated meals arrive as status='proposed' (amber, dashed) — visible here,
//     invisible to the dashboard and coach until accepted.
//   - "Accept day" flips the day's drafts to planned in one update.
//   - Rejecting a meal logs it to rejected_suggestions (the learning data), then
//     removes it. Redo a day = reject what you don't want, generate again.
//   - "Generate week" runs day-by-day with live progress; complete days are
//     skipped server-side before any AI call is made.

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
function dayName(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
}
function dayNumber(dateStr) {
  return new Date(dateStr + "T12:00:00").getDate();
}

// ── Meal helpers ─────────────────────────────────────────────────────
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
// One coach card / one generated meal = one group
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
const AMBER = "#f59e0b";

export default function PlanPage() {
  const [dark] = useState(true);
  const t = getTheme(dark);

  const [userId, setUserId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [weekMeals, setWeekMeals] = useState({});   // { "YYYY-MM-DD": [rows planned+proposed] }
  const [goalCalories, setGoalCalories] = useState(null);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState(null);     // date being generated, or "week"
  const [weekProgress, setWeekProgress] = useState(null); // { current, total, day }
  const [actionBusy, setActionBusy] = useState(false);

  const today = getLocalDate();
  const weekDates = Array.from({ length: 7 }, (_, i) => getShiftedDate(today, i));

  // ── Load the whole week (planned + proposed) in ONE query ──
  async function loadWeek(uid) {
    try {
      const [{ data: rows }, { data: goalRow }] = await Promise.all([
        supabase.from("planned_meals").select("*")
          .eq("user_id", uid)
          .in("status", ["planned", "proposed"])
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

  // ── Generate one day (gap-filling; server never deletes) ──
  async function generateDay(date) {
    if (!userId || genBusy) return;
    setGenBusy(date);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generate: true, date, userId }),
      });
      const data = await res.json();
      if (!data.success) alert(`Generation failed: ${data.error || "unknown error"}`);
      await loadWeek(userId);
    } catch (e) {
      alert("Generation failed — check your connection and try again.");
    }
    setGenBusy(null);
  }

  // ── Generate the rest of the week, day by day with live progress ──
  async function generateWeek() {
    if (!userId || genBusy) return;
    setGenBusy("week");
    let failures = 0;
    for (let i = 0; i < weekDates.length; i++) {
      const d = weekDates[i];
      setWeekProgress({ current: i + 1, total: weekDates.length, day: dayName(d) });
      try {
        const res = await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generate: true, date: d, userId }),
        });
        const data = await res.json();
        if (!data.success) failures++;
        await loadWeek(userId);   // days appear as they finish
      } catch { failures++; }
    }
    setWeekProgress(null);
    setGenBusy(null);
    if (failures > 0) alert(`${failures} day(s) failed to generate — tap those days and generate them individually.`);
  }

  // ── Accept the selected day's drafts: proposed → planned, one update ──
  async function acceptDay(date) {
    if (!userId || actionBusy) return;
    setActionBusy(true);
    const { error } = await supabase.from("planned_meals")
      .update({ status: "planned" })
      .eq("user_id", userId).eq("date", date).eq("status", "proposed");
    if (error) alert(`Accept failed: ${error.message}`);
    await loadWeek(userId);
    setActionBusy(false);
  }

  // ── Reject one proposed meal: log to rejected_suggestions, then remove ──
  async function rejectGroup(rows) {
    if (!userId || actionBusy || rows.length === 0) return;
    setActionBusy(true);
    const totals = sumMeals(rows);
    try {
      // Learning data first — if this insert fails we still remove the rows,
      // rejection UX must never be blocked by analytics.
      await supabase.from("rejected_suggestions").insert([{
        user_id: userId,
        date: rows[0].date,
        meal_type: rows[0].meal_type,
        foods: rows.map(r => ({ food: r.food, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat })),
        calories: Math.round(totals.calories),
        context: "plan_tab",
      }]);
    } catch (e) { console.log("rejected_suggestions insert failed (non-blocking):", e); }
    const { error } = await supabase.from("planned_meals")
      .delete().in("id", rows.map(r => r.id));
    if (error) alert(`Reject failed: ${error.message}`);
    await loadWeek(userId);
    setActionBusy(false);
  }

  const dayMeals = weekMeals[selectedDate] || [];
  const plannedMeals = dayMeals.filter(m => m.status === "planned");
  const proposedMeals = dayMeals.filter(m => m.status === "proposed");
  const plannedTotals = sumMeals(plannedMeals);
  const combinedTotals = sumMeals(dayMeals);
  const hasProposed = proposedMeals.length > 0;
  const existingTypes = new Set(dayMeals.map(m => m.meal_type));
  const missingMains = ["breakfast","lunch","dinner"].filter(x => !existingTypes.has(x));
  const dayComplete = missingMains.length === 0;
  const isGeneratingThis = genBusy === selectedDate || genBusy === "week";

  return (
    <>
      <div style={{
        minHeight: "100dvh", background: t.bg, fontFamily: "'DM Sans', sans-serif",
        maxWidth: 430, margin: "0 auto", paddingBottom: 90,
      }}>
        {/* ── Header ── */}
        <div style={{ padding: "18px 16px 10px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>📅 Plan</h1>
            <p style={{ fontSize: 12, color: t.sub, margin: "4px 0 0" }}>
              Your week ahead — planned in chat or generated here.
            </p>
          </div>
          <button onClick={generateWeek} disabled={!!genBusy || !userId}
            style={{ fontSize: 11, fontWeight: 700, color: "#fff",
              background: genBusy ? "#2563eb55" : "#2563eb", border:"none",
              borderRadius: 10, padding: "8px 12px", cursor: genBusy ? "default" : "pointer",
              flexShrink: 0 }}>
            {genBusy === "week" ? "Generating…" : "⚡ Generate week"}
          </button>
        </div>

        {/* ── Week generation progress ── */}
        {weekProgress && (
          <div style={{ margin: "0 16px 10px", background: t.surface,
            border: `1px solid ${t.border}`, borderRadius: 12, padding: "10px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
              Generating {weekProgress.day}… {weekProgress.current}/{weekProgress.total}
            </div>
            <div style={{ height: 4, background: t.muted, borderRadius: 9999, marginTop: 8 }}>
              <div style={{ height: 4, width: `${(weekProgress.current / weekProgress.total) * 100}%`,
                background: "#2563eb", borderRadius: 9999, transition: "width .3s" }} />
            </div>
          </div>
        )}

        {/* ── Week strip ── */}
        <div style={{ display: "flex", gap: 6, padding: "6px 16px 14px", overflowX: "auto" }}>
          {weekDates.map(d => {
            const isSelected = d === selectedDate;
            const rows = weekMeals[d] || [];
            const hasPlanned = rows.some(m => m.status === "planned");
            const hasDrafts = rows.some(m => m.status === "proposed");
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
                <div style={{ display:"flex", gap: 3 }}>
                  <div style={{ width: 5, height: 5, borderRadius: 9999,
                    background: hasPlanned ? (isSelected ? "#fff" : "#10b981") : "transparent" }} />
                  <div style={{ width: 5, height: 5, borderRadius: 9999,
                    background: hasDrafts ? (isSelected ? "#ffe6b3" : AMBER) : "transparent" }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Day summary + actions ── */}
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`,
            borderRadius: 16, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>
                  {Math.round(plannedTotals.calories)}{goalCalories ? ` / ${goalCalories}` : ""} cal planned
                </div>
                <div style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>
                  {hasProposed
                    ? `${Math.round(combinedTotals.calories)} cal if drafts accepted · ${Math.round(combinedTotals.protein)}g P`
                    : `${Math.round(plannedTotals.protein)}g P · ${Math.round(plannedTotals.carbs)}g C · ${Math.round(plannedTotals.fat)}g F`}
                </div>
              </div>
              <button onClick={() => generateDay(selectedDate)}
                disabled={isGeneratingThis || !userId || (dayComplete && !hasProposed)}
                style={{ fontSize: 11, fontWeight: 700, flexShrink: 0,
                  color: dayComplete && !hasProposed ? t.sub : "#fff",
                  background: isGeneratingThis ? "#2563eb55" : (dayComplete && !hasProposed ? t.muted : "#2563eb"),
                  border: "none", borderRadius: 10, padding: "8px 12px",
                  cursor: isGeneratingThis || (dayComplete && !hasProposed) ? "default" : "pointer" }}>
                {genBusy === selectedDate ? "Generating…" : dayComplete ? "✓ Day complete" : "⚡ Generate this day"}
              </button>
            </div>

            {/* Accept-day is the PRIMARY action once drafts exist */}
            {hasProposed && (
              <button onClick={() => acceptDay(selectedDate)} disabled={actionBusy}
                style={{ width: "100%", marginTop: 10, fontSize: 13, fontWeight: 800,
                  color: "#fff", background: actionBusy ? "#10b98155" : "#10b981",
                  border: "none", borderRadius: 12, padding: "12px 0", cursor: "pointer" }}>
                ✅ Accept {dayName(selectedDate)} ({proposedMeals.length} draft item{proposedMeals.length > 1 ? "s" : ""})
              </button>
            )}
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
                Tap ⚡ Generate — or plan it in chat ("plan my Tuesday") and it shows up here.
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
              {groupRows(meals).map(g => {
                const isDraft = g.rows[0]?.status === "proposed";
                return (
                  <div key={g.gid} style={{
                    background: t.surface,
                    border: isDraft ? `1px dashed ${AMBER}` : `1px solid ${t.border}`,
                    borderRadius: 14, padding: "10px 12px", marginBottom: 8,
                  }}>
                    <div style={{ display: "flex", alignItems: "center",
                      justifyContent: "space-between", gap: 8, marginBottom: g.rows.length > 0 ? 6 : 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700,
                        color: isDraft ? AMBER : t.sub }}>
                        {isDraft ? "✨ Draft · " : ""}{g.rows.length} item{g.rows.length > 1 ? "s" : ""} · {Math.round(sumMeals(g.rows).calories)} cal
                      </span>
                      {isDraft && (
                        <button onClick={() => rejectGroup(g.rows)} disabled={actionBusy}
                          style={{ fontSize: 11, fontWeight: 700, color: "#ef4444",
                            background: "transparent", border: "1px solid #ef444455",
                            borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>
                          ✕ Reject
                        </button>
                      )}
                    </div>
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
                );
              })}
            </div>
          ))}
        </div>

        <BottomNav active="plan" t={t} />
      </div>
    </>
  );
}