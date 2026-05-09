"use client";

import { useEffect, useMemo, useState } from "react";

const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

const DAILY_GOAL = {
  calories: 2200,
  protein: 180,
  carbs: 220,
  fat: 70,
};

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

function getLocalDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value) {
  return Math.round(toNumber(value));
}

function macroTotals(meals) {
  return meals.reduce(
    (totals, meal) => {
      const servings = toNumber(meal.servings, 1);

      totals.calories += toNumber(meal.calories) * servings;
      totals.protein += toNumber(meal.protein) * servings;
      totals.carbs += toNumber(meal.carbs) * servings;
      totals.fat += toNumber(meal.fat) * servings;

      return totals;
    },
    {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    }
  );
}

function remainingMacros(totals, goals) {
  return {
    calories: goals.calories - totals.calories,
    protein: goals.protein - totals.protein,
    carbs: goals.carbs - totals.carbs,
    fat: goals.fat - totals.fat,
  };
}

function macroStatus(value, goal) {
  if (goal <= 0) return "neutral";

  const percent = value / goal;

  if (percent < 0.75) return "under";
  if (percent <= 1.1) return "good";
  return "over";
}

function ProgressRow({ label, value, goal, unit = "g" }) {
  const percent = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const status = macroStatus(value, goal);

  const barColor =
    status === "good"
      ? "bg-green-600"
      : status === "over"
      ? "bg-red-500"
      : "bg-blue-600";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-600">
          {round(value)} / {goal} {unit}
        </span>
      </div>

      <div className="h-3 w-full rounded-full bg-gray-200">
        <div
          className={`h-3 rounded-full ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, subtext }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      {subtext ? <p className="mt-1 text-sm text-gray-500">{subtext}</p> : null}
    </div>
  );
}

export default function HomePage() {
  const [date, setDate] = useState(getLocalDate());
  const [meals, setMeals] = useState([]);

  const [mealName, setMealName] = useState("");
  const [mealType, setMealType] = useState("Breakfast");
  const [servings, setServings] = useState("1");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachAnswer, setCoachAnswer] = useState("");
  const [loadingCoach, setLoadingCoach] = useState(false);

  const [error, setError] = useState("");

  const totals = useMemo(() => macroTotals(meals), [meals]);
  const remaining = useMemo(
    () => remainingMacros(totals, DAILY_GOAL),
    [totals]
  );

  useEffect(() => {
    const saved = localStorage.getItem(`meals:${TEST_USER_ID}:${date}`);

    if (saved) {
      try {
        setMeals(JSON.parse(saved));
      } catch {
        setMeals([]);
      }
    } else {
      setMeals([]);
    }
  }, [date]);

  useEffect(() => {
    localStorage.setItem(`meals:${TEST_USER_ID}:${date}`, JSON.stringify(meals));
  }, [date, meals]);

  function clearMealForm() {
    setMealName("");
    setServings("1");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
  }

  function addMeal(event) {
    event.preventDefault();
    setError("");

    if (!mealName.trim()) {
      setError("Add a food or meal name first.");
      return;
    }

    const meal = {
      id: crypto.randomUUID(),
      name: mealName.trim(),
      mealType,
      servings: toNumber(servings, 1),
      calories: toNumber(calories),
      protein: toNumber(protein),
      carbs: toNumber(carbs),
      fat: toNumber(fat),
      createdAt: new Date().toISOString(),
    };

    setMeals((current) => [meal, ...current]);
    clearMealForm();
  }

  function removeMeal(id) {
    setMeals((current) => current.filter((meal) => meal.id !== id));
  }

  function clearDay() {
    const confirmed = window.confirm("Clear all meals for this day?");
    if (!confirmed) return;
    setMeals([]);
    setCoachAnswer("");
  }

  async function askCoach() {
    setError("");
    setCoachAnswer("");

    if (!coachQuestion.trim()) {
      setError("Ask the coach a question first.");
      return;
    }

    setLoadingCoach(true);

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: TEST_USER_ID,
          date,
          question: coachQuestion,
          meals,
          totals,
          remaining,
          goals: DAILY_GOAL,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Coach request failed.");
      }

      setCoachAnswer(data.answer || "");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoadingCoach(false);
    }
  }

  const groupedMeals = MEAL_TYPES.map((type) => ({
    type,
    meals: meals.filter((meal) => meal.mealType === type),
  }));

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold">AI Health Coach</h1>
              <p className="mt-1 text-gray-600">
                Track food, hit your macros, and get practical nutrition coaching.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-2"
              />

              <button
                onClick={clearDay}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold"
              >
                Clear Day
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Calories Left"
            value={round(remaining.calories)}
            subtext={`${round(totals.calories)} eaten`}
          />
          <StatCard
            label="Protein Left"
            value={`${round(remaining.protein)}g`}
            subtext={`${round(totals.protein)}g eaten`}
          />
          <StatCard
            label="Carbs Left"
            value={`${round(remaining.carbs)}g`}
            subtext={`${round(totals.carbs)}g eaten`}
          />
          <StatCard
            label="Fat Left"
            value={`${round(remaining.fat)}g`}
            subtext={`${round(totals.fat)}g eaten`}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">Today&apos;s Progress</h2>

            <div className="mt-5 space-y-4">
              <ProgressRow
                label="Calories"
                value={totals.calories}
                goal={DAILY_GOAL.calories}
                unit="cal"
              />
              <ProgressRow
                label="Protein"
                value={totals.protein}
                goal={DAILY_GOAL.protein}
              />
              <ProgressRow
                label="Carbs"
                value={totals.carbs}
                goal={DAILY_GOAL.carbs}
              />
              <ProgressRow
                label="Fat"
                value={totals.fat}
                goal={DAILY_GOAL.fat}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">AI Coach</h2>
            <p className="mt-1 text-sm text-gray-600">
              Ask what to eat next, whether a meal fits, or how to adjust your day.
            </p>

            <textarea
              value={coachQuestion}
              onChange={(event) => setCoachQuestion(event.target.value)}
              placeholder="Example: What should I eat for dinner based on what I have left?"
              className="mt-4 min-h-28 w-full rounded-xl border border-gray-300 p-3"
            />

            <button
              onClick={askCoach}
              disabled={loadingCoach}
              className="mt-3 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {loadingCoach ? "Thinking..." : "Ask Coach"}
            </button>

            {coachAnswer ? (
              <div className="mt-4 whitespace-pre-wrap rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">
                {coachAnswer}
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">Add Food</h2>

          <form onSubmit={addMeal} className="mt-4 grid gap-3 md:grid-cols-8">
            <input
              value={mealName}
              onChange={(event) => setMealName(event.target.value)}
              placeholder="Food or meal"
              className="rounded-xl border border-gray-300 px-3 py-2 md:col-span-2"
            />

            <select
              value={mealType}
              onChange={(event) => setMealType(event.target.value)}
              className="rounded-xl border border-gray-300 px-3 py-2"
            >
              {MEAL_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>

            <input
              value={servings}
              onChange={(event) => setServings(event.target.value)}
              placeholder="Servings"
              inputMode="decimal"
              className="rounded-xl border border-gray-300 px-3 py-2"
            />

            <input
              value={calories}
              onChange={(event) => setCalories(event.target.value)}
              placeholder="Calories"
              inputMode="decimal"
              className="rounded-xl border border-gray-300 px-3 py-2"
            />

            <input
              value={protein}
              onChange={(event) => setProtein(event.target.value)}
              placeholder="Protein"
              inputMode="decimal"
              className="rounded-xl border border-gray-300 px-3 py-2"
            />

            <input
              value={carbs}
              onChange={(event) => setCarbs(event.target.value)}
              placeholder="Carbs"
              inputMode="decimal"
              className="rounded-xl border border-gray-300 px-3 py-2"
            />

            <input
              value={fat}
              onChange={(event) => setFat(event.target.value)}
              placeholder="Fat"
              inputMode="decimal"
              className="rounded-xl border border-gray-300 px-3 py-2"
            />

            <button
              type="submit"
              className="rounded-xl bg-gray-900 px-4 py-2 font-semibold text-white md:col-span-8"
            >
              Add Food
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">Food Log</h2>

          {meals.length === 0 ? (
            <p className="mt-4 text-gray-600">No food logged for this day yet.</p>
          ) : (
            <div className="mt-5 space-y-6">
              {groupedMeals.map((group) => {
                if (group.meals.length === 0) return null;

                return (
                  <div key={group.type}>
                    <h3 className="mb-2 font-semibold text-gray-800">
                      {group.type}
                    </h3>

                    <div className="divide-y divide-gray-200 rounded-xl border border-gray-200">
                      {group.meals.map((meal) => {
                        const s = toNumber(meal.servings, 1);

                        return (
                          <div
                            key={meal.id}
                            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <div className="font-semibold">{meal.name}</div>
                              <div className="text-sm text-gray-600">
                                {s} serving{s === 1 ? "" : "s"} ·{" "}
                                {round(meal.calories * s)} cal · P{" "}
                                {round(meal.protein * s)}g · C{" "}
                                {round(meal.carbs * s)}g · F{" "}
                                {round(meal.fat * s)}g
                              </div>
                            </div>

                            <button
                              onClick={() => removeMeal(meal.id)}
                              className="rounded-lg border border-gray-300 px-3 py-1 text-sm"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}