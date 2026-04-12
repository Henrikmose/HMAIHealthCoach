"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import HamburgerMenu from "./components/HamburgerMenu";

const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

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

  // Match MM/DD/YYYY
  const slashMatch = messageText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const month = String(Number(slashMatch[1])).padStart(2, "0");
    const day = String(Number(slashMatch[2])).padStart(2, "0");
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Match YYYY-MM-DD
  const dashMatch = messageText.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (dashMatch) {
    return `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`;
  }

  return today;
}

// ========================================
// DETECTION FUNCTIONS
// ========================================

function isLogMessage(text) {
  if (!text) return false;
  
  const logPatterns = [
    /\bi\s+(\w+\s+)?(ate|had|drank|consumed)/i,  // "I ate", "I just ate", "I already had"
    /\bi'?ve\s+(just\s+)?(eaten|had|consumed)/i, // "I've eaten", "I've just had"
  ];
  
  return logPatterns.some(pattern => pattern.test(text));
}

function isFollowUpMessage(text) {
  if (!text) return false;
  const trimmed = text.trim();
  
  // Quantity patterns: "8oz", "1 cup", "2 slices"
  if (/^\d+(\.\d+)?\s*(oz|ounce|ounces|cup|cups|g|gram|grams|ml|tbsp|tsp|tablespoon|teaspoon|slice|slices|piece|pieces)?$/i.test(trimmed)) {
    return true;
  }
  
  // Single-word meal type
  if (['breakfast', 'lunch', 'dinner', 'snack', 'dessert'].includes(trimmed.toLowerCase())) {
    return true;
  }
  
  return false;
}

function isPlanningRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  
  // Event-based planning triggers
  const eventPatterns = [
    /\b(have|got|going to|attending)\s+(a|an)?\s*(hockey|game|race|run|workout|party|wedding|event|meeting|presentation)/i,
    /\b(plan|suggest|give me|create)\s+(a|my)?\s*(meal|meals|plan|food|day)/i,
    /\bwhat should i eat\s+(today|tomorrow|this week)/i,
  ];
  
  return eventPatterns.some(pattern => pattern.test(text));
}

function isMealPlanningRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  
  const planningPatterns = [
    /what should i eat/i,
    /give me (a )?meal (plan|suggestion|idea)/i,
    /suggest (a )?(meal|dinner|lunch|breakfast|snack)/i,
    /recommend.*eat/i,
    /plan.*meal/i,
    /need.*idea/i,
    /want.*suggestion/i,
  ];
  
  return planningPatterns.some(pattern => pattern.test(text));
}

function extractMealTypeFromMessage(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  if (lower.includes("breakfast")) return "breakfast";
  if (lower.includes("lunch")) return "lunch";
  if (lower.includes("dinner")) return "dinner";
  if (lower.includes("dessert")) return "dessert";
  if (lower.includes("snack")) return "snack";
  
  return null;
}

// ========================================
// PARSING FUNCTIONS
// ========================================

