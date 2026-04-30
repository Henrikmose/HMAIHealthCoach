// /app/api/dietary/route.js
// Dietary preferences: GET, POST/PATCH update

//import {
 // getDietaryPreferences,
//  updateDietaryPreferences,
//} from "../lib/apiHelpers";

import {
  validateDietaryPreferencesInput,
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

    if (!userId) {
      return authError("user_id required");
    }

    console.log(`[GET] Dietary preferences for user: ${userId}`);

    const preferences = await getDietaryPreferences(userId);

    if (!preferences) {
      return successResponse(
        {
          user_id: userId,
          dietary_style: [],
          allergens: [],
          intolerances: [],
          restrictions: [],
          loves: [],
          dislikes: [],
          reasons: {},
        },
        "Dietary preferences (empty)"
      );
    }

    return successResponse(preferences, "Dietary preferences retrieved");
  } catch (error) {
    return handleError(error, "GET /api/dietary");
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    console.log(`[POST] Update dietary preferences for user: ${body.user_id}`);

    // Validate input
    const validation = validateDietaryPreferencesInput(body);
    if (!validation.isValid) {
      return validationError(validation.errors);
    }

    // Build update object (only include provided fields)
    const updateData = {};
    if (body.dietary_style !== undefined) updateData.dietary_style = body.dietary_style;
    if (body.allergens !== undefined) updateData.allergens = body.allergens;
    if (body.intolerances !== undefined) updateData.intolerances = body.intolerances;
    if (body.restrictions !== undefined) updateData.restrictions = body.restrictions;
    if (body.loves !== undefined) updateData.loves = body.loves;
    if (body.dislikes !== undefined) updateData.dislikes = body.dislikes;
    if (body.reasons !== undefined) updateData.reasons = body.reasons;

    // Update or create
    const result = await updateDietaryPreferences(body.user_id, updateData);

    return createdResponse(result.data, "Dietary preferences updated");
  } catch (error) {
    return handleError(error, "POST /api/dietary");
  }
}

// PATCH is same as POST for this endpoint
export async function PATCH(request) {
  return POST(request);
}