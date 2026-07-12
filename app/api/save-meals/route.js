import { createClient } from "@supabase/supabase-js";

// Uses SERVICE ROLE KEY — bypasses RLS, always works
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── WRITE-BACK (Track 2, Option A) ─────────────────────────────────────────────
// When an AI-estimated food is locked in (saved), cache it into the shared `foods`
// table so the NEXT lookup is a free DB hit and the number is consistent forever.
// CODE does all math here (per-100g back-calculation). The AI never calculates.
// Only fires for source='ai_estimate'. Label scans use a separate path (source='label').
async function writeBackAiFood(supabase, meal) {
  try {
    // Cache both AI-found foods AND scanned labels into the shared foods table (per-serving).
    // Labels are higher-trust (read off the package); AI estimates are the fallback.
    const wbSource = meal && meal.source ? String(meal.source) : '';
    if (wbSource !== 'ai_estimate' && wbSource !== 'label') return;
    // Derive a clean food name (strip the trailing ", <qty> <unit>" the save row appends)
    let name = String(meal.canonicalName || meal.food || '').trim();
    // [v101] also strips the new gram-annotated suffix: "Greek Yogurt, 1 serving (170 g)" -> "Greek Yogurt"
    name = name.replace(/,\s*[\d.]+\s*[a-z ]+(\([\d.]+\s*g\))?\s*$/i, '').trim();
    if (name.length < 2) return;

    // SERVING-BASED storage: these are restaurant/branded foods eaten as whole items, not weighed.
    // We store PER-SERVING macros (in the per_100g columns, flagged by source) and the resolver
    // multiplies by serving count (1 / 0.5 / 2). CODE does all math; AI only supplied the numbers.
    const servings = Number(meal.servings) > 0 ? Number(meal.servings) : 1;
    const perServing = {
      calories: (Number(meal.calories) || 0) / servings,
      protein:  (Number(meal.protein)  || 0) / servings,
      carbs:    (Number(meal.carbs)    || 0) / servings,
      fat:      (Number(meal.fat)      || 0) / servings,
    };
    if (perServing.calories <= 0) return;   // no sane macros = unconfident read -> save nothing (re-shoot handled in chat)

    // Don't duplicate: skip if a foods row with this name already exists (case-insensitive).
    const { data: existing } = await supabase
      .from('foods').select('id').ilike('name', name).limit(1);
    if (existing && existing.length > 0) return;

    // [v100] grams-per-serving is the weight→serving conversion key. Without it,
    // a later "8 oz" of this cached food is read as 8 servings.
    const gramsPerServing = Number(meal.grams) > 0 ? Math.round(Number(meal.grams) / servings) : null;
    await supabase.from('foods').insert([{
      name,
      category: wbSource === 'label' ? 'branded' : 'restaurant',
      source: wbSource,
      // per-serving macros stored in the per_100g columns; resolver treats source=ai_estimate as per-serving
      calories_per_100g: Math.round(perServing.calories * 10) / 10,
      protein_per_100g:  Math.round(perServing.protein  * 10) / 10,
      carbs_per_100g:    Math.round(perServing.carbs    * 10) / 10,
      fat_per_100g:      Math.round(perServing.fat      * 10) / 10,
      grams_per_serving: gramsPerServing,
    }]);
    console.log(`🧠 write-back cached ${wbSource} food (per-serving):`, name, perServing);
  } catch (e) {
    console.log('write-back skipped (non-fatal):', e.message);
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { table, meal, userId } = body;

    // Validate inputs
    if (!table || !meal || !userId) {
      console.error("Missing required fields:", { table, meal: !!meal, userId });
      return Response.json(
        { success: false, error: "Missing required fields (table, meal, or userId)" },
        { status: 400 }
      );
    }

    if (table !== "actual_meals" && table !== "planned_meals") {
      return Response.json({ success: false, error: "Invalid table" }, { status: 400 });
    }

    if (!meal.date) {
      console.error("Missing date in meal object:", meal);
      return Response.json(
        { success: false, error: "Missing date field in meal object" },
        { status: 400 }
      );
    }

    if (!meal.food || meal.calories == null) {
      console.error("Missing food or calories in meal object:", meal);
      return Response.json(
        { success: false, error: "Missing food name or calories" },
        { status: 400 }
      );
    }

    console.log(`=== SAVE MEAL === table: ${table}`);
    console.log("UserId:", userId);
    console.log("Meal:", meal);

    const row = {
      user_id:   userId,
      date:      meal.date,
      meal_type: meal.mealType || "snack",
      food:      meal.food,
      calories:  Math.round(Number(meal.calories) || 0),
      protein:   Math.round(Number(meal.protein) || 0),
      carbs:     Math.round(Number(meal.carbs) || 0),
      fat:       Math.round(Number(meal.fat) || 0),
      // Track 2 — provenance of these numbers: "usda_db" | "ai_estimate" | "label" | "custom".
      // planned_meals has no source column, so only attach it for actual_meals (below).
    };

    // Add table-specific fields
    if (table === "actual_meals") {
      // Read servings from meal object — supports multi-serving label scans
      row.servings = Number(meal.servings) > 0 ? Number(meal.servings) : 1;
      // source column exists ONLY on actual_meals — attach it here, never on planned_meals.
      if (meal.source) row.source = String(meal.source);
    } else {
      row.suggested_time = null;
      row.status = "planned";
      // [v96] MEAL GROUPING — rows saved from one coach card share a group id so the
      // dashboard can promote the whole meal to eaten in one tap. uuid column: only
      // attach when the client sent one; legacy saves stay null (ungrouped).
      if (meal.mealGroupId) row.meal_group_id = String(meal.mealGroupId);
    }

    const { data, error } = await supabase.from(table).insert([row]).select();

    if (error) {
      console.error(`❌ Supabase insert error (${table}):`, error);
      // Return the specific Postgres error so the frontend can surface it
      return Response.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Saved to ${table}:`, data);

    // Option A write-back: cache AI-estimated foods into the shared foods table (non-blocking).
    if (table === "actual_meals") { await writeBackAiFood(supabase, meal); }

    return Response.json({ success: true, data });

  } catch (error) {
    console.error("Save meal route error:", error);
    return Response.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}