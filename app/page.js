"use client";

import { useState, useEffect, useRef } from "react";
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

function extractTargetDate(text) {
  if (!text) return getLocalDate();
  const lower = text.toLowerCase();
  if (lower.includes("tomorrow")) return addDays(getLocalDate(), 1);
  if (lower.includes("yesterday")) return addDays(getLocalDate(), -1);
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
    /yes\s+please/i,    /yes.*plan/i,
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
  return /\b(yes|yeah|yep|yup|sure|perfect|great|sounds good|i like that|let'?s do|that one|i'?ll have|add it|can we do that|looks good|works for me|do that one|i want that|i'?ll take|love it|that works|go with that|do it|let'?s go with)\b/i.test(text);
}

function isMealSwap(text) {
  if (!text) return false;
  return /i ran out|don'?t have|out of|no more|something else|another option|another suggestion|swap|give me another|can'?t make|different option|instead of|instead|no (salmon|chicken|beef|fish|meat|that)/i.test(text);
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

        if      (fll.startsWith("- foods:"))    foods    = fl.replace(/^-\s*foods:\s*/i, "").trim();
        else if (fll.startsWith("- calories:")) { const m = fl.match(/[\d.]+/); if (m) calories = parseFloat(m[0]); }
        else if (fll.startsWith("- protein:"))  { const m = fl.match(/[\d.]+/); if (m) protein  = parseFloat(m[0]); }
        else if (fll.startsWith("- carbs:"))    { const m = fl.match(/[\d.]+/); if (m) carbs    = parseFloat(m[0]); }
        else if (fll.startsWith("- fat:"))      { const m = fl.match(/[\d.]+/); if (m) fat      = parseFloat(m[0]); }

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
          mealType:    matchedType,
          displayType,
          food:        foods,
          calories:    Math.round(calories),
          protein:     Math.round(protein || 0),
          carbs:       Math.round(carbs   || 0),
          fat:         Math.round(fat     || 0),
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
        mealType:    type,
        displayType,
        food:        m[2].trim(),
        calories:    Math.round(parseFloat(m[3])),
        protein:     Math.round(parseFloat(m[4])),
        carbs:       Math.round(parseFloat(m[5])),
        fat:         Math.round(parseFloat(m[6])),
      });
    }
  }

  return meals;
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
    lunch:     "Lunch",
    dinner:    "Dinner",
    snack:     "Snack",
    snack_2:   "Snack 2",
    snack_3:   "Snack 3",
  };
  return labels[displayType] || displayType.charAt(0).toUpperCase() + displayType.slice(1);
}

// ========================================
// API SAVE (server-side route bypasses RLS)
// ========================================

