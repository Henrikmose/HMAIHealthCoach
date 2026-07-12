"use client";

// ═══ [v99] PLAN TAB — WEEK NAV, DAY SELECTION, PREP MODE ═════════════════════
// Generation model:
//   - ◀ ▶ navigate weeks (any week; past weeks are view-only reference)
//   - "⚡ Generate…" enters SELECTION MODE: tap days to check/uncheck them
//     (empty future days preselected), then "Generate N days" runs them
//     sequentially with live progress. Selection IS the specification.
//   - 🎨 Variety / 🍱 Prep toggle: variety never repeats mains; prep DELIBERATELY
//     reuses batch proteins with different sides (cook Sunday, eat all week).
//   - Gap-filling only, server-side: planned meals, kept drafts, AND food already
//     eaten (when generating today) are fixed points. Nothing is ever deleted.
//   - Green "Accept day" bar promotes drafts; red "Reject day" bar clears them
//     (logged as the weaker day-level rejection signal for the learning loop).

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import BottomNav from "../components/BottomNav";

// ── Date helpers ─────────────────────────────────────────────────────
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
function weekOfLabel(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
const RED = "#ef4444";

export default function PlanPage() {
  const [dark] = useState(true);
  const t = getTheme(dark);

  const today = getLocalDate();
  const [userId, setUserId] = useState(null);
  const [weekStart, setWeekStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [weekMeals, setWeekMeals] = useState({});
  const [goalCalories, setGoalCalories] = useState(null);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState(false);
  const [genProgress, setGenProgress] = useState(null);   // { current, total, day }
  const [actionBusy, setActionBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [pickedDays, setPickedDays] = useState(new Set());
  const [prepMode, setPrepMode] = useState(false);         // 🎨 variety (false) / 🍱 prep (true)

  const weekDates = Array.from({ length: 7 }, (_, i) => getShiftedDate(weekStart, i));

  async function loadWeek(uid, startDate = weekStart) {
    try {
      const dates = Array.from({ length: 7 }, (_, i) => getShiftedDate(startDate, i));
      const [{ data: rows }, { data: goalRow }] = await Promise.all([
        supabase.from("planned_meals").select("*")
          .eq("user_id", uid)
          .in("status", ["planned", "proposed"])
          .gte("date", dates[0])
          .lte("date", dates[6]),
        supabase.from("goals").select("calories").eq("user_id", uid).single(),
      ]);
      const byDate = {};
      for (const d of dates) byDate[d] = [];
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

  function changeWeek(direction) {
    if (genBusy) return;
    const newStart = getShiftedDate(weekStart, direction * 7);
    setWeekStart(newStart);
    setSelectedDate(newStart);
    setSelectMode(false);
    setPickedDays(new Set());
    if (userId) { setLoading(true); loadWeek(userId, newStart); }
  }

  // ── Selection mode ──
  function enterSelectMode() {
    // Preselect the common case: every future/today day with a missing main
    const pre = new Set();
    for (const d of weekDates) {
      if (d < today) continue;
      const types = new Set((weekMeals[d] || []).map(m => m.meal_type));
      if (["breakfast","lunch","dinner"].some(x => !types.has(x))) pre.add(d);
    }
    setPickedDays(pre);
    setSelectMode(true);
  }
  function togglePick(d) {
    if (d < today) return;                    // never generate the past
    const next = new Set(pickedDays);
    if (next.has(d)) next.delete(d); else next.add(d);
    setPickedDays(next);
  }

  // ── Generate the picked days, sequentially with live progress ──
  async function generatePicked() {
    if (!userId || genBusy || pickedDays.size === 0) return;
    const days = [...pickedDays].sort();
    setGenBusy(true);
    setSelectMode(false);
    let failures = 0;
    for (let i = 0; i < days.length; i++) {
      setGenProgress({ current: i + 1, total: days.length, day: dayName(days[i]) });
      try {
        const res = await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generate: true, date: days[i], userId, mode: prepMode ? "prep" : "variety" }),
        });
        const data = await res.json();
        if (!data.success) failures++;
        await loadWeek(userId);               // days appear as they finish
      } catch { failures++; }
    }
    setGenProgress(null);
    setGenBusy(false);
    setPickedDays(new Set());
    if (failures > 0) alert(`${failures} day(s) failed — select those days and generate again.`);
  }

  // ── Accept the day's drafts ──
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

  // ── Reject one proposed meal (strong signal) ──
  async function rejectGroup(rows, context = "plan_tab") {
    if (!userId || rows.length === 0) return false;
    const totals = sumMeals(rows);
    try {
      await supabase.from("rejected_suggestions").insert([{
        user_id: userId,
        date: rows[0].date,
        meal_type: rows[0].meal_type,
        foods: rows.map(r => ({ food: r.food, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat })),
        calories: Math.round(totals.calories),
        context,
      }]);
    } catch (e) { console.log("rejected_suggestions insert failed (non-blocking):", e); }
    const { error } = await supabase.from("planned_meals")
      .delete().in("id", rows.map(r => r.id));
    if (error) { alert(`Reject failed: ${error.message}`); return false; }
    return true;
  }
  async function rejectOne(rows) {
    if (actionBusy) return;
    setActionBusy(true);
    await rejectGroup(rows, "plan_tab");
    await loadWeek(userId);
    setActionBusy(false);
  }

  // ── Reject the WHOLE day's drafts (weaker signal — often means "reshuffle") ──
  async function rejectDay(date) {
    if (!userId || actionBusy) return;
    setActionBusy(true);
    const drafts = (weekMeals[date] || []).filter(m => m.status === "proposed");
    for (const g of groupRows(drafts)) {
      await rejectGroup(g.rows, "plan_tab_day_reject");
    }
    await loadWeek(userId);
    setActionBusy(false);
  }

  const dayMeals = weekMeals[selectedDate] || [];
  const plannedMeals = dayMeals.filter(m => m.status === "planned");
  const proposedMeals = dayMeals.filter(m => m.status === "proposed");
  const plannedTotals = sumMeals(plannedMeals);
  const combinedTotals = sumMeals(dayMeals);
  const shownTotals = proposedMeals.length > 0 ? combinedTotals : plannedTotals;
  const hasProposed = proposedMeals.length > 0;
  const isPastDay = selectedDate < today;
  const proposedGroupCount = groupRows(proposedMeals).length;

  return (
    <>
      <div style={{
        minHeight: "100dvh", background: t.bg, fontFamily: "'DM Sans', sans-serif",
        maxWidth: 430, margin: "0 auto", paddingBottom: 90,
      }}>
        {/* ── Header ── */}
        <div style={{ padding: "18px 16px 8px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>📅 Plan</h1>
            <p style={{ fontSize: 12, color: t.sub, margin: "4px 0 0" }}>
              Your week ahead — planned in chat or generated here.
            </p>
          </div>
          {/* 🎨 / 🍱 generation philosophy toggle */}
          <button onClick={() => setPrepMode(!prepMode)} disabled={genBusy}
            style={{ fontSize: 11, fontWeight: 700, flexShrink: 0,
              color: prepMode ? "#fff" : t.sub,
              background: prepMode ? AMBER : t.muted,
              border: "none", borderRadius: 10, padding: "8px 12px", cursor: "pointer" }}>
            {prepMode ? "🍱 Meal prep" : "🎨 Variety"}
          </button>
        </div>

        {/* ── Week navigation ── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding: "4px 16px 6px" }}>
          <button onClick={() => changeWeek(-1)} disabled={genBusy}
            style={{ fontSize: 16, color: t.sub, background: "transparent",
              border: "none", cursor: "pointer", padding: "4px 10px" }}>◀</button>
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
            Week of {weekOfLabel(weekStart)}
          </span>
          <button onClick={() => changeWeek(1)} disabled={genBusy}
            style={{ fontSize: 16, color: t.sub, background: "transparent",
              border: "none", cursor: "pointer", padding: "4px 10px" }}>▶</button>
        </div>

        {/* ── Generation progress ── */}
        {genProgress && (
          <div style={{ margin: "0 16px 10px", background: t.surface,
            border: `1px solid ${t.border}`, borderRadius: 12, padding: "10px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
              Generating {genProgress.day}… {genProgress.current}/{genProgress.total}
            </div>
            <div style={{ height: 4, background: t.muted, borderRadius: 9999, marginTop: 8 }}>
              <div style={{ height: 4, width: `${(genProgress.current / genProgress.total) * 100}%`,
                background: "#2563eb", borderRadius: 9999, transition: "width .3s" }} />
            </div>
          </div>
        )}

        {/* ── Week strip: tap = view, or check/uncheck in selection mode ── */}
        <div style={{ display: "flex", gap: 6, padding: "6px 16px 10px", overflowX: "auto" }}>
          {weekDates.map(d => {
            const isSelected = !selectMode && d === selectedDate;
            const isPicked = selectMode && pickedDays.has(d);
            const isPast = d < today;
            const rows = weekMeals[d] || [];
            const hasPlanned = rows.some(m => m.status === "planned");
            const hasDrafts = rows.some(m => m.status === "proposed");
            return (
              <button key={d}
                onClick={() => selectMode ? togglePick(d) : setSelectedDate(d)}
                style={{
                  flex: "0 0 auto", minWidth: 52, padding: "8px 4px 6px",
                  borderRadius: 14, cursor: isPast && selectMode ? "not-allowed" : "pointer",
                  border: `1px solid ${isSelected || isPicked ? "#2563eb" : t.border}`,
                  background: isSelected || isPicked ? "#2563eb" : t.surface,
                  opacity: selectMode && isPast ? 0.35 : 1,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                }}>
                <span style={{ fontSize: 10, fontWeight: 700,
                  color: isSelected || isPicked ? "#dbeafe" : t.sub }}>
                  {selectMode ? (isPicked ? "✓" : isPast ? "—" : "○") : dayLabel(d)}
                </span>
                <span style={{ fontSize: 15, fontWeight: 800,
                  color: isSelected || isPicked ? "#fff" : t.text }}>{dayNumber(d)}</span>
                <div style={{ display:"flex", gap: 3 }}>
                  <div style={{ width: 5, height: 5, borderRadius: 9999,
                    background: hasPlanned ? (isSelected || isPicked ? "#fff" : "#10b981") : "transparent" }} />
                  <div style={{ width: 5, height: 5, borderRadius: 9999,
                    background: hasDrafts ? (isSelected || isPicked ? "#ffe6b3" : AMBER) : "transparent" }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Generate controls ── */}
        <div style={{ padding: "0 16px 12px" }}>
          {!selectMode ? (
            <button onClick={enterSelectMode} disabled={genBusy || !userId}
              style={{ width: "100%", fontSize: 13, fontWeight: 800, color: "#fff",
                background: genBusy ? "#2563eb55" : "#2563eb", border: "none",
                borderRadius: 12, padding: "12px 0", cursor: genBusy ? "default" : "pointer" }}>
              {genBusy ? "Generating…" : "⚡ Generate meals — pick days"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={generatePicked} disabled={pickedDays.size === 0}
                style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#fff",
                  background: pickedDays.size === 0 ? "#2563eb55" : "#2563eb",
                  border: "none", borderRadius: 12, padding: "12px 0",
                  cursor: pickedDays.size === 0 ? "default" : "pointer" }}>
                ⚡ Generate {pickedDays.size} day{pickedDays.size === 1 ? "" : "s"} ({prepMode ? "🍱 prep" : "🎨 variety"})
              </button>
              <button onClick={() => { setSelectMode(false); setPickedDays(new Set()); }}
                style={{ fontSize: 13, fontWeight: 700, color: t.sub,
                  background: t.muted, border: "none", borderRadius: 12,
                  padding: "12px 16px", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* ── Day summary + accept/reject bars ── */}
        {!selectMode && (
          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ background: t.surface, border: `1px solid ${t.border}`,
              borderRadius: 16, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>
                {dayName(selectedDate)} · {Math.round(plannedTotals.calories)}{goalCalories ? ` / ${goalCalories}` : ""} cal planned
                {hasProposed ? ` · ${Math.round(combinedTotals.calories)} if accepted` : ""}
              </div>
              {/* [v99] full macros, always visible for the selected day */}
              <div style={{ fontSize: 12, color: t.sub, marginTop: 4 }}>
                {Math.round(shownTotals.calories)} cal · {Math.round(shownTotals.protein)}g protein · {Math.round(shownTotals.carbs)}g carbs · {Math.round(shownTotals.fat)}g fat
                {hasProposed ? " (incl. drafts)" : ""}
              </div>

              {hasProposed && (
                <>
                  <button onClick={() => acceptDay(selectedDate)} disabled={actionBusy}
                    style={{ width: "100%", marginTop: 10, fontSize: 13, fontWeight: 800,
                      color: "#fff", background: actionBusy ? "#10b98155" : "#10b981",
                      border: "none", borderRadius: 12, padding: "12px 0", cursor: "pointer" }}>
                    ✅ Accept {dayName(selectedDate)} ({proposedGroupCount} meal{proposedGroupCount > 1 ? "s" : ""})
                  </button>
                  <button onClick={() => rejectDay(selectedDate)} disabled={actionBusy}
                    style={{ width: "100%", marginTop: 8, fontSize: 13, fontWeight: 800,
                      color: RED, background: "transparent",
                      border: `1px solid ${RED}66`, borderRadius: 12, padding: "11px 0", cursor: "pointer" }}>
                    ✕ Reject all drafts for {dayName(selectedDate)}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Meals for the selected day ── */}
        {!selectMode && (
          <div style={{ padding: "0 16px" }}>
            {loading ? (
              <p style={{ fontSize: 13, color: t.sub, textAlign: "center", padding: "24px 0" }}>Loading…</p>
            ) : dayMeals.length === 0 ? (
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
                padding: "28px 16px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: t.sub, margin: 0 }}>
                  Nothing planned for this day{isPastDay ? "" : " yet"}.
                </p>
                {!isPastDay && (
                  <p style={{ fontSize: 11, color: t.sub, marginTop: 4 }}>
                    Tap ⚡ Generate — or plan it in chat ("plan my Tuesday") and it shows up here.
                  </p>
                )}
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
                        justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700,
                          color: isDraft ? AMBER : t.sub }}>
                          {isDraft ? "✨ Draft · " : ""}{g.rows.length} item{g.rows.length > 1 ? "s" : ""} · {Math.round(sumMeals(g.rows).calories)} cal
                        </span>
                        {isDraft && (
                          <button onClick={() => rejectOne(g.rows)} disabled={actionBusy}
                            style={{ fontSize: 11, fontWeight: 700, color: RED,
                              background: "transparent", border: `1px solid ${RED}55`,
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
        )}

        <BottomNav active="plan" t={t} />
      </div>
    </>
  );
}