// Input Validators
// Sanitize and validate data before saving to database

// ============================================
// STRING VALIDATORS
// ============================================

export function isValidString(str, minLength = 1, maxLength = 255) {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength;
}

export function sanitizeString(str) {
  return String(str).trim();
}

// ============================================
// HEALTH CONDITION VALIDATORS
// ============================================

export function validateHealthCondition(condition) {
  const errors = [];

  if (!isValidString(condition, 2, 100)) {
    errors.push("Condition must be 2-100 characters");
  }

  // Check if condition is reasonable (not random text)
  const validConditions = [
    "high blood pressure",
    "high cholesterol",
    "inflammation",
    "diabetes",
    "arthritis",
    "joint pain",
    "muscle soreness",
    "low energy",
    "digestive issues",
    "bloating",
    "acne",
    "skin issues",
    "anxiety",
    "sleep issues",
    "recovery",
    "tennis elbow",
    "carpal tunnel",
  ];

  const conditionLower = condition.toLowerCase();
  if (!validConditions.some(v => conditionLower.includes(v.split(" ")[0]))) {
    // Allow any condition, but log it
    console.log("Unusual condition:", condition);
  }

  return { isValid: errors.length === 0, errors };
}

export function validateHealthConditionInput(body) {
  const errors = [];

  if (!body.user_id || !isValidString(body.user_id)) {
    errors.push("Invalid user ID");
  }

  const condValidation = validateHealthCondition(body.condition);
  if (!condValidation.isValid) {
    errors.push(...condValidation.errors);
  }

  if (body.reason && !isValidString(body.reason, 0, 255)) {
    errors.push("Reason must be under 255 characters");
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// NUTRIENT PREFERENCE VALIDATORS
// ============================================

export function validateNutrientName(nutrient) {
  const errors = [];

  if (!isValidString(nutrient, 2, 50)) {
    errors.push("Nutrient must be 2-50 characters");
  }

  return { isValid: errors.length === 0, errors };
}

export function validateFrequency(freq) {
  if (!Number.isInteger(freq) || freq < 1 || freq > 7) {
    return { isValid: false, errors: ["Frequency must be 1-7 times per week"] };
  }
  return { isValid: true, errors: [] };
}

export function validateNutrientPreferenceInput(body) {
  const errors = [];

  if (!body.user_id || !isValidString(body.user_id)) {
    errors.push("Invalid user ID");
  }

  const nutrientValidation = validateNutrientName(body.nutrient);
  if (!nutrientValidation.isValid) {
    errors.push(...nutrientValidation.errors);
  }

  const freqValidation = validateFrequency(body.frequency_per_week);
  if (!freqValidation.isValid) {
    errors.push(...freqValidation.errors);
  }

  if (body.reason && !isValidString(body.reason, 0, 255)) {
    errors.push("Reason must be under 255 characters");
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// DIETARY PREFERENCES VALIDATORS
// ============================================

export function validateArrayOfStrings(arr, maxItems = 20, maxLength = 50) {
  if (!Array.isArray(arr)) return false;
  if (arr.length > maxItems) return false;
  return arr.every(item => isValidString(item, 1, maxLength));
}

export function validateDietaryPreferencesInput(body) {
  const errors = [];

  if (!body.user_id || !isValidString(body.user_id)) {
    errors.push("Invalid user ID");
  }

  if (body.dietary_style !== undefined) {
    if (!validateArrayOfStrings(body.dietary_style, 5)) {
      errors.push("Dietary style must be array of valid strings (max 5)");
    }
  }

  if (body.allergens !== undefined) {
    if (!validateArrayOfStrings(body.allergens, 10)) {
      errors.push("Allergens must be array of valid strings (max 10)");
    }
  }

  if (body.intolerances !== undefined) {
    if (!validateArrayOfStrings(body.intolerances, 10)) {
      errors.push("Intolerances must be array of valid strings (max 10)");
    }
  }

  if (body.restrictions !== undefined) {
    if (!validateArrayOfStrings(body.restrictions, 10)) {
      errors.push("Restrictions must be array of valid strings (max 10)");
    }
  }

  if (body.loves !== undefined) {
    if (!validateArrayOfStrings(body.loves, 10)) {
      errors.push("Loves must be array of valid strings (max 10)");
    }
  }

  if (body.dislikes !== undefined) {
    if (!validateArrayOfStrings(body.dislikes, 10)) {
      errors.push("Dislikes must be array of valid strings (max 10)");
    }
  }

  if (body.reasons !== undefined) {
    if (typeof body.reasons !== "object" || body.reasons === null) {
      errors.push("Reasons must be an object");
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// MEAL SUGGESTION VALIDATORS
// ============================================

export function validateMealSuggestionInput(body) {
  const errors = [];

  if (!body.user_id || !isValidString(body.user_id)) {
    errors.push("Invalid user ID");
  }

  if (body.calories_remaining !== undefined) {
    if (typeof body.calories_remaining !== "number" || body.calories_remaining < 0) {
      errors.push("Calories remaining must be a positive number");
    }
  }

  if (body.meal_type !== undefined) {
    const validTypes = ["breakfast", "lunch", "dinner", "snack"];
    if (!validTypes.includes(body.meal_type)) {
      errors.push("Meal type must be breakfast, lunch, dinner, or snack");
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// GENERAL VALIDATORS
// ============================================

export function validateUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export default {
  isValidString,
  sanitizeString,
  validateHealthCondition,
  validateHealthConditionInput,
  validateNutrientName,
  validateFrequency,
  validateNutrientPreferenceInput,
  validateArrayOfStrings,
  validateDietaryPreferencesInput,
  validateMealSuggestionInput,
  validateUUID,
  validateEmail,
};