'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [remaining, setRemaining] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [goal, setGoal] = useState({ calories: 2800, protein: 180, carbs: 350, fat: 93 });
  const [activeMealLog, setActiveMealLog] = useState(null);

  const messagesEndRef = useRef(null);

  // Get user ID from localStorage
  const getCurrentUserId = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('currentUser') || localStorage.getItem('userId') || 'de52999b-7269-43bd-b205-c42dc381df5d';
    }
    return 'de52999b-7269-43bd-b205-c42dc381df5d';
  };

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load today's meals and calculate totals
  const loadTodaysMeals = async () => {
    const today = new Date().toISOString().split('T')[0];
    const userId = getCurrentUserId();
    
    const { data, error } = await supabase
      .from('actual_meals')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today);

    if (!error && data) {
      const todayTotals = data.reduce((acc, meal) => ({
        calories: acc.calories + (meal.calories || 0),
        protein: acc.protein + (meal.protein || 0),
        carbs: acc.carbs + (meal.carbs || 0),
        fat: acc.fat + (meal.fat || 0)
      }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

      setTotals(todayTotals);
      setRemaining({
        calories: Math.max(0, goal.calories - todayTotals.calories),
        protein: Math.max(0, goal.protein - todayTotals.protein),
        carbs: Math.max(0, goal.carbs - todayTotals.carbs),
        fat: Math.max(0, goal.fat - todayTotals.fat)
      });
    }
  };

  // Load user goals
  const loadUserGoals = async () => {
    const userId = getCurrentUserId();
    
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!error && data) {
      setGoal(data);
    }
  };

  // Load conversation history
  const loadConversationHistory = async () => {
    const userId = getCurrentUserId();
    
    const { data, error } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(20);

    if (!error && data) {
      const formattedMessages = data.flatMap(msg => [
        { role: 'user', content: msg.message },
        { role: 'assistant', content: msg.response }
      ]);
      setMessages(formattedMessages);
    }
  };

  useEffect(() => {
    loadTodaysMeals();
    loadUserGoals();
    loadConversationHistory();
  }, []);

  // Detect if message is a food log
  const isLogMessage = (text) => {
    if (!text) return false;
    const patterns = [
      /\b(I ate|I had|I consumed|just ate|just had)\b/i,
      /\b(ate|had|consumed)\s+\w+\s+(for|at|during)\s+(breakfast|lunch|dinner|snack)/i,
      /\b(for\s+)?(breakfast|lunch|dinner)\s+(I|i)\s+(ate|had|consumed)/i
    ];
    return patterns.some(pattern => pattern.test(text));
  };

  // Detect if message is meal planning
  const isMealPlanningRequest = (text) => {
    if (!text) return false;
    const patterns = [
      /what should I eat/i,
      /meal plan/i,
      /suggestions? for/i,
      /plan.*meal/i,
      /help.*plan/i,
      /recommend.*food/i
    ];
    return patterns.some(pattern => pattern.test(text));
  };

  // Extract meal type from message
  const extractMealType = (text) => {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (lower.includes('breakfast')) return 'breakfast';
    if (lower.includes('lunch')) return 'lunch';
    if (lower.includes('dinner')) return 'dinner';
    if (lower.includes('snack')) return 'snack';
    
    // Time-based inference
    const hour = new Date().getHours();
    if (hour < 11) return 'breakfast';
    if (hour < 17) return 'lunch';
    return 'dinner';
  };

  // Parse meal blocks from AI response
  const parseMealBlocks = async (text) => {
    const blocks = [];
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for meal type headers
      if (/^\*\*(Breakfast|Lunch|Dinner|Snack|Dessert)\*\*$/.test(line)) {
        const mealType = line.replace(/\*\*/g, '').toLowerCase();
        const block = { meal_type: mealType };
        
        // Parse the following lines
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (!nextLine || nextLine.startsWith('**')) break;
          
          if (nextLine.startsWith('- Foods:')) {
            block.food = nextLine.replace('- Foods:', '').trim();
          } else if (nextLine.startsWith('- Calories:')) {
            block.calories = parseInt(nextLine.replace('- Calories:', '').trim()) || 0;
          } else if (nextLine.startsWith('- Protein:')) {
            block.protein = parseInt(nextLine.replace('- Protein:', '').replace('g', '').trim()) || 0;
          } else if (nextLine.startsWith('- Carbs:')) {
            block.carbs = parseInt(nextLine.replace('- Carbs:', '').replace('g', '').trim()) || 0;
          } else if (nextLine.startsWith('- Fat:')) {
            block.fat = parseInt(nextLine.replace('- Fat:', '').replace('g', '').trim()) || 0;
          }
        }
        
        if (block.food && block.calories) {
          blocks.push(block);
        }
      }
    }
    
    return blocks;
  };

  // Auto-save detection
  const shouldAutoSave = (response, activeMealLog) => {
    if (!activeMealLog) return false;
    
    const triggers = [
      /let's log/i,
      /total:/i,
      /logged:/i,
      /\*\*(breakfast|lunch|dinner|snack)\*\*/i
    ];
    
    return triggers.some(trigger => trigger.test(response)) && 
           response.includes('Calories:') && 
           response.includes('Protein:');
  };

  // Handle sending messages
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const currentMessage = input.trim();
    const userId = getCurrentUserId();
    const now = new Date();
    const localHour = now.getHours();
    const localDate = now.toISOString().split('T')[0];

    // 1. Detect message type
    const isNewFoodLog = isLogMessage(currentMessage);
    const isMealPlanning = isMealPlanningRequest(currentMessage);
    const isFollowUp = activeMealLog && 
      (currentMessage.match(/^\d/) || currentMessage.length < 20) && 
      !isNewFoodLog && 
      !isMealPlanning;

    // 2. Update activeMealLog based on context
    if (isNewFoodLog && !isFollowUp) {
      // Starting NEW food log
      setActiveMealLog({
        type: "food_log",
        originalMessage: currentMessage,
        mealType: extractMealType(currentMessage) || null,
      });
    } else if (isFollowUp) {
      // Continuing existing food log
      setActiveMealLog({
        ...activeMealLog,
        followUpMessage: currentMessage,
        conversationStage: "followup"
      });
    } else if (isMealPlanning) {
      // Meal planning - clear food log context
      setActiveMealLog(null);
    }

    // 3. Add user message
    setMessages(prev => [...prev, { role: 'user', content: currentMessage }]);
    setInput('');
    setIsLoading(true);

    try {
      // 4. Call API
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentMessage,
          userId: userId,
          requestType: activeMealLog ? 'food_log' : 'general',
          contextData: activeMealLog || {},
          localHour: localHour,
          localDate: localDate,
          history: messages.slice(-10) // Send recent history
        }),
      });

      const data = await response.json();

      // 5. Add AI response
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: data.reply || data.message 
      }]);

      // 6. Handle auto-save for food logs
      if (shouldAutoSave(data.reply, activeMealLog)) {
        const mealBlocks = await parseMealBlocks(data.reply);
        
        for (const meal of mealBlocks) {
          await supabase.from('actual_meals').insert({
            user_id: userId,
            date: localDate,
            meal_type: meal.meal_type,
            food: meal.food,
            calories: meal.calories,
            protein: meal.protein,
            carbs: meal.carbs,
            fat: meal.fat,
            servings: 1
          });
        }
        
        // Clear activeMealLog after successful save
        setActiveMealLog(null);
        
        // Reload today's totals
        await loadTodaysMeals();
      }

    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4">
        <h1 className="text-xl font-bold">AI Health Coach</h1>
        <div className="text-sm mt-2 grid grid-cols-4 gap-2">
          <div>Cal: {totals.calories}/{goal.calories}</div>
          <div>P: {totals.protein}g</div>
          <div>C: {totals.carbs}g</div>
          <div>F: {totals.fat}g</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`mb-4 ${
              message.role === 'user'
                ? 'text-right'
                : 'text-left'
            }`}
          >
            <div
              className={`inline-block p-3 rounded-lg max-w-xs lg:max-w-md ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="text-left mb-4">
            <div className="inline-block p-3 rounded-lg bg-gray-100 text-gray-800">
              AI is thinking...
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask your coach anything..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows="2"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}