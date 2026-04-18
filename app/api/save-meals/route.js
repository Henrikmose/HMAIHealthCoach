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
      console.error("Missing required fields:", { table, meal, userId });
      return Response.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    if (table !== "actual_meals" && table !== "planned_meals") {
      return Response.json({ success: false, error: "Invalid table" }, { status: 400 });
    }

    console.log(`=== SAVE MEAL === table: ${table}`);
    console.log("UserId:", userId);
    console.log("Meal:", meal);

    const row = {
      user_id:   userId,
      date:      meal.date,
      meal_type: meal.mealType || "snack",
      food:      meal.food,
      calories:  meal.calories,
      protein:   meal.protein,
      carbs:     meal.carbs,
      fat:       meal.fat,
    };

    // Add table-specific fields
    if (table === "actual_meals") {
      row.servings = 1;
    } else {
      row.suggested_time = null;
      row.status = "planned";
    }

    const { data, error } = await supabase.from(table).insert([row]).select();

    if (error) {
      console.error(`❌ Supabase insert error (${table}):`, error);
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }

    console.log(`✅ Saved to ${table}:`, data);
    return Response.json({ success: true, data });

  } catch (error) {
    console.error("Save meal route error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
