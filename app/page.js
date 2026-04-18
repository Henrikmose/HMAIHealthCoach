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
  const lower = messageText.toLowerCase().trim();
  const today = getLocalDate();
  if (lower.includes("tomorrow")) return addDays(today, 1);
  if (lower.includes("yesterday")) return addDays(today, -1);
  if (lower.includes("today")) return today;
  const slashMatch = messageText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const month = String(Number(slashMatch[1])).padStart(2, "0");
    const day = String(Number(slashMatch[2])).padStart(2, "0");
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }
  return today;
}

// ========================================
// DETECTION FUNCTIONS
// ========================================

function isLogMessage(text) {
  if (!text) return false;
  const logPatterns = [
    /\bi\s+(\w+\s+)?(ate|had|drank|consumed)/i,
    /\bi've\s+(just\s+)?(had|eaten|consumed|drunk)/i,
    /\bjust\s+(ate|had|eaten|consumed)/i,
    /\bfor\s+(breakfast|lunch|dinner|snack)\s+i\s+(had|ate)/i,
    /\b(breakfast|lunch|dinner|snack)\s*[:]\s*\w/i,
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
    /what('s|\s+is)\s+good\s+for/i,
    /give\s+me\s+(a\s+)?(meal|food|breakfast|lunch|dinner)/i,
    /what\s+should\s+i\s+have/i,
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

function parseSingleMeal(text) {
  if (!text) return null;

  const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
  let foundMealType = null;
  let mealStart = -1;

  for (const type of mealTypes) {
    const regex = new RegExp(`^${type}\\s*$`, "im");
    const match = text.match(regex);
    if (match) {
      foundMealType = type;
      mealStart = match.index;
      break;
    }
  }

  if (!foundMealType) return null;

  const mealSection = text.slice(mealStart);
  const lines = mealSection.split("\n").map((l) => l.trim());

  let foods = null;
  let calories = null;
  let protein = null;
  let carbs = null;
  let fat = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("- foods:")) {
      foods = line.replace(/^-\s*foods:\s*/i, "").trim();
    } else if (lower.startsWith("- calories:")) {
      const match = line.match(/[\d.]+/);
      if (match) calories = parseFloat(match[0]);
    } else if (lower.startsWith("- protein:")) {
      const match = line.match(/[\d.]+/);
      if (match) protein = parseFloat(match[0]);
    } else if (lower.startsWith("- carbs:")) {
      const match = line.match(/[\d.]+/);
      if (match) carbs = parseFloat(match[0]);
    } else if (lower.startsWith("- fat:")) {
      const match = line.match(/[\d.]+/);
      if (match) fat = parseFloat(match[0]);
    }
  }

  if (!foods || calories === null) return null;

  return {
    mealType: foundMealType,
    food: foods,
    calories: Math.round(calories),
    protein: Math.round(protein || 0),
    carbs: Math.round(carbs || 0),
    fat: Math.round(fat || 0),
  };
}

function parseAllMeals(text) {
  if (!text) return [];
  const meals = [];
  const mealTypes = ["breakfast", "lunch", "dinner", "snack"];

  for (const type of mealTypes) {
    const regex = new RegExp(`^${type}\\s*$`, "im");
    const match = text.match(regex);
    if (!match) continue;

    const startIndex = match.index;
    let endIndex = text.length;

    for (const otherType of mealTypes) {
      if (otherType === type) continue;
      const otherRegex = new RegExp(`^${otherType}\\s*$`, "im");
      const otherMatch = text.slice(startIndex + type.length).match(otherRegex);
      if (otherMatch) {
        const pos = startIndex + type.length + otherMatch.index;
        if (pos < endIndex) endIndex = pos;
      }
    }

    const section = text.slice(startIndex, endIndex);
    const parsed = parseSingleMeal(section);
    if (parsed) {
      parsed.mealType = type;
      meals.push(parsed);
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
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const storedId = localStorage.getItem("user_id");
    const storedName = localStorage.getItem("user_name");
    if (storedId) setUserId(storedId);
    if (storedName) setUserName(storedName);
    loadTodayLoggedMeals(storedId);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

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
      const { error } = await supabase.from("actual_meals").insert([
        {
          user_id: activeId,
          date: targetDate || getLocalDate(),
          meal_type: meal.mealType || "snack",
          food: meal.food,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          servings: 1,
        },
      ]);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error("Save meal error:", e);
      return false;
    }
  }

  async function savePlannedMeal(meal, targetDate) {
    const activeId = userId || localStorage.getItem("user_id");
    if (!activeId) return false;
    try {
      const { error } = await supabase.from("planned_meals").insert([
        {
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
        },
      ]);
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

    // Add user message to history
    const userMsg = { role: "user", content: currentMessage };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);

    try {
      // Determine context
      let context = {};
      let newActiveMealLog = activeMealLog;

      if (isLogMessage(currentMessage)) {
        // Starting a new food log
        const mealType = extractMealType(currentMessage);
        newActiveMealLog = {
          type: "food_log",
          originalMessage: currentMessage,
          mealType: mealType,
          conversationStage: "initial",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      } else if (activeMealLog && !isMealPlanningRequest(currentMessage)) {
        // Continuing an existing food log (follow-up answer like "8oz")
        newActiveMealLog = {
          ...activeMealLog,
          followUpMessage: currentMessage,
          conversationStage: "followup",
        };
        setActiveMealLog(newActiveMealLog);
        context = newActiveMealLog;
      } else if (isMealPlanningRequest(currentMessage)) {
        // Meal planning request - clear any active log
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = {
          type: "meal_planning",
          request: currentMessage,
        };
      }

      // Call API
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
      const reply = data.reply || "Sorry, I could not get a response.";

      // Add AI response to history
      const aiMsg = { role: "assistant", content: reply };
      setHistory([...newHistory, aiMsg]);

      // Check if AI returned a meal block for food logging
      if (newActiveMealLog && newActiveMealLog.type === "food_log") {
        const parsed = parseSingleMeal(reply);
        if (parsed) {
          const saved = await saveMealToDatabase(parsed, getLocalDate());
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

  async function handleAddToPlan(meal, messageIndex) {
    const targetDate = extractRequestedDate(
      history.find((m) => m.role === "user")?.content || ""
    );
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

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <HamburgerMenu />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 pt-16">
        <h1 className="text-lg font-bold text-gray-900">
          🧠 AI Health Coach
        </h1>
        {userName && (
          <p className="text-sm text-gray-500">Hi {userName}!</p>
        )}

        {/* Daily totals bar */}
        {todayLoggedMeals.length > 0 && (
          <div className="mt-2 flex gap-3 text-xs text-gray-600">
            <span>🔥 {totals.calories} cal</span>
            <span>🥩 {totals.protein}g P</span>
            <span>🍚 {totals.carbs}g C</span>
            <span>🥑 {totals.fat}g F</span>
          </div>
        )}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {history.length === 0 && (
          <div className="text-center text-gray-400 mt-10">
            <p className="text-4xl mb-3">🧠</p>
            <p className="font-medium text-gray-600">Your AI Health Coach</p>
            <p className="text-sm mt-1">
              Tell me what you ate, ask for meal suggestions, or ask any nutrition question.
            </p>
          </div>
        )}

        {history.map((msg, idx) => {
          const isUser = msg.role === "user";
          const meals = !isUser ? parseAllMeals(msg.content) : [];

          return (
            <div
              key={idx}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  isUser
                    ? "bg-blue-500 text-white rounded-br-sm"
                    : "bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm"
                }`}
              >
                {msg.content}

                {/* Add to plan buttons for meal suggestions */}
                {meals.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {meals.map((meal) => {
                      const key = `${idx}-${meal.mealType}`;
                      const isSaved = savedPlanIds.includes(key);
                      return (
                        <button
                          key={key}
                          onClick={() => handleAddToPlan(meal, idx)}
                          disabled={isSaved}
                          className={`w-full text-xs py-2 px-3 rounded-lg font-medium transition-colors ${
                            isSaved
                              ? "bg-green-100 text-green-700 cursor-default"
                              : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                          }`}
                        >
                          {isSaved
                            ? `✅ ${meal.mealType} added to plan`
                            : `+ Add ${meal.mealType} to plan (${meal.calories} cal)`}
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
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex gap-2 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach..."
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-400 max-h-32"
            style={{ minHeight: "42px" }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !message.trim()}
            className="bg-blue-500 text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-blue-600 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