function extractNumber(line) {
  if (!line) return 0;
  const match = line.match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function parseMealPlan(replyText) {
  if (!replyText) return [];
  
  // PRE-PROCESSING: Fix common AI mistakes
  let cleanedText = replyText;
  
  // Replace invalid meal type names with valid ones
  const invalidToValid = {
    'post-game recovery': 'Snack',
    'post game recovery': 'Snack',
    'pre-game snack': 'Snack',
    'pre game snack': 'Snack',
    'pre-game fuel': 'Snack',
    'pre game fuel': 'Snack',
    'post-workout': 'Snack',
    'post workout': 'Snack',
    'pre-workout': 'Snack',
    'pre workout': 'Snack',
    'recovery meal': 'Snack',
    'evening meal': 'Dinner',
    'morning meal': 'Breakfast',
    'midday meal': 'Lunch',
  };
  
  // Replace invalid names (case-insensitive)
  Object.entries(invalidToValid).forEach(([invalid, valid]) => {
    const regex = new RegExp(invalid, 'gi');
    cleanedText = cleanedText.replace(regex, valid);
  });
  
  // Remove non-meal lines like "HOCKEY GAME (hydration only)"
  const linesToRemove = [
    /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\s*-\s*HOCKEY GAME.*$/gim,
    /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\s*-\s*GAME TIME.*$/gim,
    /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\s*-\s*EVENT.*$/gim,
  ];
  
  linesToRemove.forEach(pattern => {
    cleanedText = cleanedText.replace(pattern, '');
  });
  
  const lines = cleanedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const mealTitles = ["breakfast", "lunch", "dinner", "snack", "dessert"];
  const meals = [];
  let currentMeal = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\*\*/g, "").replace(/#/g, "").trim();
    const lower = line.toLowerCase().replace(":", "");

    if (lower === "daily total" || lower === "final daily total") {
      if (currentMeal) meals.push(currentMeal);
      currentMeal = null;
      break;
    }

    // Check if line starts with a meal type (handle variations like "Snack (Pre-Game)" or "8:30 PM - Snack")
    let matchedMealType = null;
    let extractedTime = null;
    
    for (const mealType of mealTitles) {
      // Match patterns like:
      // "Snack"
      // "Snack (Pre-Game)"
      // "8:30 PM - Snack"
      // "5:00 PM - Snack (Pre-Game)"
      
      const mealTypeRegex = new RegExp(`(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm))?\\s*-?\\s*${mealType}`, 'i');
      const match = lower.match(mealTypeRegex);
      
      if (match) {
        matchedMealType = mealType;
        // Extract time if present in header (e.g., "8:30 PM - Snack")
        const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i);
        if (timeMatch) {
          extractedTime = timeMatch[1];
        }
        break;
      }
    }

    if (matchedMealType) {
      if (currentMeal) meals.push(currentMeal);

      currentMeal = {
        meal_type: matchedMealType,
        food: "",
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        servings: 1,
        suggested_time: extractedTime, // Use time from header if found
      };
      continue;
    }

    if (!currentMeal) continue;

    if (lower.startsWith("- foods") || lower.startsWith("foods")) {
      currentMeal.food = line.split(":").slice(1).join(":").trim();
    } else if (lower.startsWith("- time") || lower.startsWith("time")) {
      // Override with explicit Time line if present
      currentMeal.suggested_time = line.split(":").slice(1).join(":").trim();
    } else if (lower.startsWith("- calories") || lower.startsWith("calories")) {
      currentMeal.calories = extractNumber(line);
    } else if (lower.startsWith("- protein") || lower.startsWith("protein")) {
      currentMeal.protein = extractNumber(line);
    } else if (lower.startsWith("- carbs") || lower.startsWith("carbs")) {
      currentMeal.carbs = extractNumber(line);
    } else if (lower.startsWith("- fat") || lower.startsWith("fat")) {
      currentMeal.fat = extractNumber(line);
    }
  }

  if (currentMeal) meals.push(currentMeal);

  return meals.filter(
    (meal) => meal.meal_type && meal.food && meal.calories > 0
  );
}

function cleanAIResponse(reply, activeMealLog) {
  // Only clean for food logging responses
  if (!activeMealLog || activeMealLog.type !== "food_log") {
    return reply;
  }

  // Extract all meal blocks from response
  const mealBlockPattern = /^(Breakfast|Lunch|Dinner|Snack|Dessert)\s*\n-\s*Foods?:/gim;
  const matches = [...reply.matchAll(mealBlockPattern)];
  
  if (matches.length <= 1) {
    // Only one meal block - no duplicates
    return reply;
  }

  console.log(`⚠️ Found ${matches.length} meal blocks in response - keeping only the LAST one`);

  // Keep only the LAST meal block (the current one being logged)
  const lastMatch = matches[matches.length - 1];
  const lastMealIndex = lastMatch.index;
  
  // Extract just the last meal block + everything after it
  const cleanedReply = reply.slice(lastMealIndex);
  
  console.log('✅ Cleaned response - removed duplicate meal blocks');
  return cleanedReply;
}

