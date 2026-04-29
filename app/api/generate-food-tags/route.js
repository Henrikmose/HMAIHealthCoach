// /app/api/rule-engine/generate-food-tags/route.js
// Auto-tag USDA foods using deterministic rules
// Fixed version: proper quotes, upsert, batching, deduping

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    console.log("[RULE ENGINE] Starting auto-tag process...");

    // Batch foods - limit 1000 per run to avoid timeout
    const { data: foods, error: foodError } = await supabase
      .from("foods")
      .select("id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category")
      .limit(1000);

    if (foodError) {
      return Response.json({ error: foodError.message }, { status: 500 });
    }

    console.log(`[RULE ENGINE] Found ${foods.length} foods to tag`);

    // Get all tags for reference
    const { data: tags } = await supabase.from("tags").select("id, tag_key");
    const tagMap = {};
    tags.forEach(t => {
      tagMap[t.tag_key] = t.id;
    });

    let totalTagsAdded = 0;
    let totalErrors = 0;

    // Process each food
    for (const food of foods) {
      try {
        const generatedTags = applyRules(food);

        // Save each tag to food_tags using upsert
        for (const tagData of generatedTags) {
          const tagId = tagMap[tagData.tag_key];
          if (!tagId) {
            console.log(`[RULE ENGINE] Tag not found: ${tagData.tag_key}`);
            continue;
          }

          const { error: upsertError } = await supabase
            .from("food_tags")
            .upsert(
              {
                food_id: food.id,
                tag_id: tagId,
                confidence: tagData.confidence,
                source: "rule_based",
                reason: tagData.reason,
              },
              { onConflict: "food_id,tag_id" }
            );

          if (!upsertError) {
            totalTagsAdded++;
          } else {
            console.log(`[RULE ENGINE] Upsert error for ${food.name}:`, upsertError.message);
            totalErrors++;
          }
        }
      } catch (e) {
        console.log(`[RULE ENGINE] Error processing ${food.name}:`, e.message);
        totalErrors++;
      }
    }

    console.log(`[RULE ENGINE] Complete! Tags added: ${totalTagsAdded}, Errors: ${totalErrors}`);

    return Response.json({
      success: true,
      message: `Auto-tagged ${foods.length} foods`,
      totalTagsAdded,
      totalErrors,
    });
  } catch (error) {
    console.error("[RULE ENGINE ERROR]", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ============================================
// RULE ENGINE: Apply all rules to a food
// ============================================

function applyRules(food) {
  const tags = [];

  // Convert null values to 0 for safe calculations
  const cal = food.calories_per_100g || 0;
  const protein = food.protein_per_100g || 0;
  const carbs = food.carbs_per_100g || 0;
  const fat = food.fat_per_100g || 0;
  const category = (food.category || "").toLowerCase();

  // Note: fiber, sodium, potassium not available in current USDA table
  // These rules are disabled until data is added to foods table

  // ────────────────────────────────────────
  // MACRO PROFILE RULES
  // ────────────────────────────────────────

  if (protein >= 20) {
    tags.push({
      tag_key: "high_protein",
      confidence: 0.98,
      reason: `${protein.toFixed(1)}g protein per 100g`,
    });
  } else if (protein >= 10 && protein < 20) {
    tags.push({
      tag_key: "moderate_protein",
      confidence: 0.95,
      reason: `${protein.toFixed(1)}g protein per 100g`,
    });
  }

  if (carbs >= 40) {
    tags.push({
      tag_key: "high_carb",
      confidence: 0.98,
      reason: `${carbs.toFixed(1)}g carbs per 100g`,
    });
  } else if (carbs < 10) {
    tags.push({
      tag_key: "low_carb",
      confidence: 0.98,
      reason: `${carbs.toFixed(1)}g carbs per 100g`,
    });
  }

  if (fat >= 15) {
    tags.push({
      tag_key: "high_fat",
      confidence: 0.98,
      reason: `${fat.toFixed(1)}g fat per 100g`,
    });
  } else if (fat < 3) {
    tags.push({
      tag_key: "low_fat",
      confidence: 0.98,
      reason: `${fat.toFixed(1)}g fat per 100g`,
    });
  }

  // Fiber data not available in current USDA table
  // if (fiber >= 3) {
  //   tags.push({
  //     tag_key: "high_fiber",
  //     confidence: 0.98,
  //     reason: `${fiber.toFixed(1)}g fiber per 100g`,
  //   });
  // }

  if (cal < 100) {
    tags.push({
      tag_key: "low_calorie_density",
      confidence: 0.98,
      reason: `${cal} calories per 100g`,
    });
  }

  // ────────────────────────────────────────
  // MICRONUTRIENT RULES
  // ────────────────────────────────────────

  // Micronutrient data not available in current USDA table
  // if (potassium >= 300) {
  //   tags.push({
  //     tag_key: "high_potassium",
  //     confidence: 0.95,
  //     reason: `${potassium.toFixed(0)}mg potassium per 100g`,
  //   });
  // }
  //
  // if (sodium >= 400) {
  //   tags.push({
  //     tag_key: "high_sodium",
  //     confidence: 0.98,
  //     reason: `${sodium.toFixed(0)}mg sodium per 100g`,
  //   });
  // }

  // ────────────────────────────────────────
  // DIET COMPATIBILITY RULES (CAREFUL: category-based)
  // ────────────────────────────────────────

  // Vegan: be conservative - lower confidence for complex foods
  if (
    category.includes("vegetable") ||
    category.includes("fruit") ||
    category.includes("legume") ||
    category.includes("grain") ||
    category.includes("nut") ||
    category.includes("seed")
  ) {
    // Lower confidence (0.75) because USDA categories can be misleading
    // Example: "vegetable soup" might have beef stock
    tags.push({
      tag_key: "vegan",
      confidence: 0.75,
      reason: "Plant-based category (verify for processed foods)",
    });
  }

  // Vegetarian (includes dairy, eggs) - also lower confidence
  if (
    category.includes("vegetable") ||
    category.includes("fruit") ||
    category.includes("legume") ||
    category.includes("grain") ||
    category.includes("dairy") ||
    category.includes("egg")
  ) {
    tags.push({
      tag_key: "vegetarian",
      confidence: 0.75,
      reason: "No meat/fish in category (verify for processed foods)",
    });
  }

  // Gluten-free check (natural foods only)
  if (
    category.includes("fruit") ||
    category.includes("vegetable") ||
    category.includes("meat") ||
    category.includes("fish")
  ) {
    tags.push({
      tag_key: "gluten_free",
      confidence: 0.90,
      reason: "Naturally gluten-free category",
    });
  }

  // ────────────────────────────────────────
  // MEAL ROLE RULES (category-based)
  // ────────────────────────────────────────

  if (category.includes("vegetable")) {
    tags.push({
      tag_key: "vegetable",
      confidence: 0.99,
      reason: "Vegetable category",
    });
  }

  if (category.includes("fruit")) {
    tags.push({
      tag_key: "fruit",
      confidence: 0.99,
      reason: "Fruit category",
    });
  }

  if (
    category.includes("meat") ||
    category.includes("poultry") ||
    category.includes("beef") ||
    category.includes("pork")
  ) {
    tags.push({
      tag_key: "meat",
      confidence: 0.99,
      reason: "Meat/poultry category",
    });
    tags.push({
      tag_key: "protein_source",
      confidence: 0.95,
      reason: `${protein.toFixed(1)}g protein per 100g`,
    });
  }

  if (
    category.includes("fish") ||
    category.includes("seafood") ||
    category.includes("shellfish")
  ) {
    tags.push({
      tag_key: "seafood",
      confidence: 0.99,
      reason: "Fish/seafood category",
    });
    tags.push({
      tag_key: "protein_source",
      confidence: 0.95,
      reason: `${protein.toFixed(1)}g protein per 100g`,
    });
  }

  if (category.includes("grain") || category.includes("cereal")) {
    tags.push({
      tag_key: "grain",
      confidence: 0.99,
      reason: "Grain category",
    });
    tags.push({
      tag_key: "carb_source",
      confidence: 0.95,
      reason: `${carbs.toFixed(1)}g carbs per 100g`,
    });
  }

  if (category.includes("legume") || category.includes("bean")) {
    tags.push({
      tag_key: "legume",
      confidence: 0.99,
      reason: "Legume category",
    });
  }

  if (category.includes("dairy")) {
    tags.push({
      tag_key: "dairy",
      confidence: 0.99,
      reason: "Dairy category",
    });
  }

  if (category.includes("oil") || category.includes("fat")) {
    tags.push({
      tag_key: "fat_source",
      confidence: 0.98,
      reason: `${fat.toFixed(1)}g fat per 100g`,
    });
  }

  // ────────────────────────────────────────
  // PERFORMANCE RULES (based on macros)
  // ────────────────────────────────────────

  // Fast carbs: high carb, low fiber (fiber data not available)
  // if (carbs >= 40 && fiber < 2) {
  //   tags.push({
  //     tag_key: "fast_carb",
  //     confidence: 0.85,
  //     reason: `High carbs (${carbs.toFixed(1)}g), low fiber (${fiber.toFixed(1)}g)`,
  //   });
  //   tags.push({
  //     tag_key: "pre_workout",
  //     confidence: 0.80,
  //     reason: "Quick-acting carbohydrates for energy",
  //   });
  // }

  // Slow carbs: high carb + high fiber (fiber data not available)
  // if (carbs >= 30 && fiber >= 3) {
  //   tags.push({
  //     tag_key: "slow_carb",
  //     confidence: 0.85,
  //     reason: `High carbs (${carbs.toFixed(1)}g) + high fiber (${fiber.toFixed(1)}g)`,
  //   });
  //   tags.push({
  //     tag_key: "energy_support",
  //     confidence: 0.85,
  //     reason: "Sustained energy from complex carbs",
  //   });
  // }

  // Post-workout: high protein
  if (protein >= 20) {
    tags.push({
      tag_key: "post_workout",
      confidence: 0.85,
      reason: `High protein (${protein.toFixed(1)}g) for muscle recovery`,
    });
  }

  // Endurance: balanced carbs + protein
  if (carbs >= 30 && protein >= 10) {
    tags.push({
      tag_key: "endurance_fuel",
      confidence: 0.80,
      reason: `Carbs (${carbs.toFixed(1)}g) + protein (${protein.toFixed(1)}g) for sustained activity`,
    });
  }

  // ────────────────────────────────────────
  // HEALTH OUTCOME RULES (BASIC - improve later with AI)
  // ────────────────────────────────────────

  // Health outcome rules disabled - need fiber/sodium/potassium data
  // Blood pressure support: low sodium + high potassium
  // if (sodium < 100 && potassium >= 300) {
  //   tags.push({
  //     tag_key: "blood_pressure_support",
  //     confidence: 0.85,
  //     reason: `Low sodium (${sodium.toFixed(0)}mg), high potassium (${potassium.toFixed(0)}mg)`,
  //   });
  // }

  // Heart health: low fat, high fiber (simplified - salmon/nuts handled by AI later)
  // if (fat < 3 && fiber >= 3) {
  //   tags.push({
  //     tag_key: "heart_health",
  //     confidence: 0.80,
  //     reason: "Low fat, high fiber for cardiovascular support",
  //   });
  // }

  // Gut health: high fiber
  // if (fiber >= 4) {
  //   tags.push({
  //     tag_key: "gut_health",
  //     confidence: 0.85,
  //     reason: `${fiber.toFixed(1)}g fiber supports digestive health`,
  //   });
  // }

  // Bone health: plant-based with minerals (simplified)
  // if (category.includes("vegetable") && potassium >= 300) {
  //   tags.push({
  //     tag_key: "bone_health",
  //     confidence: 0.70,
  //     reason: "Plant-based minerals support bone health",
  //   });
  // }

  // ────────────────────────────────────────
  // DEDUPLICATE TAGS (same tag_key only once)
  // ────────────────────────────────────────

  const uniqueTags = Array.from(
    new Map(tags.map(tag => [tag.tag_key, tag])).values()
  );

  return uniqueTags;
}

export default {
  POST,
};