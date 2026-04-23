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

function extractTargetDate(text, surroundingTexts) {
  // Check all provided texts for tomorrow/yesterday
  const allTexts = [text, ...(surroundingTexts || [])].join(" ").toLowerCase();
  if (allTexts.includes("tomorrow")) return addDays(getLocalDate(), 1);
  if (allTexts.includes("yesterday")) return addDays(getLocalDate(), -1);
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
    /what\s+should\s+i\s+make/i,
    /what\s+can\s+i\s+make/i,
    /what\s+can\s+i\s+cook/i,
    /what\s+to\s+make/i,
    /i\s+have\s+(some\s+)?(chicken|beef|fish|salmon|turkey|pork|tofu|eggs|rice|pasta|potatoes|vegetables|veggies)/i,
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
  return /\b(yes|yeah|yep|yup|yew|yea|ya|ye|sure|perfect|great|sounds good|i like that|let'?s do|that one|i'?ll have|add it|can we do that|looks good|works for me|do that one|i want that|i'?ll take|love it|that works|go with that|do it|let'?s go with|as planned|as actual|for later|plan it|log it|save it|add (it |this )?(to my )?(plan|log)|confirm|correct|right|exactly|absolutely|i'?ll go|i will go|go over|i'?ll take that|i choose|going with|i'?ll have that|that one|the (protein|shake|fitzels|first|second|last|other) one)\b/i.test(text);
}

function isMealSwap(text) {
  if (!text) return false;
  return /i ran out|don'?t have|don'?t want|out of|no more|something else|another option|another suggestion|swap|give me another|can'?t make|different option|instead of|instead|replace|substitute|change it|can you change|no (salmon|chicken|beef|fish|meat|that)/i.test(text);
}

function isFutureMeal(text) {
  if (!text) return false;
  return /\b(i'?ll have|i will have|i'?m (going to|gonna) have|i'?m planning (to have|on having)|planning to eat|going to eat|will eat|i'?ll eat|having .* (tonight|later|for dinner|for lunch|for breakfast|after|tomorrow))\b/i.test(text);
}

function detectPhotoIntent(text) {
  if (!text) return "unknown";
  const lower = text.toLowerCase();
  if (/i (just |already )?(had|ate|drank|consumed|finished)/i.test(lower)) return "eaten";
  if (/for (dinner|lunch|breakfast|snack|later|tonight|tomorrow)/i.test(lower)) return "planned";
  if (/(going to|will have|planning|saving|for when i get home|store|shopping|found this)/i.test(lower)) return "planned";
  if (/(which|better|compare|vs|versus|best for|recommend|should i (get|buy|choose))/i.test(lower)) return "compare";
  if (/(menu|order|what (should|can) i (get|order|have)|restaurant)/i.test(lower)) return "menu";
  return "unknown";
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
  const [pendingImages, setPendingImages]  = useState([]); // max 4: [{ base64, mimeType, preview }]
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [loadingStage, setLoadingStage]   = useState("");

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

  // Track which AI message indices have had ALL their meals saved — close them permanently
  const [closedPlanIndices, setClosedPlanIndices] = useState(new Set());

  const messagesEndRef  = useRef(null);
  const textareaRef     = useRef(null);
  const cameraInputRef  = useRef(null);
  const libraryInputRef = useRef(null);

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
    if ((!trimmed && pendingImages.length === 0) || isLoading) return;

    const uid = userId || localStorage.getItem("user_id");
    setMessage("");
    setIsLoading(true);

    const userMsg = {
      role: "user",
      content: trimmed || (pendingImages.length > 0 ? `📷 ${pendingImages.length > 1 ? pendingImages.length + " photos" : "Photo"}` : ""),
      imagePreviews: pendingImages.map(img => img.preview),
    };
    let newHistory = [...history, userMsg];
    setHistory(newHistory);

    const imagesToSend = [...pendingImages];
    setPendingImages([]);

    // Set loading stage based on what's being sent
    if (imagesToSend.length > 1) {
      setLoadingStage("Comparing labels...");
    } else if (imagesToSend.length === 1) {
      setLoadingStage("Scanning label...");
    } else {
      setLoadingStage("Thinking...");
    }

    // Progressive messages for photo calls
    let stageTimer;
    if (imagesToSend.length > 0) {
      stageTimer = setTimeout(() => setLoadingStage("Reading nutrition values..."), 2500);
      setTimeout(() => setLoadingStage("Almost done..."), 5500);
    }

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
      } else if (isFutureMeal(trimmed) && !isMealPlanningRequest(trimmed)) {
        // Future tense food statement → treat as planned meal
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed, isFutureMeal: true };
      } else if (imagesToSend.length > 0) {
        const photoIntent = detectPhotoIntent(trimmed);
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = {
          type: "photo",
          photoIntent,
          imageCount: imagesToSend.length,
          message: trimmed,
        };
      } else if (isConfirmation(trimmed) && lastAiHadMeals) {
        // User confirmed — save meals from previous AI message directly, skip AI call
        const mostRecentAiMsg = recentAiMsgs[0];
        const meals = mostRecentAiMsg ? parseAllMeals(mostRecentAiMsg.content) : [];
        
        if (meals.length > 0) {
          const uid = userId || localStorage.getItem("user_id");
          
          // Detect target date from context (today vs tomorrow)
          const surroundingTexts = history.slice(Math.max(0, history.length - 6)).map(m => m.content || "");
          const targetDate = extractTargetDate(trimmed, surroundingTexts);
          
          let savedCount = 0;
          
          for (const meal of meals) {
            const saved = await saveMealViaAPI("planned_meals", { ...meal, date: targetDate }, uid);
            if (saved) savedCount++;
          }
          
          if (savedCount > 0) {
            await loadPlannedMeals(uid);
            const confirmMsg = savedCount === 1 
              ? `Done — ${meals[0].displayType} added to your plan.`
              : `Done — all ${savedCount} meals added to your plan.`;
            setHistory([...newHistory, { role: "assistant", content: confirmMsg }]);
            
            // Close the meal plan message so it's never looked up again
            const mostRecentAiIdx = history.lastIndexOf(mostRecentAiMsg);
            if (mostRecentAiIdx >= 0) {
              setClosedPlanIndices(prev => new Set([...prev, mostRecentAiIdx]));
            }
          } else {
            setHistory([...newHistory, { role: "assistant", content: "Sorry, couldn't save. Please try again." }]);
          }
          
          setIsLoading(false);
          setLoadingStage("");
          return; // Skip AI call entirely
        }
        
        // Fallback: if no meals found, route to AI
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed, isConfirmation: true };
      } else if (isMealPlanningRequest(trimmed) || isWeightGoalRequest(trimmed)) {
        newActiveMealLog = null;
        setActiveMealLog(null);
        context = { type: "meal_planning", request: trimmed };
      } else if (isMealSwap(trimmed) && history.some(m => m.role === "assistant" && parseAllMeals(m.content).length > 0)) {
        // User is swapping a previously suggested meal
        // Delete the previous AI message with meals to avoid confusion
        const lastAiMealIdx = history.findLastIndex(m => m.role === "assistant" && parseAllMeals(m.content).length > 0);
        if (lastAiMealIdx >= 0) {
          newHistory = [...history.slice(0, lastAiMealIdx), ...history.slice(lastAiMealIdx + 1)];
        }
        
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
          images:    imagesToSend.length > 0 ? imagesToSend.map(img => ({ base64: img.base64, mimeType: img.mimeType })) : null,
        }),
      });

      const data  = await res.json();
      const reply = data.reply || "Sorry, could not get a response.";
      setHistory([...newHistory, { role: "assistant", content: reply }]);

      // The AI response index in history — used to close it after saving
      const aiMsgIdx = newHistory.length;

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
            // Close this message — never look it up again
            setClosedPlanIndices(prev => new Set([...prev, aiMsgIdx]));
          }
        }
      }

      // Auto-save photo logs when intent is "eaten" or meal type was specified
      if (context?.type === "photo" && imagesToSend.length > 0) {
        const photoIntent = context.photoIntent;
        const msgLower = (trimmed || "").toLowerCase();
        const isEaten = photoIntent === "eaten" ||
          /\b(had|ate|drank|consumed|finished|as a snack|as a lunch|as a breakfast|as a dinner|for snack|for lunch|for breakfast|for dinner)\b/i.test(msgLower);

        if (isEaten) {
          const parsed = parseAllMeals(reply);
          if (parsed.length > 0) {
            // Infer meal type from time if not in meal block
            const hour = new Date().getHours();
            const inferredType = hour < 11 ? "breakfast" : hour < 14 ? "lunch" : hour < 17 ? "snack" : "dinner";
            const meal = {
              ...parsed[0],
              date: getLocalDate(),
              mealType: parsed[0].mealType || inferredType,
            };
            const saved = await saveMealViaAPI("actual_meals", meal, uid);
            if (saved) {
              await loadTodayMeals(uid);
              // Close this message — never look it up again
              setClosedPlanIndices(prev => new Set([...prev, aiMsgIdx]));
              console.log("✅ Photo meal auto-saved to actual_meals");
            }
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
      setLoadingStage("");
      if (stageTimer) clearTimeout(stageTimer);
    }
  }

  async function handleAddToPlan(meal, msgIdx, targetDate) {
    const key = getMealKey(msgIdx, meal);
    if (savedPlanKeys.includes(key)) return;
    const uid = userId || localStorage.getItem("user_id");

    // Only replace for Breakfast/Lunch/Dinner — Snacks can stack
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
      const newKeys = [...savedPlanKeys, key];
      setSavedPlanKeys(newKeys);
      // Close this plan index — no more looking back at it
      setClosedPlanIndices(prev => new Set([...prev, msgIdx]));
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
    if (newKeys.length > 0) {
      setSavedPlanKeys(prev => [...prev, ...newKeys]);
      // Close this plan index entirely — conversation is done
      setClosedPlanIndices(prev => new Set([...prev, msgIdx]));
      await loadPlannedMeals(uid);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleImageSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowPhotoMenu(false);

    // Compress image using canvas before sending — prevents Vercel 4.5MB limit
    const compressImage = (file) => new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const preview = canvas.toDataURL("image/jpeg", 0.85);
        const base64 = preview.split(",")[1];
        URL.revokeObjectURL(url);
        resolve({ base64, mimeType: "image/jpeg", preview });
      };
      img.src = url;
    });

    const compressed = await compressImage(file);
    setPendingImages(prev => {
      if (prev.length >= 4) return prev;
      return [...prev, compressed];
    });
    e.target.value = "";
  }

  function removeImage(idx) {
    setPendingImages(prev => prev.filter((_, i) => i !== idx));
  }

  function clearImages() {
    setPendingImages([]);
  }

  // ── CURA Theme ──────────────────────────────────────────────────
  const dark = typeof window !== "undefined"
    ? localStorage.getItem("cura_dark") !== "false"
    : true;

  const T = dark ? {
    bg:      "#1c1c1e",
    surface: "#242424",
    border:  "#2c2c2c",
    text:    "#f0f0f0",
    sub:     "#888888",
    muted:   "#3a3a3a",
    input:   "#2c2c2c",
    userBubble: "#2563eb",
    aiBubble:   "#242424",
    aiBorder:   "#2c2c2c",
  } : {
    bg:      "#f5f5f5",
    surface: "#ffffff",
    border:  "#ebebeb",
    text:    "#111111",
    sub:     "#aaaaaa",
    muted:   "#f0f0f0",
    input:   "#f5f5f5",
    userBubble: "#2563eb",
    aiBubble:   "#ffffff",
    aiBorder:   "#ebebeb",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; }
      `}</style>

      <div style={{ display:"flex", flexDirection:"column", height:"100vh",
        background: T.bg, fontFamily:"'DM Sans', sans-serif",
        maxWidth: 430, margin:"0 auto" }}>

        {/* Hidden file inputs */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
          onChange={handleImageSelected} style={{ display:"none" }} />
        <input ref={libraryInputRef} type="file" accept="image/*"
          onChange={handleImageSelected} style={{ display:"none" }} />

        {/* ── Sticky Header ── */}
        <div style={{ position:"sticky", top:0, zIndex:50, background: T.surface,
          borderBottom:`1px solid ${T.border}`, padding:"52px 20px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
                textTransform:"uppercase", letterSpacing:".1em", margin:0 }}>CURA</p>
              <h1 style={{ fontSize:20, fontWeight:800, color: T.text,
                margin:"2px 0 0", letterSpacing:"-.02em" }}>
                {userName ? `Hey ${userName} 👋` : "AI Coach"}
              </h1>
            </div>
            <div style={{ background:"#2563eb22", border:"1px solid #2563eb44",
              borderRadius:16, padding:"8px 12px", textAlign:"right" }}>
              <p style={{ fontSize:15, fontWeight:800, color:"#2563eb",
                margin:0, lineHeight:1.2 }}>
                {totals.calories} <span style={{ fontWeight:400, color:"#3b82f6", fontSize:12 }}>/ {goals.calories}</span>
              </p>
              <p style={{ fontSize:10, color:"#3b82f6", margin:0, fontWeight:600 }}>
                cal today · {calPct}%
              </p>
            </div>
          </div>
          {todayMeals.length > 0 && (
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              {[
                { label:"P", value:totals.protein, goal:goals.protein, color:"#3b82f6" },
                { label:"C", value:totals.carbs,   goal:goals.carbs,   color:"#10b981" },
                { label:"F", value:totals.fat,     goal:goals.fat,     color:"#f59e0b" },
              ].map(m => {
                const pct = Math.min(100, Math.round((m.value/m.goal)*100));
                return (
                  <div key={m.label} style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:10, fontWeight:600, color: T.sub,
                        textTransform:"uppercase", letterSpacing:".05em" }}>{m.label}</span>
                      <span style={{ fontSize:10, fontWeight:700, color: T.text }}>
                        {Math.round(m.value)}g
                      </span>
                    </div>
                    <div style={{ height:3, background: T.muted, borderRadius:9999, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background: m.color,
                        borderRadius:9999, transition:"width .5s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Messages ── */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px",
          display:"flex", flexDirection:"column", gap:12, background: T.bg }}>

          {history.length === 0 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", height:"100%", textAlign:"center", padding:"0 16px 80px" }}>
              <div style={{ width:64, height:64, borderRadius:20, background:"#2563eb",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:28, marginBottom:16, boxShadow:"0 8px 24px #2563eb44" }}>
                💬
              </div>
              <p style={{ fontWeight:800, color: T.text, fontSize:18, margin:"0 0 8px" }}>CURA</p>
              <p style={{ fontSize:13, color: T.sub, lineHeight:1.5, maxWidth:260, margin:0 }}>
                Tell me what you ate, ask for a meal plan, or get nutrition advice.
              </p>
              <div style={{ marginTop:20, display:"flex", flexDirection:"column",
                gap:8, width:"100%", maxWidth:280 }}>
                {[
                  "I had 8oz chicken and 1 cup rice for lunch",
                  "Create a meal plan for tomorrow",
                  "What should I eat for dinner?",
                  "I want to drop 10 pounds",
                ].map(s => (
                  <button key={s} onClick={() => setMessage(s)}
                    style={{ textAlign:"left", fontSize:13, padding:"12px 14px",
                      borderRadius:14, border:`1px solid ${T.border}`,
                      background: T.surface, color: T.sub, cursor:"pointer",
                      transition:"all .2s" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((msg, idx) => {
            const isUser = msg.role === "user";

            // Find meals — only look back 3 messages, skip any closed plan indices
            const findRecentMeals = (beforeIdx) => {
              const limit = Math.max(0, beforeIdx - 3);
              for (let i = beforeIdx - 1; i >= limit; i--) {
                if (history[i].role === "assistant") {
                  // Skip if this plan has already been saved — it's closed
                  if (closedPlanIndices.has(i)) continue;
                  const m = parseAllMeals(history[i].content);
                  if (m.length > 0) return { meals: m, sourceIdx: i };
                }
              }
              return { meals: [], sourceIdx: -1 };
            };

            const prevUserMsg = !isUser && history[idx - 1]?.role === "user" ? history[idx - 1].content : null;
            const thisIsPostConfirmAI = !isUser && prevUserMsg && isConfirmation(prevUserMsg);

            // Photo selection — winner pick OR "yes log it" after label advice
            const isPhotoSelection = !isUser && prevUserMsg && (
              /\b(whole bag|full bag|all of it|i'?ll go (with|over)|i will go (with|over)|i'?ll take that|i choose|going with|log it|add it|yes please log|want to log|add to plan|log this)\b/i.test(prevUserMsg)
              || (isConfirmation(prevUserMsg) && history.slice(Math.max(0, idx-4), idx)
                .some(m => m.role === "assistant" && /want me to log|add it to your plan|log it or add/i.test(m.content)))
            );

            const { meals: confirmMeals, sourceIdx } = (thisIsPostConfirmAI || isPhotoSelection)
              ? findRecentMeals(idx) : { meals: [], sourceIdx: -1 };

            const thisMeals = !isUser ? parseAllMeals(msg.content) : [];

            // Only show buttons for multi-meal plans (2+ meals) or explicit photo winner
            // Never show buttons for single food logs — those auto-save
            const buttonMeals = (thisIsPostConfirmAI && confirmMeals.length >= 2)
              ? confirmMeals
              : (isPhotoSelection && confirmMeals.length > 0)
              ? confirmMeals
              : [];
            const buttonSourceIdx = sourceIdx >= 0 ? sourceIdx : idx;

            const triggerText = !isUser && history[idx - 1]?.role === "user"
              ? history[idx - 1].content : "";
            const surroundingTexts = history.slice(Math.max(0, idx - 6), idx).map(m => m.content || "");
            const targetDate = extractTargetDate(triggerText, surroundingTexts);

            const showButtons = buttonMeals.length > 0;
            const allSaved = showButtons &&
              buttonMeals.every((m) => savedPlanKeys.includes(getMealKey(buttonSourceIdx, m)));

            return (
              <div key={idx} style={{ display:"flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                alignItems:"flex-end", gap:8 }}>

                {!isUser && (
                  <div style={{ width:32, height:32, borderRadius:10, background:"#2563eb",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:16, flexShrink:0, marginBottom:4,
                    boxShadow:"0 2px 8px #2563eb44" }}>
                    💬
                  </div>
                )}

                <div style={{ maxWidth:"82%", display:"flex", flexDirection:"column", gap:6 }}>
                  {/* Image previews */}
                  {msg.imagePreviews && msg.imagePreviews.length > 0 && (
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {msg.imagePreviews.map((preview, i) => (
                        <img key={i} src={preview} alt={`Photo ${i+1}`}
                          style={{ height:90, width:90, objectFit:"cover",
                            borderRadius:12, border:`1px solid ${T.border}` }} />
                      ))}
                    </div>
                  )}

                  {/* Message bubble */}
                  {msg.content && (
                    <div style={{
                      borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      padding:"12px 14px", fontSize:14, lineHeight:1.5,
                      whiteSpace:"pre-wrap",
                      background: isUser ? T.userBubble : T.aiBubble,
                      color: isUser ? "#fff" : T.text,
                      border: isUser ? "none" : `1px solid ${T.aiBorder}`,
                    }}>
                      {msg.content}
                    </div>
                  )}

                  {/* Add to plan buttons */}
                  {showButtons && (
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {buttonMeals.length > 1 && (
                        <button onClick={() => handleAddAllToPlan(buttonMeals, buttonSourceIdx, targetDate)}
                          disabled={allSaved}
                          style={{ fontSize:12, padding:"10px 16px", borderRadius:12, fontWeight:700,
                            background: allSaved ? "#10b98122" : "#10b981",
                            color: allSaved ? "#10b981" : "#fff", border:"none", cursor:"pointer" }}>
                          {allSaved ? "✅ All meals added" : `+ Add all ${buttonMeals.length} meals to plan`}
                        </button>
                      )}
                      {buttonMeals.map(meal => {
                        const key = getMealKey(buttonSourceIdx, meal);
                        const isSaved = savedPlanKeys.includes(key);
                        const label = getMealLabel(meal.displayType);
                        const hasExisting = meal.mealType !== "snack" && plannedMeals.some(
                          pm => pm.meal_type === meal.mealType && pm.date === targetDate
                        );
                        return (
                          <button key={key}
                            onClick={() => handleAddToPlan(meal, buttonSourceIdx, targetDate)}
                            disabled={isSaved}
                            style={{ fontSize:12, padding:"9px 16px", borderRadius:12, fontWeight:600,
                              border: isSaved ? "none" : `1px solid ${hasExisting ? "#f59e0b" : "#2563eb"}`,
                              background: isSaved ? "#10b98122" : hasExisting ? "#f59e0b22" : "#2563eb22",
                              color: isSaved ? "#10b981" : hasExisting ? "#f59e0b" : "#2563eb",
                              cursor: isSaved ? "default" : "pointer" }}>
                            {isSaved ? `✅ ${label} added`
                              : hasExisting ? `↺ Replace ${label} · ${meal.calories} cal`
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
            <div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
              <div style={{ width:32, height:32, borderRadius:10, background:"#2563eb",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:16, flexShrink:0, boxShadow:"0 2px 8px #2563eb44" }}>
                💬
              </div>
              <div style={{ background: T.aiBubble, border:`1px solid ${T.aiBorder}`,
                borderRadius:"18px 18px 18px 4px", padding:"12px 16px",
                display:"flex", flexDirection:"column", gap:8 }}>
                {/* Progressive status text */}
                {loadingStage && (
                  <p style={{ fontSize:12, color: T.sub, margin:0, fontWeight:500 }}>
                    {loadingStage}
                  </p>
                )}
                {/* Bouncing dots */}
                <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                  {[0,150,300].map(d => (
                    <div key={d} style={{ width:7, height:7, borderRadius:"50%",
                      background:"#2563eb", animation:"bounce 1s infinite",
                      animationDelay:`${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ── */}
        <div style={{ background: T.surface, borderTop:`1px solid ${T.border}`,
          padding:"12px 14px", paddingBottom:"calc(12px + env(safe-area-inset-bottom, 0px))" }}>

          {/* Photo menu */}
          {showPhotoMenu && (
            <div style={{ display:"flex", gap:8, marginBottom:10 }}>
              <button onClick={() => { setShowPhotoMenu(false); cameraInputRef.current?.click(); }}
                style={{ flex:1, fontSize:13, padding:"10px 12px", borderRadius:12,
                  background:"#2563eb22", color:"#2563eb", border:"1px solid #2563eb44",
                  fontWeight:600, cursor:"pointer" }}>
                📷 Take Photo
              </button>
              <button onClick={() => { setShowPhotoMenu(false); libraryInputRef.current?.click(); }}
                style={{ flex:1, fontSize:13, padding:"10px 12px", borderRadius:12,
                  background:"#2563eb22", color:"#2563eb", border:"1px solid #2563eb44",
                  fontWeight:600, cursor:"pointer" }}>
                🖼️ Library
              </button>
              <button onClick={() => setShowPhotoMenu(false)}
                style={{ fontSize:13, padding:"10px 12px", borderRadius:12,
                  background: T.muted, color: T.sub, border:"none", cursor:"pointer" }}>
                ✕
              </button>
            </div>
          )}

          {/* Image thumbnails */}
          {pendingImages.length > 0 && (
            <div style={{ display:"flex", gap:8, overflowX:"auto", marginBottom:10, paddingBottom:2 }}>
              {pendingImages.map((img, i) => (
                <div key={i} style={{ position:"relative", flexShrink:0 }}>
                  <img src={img.preview} alt={`Photo ${i+1}`}
                    style={{ width:72, height:72, objectFit:"cover", borderRadius:10,
                      border:`1px solid ${T.border}` }} />
                  <button onClick={() => removeImage(i)}
                    style={{ position:"absolute", top:-6, right:-6, width:18, height:18,
                      borderRadius:"50%", background:"#3a3a3a", color:"#fff",
                      border:"none", cursor:"pointer", fontSize:10,
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
            {/* Camera button */}
            <button onClick={() => pendingImages.length < 4 && setShowPhotoMenu(!showPhotoMenu)}
              disabled={isLoading || pendingImages.length >= 4}
              style={{ minHeight:52, minWidth:48, borderRadius:14, background: T.muted,
                border:"none", cursor:"pointer", display:"flex", flexDirection:"column",
                alignItems:"center", justifyContent:"center", gap:2, flexShrink:0,
                opacity: pendingImages.length >= 4 ? .4 : 1 }}>
              <span style={{ fontSize:20 }}>📷</span>
              {pendingImages.length > 0 && (
                <span style={{ fontSize:9, fontWeight:700, color:"#2563eb" }}>
                  {pendingImages.length}/4
                </span>
              )}
            </button>

            {/* Text input */}
            <textarea ref={textareaRef} value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pendingImages.length > 1 ? "Compare these or add a message..." :
                pendingImages.length === 1 ? "Add a message or just send..." : "Ask your coach..."}
              rows={1}
              style={{ flex:1, resize:"none", borderRadius:14, padding:"14px 16px",
                fontSize:14, border:`1px solid ${message ? "#2563eb" : T.border}`,
                background: T.input, color: T.text, outline:"none",
                minHeight:52, maxHeight:120, fontFamily:"'DM Sans', sans-serif",
                transition:"border-color .2s" }}
            />

            {/* Send button */}
            <button onClick={handleSend}
              disabled={isLoading || (!message.trim() && pendingImages.length === 0)}
              style={{ minHeight:52, minWidth:52, borderRadius:14,
                background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
                border:"none", color:"#fff", fontWeight:700, fontSize:14,
                cursor:"pointer", flexShrink:0, opacity: (isLoading || (!message.trim() && pendingImages.length === 0)) ? .4 : 1,
                padding:"0 16px", boxShadow:"0 4px 12px #2563eb44" }}>
              Send
            </button>
          </div>
        </div>

        {/* ── Bottom Nav ── */}
        <div style={{ background: T.surface, borderTop:`1px solid ${T.border}`,
          display:"flex", paddingBottom:"env(safe-area-inset-bottom, 8px)", zIndex:100 }}>
          {[
            { id:"coach",     icon:"💬", label:"Coach",     path:"/"          },
            { id:"dashboard", icon:"📊", label:"Dashboard", path:"/dashboard" },
            { id:"profile",   icon:"⚙️", label:"Profile",   path:"/profile"   },
          ].map(tab => (
            <button key={tab.id}
              onClick={() => window.location.href = tab.path}
              style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
                gap:3, padding:"10px 0 4px", border:"none", background:"transparent", cursor:"pointer" }}>
              <span style={{ fontSize:20 }}>{tab.icon}</span>
              <span style={{ fontSize:10, fontWeight: tab.id === "coach" ? 700 : 500,
                color: tab.id === "coach" ? "#2563eb" : T.sub, letterSpacing:".03em" }}>
                {tab.label}
              </span>
              {tab.id === "coach" && (
                <div style={{ width:18, height:2, background:"#2563eb", borderRadius:9999 }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `}</style>
    </>
  );

}