"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import HamburgerMenu from "./components/HamburgerMenu";

// ========================================
// UTILITIES
// ========================================

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
  if (!text) return null;
  const lower = text.toLowerCase();
  const today = getLocalDate();
  if (lower.includes("tomorrow")) return addDays(today, 1);
  if (lower.includes("yesterday")) return addDays(today, -1);
  return null; // null = today (actual meal)
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
    /plan\s+my\s+meals/i,
    /meal\s+plan/i,
    /suggest\s+(a\s+)?(meal|food|breakfast|lunch|dinner|snack)/i,
    /give\s+me\s+(a\s+)?(meal|breakfast|lunch|dinner|plan)/i,
    /what\s+should\s+i\s+have/i,
    /create\s+(a\s+)?meal\s+plan/i,
    /make\s+(a\s+)?meal\s+plan/i,
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
    const lineLower = lines[i].toLowerCase().trim();
    const matchedType = mealTypes.find((t) => lineLower === t);

    if (matchedType) {
      let foods = null, calories = null, protein = null, carbs = null, fat = null;
      let j = i + 1;

      while (j < lines.length && j < i + 10) {
        const fl = lines[j];
        const fll = fl.toLowerCase();
        if (fll.startsWith("- foods:")) {
          foods = fl.replace(/^-\s*foods:\s*/i, "").trim();
        } else if (fll.startsWith("- calories:")) {
          const m = fl.match(/[\d.]+/); if (m) calories = parseFloat(m[0]);
        } else if (fll.startsWith("- protein:")) {
          const m = fl.match(/[\d.]+/); if (m) protein = parseFloat(m[0]);
        } else if (fll.startsWith("- carbs:")) {
          const m = fl.match(/[\d.]+/); if (m) carbs = parseFloat(m[0]);
        } else if (fll.startsWith("- fat:")) {
          const m = fl.match(/[\d.]+/); if (m) fat = parseFloat(m[0]);
        } else if (mealTypes.some((t) => fll === t)) {
          break;
        }
        j++;
      }

      if (foods && calories !== null) {
        meals.push({
          mealType: matchedType,
          food: foods,
          calories: Math.round(calories),
          protein: Math.round(protein || 0),
          carbs: Math.round(carbs || 0),
          fat: Math.round(fat || 0),
        });
      }
      i = j;
    } else {
      i++;
    }
  }
  return meals;
}

// ========================================
// MAIN COMPONENT
// ========================================