function parseSingleMeal(replyText) {
  if (!replyText) return null;

  const parsedMeals = parseMealPlan(replyText);
  if (parsedMeals.length === 1) return parsedMeals[0];
  if (parsedMeals.length > 1) return null;

  const lines = replyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const mealTitles = ["breakfast", "lunch", "dinner", "snack", "dessert"];
  let mealType = null;
  let food = "";
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\*\*/g, "").replace(/#/g, "").trim();
    const lower = line.toLowerCase();

    if (!mealType && mealTitles.includes(lower.replace(":", ""))) {
      mealType = lower.replace(":", "");
      continue;
    }

    if (lower.startsWith("- foods") || lower.startsWith("foods")) {
      food = line.split(":").slice(1).join(":").trim();
    } else if (lower.startsWith("- calories") || lower.startsWith("calories")) {
      calories = extractNumber(line);
    } else if (lower.startsWith("- protein") || lower.startsWith("protein")) {
      protein = extractNumber(line);
    } else if (lower.startsWith("- carbs") || lower.startsWith("carbs")) {
      carbs = extractNumber(line);
    } else if (lower.startsWith("- fat") || lower.startsWith("fat")) {
      fat = extractNumber(line);
    }
  }

  if (!mealType || !food || calories <= 0) return null;

  return {
    meal_type: mealType,
    food,
    calories,
    protein,
    carbs,
    fat,
    servings: 1,
  };
}

function mealButtonKey(itemId, index) {
  return `${itemId}-${index}`;
}

// ========================================
// MAIN COMPONENT
// ========================================

