"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import HamburgerMenu from "./components/HamburgerMenu";

function getLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function extractTargetDate(text) {
  if (!text) return getLocalDate();
  const lower = text.toLowerCase();
  if (lower.includes("tomorrow")) return addDays(getLocalDate(), 1);
  if (lower.includes("yesterday")) return addDays(getLocalDate(), -1);
  return getLocalDate();
}

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
    /what.*eat.*before/i,
    /what.*eat.*after/i,
    /what.*eat.*today/i,
    /what.*eat.*tonight/i,
    /what.*eat.*dinner/i,
    /what.*eat.*lunch/i,
    /what.*eat.*breakfast/i,
    /ideal\s+meal/i,
    /give.*meal/i,
    /yes\s+please/i,
    /yes.*plan/i,
    /sure.*plan/i,
    /create.*plan/i,
    /plan.*today/i,
    /plan.*tonight/i,
    /plan.*game/i,
  ].some((p) => p.test(text));
}

function isWeightGoalRequest(text) {
  if (!text) return false;
  return [
    /want.*lose/i,
    /want.*drop/i,
    /want.*shed/i,
    /trying.*lose/i,
    /lose.*pounds/i,
    /lose.*lbs/i,
    /drop.*pounds/i,
    /lose.*weight/i,
    /gain.*weight/i,
    /bulk.*up/i,
    /want.*gain/i,
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
// ========================================
function parseAllMeals(text) {
  if (!text) return [];
  const meals = [];
  const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
  const lines = text.split("\n").map((l) => l.trim());

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineLower = line.toLowerCase().trim();

    let matchedType = null;
    for (const type of mealTypes) {
      if (
        lineLower === type ||
        lineLower.startsWith(type + " ") ||
        lineLower.startsWith(type + "(")
      ) {
        if (!lineLower.includes("total") && !lineLower.includes("calories:") && !line.startsWith("-")) {
          matchedType = type;
          break;
        }
      }
    }

    if (matchedType) {
      let foods = null, calories = null, protein = null, carbs = null, fat = null;
      let j = i + 1;

      while (j < lines.length && j < i + 15) {
        const fl = lines[j];
        const fll = fl.toLowerCase().trim();

        const isNextMeal = mealTypes.some(t =>
          fll === t || fll.startsWith(t + " ") || fll.startsWith(t + "(")
        );
        const isTotal = fll.startsWith("total") || fll.includes("📊") || fll.startsWith("this plan") || fll.startsWith("---");
        if (isNextMeal || isTotal) break;

        if      (fll.startsWith("- foods:"))    foods    = fl.replace(/^-\s*foods:\s*/i, "").trim();
        else if (fll.startsWith("- calories:")) { const m = fl.match(/[\d.]+/); if (m) calories = parseFloat(m[0]); }
        else if (fll.startsWith("- protein:"))  { const m = fl.match(/[\d.]+/); if (m) protein  = parseFloat(m[0]); }
        else if (fll.startsWith("- carbs:"))    { const m = fl.match(/[\d.]+/); if (m) carbs    = parseFloat(m[0]); }
        else if (fll.startsWith("- fat:"))      { const m = fl.match(/[\d.]+/); if (m) fat      = parseFloat(m[0]); }
        j++;
      }

      if (foods && calories !== null) {
        meals.push({
          mealType: matchedType,
          food: foods,
          calories: Math.round(calories),
          protein:  Math.round(protein || 0),
          carbs:    Math.round(carbs   || 0),
          fat:      Math.round(fat     || 0),
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
    let m;
    while ((m = re.exec(text)) !== null) {
      meals.push({ mealType: m[1].toLowerCase(), food: m[2].trim(), calories: Math.round(parseFloat(m[3])), protein: Math.round(parseFloat(m[4])), carbs: Math.round(parseFloat(m[5])), fat: Math.round(parseFloat(m[6])) });
    }
  }

  return meals;
}

// Content-based key to prevent false "already added"
function getMealKey(msgIdx, meal) {
  const foodKey = meal.food.substring(0, 20).replace(/\s/g, "_");
  return `${msgIdx}-${meal.mealType}-${meal.calories}-${foodKey}`;
}

// ========================================
// SAVE VIA SERVER ROUTE
// ========================================
async function saveMealViaAPI(table, meal, userId) {
  try {
    const res = await fetch("/api/save-meals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, meal, userId }),
    });
    const data = await res.json();
    if (!data.success) { console.error(`Save failed (${table}):`, data.error); return false; }
    return true;
  } catch (e) { console.error(`Save exception:`, e); return false; }
}

// ========================================
// MACRO BAR
// ========================================
function MacroBar({ label, value, goal, color }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <span className="text-xs font-bold text-gray-700">{Math.round(value)}<span className="text-gray-400 font-normal">/{goal}g</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ========================================
// MAIN COMPONENT
// ========================================
export default function HomePage() {
  const [message, setMessage]             = useState("");
  const [history, setHistory]             = useState([]);
  const [isLoading, setIsLoading]         = useState(false);
  const [activeMealLog, setActiveMealLog] = useState(null);
  const [todayMeals, setTodayMeals]       = useState([]);
  const [savedPlanKeys, setSavedPlanKeys] = useState(() => {
    if (typeof window !== "undefined") {
      const today = getLocalDate();
      const storedDate = localStorage.getItem("savedPlanKeysDate");
      if (storedDate === today) {
        const stored = localStorage.getItem("savedPlanKeys");
        return stored ? JSON.parse(stored) : [];
      }
    }
    return [];
  });
  const [userId, setUserId]               = useState(null);
  const [userName, setUserName]           = useState("");
  const [goals, setGoals]                 = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);

  // Persist savedPlanKeys
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
    if (uid) setUserId(uid);
  }, []);

  useEffect(() => {
    if (userId) {
      loadGoals(userId);
      loadTodayMeals(userId);
      loadTodayMessages(userId);
    }
  }, [userId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + "px";
    }
  }, [message]);

  async function loadGoals(uid) {
    try {
      const { data } = await supabase.from("goals").select("*").eq("user_id", uid).single();
      if (data) setGoals({ calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat });
    } catch (e) { console.log("Goals error:", e); }
  }

  async function loadTodayMeals(uid) {
    try {
      const { data } = await supabase.from("actual_meals").select("*").eq("user_id", uid).eq("date", getLocalDate());
      setTodayMeals(data || []);
    } catch (e) { console.log("Meals error:", e); }
  }

  async function loadTodayMessages(uid) {
    try {
      const today = getLocalDate();
      const { data } = await supabase
        .from("ai_messages").select("*")
        .eq("user_id", uid)
        .gte("created_at", `${today}T00:00:00.000Z`)
        .lte("created_at", `${today}T23:59:59.999Z`)
        .order("created_at", { ascending: true });

      if (data && data.length > 0) {
        const rebuilt = [];
        for (const row of data) {
          if (row.message)  rebuilt.push({ role: "user",      content: row.message });
          if (row.response) rebuilt.push({ role: "assistant", content: row.response });
        }
        setHistory(rebuilt);
      }
    } catch (e) { console.log("Messages error:", e); }
  }

  const totals = todayMeals.reduce(
    (t, m) => ({ calories: t.calories + Number(m.calories||0), protein: t.protein + Number(m.protein||0), carbs: t.carbs + Number(m.carbs||0), fat: t.fat + Number(m.fat||0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

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

      if (isLogMessage(trimmed)) {
        newActiveMealLog = { type: "food_log", originalMessage: trimmed, mealType: extractMealType(trimmed), conversationStage: "initial" };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      } else if (isMealPlanningRequest(trimmed) || isWeightGoalRequest(trimmed)) {
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed };
      } else if (activeMealLog) {
        newActiveMealLog = { ...activeMealLog, followUpMessage: trimmed, conversationStage: "followup" };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      }

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          context,
          history: newHistory.slice(-8).map(m => ({ role: m.role, content: m.content })),
          userId: uid,
          // ✅ Send browser's local time — always accurate regardless of server timezone
          localHour: new Date().getHours(),
          localDate: getLocalDate(),
        }),
      });

      const data  = await res.json();
      const reply = data.reply || "Sorry, could not get a response.";
      setHistory([...newHistory, { role: "assistant", content: reply }]);

      // Auto-save food logs
      if (newActiveMealLog?.type === "food_log") {
        const parsed = parseAllMeals(reply);
        if (parsed.length > 0) {
          const meal = { ...parsed[0], date: getLocalDate() };
          if (!meal.mealType && newActiveMealLog.mealType) meal.mealType = newActiveMealLog.mealType;
          const saved = await saveMealViaAPI("actual_meals", meal, uid);
          if (saved) { setActiveMealLog(null); await loadTodayMeals(uid); }
        }
      }
    } catch (err) {
      console.error("Send error:", err);
      setHistory([...newHistory, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddToPlan(meal, msgIdx, targetDate) {
    const key = getMealKey(msgIdx, meal);
    if (savedPlanKeys.includes(key)) return;
    const uid = userId || localStorage.getItem("user_id");
    const saved = await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
    if (saved) setSavedPlanKeys((prev) => [...prev, key]);
    else alert("Could not save to plan. Please try again.");
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const calPct = goals.calories > 0 ? Math.min(100, Math.round((totals.calories / goals.calories) * 100)) : 0;

  return (
    <div className="flex flex-col h-screen bg-white">
      <HamburgerMenu />

      {/* ── Header ── */}
      <div className="px-4 pt-14 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">AI Coach</h1>
            {userName && <p className="text-sm text-gray-400 mt-0.5">Hey {userName} 👋</p>}
          </div>
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-2xl px-3 py-2">
            <div className="text-right">
              <p className="text-sm font-bold text-blue-700 leading-tight">{totals.calories} <span className="font-normal text-blue-400">/ {goals.calories}</span></p>
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
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 bg-blue-600 shadow-lg shadow-blue-200">🧠</div>
            <p className="font-bold text-gray-800 text-lg">Your AI Health Coach</p>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed max-w-xs">Tell me what you ate, ask for a meal plan, or get nutrition advice.</p>
            <div className="mt-5 flex flex-col gap-2 w-full max-w-xs">
              {[
                "I had 8oz chicken and 1 cup rice for lunch",
                "Create a meal plan for tomorrow",
                "What should I eat for dinner?",
                "I want to drop 10 pounds",
              ].map((s) => (
                <button key={s} onClick={() => setMessage(s)}
                  className="text-left text-sm px-4 py-3 rounded-2xl border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all shadow-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, idx) => {
          const isUser      = msg.role === "user";
          const meals       = !isUser ? parseAllMeals(msg.content) : [];
          const triggerText = !isUser && history[idx-1]?.role === "user" ? history[idx-1].content : "";
          const showButtons = meals.length > 0 && (isMealPlanningRequest(triggerText) || isWeightGoalRequest(triggerText));
          const targetDate  = extractTargetDate(triggerText);
          const allSaved    = meals.length > 0 && meals.every(m => savedPlanKeys.includes(getMealKey(idx, m)));

          return (
            <div key={idx} className={`flex ${isUser ? "justify-end" : "justify-start"} items-end gap-2`}>
              {!isUser && (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0 mb-1 bg-blue-600 shadow-sm shadow-blue-200">🧠</div>
              )}
              <div className="max-w-[82%] flex flex-col gap-2">
                <div className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${isUser ? "text-white rounded-br-sm shadow-sm" : "bg-white text-gray-800 border border-gray-100 rounded-bl-sm shadow-sm"}`}
                  style={isUser ? { background: "linear-gradient(135deg,#2563eb,#1d4ed8)" } : {}}>
                  {msg.content}
                </div>

                {showButtons && (
                  <div className="space-y-2 ml-1">
                    {meals.length > 1 && (
                      <button onClick={() => handleAddAllToPlan(meals, idx, targetDate)} disabled={allSaved}
                        className={`w-full text-xs py-2.5 px-4 rounded-xl font-bold transition-all border ${allSaved ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default" : "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600 active:scale-95 shadow-sm"}`}>
                        {allSaved ? "✅ All meals added to plan" : `+ Add all ${meals.length} meals to plan`}
                      </button>
                    )}
                    {meals.map((meal) => {
                      const key = getMealKey(idx, meal);
                      const isSaved = savedPlanKeys.includes(key);
                      return (
                        <button key={key} onClick={() => handleAddToPlan(meal, idx, targetDate)} disabled={isSaved}
                          className={`w-full text-xs py-2 px-4 rounded-xl font-medium transition-all border ${isSaved ? "bg-emerald-50 text-emerald-600 border-emerald-200 cursor-default" : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95"}`}>
                          {isSaved ? `✅ ${meal.mealType.charAt(0).toUpperCase()+meal.mealType.slice(1)} added` : `+ Add ${meal.mealType} · ${meal.calories} cal`}
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
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0 bg-blue-600 shadow-sm shadow-blue-200">🧠</div>
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0,150,300].map((d) => <div key={d} className="w-2 h-2 rounded-full animate-bounce bg-blue-400" style={{ animationDelay:`${d}ms` }} />)}
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
            style={{ minHeight: "60px", maxHeight: "140px", borderColor: message ? "#3b82f6" : "#e5e7eb" }}
          />
          <button onClick={handleSend} disabled={isLoading || !message.trim()}
            className="rounded-2xl px-5 text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 flex-shrink-0 shadow-sm shadow-blue-200"
            style={{ minHeight: "60px", background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}