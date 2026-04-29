// Shared API Helper Functions
// Used across all intelligent engine endpoints
// UPDATED: Added meal database functions

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// EXISTING: USER CONTEXT FUNCTIONS
// ============================================

export async function getHealthConditions(userId) {
  try {
    const { data, error } = await supabase
      .from("user_health_conditions")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.log("Get health conditions error:", e.message);
    return [];
  }
}

export async function getNutrientPreferences(userId) {
  try {
    const { data, error } = await supabase
      .from("user_nutrient_preferences")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.log("Get nutrient preferences error:", e.message);
    return [];
  }
}

export async function getDietaryPreferences(userId) {
  try {
    const { data, error } = await supabase
      .from("user_dietary_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  } catch (e) {
    console.log("Get dietary preferences error:", e.message);
    return null;
  }
}

export async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data || null;
  } catch (e) {
    console.log("Get user profile error:", e.message);
    return null;
  }
}

export async function getUserGoals(userId) {
  try {
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data || null;
  } catch (e) {
    console.log("Get user goals error:", e.message);
    return null;
  }
}

// ============================================
// NEW: MEAL DATABASE FUNCTIONS
// ============================================

// Get all meals matching user's constraints
export async function getMealsMatchingConstraints(userId, options = {}) {
  try {
    const { caloriesMax, caloriesMin = 0, mealType, excludeIngredients = [] } = options;
    
    const dietary = await getDietaryPreferences(userId);
    
    let query = supabase
      .from("meals")
      .select("*");
    
    // Filter by calories
    if (caloriesMax) {
      query = query.lte("calories", caloriesMax);
    }
    if (caloriesMin) {
      query = query.gte("calories", caloriesMin);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Filter by dietary restrictions (client-side)
    let filtered = data || [];
    if (dietary) {
      filtered = filtered.filter(meal => {
        // Check allergens
        if (dietary.allergens && dietary.allergens.length > 0) {
          const hasAllergen = dietary.allergens.some(allergen => 
            meal.ingredients?.some(ing => ing.toLowerCase().includes(allergen.toLowerCase()))
          );
          if (hasAllergen) return false;
        }
        
        // Check intolerances
        if (dietary.intolerances && dietary.intolerances.length > 0) {
          const hasIntolerance = dietary.intolerances.some(intol =>
            meal.ingredients?.some(ing => ing.toLowerCase().includes(intol.toLowerCase()))
          );
          if (hasIntolerance) return false;
        }
        
        // Check vegan/vegetarian
        if (dietary.dietary_style?.includes("vegan")) {
          const hasAnimal = meal.ingredients?.some(ing => 
            ["meat", "fish", "chicken", "beef", "dairy", "egg", "milk"].some(a => 
              ing.toLowerCase().includes(a)
            )
          );
          if (hasAnimal) return false;
        }
        
        return true;
      });
    }
    
    return filtered;
  } catch (e) {
    console.log("Get meals matching constraints error:", e.message);
    return [];
  }
}

// Get meals that helped with specific condition
export async function getMealsForCondition(userId, condition) {
  try {
    const { data, error } = await supabase
      .from("meal_outcomes")
      .select("meal_id, meals(name, calories, protein, carbs, fat)")
      .eq("user_id", userId)
      .eq("health_condition", condition)
      .eq("outcome", "helped")
      .order("created_at", { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    return (data || [])
      .map(item => item.meals)
      .filter(Boolean);
  } catch (e) {
    console.log("Get meals for condition error:", e.message);
    return [];
  }
}

// Get meals containing specific nutrient
export async function getMealsByNutrient(nutrient) {
  try {
    const { data, error } = await supabase
      .from("meal_nutrient_map")
      .select("meal_id, meals(name, calories, protein, carbs, fat, ingredients)")
      .eq("nutrient", nutrient);
    
    if (error) throw error;
    
    return (data || [])
      .map(item => item.meals)
      .filter(Boolean);
  } catch (e) {
    console.log("Get meals by nutrient error:", e.message);
    return [];
  }
}

// Get user's meal history
export async function getMealHistory(userId, date) {
  try {
    const { data, error } = await supabase
      .from("user_meal_history")
      .select("*, meals(name, calories, protein, carbs, fat)")
      .eq("user_id", userId)
      .eq("date", date);
    
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.log("Get meal history error:", e.message);
    return [];
  }
}

// Save a meal to the database (from Claude or user)
export async function saveMealToDatabase(mealData) {
  try {
    const { data, error } = await supabase
      .from("meals")
      .insert([{
        name: mealData.name,
        description: mealData.description,
        calories: mealData.calories,
        protein: mealData.protein,
        carbs: mealData.carbs,
        fat: mealData.fat,
        suggested_for: mealData.suggested_for || [],
        key_nutrients: mealData.key_nutrients || [],
        ingredients: mealData.ingredients || [],
        created_by: mealData.created_by || "claude",
        prep_time_minutes: mealData.prep_time_minutes,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    console.log("Save meal error:", e.message);
    throw e;
  }
}

// Save meal nutrients
export async function saveMealNutrients(mealId, nutrients) {
  try {
    if (!nutrients || nutrients.length === 0) return { success: true };
    
    const { error } = await supabase
      .from("meal_nutrient_map")
      .insert(
        nutrients.map(nutrient => ({
          meal_id: mealId,
          nutrient: nutrient.name,
          amount_mg: nutrient.amount_mg,
        }))
      );
    
    if (error) throw error;
    return { success: true };
  } catch (e) {
    console.log("Save meal nutrients error:", e.message);
    throw e;
  }
}

// Record meal outcome (did it help?)
export async function recordMealOutcome(userId, mealId, condition, outcome, feedback) {
  try {
    const { data, error } = await supabase
      .from("meal_outcomes")
      .insert([{
        user_id: userId,
        meal_id: mealId,
        health_condition: condition,
        date_eaten: feedback.date_eaten,
        date_reported: new Date().toISOString().split("T")[0],
        outcome: outcome, // "helped", "neutral", "worsened"
        severity_before: feedback.severity_before,
        severity_after: feedback.severity_after,
        notes: feedback.notes,
      }])
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    console.log("Record meal outcome error:", e.message);
    throw e;
  }
}

// Save user meal preference
export async function saveMealPreference(userId, mealId, liked, reason) {
  try {
    const existing = await supabase
      .from("user_meal_preferences")
      .select("id")
      .eq("user_id", userId)
      .eq("meal_id", mealId)
      .single();
    
    let result;
    if (existing.data) {
      // Update
      const { data, error } = await supabase
        .from("user_meal_preferences")
        .update({
          liked,
          reason,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("meal_id", mealId)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Insert
      const { data, error } = await supabase
        .from("user_meal_preferences")
        .insert([{
          user_id: userId,
          meal_id: mealId,
          liked,
          reason,
          created_at: new Date().toISOString(),
        }])
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    }
    
    return { success: true, data: result };
  } catch (e) {
    console.log("Save meal preference error:", e.message);
    throw e;
  }
}

// Get most helpful meals for user's conditions
export async function getMostHelpfulMeals(userId, limit = 5) {
  try {
    const { data, error } = await supabase
      .from("meal_outcomes")
      .select("meal_id, meals(name, calories, protein, carbs, fat), health_condition")
      .eq("user_id", userId)
      .eq("outcome", "helped")
      .order("created_at", { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    return (data || [])
      .map(item => ({
        ...item.meals,
        helped_with: item.health_condition,
      }))
      .filter(Boolean);
  } catch (e) {
    console.log("Get most helpful meals error:", e.message);
    return [];
  }
}

// Get meals user likes
export async function getUserLikedMeals(userId) {
  try {
    const { data, error } = await supabase
      .from("user_meal_preferences")
      .select("meals(name, calories, protein, carbs, fat)")
      .eq("user_id", userId)
      .eq("liked", true);
    
    if (error) throw error;
    
    return (data || [])
      .map(item => item.meals)
      .filter(Boolean);
  } catch (e) {
    console.log("Get user liked meals error:", e.message);
    return [];
  }
}

// ============================================
// EXISTING: CALCULATIONS & CONTEXT
// ============================================

export async function getWeeklyNutrientProgress(userId, nutrient) {
  try {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());

    const { data, error } = await supabase
      .from("user_nutrient_tracking")
      .select("*")
      .eq("user_id", userId)
      .eq("nutrient", nutrient)
      .gte("date", weekStart.toISOString().split("T")[0])
      .lte("date", today.toISOString().split("T")[0]);

    if (error) throw error;

    const consumed = (data || []).filter(d => d.amount_consumed > 0).length;
    return {
      nutrient,
      consumed,
      dates: data || [],
    };
  } catch (e) {
    console.log("Get weekly progress error:", e.message);
    return { nutrient, consumed: 0, dates: [] };
  }
}

export async function calculateNutrientStatus(userId) {
  try {
    const preferences = await getNutrientPreferences(userId);
    const statuses = [];

    for (const pref of preferences) {
      const progress = await getWeeklyNutrientProgress(userId, pref.nutrient);
      statuses.push({
        nutrient: pref.nutrient,
        target: pref.frequency_per_week,
        completed: progress.consumed,
        remaining: Math.max(0, pref.frequency_per_week - progress.consumed),
        isOnTrack: progress.consumed >= pref.frequency_per_week,
      });
    }

    return statuses;
  } catch (e) {
    console.log("Calculate nutrient status error:", e.message);
    return [];
  }
}

export async function buildUserContext(userId) {
  try {
    const [profile, goals, conditions, nutrients, dietary] = await Promise.all([
      getUserProfile(userId),
      getUserGoals(userId),
      getHealthConditions(userId),
      getNutrientPreferences(userId),
      getDietaryPreferences(userId),
    ]);

    return {
      profile,
      goals,
      conditions,
      nutrients,
      dietary,
    };
  } catch (e) {
    console.log("Build user context error:", e.message);
    return {};
  }
}

export function formatContextForClaude(context) {
  const { profile, goals, conditions, nutrients, dietary } = context;

  let contextStr = "";

  if (profile) {
    contextStr += `\nUSER PROFILE:\n`;
    contextStr += `- Name: ${profile.name || "N/A"}\n`;
    contextStr += `- Current weight: ${profile.current_weight} ${profile.weight_unit}\n`;
    contextStr += `- Target weight: ${profile.target_weight} ${profile.weight_unit}\n`;
    contextStr += `- Age: ${profile.age}\n`;
    contextStr += `- Activity level: ${profile.activity_level}\n`;
  }

  if (goals) {
    contextStr += `\nNUTRITION GOALS:\n`;
    contextStr += `- Daily calories: ${goals.calories}\n`;
    contextStr += `- Protein: ${goals.protein}g\n`;
    contextStr += `- Carbs: ${goals.carbs}g\n`;
    contextStr += `- Fat: ${goals.fat}g\n`;
  }

  if (conditions && conditions.length > 0) {
    contextStr += `\nHEALTH CONDITIONS:\n`;
    conditions.forEach(c => {
      contextStr += `- ${c.condition}${c.reason ? ` (${c.reason})` : ""}\n`;
    });
  }

  if (nutrients && nutrients.length > 0) {
    contextStr += `\nNUTRIENT PREFERENCES:\n`;
    nutrients.forEach(n => {
      contextStr += `- ${n.nutrient}: ${n.frequency_per_week}x/week${n.reason ? ` (${n.reason})` : ""}\n`;
    });
  }

  if (dietary) {
    contextStr += `\nDIETARY PREFERENCES:\n`;
    if (dietary.dietary_style && dietary.dietary_style.length > 0) {
      contextStr += `- Dietary style: ${dietary.dietary_style.join(", ")}\n`;
    }
    if (dietary.allergens && dietary.allergens.length > 0) {
      contextStr += `- Allergies: ${dietary.allergens.join(", ")}\n`;
    }
    if (dietary.intolerances && dietary.intolerances.length > 0) {
      contextStr += `- Intolerances: ${dietary.intolerances.join(", ")}\n`;
    }
    if (dietary.restrictions && dietary.restrictions.length > 0) {
      contextStr += `- Restrictions: ${dietary.restrictions.join(", ")}\n`;
    }
  }

  return contextStr;
}

export function getUserIdFromRequest(req) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    return token || null;
  } catch (e) {
    console.log("Extract user ID error:", e.message);
    return null;
  }
}

export default {
  // User context
  getHealthConditions,
  getNutrientPreferences,
  getDietaryPreferences,
  getUserProfile,
  getUserGoals,
  buildUserContext,
  formatContextForClaude,
  
  // Meal database (NEW)
  getMealsMatchingConstraints,
  getMealsForCondition,
  getMealsByNutrient,
  getMealHistory,
  saveMealToDatabase,
  saveMealNutrients,
  recordMealOutcome,
  saveMealPreference,
  getMostHelpfulMeals,
  getUserLikedMeals,
  
  // Calculations
  getWeeklyNutrientProgress,
  calculateNutrientStatus,
  getUserIdFromRequest,
};