"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import HamburgerMenu from "./components/HamburgerMenu";

// ========================================
// UTILITY FUNCTIONS
// ========================================

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(dateString + "T12:00:00");
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractRequestedDate(messageText) {
  if (!messageText) return getLocalDate();
  const lower = messageText.toLowerCase();
  const today = getLocalDate();
  if (lower.includes("tomorrow")) return addDays(today, 1);
  if (lower.includes("yesterday")) return addDays(today, -1);
  return today;
}

// ========================================
// DETECTION FUNCTIONS
// ========================================

function isLogMessage(text) {
  if (!text) return false;
  const logPatterns = [
    /\bi\s+(\w+\s+)?(ate|had|drank|consumed)/i,
    /\bi'?ve\s+(just\s+)?(had|eaten|consumed)/i,
    /\bjust\s+(ate|had|eaten)/i,
    /\bfor\s+(breakfast|lunch|dinner|snack)\s+i\s+(had|ate)/i,
  ];
  return logPatterns.some((p) => p.test(text));
}

function isMealPlanningRequest(text) {
  if (!text) return false;
  const planPatterns = [
    /what\s+should\s+i\s+eat/i,
    /what\s+can\s+i\s+eat/i,
    /plan\s+my\s+meals/i,
    /meal\s+plan/i,
    /suggest\s+(a\s+)?(meal|food|breakfast|lunch|dinner|snack)/i,
    /give\s+me\s+(a\s+)?(meal|breakfast|lunch|dinner)/i,
    /what\s+should\s+i\s+have/i,
    /create\s+(a\s+)?meal\s+plan/i,
    /make\s+(a\s+)?meal\s+plan/i,
  ];
  return planPatterns.some((p) => p.test(text));
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
// MEAL PARSING
// ========================================

function parseAllMeals(text) {
  if (!text) return [];
  const meals = [];
  const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
  const lines = text.split("\n").map((l) => l.trim());

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].toLowerCase().trim();
    const matchedType = mealTypes.find((t) => line === t);

    if (matchedType) {
      let foods = null;
      let calories = null;
      let protein = null;
      let carbs = null;
      let fat = null;

      let j = i + 1;
      while (j < lines.length && j < i + 10) {
        const fieldLine = lines[j];
        const fieldLower = fieldLine.toLowerCase();

        if (fieldLower.startsWith("- foods:")) {
          foods = fieldLine.replace(/^-\s*foods:\s*/i, "").trim();
        } else if (fieldLower.startsWith("- calories:")) {
          const match = fieldLine.match(/[\d.]+/);
          if (match) calories = parseFloat(match[0]);
        } else if (fieldLower.startsWith("- protein:")) {
          const match = fieldLine.match(/[\d.]+/);
          if (match) protein = parseFloat(match[0]);
        } else if (fieldLower.startsWith("- carbs:")) {
          const match = fieldLine.match(/[\d.]+/);
          if (match) carbs = parseFloat(match[0]);
        } else if (fieldLower.startsWith("- fat:")) {
          const match = fieldLine.match(/[\d.]+/);
          if (match) fat = parseFloat(match[0]);
        } else if (mealTypes.some((t) => fieldLower === t)) {
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
// MACRO BAR COMPONENT
// ========================================

function MacroBar({ label, value, goal, color }) {
  const pct = Math.min(100, Math.round((value / goal) * 100));
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <span className="text-xs font-bold text-gray-700">{value}<span className="text-gray-400 font-normal">/{goal}</span></span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
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
  const [userGoals, setUserGoals] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 70 });
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const storedId = localStorage.getItem("user_id");
    const storedName = localStorage.getItem("user_name");
    if (storedId) setUserId(storedId);
    if (storedName) setUserName(storedName);
    loadTodayLoggedMeals(storedId);
    loadGoals(storedId);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function loadGoals(uid) {
    const activeId = uid || userId;
    if (!activeId) return;
    try {
      const { data } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", activeId)
        .single();
      if (data) setUserGoals({ calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat });
    } catch (e) {
      console.log("Goals load error:", e);
    }
  }

  async function loadTodayLoggedMeals(uid) {
    const activeId = uid || userId;
    if (!activeId) return;
    try {
      const today = getLocalDate();
      const { data } = await supabase
        .from("actual_meals")
        .select("*")
        .eq("user_id", activeId)
        .eq("date", today);
      setTodayLoggedMeals(data || []);
    } catch (e) {
      console.error("Load meals error:", e);
    }
  }

  function getTodayTotals() {
    return todayLoggedMeals.reduce(
      (t, m) => {
        const s = Number(m.servings || 1);
        t.calories += Number(m.calories || 0) * s;
        t.protein += Number(m.protein || 0) * s;
        t.carbs += Number(m.carbs || 0) * s;
        t.fat += Number(m.fat || 0) * s;
        return t;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }

  async function saveMealToDatabase(meal, targetDate) {
    const activeId = userId || localStorage.getItem("user_id");
    if (!activeId) return false;
    try {
      const { error } = await supabase.from("actual_meals").insert([{
        user_id: activeId,
        date: targetDate || getLocalDate(),
        meal_type: meal.mealType || "snack",
        food: meal.food,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        servings: 1,
      }]);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error("Save actual meal error:", e);
      return false;
    }
  }

  async function savePlannedMeal(meal, targetDate) {
    const activeId = userId || localStorage.getItem("user_id");
    if (!activeId) return false;
    try {
      const { error } = await supabase.from("planned_meals").insert([{
        user_id: activeId,
        date: targetDate || getLocalDate(),
        meal_type: meal.mealType || "snack",
        food: meal.food,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        suggested_time: null,
        status: "planned",
      }]);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error("Save planned meal error:", e);
      return false;
    }
  }

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;

    const activeId = userId || localStorage.getItem("user_id");
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
        const mealType = extractMealType(currentMessage);
        newActiveMealLog = {
          type: "food_log",
          originalMessage: currentMessage,
          mealType,
          conversationStage: "initial",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      } else if (isMealPlanningRequest(currentMessage)) {
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: currentMessage };
      } else if (activeMealLog) {
        newActiveMealLog = {
          ...activeMealLog,
          followUpMessage: currentMessage,
          conversationStage: "followup",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      }

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentMessage,
          context,
          history: history.slice(-6),
          userId: activeId,
        }),
      });

      const data = await res.json();
      const reply = data.reply || "Sorry, could not get a response.";

      const aiMsg = { role: "assistant", content: reply };
      setHistory([...newHistory, aiMsg]);

      if (newActiveMealLog && newActiveMealLog.type === "food_log") {
        const parsedMeals = parseAllMeals(reply);
        if (parsedMeals.length > 0) {
          const meal = parsedMeals[0];
          if (!meal.mealType && newActiveMealLog.mealType) {
            meal.mealType = newActiveMealLog.mealType;
          }
          const saved = await saveMealToDatabase(meal, getLocalDate());
          if (saved) {
            setActiveMealLog(null);
            await loadTodayLoggedMeals(activeId);
          }
        }
      }
    } catch (error) {
      console.error("Send error:", error);
      setHistory([
        ...newHistory,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddToPlan(meal, messageIndex, targetDate) {
    const saved = await savePlannedMeal(meal, targetDate);
    if (saved) {
      setSavedPlanIds((prev) => [...prev, `${messageIndex}-${meal.mealType}`]);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const totals = getTodayTotals();
  const calPct = Math.min(100, Math.round((totals.calories / userGoals.calories) * 100));

  return (
    <div className="flex flex-col h-screen" style={{ background: "#f8f9fb" }}>
      <HamburgerMenu />

      {/* ── Header ── */}
      <div
        className="px-4 pt-14 pb-3 border-b"
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        {/* Top row */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-white font-bold text-base leading-tight">
              AI Health Coach
            </h1>
            {userName && (
              <p className="text-blue-300 text-xs mt-0.5">Hey {userName} 👋</p>
            )}
          </div>
          {/* Calorie ring */}
          <div className="flex flex-col items-center">
            <div className="relative w-12 h-12">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke="#60a5fa" strokeWidth="3"
                  strokeDasharray={`${calPct} 100`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white text-xs font-bold">{calPct}%</span>
              </div>
            </div>
            <span className="text-blue-300 text-xs mt-0.5">{totals.calories} cal</span>
          </div>
        </div>

        {/* Macro bars */}
        {todayLoggedMeals.length > 0 && (
          <div className="flex gap-3">
            <MacroBar label="Protein" value={totals.protein} goal={userGoals.protein} color="bg-blue-400" />
            <MacroBar label="Carbs" value={totals.carbs} goal={userGoals.carbs} color="bg-emerald-400" />
            <MacroBar label="Fat" value={totals.fat} goal={userGoals.fat} color="bg-amber-400" />
          </div>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 pb-16">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-lg"
              style={{ background: "linear-gradient(135deg, #1a1a2e, #0f3460)" }}
            >
              🧠
            </div>
            <p className="font-semibold text-gray-700 text-base">Your AI Health Coach</p>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Tell me what you ate, ask for a meal plan, or get personalized nutrition advice.
            </p>
            <div className="mt-5 flex flex-col gap-2 w-full max-w-xs">
              {[
                "I had 8oz chicken for lunch",
                "Plan my meals for tomorrow",
                "What should I eat for dinner?",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setMessage(s)}
                  className="text-left text-sm px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors shadow-sm"
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
          const userMsgContent = history[idx - 1]?.role === "user" ? history[idx - 1].content : "";
          const targetDate = extractRequestedDate(userMsgContent);
          const isFuture = targetDate !== getLocalDate();

          return (
            <div key={idx} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              {!isUser && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-sm mr-2 mt-1 flex-shrink-0 shadow-sm"
                  style={{ background: "linear-gradient(135deg, #1a1a2e, #0f3460)" }}
                >
                  🧠
                </div>
              )}
              <div className="max-w-[80%] flex flex-col gap-2">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed shadow-sm ${
                    isUser
                      ? "text-white rounded-br-sm"
                      : "bg-white text-gray-800 border border-gray-100 rounded-bl-sm"
                  }`}
                  style={
                    isUser
                      ? { background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }
                      : {}
                  }
                >
                  {msg.content}
                </div>

                {/* Add to plan buttons */}
                {meals.length > 0 && isFuture && (
                  <div className="space-y-1.5 ml-1">
                    {meals.map((meal) => {
                      const key = `${idx}-${meal.mealType}`;
                      const isSaved = savedPlanIds.includes(key);
                      return (
                        <button
                          key={key}
                          onClick={() => handleAddToPlan(meal, idx, targetDate)}
                          disabled={isSaved}
                          className={`w-full text-xs py-2 px-3 rounded-xl font-medium transition-all shadow-sm border ${
                            isSaved
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                              : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 active:scale-95"
                          }`}
                        >
                          {isSaved
                            ? `✅ ${meal.mealType} added to plan`
                            : `+ Add ${meal.mealType} to plan · ${meal.calories} cal`}
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
          <div className="flex justify-start">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-sm mr-2 mt-1 flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #1a1a2e, #0f3460)" }}
            >
              🧠
            </div>
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0, 150, 300].map((delay) => (
                  <div
                    key={delay}
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: "#60a5fa", animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div
        className="px-4 py-3 border-t"
        style={{ background: "#fff", borderColor: "#e5e7eb" }}
      >
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach..."
            rows={1}
            className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none border transition-colors leading-relaxed"
            style={{
              minHeight: "44px",
              maxHeight: "120px",
              borderColor: message ? "#93c5fd" : "#e5e7eb",
              background: "#f8f9fb",
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !message.trim()}
            className="rounded-2xl px-4 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40 flex-shrink-0"
            style={{
              minHeight: "44px",
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
