// /app/api/meals/route.js
// Meal suggestions - DATABASE FIRST, OpenAI when needed

import OpenAI from "openai";
import {
  getMealsMatchingConstraints,
  getMealsForCondition,
  getMealsByNutrient,
  getMostHelpfulMeals,
  buildUserContext,
  calculateNutrientStatus,
  saveMealToDatabase,
  saveMealNutrients,
} from "../lib/apiHelpers";

import {
  validateMealSuggestionInput,
} from "../lib/validators";

import {
  successResponse,
  validationError,
  handleError,
  authError,
} from "../lib/errors";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request) {
  try {
    const body = await request.json();

    console.log(
      `[MEALS] Suggest for user: ${body.user_id}`,
      `| Remaining: ${body.calories_remaining} cal`
    );

    // Validate input
    const validation = validateMealSuggestionInput(body);
    if (!validation.isValid) {
      return validationError(validation.errors);
    }

    if (!body.user_id) {
      return authError("user_id required");
    }

    // ========================================
    // STEP 1: Build user context
    // ========================================
    const context = await buildUserContext(body.user_id);
    const nutrientStatus = await calculateNutrientStatus(body.user_id);

    // ========================================
    // STEP 2: TRY DATABASE FIRST ✅
    // ========================================
    console.log("[MEALS] Checking database for matches...");

    let dbSuggestions = [];

    // Priority 1: Meals that help user's conditions
    if (context.conditions && context.conditions.length > 0) {
      const conditionMeals = await getMealsForCondition(
        body.user_id,
        context.conditions[0].condition
      );
      if (conditionMeals.length > 0) {
        dbSuggestions = conditionMeals.slice(0, 3);
        console.log(`[MEALS] Found ${dbSuggestions.length} helpful meals for ${context.conditions[0].condition}`);
      }
    }

    // Priority 2: Meals with missing nutrients
    if (dbSuggestions.length === 0 && nutrientStatus.length > 0) {
      const deficient = nutrientStatus.find(n => !n.isOnTrack);
      if (deficient) {
        const nutrientMeals = await getMealsByNutrient(deficient.nutrient);
        if (nutrientMeals.length > 0) {
          dbSuggestions = nutrientMeals.slice(0, 3);
          console.log(`[MEALS] Found ${dbSuggestions.length} meals with ${deficient.nutrient}`);
        }
      }
    }

    // Priority 3: Most helpful meals overall
    if (dbSuggestions.length === 0) {
      const helpfulMeals = await getMostHelpfulMeals(body.user_id, 5);
      if (helpfulMeals.length > 0) {
        dbSuggestions = helpfulMeals;
        console.log(`[MEALS] Using most helpful meals (${dbSuggestions.length})`);
      }
    }

    // Priority 4: Constraint-based matching
    if (dbSuggestions.length === 0) {
      dbSuggestions = await getMealsMatchingConstraints(body.user_id, {
        caloriesMax: body.calories_remaining,
        caloriesMin: Math.max(100, body.calories_remaining - 200),
        mealType: body.meal_type,
      });
      console.log(`[MEALS] Found ${dbSuggestions.length} constraint-matched meals`);
    }

    // ========================================
    // STEP 3: If database has suggestions, return them!
    // ========================================
    if (dbSuggestions.length > 0) {
      console.log(`[MEALS] ✅ Returning ${dbSuggestions.length} meals from database`);
      
      return successResponse(
        {
          suggestions: dbSuggestions.map((meal, idx) => ({
            id: meal.id,
            rank: idx + 1,
            title: meal.name,
            calories: meal.calories,
            protein: meal.protein,
            carbs: meal.carbs,
            fat: meal.fat,
            ingredients: meal.ingredients,
            suggested_for: meal.suggested_for,
            key_nutrients: meal.key_nutrients,
            source: "database",
          })),
          source: "database",
          message: `Found ${dbSuggestions.length} suggestions in database`,
        },
        "Meal suggestions from database"
      );
    }

    // ========================================
    // STEP 4: Database is empty - use OpenAI
    // ========================================
    console.log("[MEALS] ⚠️ Database empty, calling OpenAI...");

    const claudeSuggestions = await getOpenAIMealSuggestions(
      body.user_id,
      context,
      body.calories_remaining,
      body.meal_type
    );

    console.log(`[MEALS] OpenAI returned ${claudeSuggestions.length} suggestions`);

    // Save OpenAI's suggestions to database for next time
    for (const meal of claudeSuggestions) {
      try {
        const savedMeal = await saveMealToDatabase({
          name: meal.title,
          description: meal.description,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          ingredients: meal.ingredients,
          suggested_for: meal.suggested_for,
          key_nutrients: meal.key_nutrients,
          created_by: "openai",
        });

        console.log(`[MEALS] Saved meal: ${meal.title}`);

        // Save nutrients if provided
        if (meal.key_nutrients && meal.key_nutrients.length > 0) {
          await saveMealNutrients(
            savedMeal.data.id,
            meal.key_nutrients.map(n => ({ name: n }))
          );
        }
      } catch (e) {
        console.log("Error saving OpenAI meal:", e.message);
      }
    }

    return successResponse(
      {
        suggestions: claudeSuggestions,
        source: "openai",
        message: `OpenAI generated ${claudeSuggestions.length} suggestions (saved to database for next time)`,
      },
      "Meal suggestions from OpenAI"
    );
  } catch (error) {
    console.error("[MEALS ERROR]", error);
    return handleError(error, "POST /api/meals");
  }
}

