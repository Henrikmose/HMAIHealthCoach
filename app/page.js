'use client';

import { useState, useEffect, useRef } from 'react';

// Utility functions for date manipulation
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const getLocalDate = () => {
  const today = new Date();
  return formatDate(today);
};

const extractRequestedDate = (message) => {
  const lower = message.toLowerCase();
  const today = new Date();
  
  if (lower.includes("tomorrow")) {
    return formatDate(addDays(today, 1));
  }
  if (lower.includes("yesterday")) {
    return formatDate(addDays(today, -1));
  }
  
  // Check for date patterns (MM/DD/YYYY or YYYY-MM-DD)
  const dateMatch = message.match(/(\d{1,2}\/\d{1,2}\/\d{4})|(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const dateStr = dateMatch[0];
    let parsedDate;
    
    if (dateStr.includes('/')) {
      const [month, day, year] = dateStr.split('/');
      parsedDate = new Date(year, month - 1, day);
    } else {
      parsedDate = new Date(dateStr);
    }
    
    if (!isNaN(parsedDate.getTime())) {
      return formatDate(parsedDate);
    }
  }
  
  return getLocalDate(); // Default to today
};

// Parse meal plan from AI response
const parseMealPlan = (response) => {
  const lines = response.split('\n');
  const meals = [];
  let currentMeal = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) continue;
    
    // Skip lines that aren't meals
    if (trimmed.includes('HOCKEY GAME') || 
        trimmed.includes('hydration only') ||
        trimmed.includes('Let me know') ||
        trimmed.includes('Ask your coach') ||
        trimmed.match(/^[\d.]+ hours? (before|after)/i)) {
      continue;
    }
    
    // Replace "post-game recovery" with "Snack"
    let processedLine = trimmed.replace(/\*\*post-game recovery\*\*/gi, '**Snack**');
    
    // Check if this line is a meal type header
    const mealHeaderMatch = processedLine.match(/\*\*(.+?)\*\*/);
    if (mealHeaderMatch) {
      let mealType = mealHeaderMatch[1].trim();
      
      // Extract time from headers like "8:30 PM - Snack"
      let suggestedTime = null;
      const timeMatch = mealType.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-?\s*(.+)/i);
      if (timeMatch) {
        suggestedTime = timeMatch[1].trim();
        mealType = timeMatch[2].trim();
      }
      
      // Clean up meal type (remove parenthetical content)
      mealType = mealType.replace(/\s*\([^)]*\)/g, '');
      
      // Map meal types
      const mealTypeMap = {
        'pre-workout snack': 'Snack',
        'post-workout recovery meal': 'Snack',
        'post-workout recovery': 'Snack',
        'recovery meal': 'Snack',
        'pre-tennis snack': 'Snack',
        'post-tennis recovery snack': 'Snack',
        'snack': 'Snack'
      };
      
      const normalizedType = mealTypeMap[mealType.toLowerCase()] || 
                            mealType.charAt(0).toUpperCase() + mealType.slice(1).toLowerCase();
      
      if (currentMeal) {
        meals.push(currentMeal);
      }
      
      currentMeal = {
        type: normalizedType,
        foods: [],
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        servings: 1,
        suggestedTime: suggestedTime
      };
      continue;
    }
    
    // Parse food items
    if (currentMeal && (trimmed.startsWith('- ') || trimmed.startsWith('•'))) {
      const foodLine = trimmed.substring(2).trim();
      
      // Skip macro summaries and instructions
      if (foodLine.match(/^(Calories|Protein|Carbs|Fat):/i) ||
          foodLine.includes('Have this') ||
          foodLine.includes('minutes before')) {
        continue;
      }
      
      currentMeal.foods.push(foodLine);
    }
    
    // Parse macros
    if (currentMeal && trimmed.startsWith('- Calories:')) {
      const caloriesMatch = trimmed.match(/- Calories:\s*(\d+)/);
      if (caloriesMatch) currentMeal.calories = parseInt(caloriesMatch[1]);
    }
    if (currentMeal && trimmed.startsWith('- Protein:')) {
      const proteinMatch = trimmed.match(/- Protein:\s*(\d+)/);
      if (proteinMatch) currentMeal.protein = parseInt(proteinMatch[1]);
    }
    if (currentMeal && trimmed.startsWith('- Carbs:')) {
      const carbsMatch = trimmed.match(/- Carbs:\s*(\d+)/);
      if (carbsMatch) currentMeal.carbs = parseInt(carbsMatch[1]);
    }
    if (currentMeal && trimmed.startsWith('- Fat:')) {
      const fatMatch = trimmed.match(/- Fat:\s*(\d+)/);
      if (fatMatch) currentMeal.fat = parseInt(fatMatch[1]);
    }
  }
  
  if (currentMeal) {
    meals.push(currentMeal);
  }
  
  return meals;
};