export default function Home() {
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [savingPlanId, setSavingPlanId] = useState(null);
  const [savedPlanIds, setSavedPlanIds] = useState([]);
  const [savedMealKeys, setSavedMealKeys] = useState([]);
  const [loggedMealIds, setLoggedMealIds] = useState([]);
  const [activeMealLog, setActiveMealLog] = useState(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [todayLoggedMeals, setTodayLoggedMeals] = useState([]);

  const chatEndRef = useRef(null);

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("ai_messages")
      .select("*")
      .eq("user_id", TEST_USER_ID)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Load messages error:", error);
    } else {
      setHistory(data || []);
    }
    setIsInitialLoad(false);
  };

  const loadTodayLoggedMeals = async () => {
    const { data, error } = await supabase
      .from("actual_meals")
      .select("*")
      .eq("user_id", TEST_USER_ID)
      .eq("date", getLocalDate());

    if (!error && data) {
      setTodayLoggedMeals(data);
    }
  };

  useEffect(() => {
    loadMessages();
    loadTodayLoggedMeals();
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, isLoading]);

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const currentMessage = message.trim();

    try {
      setIsLoading(true);

      // ========================================
      // STEP 1: Detect message type
      // ========================================
      const isInitialLog = isLogMessage(currentMessage);
      const isFollowUp = isFollowUpMessage(currentMessage) || 
                         (activeMealLog && /^\d+(\.\d+)?\s*(oz|ounce|ounces|cup|cups|g|gram|grams|ml|tbsp|tsp|tablespoon|teaspoon|slice|slices|piece|pieces)\s+\w+/i.test(currentMessage));
      const isPlanning = isPlanningRequest(currentMessage);
      const isMealPlanningReq = isMealPlanningRequest(currentMessage);
      const isLogRelated = isInitialLog || (isFollowUp && activeMealLog);

      console.log("=== MESSAGE ANALYSIS ===");
      console.log("Message:", currentMessage);
      console.log("isInitialLog:", isInitialLog);
      console.log("isFollowUp:", isFollowUp);
      console.log("isPlanning:", isPlanning);
      console.log("isMealPlanningReq:", isMealPlanningReq);
      console.log("isLogRelated:", isLogRelated);
      console.log("activeMealLog (BEFORE):", activeMealLog);

      // ========================================
      // STEP 2: Build context and manage activeMealLog
      // ========================================
      let contextToSend = null;

      if (isInitialLog && !isFollowUp) {
        // STARTING A NEW FOOD LOG - Clear previous context
        console.log("🆕 Starting NEW food log - clearing old activeMealLog");
        const mealType = extractMealTypeFromMessage(currentMessage);
        contextToSend = {
          type: "food_log",
          originalMessage: currentMessage,
          mealType: mealType,
        };
        setActiveMealLog(contextToSend);
      } else if (isFollowUp && activeMealLog) {
        // CONTINUING EXISTING FOOD LOG - Update context
        console.log("➡️ Follow-up to existing food log - keeping activeMealLog");
        contextToSend = {
          ...activeMealLog,
          followUpMessage: currentMessage,
        };
        setActiveMealLog(contextToSend);
      } else if (isMealPlanningReq) {
        // MEAL PLANNING - Clear food log context
        console.log("📋 Meal planning request - clearing food log context");
        contextToSend = {
          type: "meal_planning",
          request: currentMessage,
        };
        setActiveMealLog(null);
      } else if (isPlanning) {
        contextToSend = {
          type: "meal_planning",
          request: currentMessage,
        };
        setActiveMealLog(null);
      } else {
        // NOT A FOOD LOG - Clear activeMealLog
        console.log("🧹 Not a food log - clearing activeMealLog");
        setActiveMealLog(null);
      }

      console.log("activeMealLog (AFTER):", contextToSend);

      // ========================================
      // STEP 3: Call AI
      // ========================================
      
      // CRITICAL FIX: Don't send conversation history for food logs
      // This prevents AI from getting confused with old meal data
      let chatHistoryToSend = [];
      
      if (!isLogRelated) {
        // For meal planning and general questions, send full history
        chatHistoryToSend = history.map(h => ({
          role: h.role || "user",
          content: h.message || h.content || h.response || ""
        }));
        console.log("📚 Sending conversation history (meal planning/general)");
      } else {
        // For food logging, send ONLY the current conversation
        console.log("🚫 NOT sending conversation history (food logging - prevents confusion)");
      }

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentMessage,
          history: chatHistoryToSend,
          context: contextToSend,
        }),
      });

      const data = await res.json();
      let reply = data.reply;

      console.log("=== AI RESPONSE (RAW) ===");
      console.log("Reply:", reply);

      // ========================================
      // STEP 3.5: Clean AI response if food logging
      // ========================================
      if (contextToSend && contextToSend.type === "food_log") {
        reply = cleanAIResponse(reply, contextToSend);
        console.log("=== AI RESPONSE (CLEANED) ===");
        console.log("Cleaned reply:", reply);
      }

      // ========================================
      // STEP 4: Parse response
      // ========================================
      const parsedMeal = parseSingleMeal(reply);
      console.log("Parsed meal:", parsedMeal);

      // ========================================
      // STEP 5: Save if food log complete
      // ========================================
      const hasCompleteData = parsedMeal && parsedMeal.calories > 0 && parsedMeal.food;

      if (isLogRelated && hasCompleteData) {
        let finalMealType = parsedMeal.meal_type;

        // Priority: context > parsed > default
        if (contextToSend?.mealType) {
          finalMealType = contextToSend.mealType;
        } else if (activeMealLog?.mealType) {
          finalMealType = activeMealLog.mealType;
        } else if (!finalMealType) {
          finalMealType = "snack";
        }

        console.log("=== SAVING TO ACTUAL_MEALS ===");
        console.log("Meal type:", finalMealType);
        console.log("Food:", parsedMeal.food);

        const { error: actualInsertError } = await supabase
          .from("actual_meals")
          .insert([{
            user_id: TEST_USER_ID,
            date: getLocalDate(),
            meal_type: finalMealType,
            food: parsedMeal.food,
            calories: parsedMeal.calories,
            protein: parsedMeal.protein,
            carbs: parsedMeal.carbs,
            fat: parsedMeal.fat,
            servings: 1,
          }]);

        if (actualInsertError) {
          console.error("❌ Save error:", actualInsertError);
        } else {
          console.log("✅ SAVED TO ACTUAL_MEALS!");

          // Reload today's logged meals to update UI
          await loadTodayLoggedMeals();

          // Mark entire conversation as logged
          const { data: latestMessage } = await supabase
            .from("ai_messages")
            .select("id")
            .eq("user_id", TEST_USER_ID)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          const idsToMark = [];
          if (latestMessage?.id) idsToMark.push(latestMessage.id);
          
          // Also mark recent messages in this conversation
          history.slice(-5).forEach(msg => {
            if (msg.id) idsToMark.push(msg.id);
          });

          setLoggedMealIds(prev => [...new Set([...prev, ...idsToMark])]);
          
          // ONLY clear activeMealLog after successful save
          console.log("🧹 Meal saved - clearing activeMealLog");
          setActiveMealLog(null);
        }
      } else if (isLogRelated && !hasCompleteData) {
        // AI is asking for more info, keep activeMealLog alive
        console.log("⏳ Waiting for more info, keeping activeMealLog active");
        // Don't clear activeMealLog here!
      } else {
        // Not a food log, clear it
        console.log("🧹 Not a food log - clearing activeMealLog");
        setActiveMealLog(null);
      }

      // ========================================
      // STEP 6: Save message to history
      // ========================================
      const { error } = await supabase.from("ai_messages").insert([{
        message: currentMessage,
        response: reply,
        user_id: TEST_USER_ID,
        role: "user",
      }]);

      if (error) {
        console.error("Message save error:", error);
      }

      setMessage("");
      await loadMessages();

    } catch (error) {
      console.error("Send error:", error);
      alert("Something went wrong. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  const saveRowsToPlannedMeals = async (rows) => {
    const { error } = await supabase.from("planned_meals").insert(rows);
    return error;
  };

  const savePlanToDatabase = async (item, mealsOverride = null) => {
    try {
      setSavingPlanId(item.id);

      const meals = mealsOverride || parseMealPlan(item.response);
      if (!meals.length) {
        alert("Could not parse meal plan.");
        return;
      }

      const targetDate = extractRequestedDate(item.message);

      const unsavedMeals = meals.filter((meal, index) => {
        const key = mealButtonKey(item.id, index);
        return !savedMealKeys.includes(key);
      });

      if (!unsavedMeals.length) {
        setSavedPlanIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
        alert("Plan already saved.");
        return;
      }

      const rows = unsavedMeals.map((meal) => ({
        user_id: TEST_USER_ID,
        date: targetDate,
        meal_type: meal.meal_type,
        food: meal.food,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        servings: meal.servings,
        suggested_time: meal.suggested_time || null,
        status: "planned",
      }));

      const error = await saveRowsToPlannedMeals(rows);

      if (error) {
        console.error("Plan save error:", error);
        alert("Could not save plan.");
        return;
      }

      const newMealKeys = meals.map((_, index) => mealButtonKey(item.id, index));
      setSavedMealKeys((prev) => [...new Set([...prev, ...newMealKeys])]);
      setSavedPlanIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
      alert("Plan saved!");
    } catch (error) {
      console.error("Save plan error:", error);
      alert("Could not save plan.");
    } finally {
      setSavingPlanId(null);
    }
  };

  const saveSingleMealToDatabase = async (item, meal, index = 0) => {
    try {
      setSavingPlanId(item.id);

      if (!meal) {
        alert("Could not parse meal.");
        return;
      }

      const targetDate = extractRequestedDate(item.message);
      const key = mealButtonKey(item.id, index);

      if (savedMealKeys.includes(key)) {
        alert("Meal already added.");
        return;
      }

      const row = {
        user_id: TEST_USER_ID,
        date: targetDate,
        meal_type: meal.meal_type,
        food: meal.food,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        servings: meal.servings,
        suggested_time: meal.suggested_time || null,
        status: "planned",
      };

      const error = await saveRowsToPlannedMeals([row]);

      if (error) {
        console.error("Meal save error:", error);
        alert("Could not add meal.");
        return;
      }

      setSavedMealKeys((prev) => [...prev, key]);

      const parsedMeals = parseMealPlan(item.response);
      if (parsedMeals.length <= 1) {
        setSavedPlanIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
      }

      alert("Meal added to plan!");
    } catch (error) {
      console.error("Save meal error:", error);
      alert("Could not add meal.");
    } finally {
      setSavingPlanId(null);
    }
  };

  const handleMicClick = () => {
    alert("Voice input coming soon!");
  };

  const handleUploadClick = () => {
    alert("Photo upload coming soon!");
  };

  const showSend = message.trim().length > 0;

  return (
    <>
      <HamburgerMenu />
      
      <main
        style={{
          padding: isMobile ? "10px" : "20px",
          maxWidth: "900px",
          margin: "0 auto",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h1 style={{ fontSize: isMobile ? "24px" : "32px", marginBottom: "10px" }}>
          AI Health Coach
        </h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "16px",
          backgroundColor: "#fafafa",
          height: isMobile ? "75vh" : "500px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "12px" : "20px",
          }}
        >
          {isInitialLoad ? (
            <p style={{ fontSize: isMobile ? "14px" : "16px", color: "#9ca3af" }}>
              Loading...
            </p>
          ) : history.length === 0 ? (
            <p style={{ fontSize: isMobile ? "14px" : "16px" }}>
              No messages yet. Try: "I ate chicken for lunch" or "I have a hockey game tonight, plan my meals"
            </p>
          ) : (
            history.map((item) => {
              const parsedMeals = parseMealPlan(item.response);
              const planDetected = parsedMeals.length > 1;
              const singleParsedMeal =
                parsedMeals.length === 1 ? parsedMeals[0] : parseSingleMeal(item.response);
              const singleMealDetected = !planDetected && Boolean(singleParsedMeal);
              const alreadySavedWholePlan = savedPlanIds.includes(item.id);
              
              // Check if this meal is already logged by comparing with actual_meals
              const isLoggedMeal = singleMealDetected && todayLoggedMeals.some(loggedMeal => {
                // Match by meal_type and similar food description
                const foodMatch = loggedMeal.food && singleParsedMeal.food && 
                  loggedMeal.food.toLowerCase().includes(singleParsedMeal.food.toLowerCase().split(',')[0].trim().toLowerCase());
                const mealTypeMatch = loggedMeal.meal_type === singleParsedMeal.meal_type;
                const caloriesClose = Math.abs(loggedMeal.calories - singleParsedMeal.calories) < 50;
                
                return mealTypeMatch && (foodMatch || caloriesClose);
              });

              return (
                <div key={item.id} style={{ marginBottom: "16px" }}>
                  {/* User message */}
                  <div style={{ textAlign: "right", marginBottom: "8px" }}>
                    <span
                      style={{
                        background: "#dbeafe",
                        padding: isMobile ? "10px 12px" : "10px 14px",
                        borderRadius: "12px",
                        display: "inline-block",
                        maxWidth: isMobile ? "88%" : "70%",
                        whiteSpace: "pre-wrap",
                        textAlign: "left",
                        fontSize: isMobile ? "14px" : "16px",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.message}
                    </span>
                  </div>

                  {/* AI response */}
                  <div style={{ textAlign: "left" }}>
                    <div
                      style={{
                        background: "#e5e7eb",
                        padding: isMobile ? "10px 12px" : "10px 14px",
                        borderRadius: "12px",
                        display: "inline-block",
                        maxWidth: isMobile ? "88%" : "70%",
                        whiteSpace: "pre-wrap",
                        textAlign: "left",
                        fontSize: isMobile ? "14px" : "16px",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.response}
                    </div>
                  </div>

                  {/* Multi-meal plan buttons */}
                  {planDetected && (
                    <div style={{ marginTop: "8px", textAlign: "left" }}>
                      {parsedMeals.map((meal, index) => {
                        const key = mealButtonKey(item.id, index);
                        const mealAlreadySaved = savedMealKeys.includes(key);

                        return (
                          <div key={key} style={{ marginBottom: "8px" }}>
                            <button
                              onClick={() => saveSingleMealToDatabase(item, meal, index)}
                              disabled={savingPlanId === item.id || mealAlreadySaved}
                              style={{
                                border: "none",
                                borderRadius: "10px",
                                padding: "10px 14px",
                                backgroundColor: mealAlreadySaved ? "#9ca3af" : "#374151",
                                color: "#fff",
                                cursor: mealAlreadySaved ? "default" : "pointer",
                                opacity: savingPlanId === item.id ? 0.7 : 1,
                                marginRight: "8px",
                              }}
                            >
                              {mealAlreadySaved
                                ? `${meal.meal_type} added`
                                : savingPlanId === item.id
                                ? "Saving..."
                                : `Add ${meal.meal_type}`}
                            </button>
                          </div>
                        );
                      })}

                      <button
                        onClick={() => savePlanToDatabase(item, parsedMeals)}
                        disabled={savingPlanId === item.id || alreadySavedWholePlan}
                        style={{
                          border: "none",
                          borderRadius: "10px",
                          padding: "10px 14px",
                          backgroundColor: alreadySavedWholePlan ? "#9ca3af" : "#111827",
                          color: "#fff",
                          cursor: alreadySavedWholePlan ? "default" : "pointer",
                          opacity: savingPlanId === item.id ? 0.7 : 1,
                        }}
                      >
                        {alreadySavedWholePlan
                          ? "Plan saved"
                          : savingPlanId === item.id
                          ? "Saving..."
                          : "Add this plan"}
                      </button>
                    </div>
                  )}

                  {/* Single meal - show button OR confirmation */}
                  {!planDetected && singleMealDetected && !isLoggedMeal && (
                    <div style={{ marginTop: "8px", textAlign: "left" }}>
                      <button
                        onClick={() => saveSingleMealToDatabase(item, singleParsedMeal, 0)}
                        disabled={savingPlanId === item.id || savedMealKeys.includes(mealButtonKey(item.id, 0))}
                        style={{
                          border: "none",
                          borderRadius: "10px",
                          padding: "10px 14px",
                          backgroundColor: savedMealKeys.includes(mealButtonKey(item.id, 0)) ? "#9ca3af" : "#111827",
                          color: "#fff",
                          cursor: savedMealKeys.includes(mealButtonKey(item.id, 0)) ? "default" : "pointer",
                          opacity: savingPlanId === item.id ? 0.7 : 1,
                        }}
                      >
                        {savedMealKeys.includes(mealButtonKey(item.id, 0))
                          ? "Added to plan"
                          : savingPlanId === item.id
                          ? "Saving..."
                          : "Add to plan"}
                      </button>
                    </div>
                  )}

                  {/* Logged meal confirmation */}
                  {!planDetected && singleMealDetected && isLoggedMeal && (
                    <div
                      style={{
                        marginTop: "8px",
                        textAlign: "left",
                        background: "#E8F5E9",
                        border: "1px solid #4CAF50",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        display: "inline-block",
                      }}
                    >
                      <span style={{ color: "#2E7D32", fontSize: isMobile ? "13px" : "14px", fontWeight: "600" }}>
                        ✅ Logged to {singleParsedMeal.meal_type} for today
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isLoading && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ textAlign: "right", marginBottom: "8px" }}>
                <span
                  style={{
                    background: "#dbeafe",
                    padding: isMobile ? "10px 12px" : "10px 14px",
                    borderRadius: "12px",
                    display: "inline-block",
                    maxWidth: isMobile ? "88%" : "70%",
                    whiteSpace: "pre-wrap",
                    textAlign: "left",
                    fontSize: isMobile ? "14px" : "16px",
                    wordBreak: "break-word",
                  }}
                >
                  {message}
                </span>
              </div>

              <div style={{ textAlign: "left" }}>
                <span
                  style={{
                    background: "#e5e7eb",
                    padding: isMobile ? "10px 12px" : "10px 14px",
                    borderRadius: "12px",
                    display: "inline-block",
                    maxWidth: isMobile ? "88%" : "70%",
                    fontSize: isMobile ? "14px" : "16px",
                  }}
                >
                  Thinking...
                </span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            borderTop: "1px solid #ddd",
            padding: isMobile ? "10px" : "14px",
            backgroundColor: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              border: "1px solid #d1d5db",
              borderRadius: "24px",
              padding: isMobile ? "8px 10px" : "10px 12px",
              backgroundColor: "#fff",
            }}
          >
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isLoading}
              title="Upload photo"
              style={{
                width: isMobile ? "42px" : "44px",
                height: isMobile ? "42px" : "44px",
                borderRadius: "50%",
                border: "1px solid #ddd",
                backgroundColor: "#fff",
                fontSize: "18px",
                flexShrink: 0,
                opacity: isLoading ? 0.6 : 1,
                cursor: isLoading ? "default" : "pointer",
              }}
            >
              +
            </button>

            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask your coach"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                fontSize: "16px",
                backgroundColor: "transparent",
                color: "#111827",
              }}
            />

            {showSend ? (
              <button
                type="button"
                onClick={handleSend}
                disabled={isLoading}
                title="Send"
                style={{
                  width: isMobile ? "42px" : "44px",
                  height: isMobile ? "42px" : "44px",
                  borderRadius: "50%",
                  border: "none",
                  backgroundColor: isLoading ? "#9ca3af" : "#111827",
                  color: "#ffffff",
                  fontSize: "18px",
                  fontWeight: "700",
                  flexShrink: 0,
                  opacity: isLoading ? 0.7 : 1,
                  cursor: isLoading ? "default" : "pointer",
                }}
              >
                ↑
              </button>
            ) : (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={isLoading}
                title="Voice input"
                style={{
                  width: isMobile ? "42px" : "44px",
                  height: isMobile ? "42px" : "44px",
                  borderRadius: "50%",
                  border: "none",
                  backgroundColor: "#111827",
                  color: "#ffffff",
                  fontSize: "18px",
                  flexShrink: 0,
                  opacity: isLoading ? 0.7 : 1,
                  cursor: isLoading ? "default" : "pointer",
                }}
              >
                🎤
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
    </>
  );
}