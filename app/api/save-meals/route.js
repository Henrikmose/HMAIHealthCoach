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
    if (!meal || meal.source !== 'ai_estimate') return;        // only AI-found foods
    const grams = Number(meal.grams) || 0;
    if (grams <= 0) return;                                      // need a weight to normalize per-100g
    // Derive a clean food name (strip the trailing ", <qty> <unit>" the save row appends)
    let name = String(meal.canonicalName || meal.food || '').trim();
    name = name.replace(/,\s*[\d.]+\s*\w+\s*$/, '').trim();      // "Big Mac, 1 serving" -> "Big Mac"
    if (name.length < 2) return;
    const cal = Number(meal.calories) || 0;
    const pro = Number(meal.protein)  || 0;
    const carb= Number(meal.carbs)    || 0;
    const fat = Number(meal.fat)      || 0;
    if (cal <= 0) return;
    const f = 100 / grams;                                       // scale factor to per-100g (CODE math)
    const per100 = {
      calories_per_100g: Math.round(cal  * f * 10) / 10,
      protein_per_100g:  Math.round(pro  * f * 10) / 10,
      carbs_per_100g:    Math.round(carb * f * 10) / 10,
      fat_per_100g:      Math.round(fat  * f * 10) / 10,
    };
    // Don't duplicate: only insert if no existing foods row with this name (case-insensitive).
    const { data: existing } = await supabase
      .from('foods').select('id').ilike('name', name).limit(1);
    if (existing && existing.length > 0) return;                 // already cached
    await supabase.from('foods').insert([{
      name,
      category: 'ai_estimate',
      source: 'ai_estimate',
      ...per100,
    }]);
    console.log('🧠 write-back cached AI food into foods:', name, per100);
  } catch (e) {
    console.log('write-back skipped (non-fatal):', e.message);   // never block the save
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