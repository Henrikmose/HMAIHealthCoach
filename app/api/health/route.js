// /app/api/health/route.js
// Health conditions endpoint: GET all, POST add

//import {
 // getHealthConditions,
  //addHealthCondition,
//} from "../lib/apiHelpers";

import {
  validateHealthConditionInput,
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

    console.log(`[GET] Health conditions for user: ${userId}`);

    const conditions = await getHealthConditions(userId);

    return successResponse(conditions, "Health conditions retrieved");
  } catch (error) {
    return handleError(error, "GET /api/health");
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    console.log(`[POST] Add health condition for user: ${body.user_id}`);

    // Validate input
    const validation = validateHealthConditionInput(body);
    if (!validation.isValid) {
      return validationError(validation.errors);
    }

    // Add condition
    const result = await addHealthCondition(
      body.user_id,
      body.condition,
      body.reason || null
    );

    return createdResponse(result.data, "Health condition added");
  } catch (error) {
    return handleError(error, "POST /api/health");
  }
}