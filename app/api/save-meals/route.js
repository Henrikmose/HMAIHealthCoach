import { createClient } from "@supabase/supabase-js";

// Uses SERVICE ROLE KEY — bypasses RLS, always works
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    if (meal.source) row.source = String(meal.source);

    // Add table-specific fields
    if (table === "actual_meals") {
      // Read servings from meal object — supports multi-serving label scans
      row.servings = Number(meal.servings) > 0 ? Number(meal.servings) : 1;
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
    return Response.json({ success: true, data });

  } catch (error) {
    console.error("Save meal route error:", error);
    return Response.json(
      { success: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}