// Parse single meal from response
const parseSingleMeal = (response) => {
  const meals = parseMealPlan(response);
  if (meals.length > 0) {
    return meals[0];
  }
  
  // Fallback parsing for single meal
  const lines = response.split('\n').map(line => line.trim()).filter(Boolean);
  const meal = {
    type: 'Meal',
    foods: [],
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servings: 1
  };
  
  for (const line of lines) {
    if (line.startsWith('- ') && !line.match(/^- (Calories|Protein|Carbs|Fat):/i)) {
      meal.foods.push(line.substring(2).trim());
    } else if (line.includes('Calories:')) {
      const match = line.match(/(\d+)/);
      if (match) meal.calories = parseInt(match[1]);
    } else if (line.includes('Protein:')) {
      const match = line.match(/(\d+)/);
      if (match) meal.protein = parseInt(match[1]);
    } else if (line.includes('Carbs:')) {
      const match = line.match(/(\d+)/);
      if (match) meal.carbs = parseInt(match[1]);
    } else if (line.includes('Fat:')) {
      const match = line.match(/(\d+)/);
      if (match) meal.fat = parseInt(match[1]);
    }
  }
  
  return meal;
};

// Parse all meals from response
const parseAllMeals = (response) => {
  const meals = parseMealPlan(response);
  return meals.length > 1 ? meals : [parseSingleMeal(response)].filter(meal => meal.foods.length > 0);
};

// Check if message is about food logging
const isLogMessage = (message) => {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return lower.includes('i ate') || 
         lower.includes('i had') || 
         lower.includes('i just ate') ||
         lower.includes('just had') ||
         lower.includes('for breakfast') ||
         lower.includes('for lunch') ||
         lower.includes('for dinner') ||
         lower.match(/^(ate|had)\s/);
};

// Check if message is a follow-up response
const isFollowUpMessage = (message, activeMealLog) => {
  if (!activeMealLog || !message) return false;
  const trimmed = message.trim().toLowerCase();
  
  // Check for quantity/measurement responses
  return trimmed.match(/^(\d+(\.\d+)?\s*(oz|ounces|grams?|g|cups?|tbsp|tsp|slices?|pieces?|medium|large|small|half|quarter)?|half|quarter|one|two|three|a cup|1 cup|2 cups)$/i) ||
         trimmed.length < 20; // Short responses are likely follow-ups
};

// Check if message is meal planning request
const isMealPlanningRequest = (message) => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('plan my meals') ||
         lower.includes('what should i eat') ||
         lower.includes('meal plan') ||
         lower.includes('suggest meals') ||
         lower.includes('plan for') ||
         lower.includes('give me a') && (lower.includes('meal') || lower.includes('food'));
};

