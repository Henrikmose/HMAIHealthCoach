// /app/api/nutrient/route.js
// Nutrient preferences: GET all, POST add, GET progress

//import {
 // getNutrientPreferences,
 // addNutrientPreference,
 // calculateNutrientStatus,
//} from "../lib/apiHelpers";

import {
  validateNutrientPreferenceInput,
} from "../lib/validators";

import {
  successResponse,
  validationError,
  createdResponse,
  handleError,
  authError,
} from "../lib/errors";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const includeProgress = searchParams.get("include_progress") === "true";

    if (!userId) {
      return authError("user_id required");
    }

    console.log(`[GET] Nutrient preferences for user: ${userId}`);

    const preferences = await getNutrientPreferences(userId);

    // Optionally include weekly progress for each nutrient
    let response = preferences;
    if (includeProgress) {
      const progress = await calculateNutrientStatus(userId);
      response = {
        preferences,
        progress,
      };
    }

    return successResponse(response, "Nutrient preferences retrieved");
  } catch (error) {
    return handleError(error, "GET /api/nutrient");
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    console.log(
      `[POST] Add nutrient preference for user: ${body.user_id}`,
      body.nutrient
    );

    // Validate input
    const validation = validateNutrientPreferenceInput(body);
    if (!validation.isValid) {
      return validationError(validation.errors);
    }

    // Add preference
    const result = await addNutrientPreference(
      body.user_id,
      body.nutrient,
      body.frequency_per_week,
      body.reason || null
    );

    return createdResponse(result.data, "Nutrient preference added");
  } catch (error) {
    return handleError(error, "POST /api/nutrient");
  }
}