async function saveMealViaAPI(table, meal, userId) {
  try {
    const res = await fetch("/api/save-meals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, meal, userId }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error(`Save failed (${table}):`, data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Save exception:", e);
    return false;
  }
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
  const [message, setMessage]             = useState("");
  const [history, setHistory]             = useState([]);
  const [isLoading, setIsLoading]         = useState(false);
  const [activeMealLog, setActiveMealLog] = useState(null);
  const [todayMeals, setTodayMeals]       = useState([]);
  const [plannedMeals, setPlannedMeals]   = useState([]);
  const [userId, setUserId]               = useState(null);
  const [userName, setUserName]           = useState("");
  const [goals, setGoals]                 = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });

  const [savedPlanKeys, setSavedPlanKeys] = useState(() => {
    if (typeof window !== "undefined") {
      const storedDate = localStorage.getItem("savedPlanKeysDate");
      if (storedDate === getLocalDate()) {
        const stored = localStorage.getItem("savedPlanKeys");
        return stored ? JSON.parse(stored) : [];
      }
    }
    return [];
  });

  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("savedPlanKeysDate", getLocalDate());
      localStorage.setItem("savedPlanKeys", JSON.stringify(savedPlanKeys));
    }
  }, [savedPlanKeys]);

  useEffect(() => {
    const uid   = localStorage.getItem("user_id");
    const uname = localStorage.getItem("user_name");
    if (uname) setUserName(uname);
    if (uid)   setUserId(uid);
  }, []);

  useEffect(() => {
    if (userId) {
      loadGoals(userId);
      loadTodayMeals(userId);
      loadPlannedMeals(userId);
      loadTodayMessages(userId);
    }
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
          protein:  data.protein,
          carbs:    data.carbs,
          fat:      data.fat,
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
      const { data } = await supabase
        .from("planned_meals").select("*")
        .eq("user_id", uid)
        .eq("date", getLocalDate());
      setPlannedMeals(data || []);
    } catch (e) {
      console.log("Planned meals load error:", e);
    }
  }

  async function loadTodayMessages(uid) {
    try {
      // Load last 20 messages — no date filter to avoid timezone issues
      const { data } = await supabase
        .from("ai_messages").select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(20);

      if (data && data.length > 0) {
        const rebuilt = [];
        for (const row of data.reverse()) {
          if (row.message)  rebuilt.push({ role: "user",      content: row.message });
          if (row.response) rebuilt.push({ role: "assistant", content: row.response });
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
      protein:  t.protein  + Number(m.protein  || 0),
      carbs:    t.carbs    + Number(m.carbs    || 0),
      fat:      t.fat      + Number(m.fat      || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const calPct = goals.calories > 0
    ? Math.min(100, Math.round((totals.calories / goals.calories) * 100))
    : 0;

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;

    const uid = userId || localStorage.getItem("user_id");
    setMessage("");
    setIsLoading(true);

    const userMsg    = { role: "user", content: trimmed };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);

    try {
      let context = {};
      let newActiveMealLog = activeMealLog;

      // Check if user is confirming a previously suggested meal — MUST check before planning detection
      // Look at last 4 AI messages in case the most recent was a text-only response
      const recentAiMsgs = [...history].reverse().filter(m => m.role === "assistant").slice(0, 4);
      const anyRecentAiHadMeals = recentAiMsgs.some(m => parseAllMeals(m.content).length > 0);
      const lastAiHadMeals = anyRecentAiHadMeals;

      if (isLogMessage(trimmed)) {
        newActiveMealLog = {
          type:              "food_log",
          originalMessage:   trimmed,
          mealType:          extractMealType(trimmed),
          conversationStage: "initial",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      } else if (isConfirmation(trimmed) && lastAiHadMeals) {
        // User confirmed a meal suggestion — don't treat as new planning request
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed, isConfirmation: true };
      } else if (isMealPlanningRequest(trimmed) || isWeightGoalRequest(trimmed)) {
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed };
      } else if (isMealSwap(trimmed) && history.some(m => m.role === "assistant" && parseAllMeals(m.content).length > 0)) {
        // User is swapping a previously suggested meal — treat as planning continuation
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed, isSwap: true };
      } else if (activeMealLog) {
        newActiveMealLog = {
          ...activeMealLog,
          followUpMessage:   trimmed,
          conversationStage: "followup",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      }

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:   trimmed,
          context,
          history:   newHistory.slice(-8).map((m) => ({ role: m.role, content: m.content })),
          userId:    uid,
          localHour: new Date().getHours(),
          localDate: getLocalDate(),
        }),
      });

      const data  = await res.json();
      const reply = data.reply || "Sorry, could not get a response.";
      setHistory([...newHistory, { role: "assistant", content: reply }]);

      if (newActiveMealLog?.type === "food_log") {
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
    } catch (err) {
      console.error("Send error:", err);
      setHistory([
        ...newHistory,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddToPlan(meal, msgIdx, targetDate) {
    const key = getMealKey(msgIdx, meal);
    if (savedPlanKeys.includes(key)) return;
    const uid = userId || localStorage.getItem("user_id");

    // Only replace for Breakfast/Lunch/Dinner — Snacks can stack (multiple per day)
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

    const saved = await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
    if (saved) {
      setSavedPlanKeys((prev) => [...prev, key]);
      await loadPlannedMeals(uid);
    } else {
      alert("Could not save to plan. Please try again.");
    }
  }

  async function handleAddAllToPlan(meals, msgIdx, targetDate) {
    const uid = userId || localStorage.getItem("user_id");
    const newKeys = [];
    for (const meal of meals) {
      const key = getMealKey(msgIdx, meal);
      if (!savedPlanKeys.includes(key)) {
        const saved = await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
        if (saved) newKeys.push(key);
      }
    }
    if (newKeys.length > 0) setSavedPlanKeys((prev) => [...prev, ...newKeys]);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <HamburgerMenu />

      {/* ── Header ── */}
      <div className="px-4 pt-14 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">AI Coach</h1>
            {userName && (
              <p className="text-sm text-gray-400 mt-0.5">Hey {userName} 👋</p>
            )}
          </div>
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-2xl px-3 py-2">
            <div className="text-right">
              <p className="text-sm font-bold text-blue-700 leading-tight">
                {totals.calories}{" "}
                <span className="font-normal text-blue-400">/ {goals.calories}</span>
              </p>
              <p className="text-xs text-blue-400">cal today · {calPct}%</p>
            </div>
          </div>
        </div>

        {todayMeals.length > 0 && (
          <div className="flex gap-4">
            <MacroBar label="Protein" value={totals.protein} goal={goals.protein} color="#3b82f6" />
            <MacroBar label="Carbs"   value={totals.carbs}   goal={goals.carbs}   color="#10b981" />
            <MacroBar label="Fat"     value={totals.fat}     goal={goals.fat}     color="#f59e0b" />
          </div>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50">

        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 pb-16">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 bg-blue-600 shadow-lg shadow-blue-200">
              🧠
            </div>
            <p className="font-bold text-gray-800 text-lg">Your AI Health Coach</p>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed max-w-xs">
              Tell me what you ate, ask for a meal plan, or get nutrition advice.
            </p>
            <div className="mt-5 flex flex-col gap-2 w-full max-w-xs">
              {[
                "I had 8oz chicken and 1 cup rice for lunch",
                "Create a meal plan for tomorrow",
                "What should I eat for dinner?",
                "I want to drop 10 pounds",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setMessage(s)}
                  className="text-left text-sm px-4 py-3 rounded-2xl border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, idx) => {
          const isUser = msg.role === "user";

          const meals = !isUser ? parseAllMeals(msg.content) : [];
          const triggerText = !isUser && history[idx - 1]?.role === "user"
            ? history[idx - 1].content
            : "";
          // Button shows after user confirms — check next user message OR the one after that
          // (in case AI gave a text-only recap after the plan before user said yes)
          const nextUserMsg  = history[idx + 1]?.role === "user" ? history[idx + 1].content : null;
          const nextNextUserMsg = history[idx + 3]?.role === "user" ? history[idx + 3].content : null;
          const userConfirmed = (nextUserMsg && isConfirmation(nextUserMsg)) ||
                                (nextNextUserMsg && isConfirmation(nextNextUserMsg));
          const showButtons = meals.length > 0 && userConfirmed;
          const targetDate = extractTargetDate(triggerText);
          const allSaved = meals.length > 0 &&
            meals.every((m) => savedPlanKeys.includes(getMealKey(idx, m)));

          return (
            <div
              key={idx}
              className={`flex ${isUser ? "justify-end" : "justify-start"} items-end gap-2`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0 mb-1 bg-blue-600 shadow-sm shadow-blue-200">
                  🧠
                </div>
              )}

              <div className="max-w-[82%] flex flex-col gap-2">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                    isUser
                      ? "text-white rounded-br-sm shadow-sm"
                      : "bg-white text-gray-800 border border-gray-100 rounded-bl-sm shadow-sm"
                  }`}
                  style={
                    isUser ? { background: "linear-gradient(135deg,#2563eb,#1d4ed8)" } : {}
                  }
                >
                  {msg.content}
                </div>

                {showButtons && (
                  <div className="space-y-2 ml-1">
                    {meals.length > 1 && (
                      <button
                        onClick={() => handleAddAllToPlan(meals, idx, targetDate)}
                        disabled={allSaved}
                        className={`w-full text-xs py-2.5 px-4 rounded-xl font-bold transition-all border ${
                          allSaved
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                            : "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600 active:scale-95 shadow-sm"
                        }`}
                      >
                        {allSaved
                          ? "✅ All meals added to plan"
                          : `+ Add all ${meals.length} meals to plan`}
                      </button>
                    )}

                    {meals.map((meal) => {
                      const key     = getMealKey(idx, meal);
                      const isSaved = savedPlanKeys.includes(key);
                      const label   = getMealLabel(meal.displayType);
                      const hasExisting = meal.mealType !== "snack" && plannedMeals.some(
                        pm => pm.meal_type === meal.mealType && pm.date === targetDate
                      );
                      return (
                        <button
                          key={key}
                          onClick={() => handleAddToPlan(meal, idx, targetDate)}
                          disabled={isSaved}
                          className={`w-full text-xs py-2 px-4 rounded-xl font-medium transition-all border ${
                            isSaved
                              ? "bg-emerald-50 text-emerald-600 border-emerald-200 cursor-default"
                              : hasExisting
                              ? "bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100 active:scale-95"
                              : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95"
                          }`}
                        >
                          {isSaved
                            ? `✅ ${label} added`
                            : hasExisting
                            ? `↺ Replace ${label} · ${meal.calories} cal`
                            : `+ Add ${label} · ${meal.calories} cal`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-end gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0 bg-blue-600 shadow-sm shadow-blue-200">
              🧠
            </div>
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0, 150, 300].map((d) => (
                  <div
                    key={d}
                    className="w-2 h-2 rounded-full animate-bounce bg-blue-400"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach..."
            rows={2}
            className="flex-1 resize-none rounded-2xl px-4 py-3 text-sm focus:outline-none border transition-all bg-gray-50"
            style={{
              minHeight:   "60px",
              maxHeight:   "140px",
              borderColor: message ? "#3b82f6" : "#e5e7eb",
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !message.trim()}
            className="rounded-2xl px-5 text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 flex-shrink-0 shadow-sm shadow-blue-200"
            style={{
              minHeight:  "60px",
              background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
            }}
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}