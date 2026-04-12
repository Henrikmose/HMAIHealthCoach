"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getLocalDate } from "../../lib/mealPlanParser";

const DEFAULT_GOAL = { calories: 0, protein: 0, carbs: 0, fat: 0 };

function sumMeals(meals) {
  return meals.reduce(
    (totals, meal) => {
      const servings = Number(meal.servings || 1);
      totals.calories += Number(meal.calories || 0) * servings;
      totals.protein += Number(meal.protein || 0) * servings;
      totals.carbs += Number(meal.carbs || 0) * servings;
      totals.fat += Number(meal.fat || 0) * servings;
      return totals;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function formatMealType(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function groupMealsByType(meals) {
  const order = ["breakfast", "lunch", "dinner", "snack", "dessert"];
  const grouped = {};

  for (const meal of meals) {
    const key = meal.meal_type || "other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(meal);
  }

  return Object.entries(grouped).sort((a, b) => {
    const aIndex = order.indexOf(a[0]);
    const bIndex = order.indexOf(b[0]);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });
}

function TotalsCard({ title, totals }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: "14px",
        padding: "16px",
        backgroundColor: "#ffffff",
      }}
    >
      <div style={{ fontWeight: "700", fontSize: "18px", marginBottom: "10px" }}>
        {title}
      </div>
      <div>Calories: {Math.round(totals.calories)}</div>
      <div>Protein: {Math.round(totals.protein)}g</div>
      <div>Carbs: {Math.round(totals.carbs)}g</div>
      <div>Fat: {Math.round(totals.fat)}g</div>
    </div>
  );
}

function PlannedMealCard({ meal, onAteThis, onRemove, moving, removing }) {
  const isAdded = meal.status === "added" || meal.status === "eaten";

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: "12px",
        padding: "12px",
        backgroundColor: isAdded ? "#ecfdf5" : "#eff6ff",
        marginBottom: "10px",
        opacity: isAdded ? 0.8 : 1,
      }}
    >
      <div style={{ marginBottom: "6px" }}>{meal.food}</div>

      <div style={{ fontSize: "14px", color: "#374151", marginBottom: "10px" }}>
        Calories: {meal.calories} | Protein: {meal.protein}g | Carbs: {meal.carbs}g | Fat: {meal.fat}g | Servings: {meal.servings}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={() => onAteThis(meal)}
          disabled={moving || isAdded}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: moving || isAdded ? "#9ca3af" : "#111827",
            color: "#fff",
            cursor: moving || isAdded ? "default" : "pointer",
            opacity: moving || isAdded ? 0.7 : 1,
          }}
        >
          {isAdded ? "Added to actual" : moving ? "Saving..." : "I ate this"}
        </button>

        <button
          onClick={() => onRemove(meal.id)}
          disabled={removing}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: removing ? "#9ca3af" : "#b91c1c",
            color: "#fff",
            cursor: removing ? "default" : "pointer",
            opacity: removing ? 0.7 : 1,
          }}
        >
          {removing ? "Removing..." : "Remove"}
        </button>
      </div>
    </div>
  );
}

function ActualMealCard({
  meal,
  onRemove,
  removing,
  servingDraft,
  setServingDraft,
  onSaveServings,
  updatingServings,
}) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: "12px",
        padding: "12px",
        backgroundColor: "#f9fafb",
        marginBottom: "10px",
      }}
    >
      <div style={{ marginBottom: "6px" }}>{meal.food}</div>

      <div style={{ fontSize: "14px", color: "#374151", marginBottom: "8px" }}>
        Base meal: {meal.calories} cal | {meal.protein}g protein | {meal.carbs}g carbs | {meal.fat}g fat
      </div>

      <div style={{ fontSize: "14px", color: "#111827", marginBottom: "10px", fontWeight: "600" }}>
        Current servings: {meal.servings}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <input
          type="number"
          step="any"
          min="0"
          value={servingDraft}
          onChange={(e) => setServingDraft(e.target.value)}
          style={{
            width: "140px",
            padding: "8px",
            borderRadius: "8px",
            border: "1px solid #ccc",
          }}
        />

        <button
          onClick={() => onSaveServings(meal)}
          disabled={updatingServings}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: updatingServings ? "#9ca3af" : "#111827",
            color: "#fff",
            opacity: updatingServings ? 0.7 : 1,
          }}
        >
          {updatingServings ? "Saving..." : "Save servings"}
        </button>

        <button
          onClick={() => onRemove(meal.id)}
          disabled={removing}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: removing ? "#9ca3af" : "#b91c1c",
            color: "#fff",
            opacity: removing ? 0.7 : 1,
          }}
        >
          {removing ? "Removing..." : "Remove"}
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
        Servings eaten (1 = planned portion)
      </div>
    </div>
  );
}

function getShiftedDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);

  const nextYear = d.getFullYear();
  const nextMonth = String(d.getMonth() + 1).padStart(2, "0");
  const nextDay = String(d.getDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export default function DashboardPage() {
  const [plannedMeals, setPlannedMeals] = useState([]);
  const [actualMeals, setActualMeals] = useState([]);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [loading, setLoading] = useState(true);
  const [movingMealId, setMovingMealId] = useState(null);
  const [removingMealId, setRemovingMealId] = useState(null);
  const [removingPlannedMealId, setRemovingPlannedMealId] = useState(null);
  const [updatingMealId, setUpdatingMealId] = useState(null);
  const [servingDrafts, setServingDrafts] = useState({});
  const [selectedDate, setSelectedDate] = useState(getLocalDate());

  async function loadDashboard() {
    setLoading(true);

    // Get the signed-in user from localStorage (set by sign-in page)
    const storedUserId = localStorage.getItem("userId") || "de52999b-7269-43bd-b205-c42dc381df5d";

    // Fetch goals from database
    const { data: goalsData, error: goalsError } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", storedUserId)
      .single();

    if (goalsError) {
      console.log("GOALS LOAD ERROR:", goalsError);
    } else if (goalsData) {
      setGoal({
        calories: goalsData.calories,
        protein: goalsData.protein,
        carbs: goalsData.carbs,
        fat: goalsData.fat,
      });
    }

    // Fetch planned meals
    const { data: plannedData, error: plannedError } = await supabase
      .from("planned_meals")
      .select("*")
      .eq("user_id", storedUserId)
      .eq("date", selectedDate)
      .order("created_at", { ascending: true });

    // Fetch actual meals
    const { data: actualData, error: actualError } = await supabase
      .from("actual_meals")
      .select("*")
      .eq("user_id", storedUserId)
      .eq("date", selectedDate)
      .order("created_at", { ascending: true });

    if (plannedError) console.log("PLANNED LOAD ERROR:", plannedError);
    if (actualError) console.log("ACTUAL LOAD ERROR:", actualError);

    setPlannedMeals(plannedData || []);
    setActualMeals(actualData || []);

    const drafts = {};
    for (const meal of actualData || []) {
      drafts[meal.id] = String(meal.servings || 1);
    }
    setServingDrafts(drafts);

    setLoading(false);
  }

  useEffect(() => {
    loadDashboard();
  }, [selectedDate]);

  const visiblePlannedMeals = useMemo(() => plannedMeals, [plannedMeals]);
  const plannedTotals = useMemo(() => sumMeals(visiblePlannedMeals), [visiblePlannedMeals]);
  const actualTotals = useMemo(() => sumMeals(actualMeals), [actualMeals]);

  const remainingTotals = useMemo(
    () => ({
      calories: goal.calories - actualTotals.calories,
      protein: goal.protein - actualTotals.protein,
      carbs: goal.carbs - actualTotals.carbs,
      fat: goal.fat - actualTotals.fat,
    }),
    [actualTotals, goal]
  );

  const groupedPlannedMeals = useMemo(
    () => groupMealsByType(visiblePlannedMeals),
    [visiblePlannedMeals]
  );

  const groupedActualMeals = useMemo(() => groupMealsByType(actualMeals), [actualMeals]);

  const handleAteThis = async (meal) => {
    try {
      setMovingMealId(meal.id);

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "eat_meal", mealId: meal.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.log("EAT MEAL ERROR:", data);
        alert(data.error || "Could not add meal to actual.");
        return;
      }

      await loadDashboard();
    } catch (error) {
      console.error("ATE THIS ERROR:", error);
      alert("Could not save actual meal.");
    } finally {
      setMovingMealId(null);
    }
  };

  const handleRemoveActual = async (id) => {
    try {
      setRemovingMealId(id);

      const { error } = await supabase.from("actual_meals").delete().eq("id", id);

      if (error) {
        console.log("ACTUAL DELETE ERROR:", error);
        alert("Could not remove meal. Check console.");
        return;
      }

      await loadDashboard();
    } catch (error) {
      console.error("REMOVE ERROR:", error);
      alert("Could not remove meal.");
    } finally {
      setRemovingMealId(null);
    }
  };

  const handleRemovePlanned = async (id) => {
    try {
      setRemovingPlannedMealId(id);

      const { error } = await supabase.from("planned_meals").delete().eq("id", id);

      if (error) {
        console.log("PLANNED DELETE ERROR:", error);
        alert("Could not remove planned meal. Check console.");
        return;
      }

      await loadDashboard();
    } catch (error) {
      console.error("REMOVE PLANNED ERROR:", error);
      alert("Could not remove planned meal.");
    } finally {
      setRemovingPlannedMealId(null);
    }
  };

  const handleSaveServings = async (meal) => {
    try {
      setUpdatingMealId(meal.id);

      const rawValue = servingDrafts[meal.id];
      const parsed = parseFloat(rawValue);

      if (!parsed || parsed <= 0) {
        alert("Servings must be greater than 0");
        return;
      }

      const { error } = await supabase
        .from("actual_meals")
        .update({ servings: parsed })
        .eq("id", meal.id);

      if (error) {
        console.log("ACTUAL UPDATE ERROR:", error);
        alert("Could not save servings. Check console.");
        return;
      }

      await loadDashboard();
    } catch (error) {
      console.error("SAVE SERVINGS ERROR:", error);
      alert("Could not save servings.");
    } finally {
      setUpdatingMealId(null);
    }
  };

  const goPreviousDay = () => setSelectedDate((prev) => getShiftedDate(prev, -1));
  const goNextDay = () => setSelectedDate((prev) => getShiftedDate(prev, 1));
  const goToday = () => setSelectedDate(getLocalDate());

  return (
    <main
      style={{
        maxWidth: "1100px",
        margin: "0 auto",
        padding: "20px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "32px", marginBottom: "6px" }}>Dashboard</h1>

      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <button
          onClick={goPreviousDay}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: "#111827",
            color: "#fff",
          }}
        >
          ← Yesterday
        </button>

        <button
          onClick={goToday}
          style={{
            border: "1px solid #ccc",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: "#fff",
          }}
        >
          Today
        </button>

        <button
          onClick={goNextDay}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "8px 12px",
            backgroundColor: "#111827",
            color: "#fff",
          }}
        >
          Tomorrow →
        </button>

        <div style={{ color: "#6b7280", fontWeight: "600" }}>
          Viewing: {selectedDate}
        </div>
      </div>

      {loading ? (
        <div>Loading dashboard...</div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "14px",
              marginBottom: "24px",
            }}
          >
            <TotalsCard title="Goal" totals={goal} />
            <TotalsCard title="Planned totals" totals={plannedTotals} />
            <TotalsCard title="Actual totals" totals={actualTotals} />
            <TotalsCard title="Remaining to goal" totals={remainingTotals} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "20px",
            }}
          >
            <section>
              <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>Planned meals</h2>

              {groupedPlannedMeals.length === 0 ? (
                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "12px",
                    padding: "14px",
                    backgroundColor: "#fff",
                  }}
                >
                  No planned meals for this date.
                </div>
              ) : (
                groupedPlannedMeals.map(([mealType, meals]) => (
                  <div key={mealType} style={{ marginBottom: "18px" }}>
                    <h3 style={{ fontSize: "18px", marginBottom: "10px" }}>
                      {formatMealType(mealType)}
                    </h3>

                    {meals.map((meal) => (
                      <PlannedMealCard
                        key={meal.id}
                        meal={meal}
                        onAteThis={handleAteThis}
                        onRemove={handleRemovePlanned}
                        moving={movingMealId === meal.id}
                        removing={removingPlannedMealId === meal.id}
                      />
                    ))}
                  </div>
                ))
              )}
            </section>

            <section>
              <h2 style={{ fontSize: "22px", marginBottom: "12px" }}>Actual meals</h2>

              {groupedActualMeals.length === 0 ? (
                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "12px",
                    padding: "14px",
                    backgroundColor: "#fff",
                  }}
                >
                  No actual meals logged for this date.
                </div>
              ) : (
                groupedActualMeals.map(([mealType, meals]) => (
                  <div key={mealType} style={{ marginBottom: "18px" }}>
                    <h3 style={{ fontSize: "18px", marginBottom: "10px" }}>
                      {formatMealType(mealType)}
                    </h3>

                    {meals.map((meal) => (
                      <ActualMealCard
                        key={meal.id}
                        meal={meal}
                        onRemove={handleRemoveActual}
                        removing={removingMealId === meal.id}
                        servingDraft={servingDrafts[meal.id] ?? String(meal.servings || 1)}
                        setServingDraft={(value) =>
                          setServingDrafts((prev) => ({ ...prev, [meal.id]: value }))
                        }
                        onSaveServings={handleSaveServings}
                        updatingServings={updatingMealId === meal.id}
                      />
                    ))}
                  </div>
                ))
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}