export default function HomePage() {
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeMealLog, setActiveMealLog] = useState(null);
  const [todayLoggedMeals, setTodayLoggedMeals] = useState([]);
  const [savedPlanIds, setSavedPlanIds] = useState([]);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [goals, setGoals] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const uid = localStorage.getItem("user_id");
    const uname = localStorage.getItem("user_name");
    if (uid) setUserId(uid);
    if (uname) setUserName(uname);
    if (uid) {
      loadTodayMeals(uid);
      loadGoals(uid);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function loadGoals(uid) {
    try {
      const { data } = await supabase.from("goals").select("*").eq("user_id", uid).single();
      if (data) setGoals({ calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat });
    } catch (e) { console.log("Goals error:", e); }
  }

  async function loadTodayMeals(uid) {
    try {
      const { data } = await supabase.from("actual_meals").select("*").eq("user_id", uid).eq("date", getLocalDate());
      setTodayLoggedMeals(data || []);
    } catch (e) { console.log("Meals error:", e); }
  }

  const totals = todayLoggedMeals.reduce(
    (t, m) => ({ calories: t.calories + Number(m.calories||0), protein: t.protein + Number(m.protein||0), carbs: t.carbs + Number(m.carbs||0), fat: t.fat + Number(m.fat||0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  async function saveActualMeal(meal, date) {
    const uid = userId || localStorage.getItem("user_id");
    if (!uid) { console.error("No user ID for saving actual meal"); return false; }
    try {
      const { error } = await supabase.from("actual_meals").insert([{
        user_id: uid, date: date || getLocalDate(),
        meal_type: meal.mealType || "snack",
        food: meal.food, calories: meal.calories,
        protein: meal.protein, carbs: meal.carbs, fat: meal.fat, servings: 1,
      }]);
      if (error) { console.error("Actual meal save error:", error); return false; }
      return true;
    } catch (e) { console.error("Actual meal save exception:", e); return false; }
  }

  async function savePlannedMeal(meal, date) {
    const uid = userId || localStorage.getItem("user_id");
    if (!uid) { console.error("No user ID for saving planned meal"); return false; }
    try {
      const { error } = await supabase.from("planned_meals").insert([{
        user_id: uid, date: date,
        meal_type: meal.mealType || "snack",
        food: meal.food, calories: meal.calories,
        protein: meal.protein, carbs: meal.carbs, fat: meal.fat,
        suggested_time: null, status: "planned",
      }]);
      if (error) { console.error("Planned meal save error:", error); return false; }
      return true;
    } catch (e) { console.error("Planned meal save exception:", e); return false; }
  }

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;

    const uid = userId || localStorage.getItem("user_id");
    const currentMessage = trimmed;
    setMessage("");
    setIsLoading(true);

    const userMsg = { role: "user", content: currentMessage };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);

    try {
      let context = {};
      let newActiveMealLog = activeMealLog;

      if (isLogMessage(currentMessage)) {
        newActiveMealLog = {
          type: "food_log",
          originalMessage: currentMessage,
          mealType: extractMealType(currentMessage),
          conversationStage: "initial",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      } else if (isMealPlanningRequest(currentMessage)) {
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: currentMessage };
      } else if (activeMealLog) {
        newActiveMealLog = { ...activeMealLog, followUpMessage: currentMessage, conversationStage: "followup" };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      }

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentMessage, context, history: history.slice(-6), userId: uid }),
      });

      const data = await res.json();
      const reply = data.reply || "Sorry, could not get a response.";
      setHistory([...newHistory, { role: "assistant", content: reply }]);

      // Auto-save food logs (today only)
      if (newActiveMealLog?.type === "food_log") {
        const parsed = parseAllMeals(reply);
        if (parsed.length > 0) {
          const meal = { ...parsed[0] };
          if (!meal.mealType && newActiveMealLog.mealType) meal.mealType = newActiveMealLog.mealType;
          const saved = await saveActualMeal(meal, getLocalDate());
          if (saved) {
            setActiveMealLog(null);
            await loadTodayMeals(uid);
          }
        }
      }
    } catch (err) {
      console.error("Send error:", err);
      setHistory([...newHistory, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddToPlan(meal, messageIdx, targetDate) {
    const key = `${messageIdx}-${meal.mealType}`;
    const saved = await savePlannedMeal(meal, targetDate);
    if (saved) {
      setSavedPlanIds((prev) => [...prev, key]);
    } else {
      alert("Could not save meal. Please try again.");
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const calPct = goals.calories > 0 ? Math.min(100, Math.round((totals.calories / goals.calories) * 100)) : 0;

  return (
    <div className="flex flex-col h-screen" style={{ background: "#f8f9fb" }}>
      <HamburgerMenu />

      {/* ── Header ── */}
      <div className="px-4 pt-14 pb-4 border-b" style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-white font-bold text-base">AI Health Coach</h1>
            {userName && <p className="text-blue-300 text-xs mt-0.5">Hey {userName} 👋</p>}
          </div>
          <div className="text-right">
            <p className="text-white font-bold text-lg">{totals.calories}<span className="text-blue-300 text-sm font-normal">/{goals.calories}</span></p>
            <p className="text-blue-300 text-xs">calories today</p>
          </div>
        </div>

        {/* Macro pills */}
        <div className="flex gap-2">
          {[
            { label: "Protein", val: totals.protein, goal: goals.protein, bg: "rgba(96,165,250,0.2)", text: "#93c5fd" },
            { label: "Carbs", val: totals.carbs, goal: goals.carbs, bg: "rgba(52,211,153,0.2)", text: "#6ee7b7" },
            { label: "Fat", val: totals.fat, goal: goals.fat, bg: "rgba(251,191,36,0.2)", text: "#fcd34d" },
          ].map(({ label, val, goal, bg, text }) => (
            <div key={label} className="flex-1 rounded-xl px-2 py-1.5 text-center" style={{ background: bg }}>
              <p className="text-xs font-bold" style={{ color: text }}>{Math.round(val)}g</p>
              <p className="text-xs" style={{ color: text, opacity: 0.7 }}>{label}</p>
              <div className="mt-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
                <div className="h-1 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((val/goal)*100))}%`, background: text }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 pb-16">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-3 shadow-lg" style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)" }}>
              🧠
            </div>
            <p className="font-semibold text-gray-700">Your AI Health Coach</p>
            <p className="text-sm text-gray-400 mt-1 leading-relaxed">Tell me what you ate, ask for a meal plan, or get nutrition advice.</p>
            <div className="mt-4 flex flex-col gap-2 w-full max-w-xs">
              {["I had 8oz chicken for lunch", "Plan my meals for tomorrow", "What should I eat for dinner?"].map((s) => (
                <button key={s} onClick={() => setMessage(s)}
                  className="text-left text-sm px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors shadow-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, idx) => {
          const isUser = msg.role === "user";
          const meals = !isUser ? parseAllMeals(msg.content) : [];

          // Find the user message that triggered this AI response
          const triggerMsg = isUser ? null : (history[idx - 1]?.role === "user" ? history[idx - 1].content : "");
          const targetDate = extractTargetDate(triggerMsg || "");
          const isPlanForFuture = targetDate !== null; // only show buttons for future dates

          return (
            <div key={idx} className={`flex ${isUser ? "justify-end" : "justify-start"} items-end gap-2`}>
              {!isUser && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 mb-1 shadow-sm" style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)" }}>
                  🧠
                </div>
              )}
              <div className="max-w-[80%] flex flex-col gap-2">
                <div className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${isUser ? "rounded-br-sm text-white" : "bg-white text-gray-800 border border-gray-100 rounded-bl-sm"}`}
                  style={isUser ? { background: "linear-gradient(135deg,#2563eb,#1d4ed8)" } : {}}>
                  {msg.content}
                </div>

                {/* Add to plan buttons — only for future dates */}
                {meals.length > 0 && isPlanForFuture && (
                  <div className="space-y-1.5 ml-1">
                    {meals.map((meal) => {
                      const key = `${idx}-${meal.mealType}`;
                      const isSaved = savedPlanIds.includes(key);
                      return (
                        <button key={key}
                          onClick={() => handleAddToPlan(meal, idx, targetDate)}
                          disabled={isSaved}
                          className={`w-full text-xs py-2.5 px-3 rounded-xl font-medium transition-all border shadow-sm ${
                            isSaved
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                              : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95"
                          }`}>
                          {isSaved ? `✅ ${meal.mealType} added to plan` : `+ Add ${meal.mealType} to plan · ${meal.calories} cal`}
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
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 shadow-sm" style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)" }}>🧠</div>
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0,150,300].map((d) => (
                  <div key={d} className="w-2 h-2 rounded-full animate-bounce" style={{ background: "#60a5fa", animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-4 py-3 border-t bg-white" style={{ borderColor: "#e5e7eb" }}>
        <div className="flex gap-2 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach..."
            rows={1}
            className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none border transition-colors"
            style={{ minHeight: "44px", maxHeight: "120px", borderColor: message ? "#93c5fd" : "#e5e7eb", background: "#f8f9fb" }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !message.trim()}
            className="rounded-2xl px-4 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40 flex-shrink-0"
            style={{ minHeight: "44px", background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