// ============================================
// OPENAI MEAL SUGGESTION LOGIC
// ============================================

async function getOpenAIMealSuggestions(userId, context, caloriesRemaining, mealType) {
  try {
    const systemPrompt = buildSystemPrompt(context);
    
    const userPrompt = `Suggest 3 meals with ${caloriesRemaining} calories remaining for ${mealType || "any meal"}.

For EACH meal, provide JSON on separate lines:
{"title": "meal name", "description": "brief description", "calories": 400, "protein": 20, "carbs": 50, "fat": 15, "ingredients": ["ingredient1", "ingredient2"], "suggested_for": ["condition"], "key_nutrients": ["nutrient1"]}`;

    console.log("[OPENAI] Calling API...");

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7,
    });

    const text = completion.choices[0].message.content;
    
    console.log("[OPENAI] Raw response:", text);

    // Parse JSON responses from OpenAI (one per line)
    const lines = text.split("\n").filter(line => line.trim().startsWith("{"));
    const suggestions = [];

    for (const line of lines) {
      try {
        const meal = JSON.parse(line);
        // Validate required fields
        if (meal.title && meal.calories && meal.protein !== undefined) {
          suggestions.push(meal);
        }
      } catch (e) {
        console.log("[OPENAI] Failed to parse line:", line, e.message);
      }
    }

    console.log(`[OPENAI] Successfully parsed ${suggestions.length} meals`);
    
    return suggestions;
  } catch (error) {
    console.error("[OPENAI ERROR]", error.message);
    return [];
  }
}

function buildSystemPrompt(context) {
  const { profile, goals, conditions, nutrients, dietary } = context;

  let prompt = `You are CURA - a nutrition meal suggester.
Your job: Suggest 3 practical meals based on user data.

CONSTRAINTS:`;

  if (dietary) {
    if (dietary.allergens?.length > 0) {
      prompt += `\n- NEVER suggest: ${dietary.allergens.join(", ")} (allergies)`;
    }
    if (dietary.intolerances?.length > 0) {
      prompt += `\n- AVOID: ${dietary.intolerances.join(", ")} (intolerances)`;
    }
    if (dietary.restrictions?.length > 0) {
      prompt += `\n- NEVER: ${dietary.restrictions.join(", ")} (restrictions)`;
    }
    if (dietary.dietary_style?.length > 0) {
      prompt += `\n- MUST BE: ${dietary.dietary_style.join(", ")}`;
    }
  }

  if (goals) {
    prompt += `\n\nMACRO TARGETS:`;
    prompt += `\n- Protein: ${goals.protein}g/day`;
    prompt += `\n- Carbs: ${goals.carbs}g/day`;
    prompt += `\n- Fat: ${goals.fat}g/day`;
  }

  if (conditions && conditions.length > 0) {
    prompt += `\n\nHEALTH CONDITIONS (prioritize foods that help):`;
    conditions.forEach(c => {
      prompt += `\n- ${c.condition}`;
    });
  }

  if (nutrients && nutrients.length > 0) {
    prompt += `\n\nNUTRIENTS TO INCLUDE:`;
    nutrients.forEach(n => {
      prompt += `\n- ${n.nutrient}`;
    });
  }

  prompt += `\n\nOUTPUT: Return ONLY JSON on separate lines. No other text.`;

  return prompt;
}