// Check if message is weight goal request
const isWeightGoalRequest = (message) => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('lose weight') ||
         lower.includes('gain weight') ||
         lower.includes('lose') && lower.includes('pounds') ||
         lower.includes('gain') && lower.includes('pounds') ||
         lower.includes('lose') && lower.includes('lbs') ||
         lower.includes('gain') && lower.includes('lbs');
};

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [savedPlanKeys, setSavedPlanKeys] = useState([]);
  const [todayLoggedMeals, setTodayLoggedMeals] = useState([]);
  const [activeMealLog, setActiveMealLog] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversation history on component mount
  useEffect(() => {
    const loadHistory = async () => {
      const userId = localStorage.getItem('currentUser');
      if (!userId) return;

      try {
        const response = await fetch('/api/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: '',
            userId: userId,
            requestType: 'load_history'
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.history && Array.isArray(data.history)) {
            setMessages(data.history);
          }
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
      }
    };

    loadHistory();
  }, []);

  // Auto-save completed food logs
  useEffect(() => {
    const autoSaveCompletedLogs = async () => {
      if (messages.length === 0) return;
      
      const userId = localStorage.getItem('currentUser');
      if (!userId) return;

      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role !== 'assistant') return;

      const meals = parseAllMeals(lastMessage.content);
      if (meals.length === 0) return;

      // Check if this was a completed food logging session
      const isCompletedLog = lastMessage.content.includes('Updated totals') || 
                            lastMessage.content.includes('Got it') ||
                            lastMessage.content.includes('Great! Here\'s the complete meal block') ||
                            (activeMealLog && lastMessage.content.includes('**' + activeMealLog.mealType + '**'));

      if (isCompletedLog && activeMealLog) {
        // Auto-save the meal
        try {
          const meal = meals[0];
          const saveDate = getLocalDate();
          
          const response = await fetch('/api/save-meal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              date: saveDate,
              meal_type: activeMealLog.mealType,
              food: meal.foods.join(', '),
              calories: meal.calories,
              protein: meal.protein,
              carbs: meal.carbs,
              fat: meal.fat,
              servings: meal.servings || 1,
              table: 'actual_meals'
            })
          });

          if (response.ok) {
            // Clear the active meal log
            setActiveMealLog(null);
            
            // Update the logged meals state
            setTodayLoggedMeals(prev => [...prev, {
              meal_type: activeMealLog.mealType,
              food: meal.foods.join(', '),
              calories: meal.calories,
              protein: meal.protein,
              carbs: meal.carbs,
              fat: meal.fat
            }]);
          }
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }
    };

    autoSaveCompletedLogs();
  }, [messages, activeMealLog]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userId = localStorage.getItem('currentUser');
    if (!userId) {
      alert('Please select a user first');
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to chat
    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    try {
      // Detect conversation context
      let requestType = 'general';
      let contextData = {};

      if (isLogMessage(userMessage)) {
        // Starting a food log
        const mealTypeMatch = userMessage.match(/(breakfast|lunch|dinner|snack)/i);
        const mealType = mealTypeMatch ? mealTypeMatch[1].toLowerCase() : 'meal';
        
        setActiveMealLog({
          type: 'food_log',
          originalMessage: userMessage,
          mealType: mealType,
          conversationStage: 'initial'
        });
        
        requestType = 'food_log';
        contextData = { mealType };
      } else if (isFollowUpMessage(userMessage, activeMealLog)) {
        // Continuing a food log
        setActiveMealLog(prev => ({
          ...prev,
          followUpMessage: userMessage,
          conversationStage: 'followup'
        }));
        
        requestType = 'food_log';
        contextData = { 
          mealType: activeMealLog.mealType,
          originalMessage: activeMealLog.originalMessage,
          followUpMessage: userMessage
        };
      } else if (isMealPlanningRequest(userMessage) || isWeightGoalRequest(userMessage)) {
        // Clear any active meal log when switching to planning
        setActiveMealLog(null);
        requestType = 'meal_planning';
        
        const requestedDate = extractRequestedDate(userMessage);
        contextData = { requestedDate };
      } else {
        // General coaching - clear active meal log
        setActiveMealLog(null);
      }

      // Get current local time
      const now = new Date();
      const localHour = now.getHours();
      const localDate = formatDate(now);

      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          userId,
          requestType,
          contextData,
          localHour,
          localDate,
          history: newMessages.slice(-10) // Send recent conversation history
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);

    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Something went wrong. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToPlan = async (meal, messageIndex, targetDate = null) => {
    const userId = localStorage.getItem('currentUser');
    if (!userId) {
      alert('Please select a user first');
      return;
    }

    const saveDate = targetDate || getLocalDate();
    const key = `${messageIndex}-${meal.type}-${saveDate}`;

    try {
      const table = activeMealLog ? 'actual_meals' : 'planned_meals';
      
      const response = await fetch('/api/save-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          date: saveDate,
          meal_type: meal.type,
          food: meal.foods.join(', '),
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          servings: meal.servings || 1,
          suggested_time: meal.suggestedTime || null,
          table
        })
      });

      if (response.ok) {
        setSavedPlanKeys(prev => [...prev, key]);
        
        if (activeMealLog) {
          setActiveMealLog(null);
          setTodayLoggedMeals(prev => [...prev, {
            meal_type: meal.type,
            food: meal.foods.join(', '),
            calories: meal.calories,
            protein: meal.protein,
            carbs: meal.carbs,
            fat: meal.fat
          }]);
        }
      } else {
        throw new Error('Failed to save meal');
      }
    } catch (error) {
      console.error('Error saving meal:', error);
      alert('Failed to save meal. Please try again.');
    }
  };

  const getMealKey = (messageIndex, meal, date = null) => {
    const saveDate = date || getLocalDate();
    return `${messageIndex}-${meal.type}-${saveDate}`;
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">🧠</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">AI Coach</h1>
            <p className="text-sm text-gray-500">Hey Henrik 👋</p>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-lg font-bold text-blue-600">0 / 2800</div>
          <div className="text-xs text-gray-500">cal today • 0%</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4 pb-20">
        {messages.map((message, index) => {
          const isUser = message.role === 'user';
          const meals = isUser ? [] : parseAllMeals(message.content);
          const triggerText = index > 0 ? messages[index - 1]?.content || '' : '';
          
          const showButtons = meals.length > 0 && (
            isMealPlanningRequest(triggerText) || 
            isWeightGoalRequest(triggerText) ||
            isLogMessage(triggerText) ||
            (activeMealLog && message.role === 'assistant')
          );

          return (
            <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${isUser ? 'bg-blue-500 text-white' : 'bg-white text-gray-900'} rounded-2xl px-4 py-2 shadow-sm`}>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.content}
                </div>
                
                {showButtons && meals.map((meal, mealIndex) => {
                  const requestedDate = extractRequestedDate(triggerText);
                  const key = getMealKey(index, meal, requestedDate);
                  const isSaved = savedPlanKeys.includes(key);
                  
                  return (
                    <div key={mealIndex} className="mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => handleAddToPlan(meal, index, requestedDate)}
                        disabled={isSaved}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                          isSaved 
                            ? 'bg-green-100 text-green-600 cursor-not-allowed' 
                            : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                        }`}
                      >
                        {isSaved ? '✓ Saved' : `Add ${meal.type} to Plan`}
                      </button>
                    </div>
                  );
                })}

                {showButtons && meals.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => {
                        const requestedDate = extractRequestedDate(triggerText);
                        meals.forEach(meal => handleAddToPlan(meal, index, requestedDate));
                      }}
                      className="text-xs px-3 py-1 rounded-full font-medium bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
                    >
                      Add All to Plan
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl px-4 py-2 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask your coach..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            rows="1"
            style={{ minHeight: '40px', maxHeight: '120px' }}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
        
        <div className="text-xs text-gray-500 mt-1 text-center">
          Press Enter to send • Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}