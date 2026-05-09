export const runtime = "nodejs";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value) {
  return Math.round(toNumber(value));
}

function buildMacroSummary(totals, goals) {
  return {
    consumed: {
      calories: round(totals.calories),
      protein: round(totals.protein),
      carbs: round(totals.carbs),
      fat: round(totals.fat),
    },
    goals: {
      calories: round(goals.calories),
      protein: round(goals.protein),
      carbs: round(goals.carbs),
      fat: round(goals.fat),
    },
    remaining: {
      calories: round(goals.calories - totals.calories),
      protein: round(goals.protein - totals.protein),
      carbs: round(goals.carbs - totals.carbs),
      fat: round(goals.fat - totals.fat),
    },
  };
}

function buildMealSummary(meals) {
  if (!Array.isArray(meals) || meals.length === 0) {
    return "No meals logged yet.";
  }

  return meals
    .map((meal) => {
      const servings = toNumber(meal.servings, 1);

      return `- ${meal.mealType || "Meal"}: ${meal.name || "Unknown food"} | ${servings} serving(s) | ${round(
        meal.calories * servings
      )} cal | ${round(meal.protein * servings)}g protein | ${round(
        meal.carbs * servings
      )}g carbs | ${round(meal.fat * servings)}g fat`;
    })
    .join("\n");
}

export async function POST(request) {
  try {
    const body = await request.json();

    const {
      userId,
      date,
      question,
      meals = [],
      totals = {},
      goals = {
        calories: 2200,
        protein: 180,
        carbs: 220,
        fat: 70,
      },
    } = body;

    if (!question || typeof question !== "string") {
      return Response.json(
        { error: "Missing coach question." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return Response.json(
        {
          error:
            "OPENAI_API_KEY is missing. Add it to .env.local and to Vercel environment variables.",
        },
        { status: 500 }
      );
    }

    const macroSummary = buildMacroSummary(totals, goals);
    const mealSummary = buildMealSummary(meals);

    const systemPrompt = `
You are an AI health and nutrition coach inside a food tracking app.

Your role:
- Help the user make practical food choices based on their logged meals and macro targets.
- Be direct, supportive, and realistic.
- Do not shame the user.
- Do not invent exact nutrition facts for foods unless they are provided.
- If giving meal suggestions, explain how they fit the user's remaining calories/macros.
- If the user asks about medical conditions, give general nutrition guidance and remind them to follow their clinician's advice.
- Keep answers concise unless the user asks for more detail.
- Prioritize protein, calories, fiber, hydration, and consistency.
`;

    const userPrompt = `
User ID: ${userId || "unknown"}
Date: ${date || "unknown"}

Macro summary:
${JSON.stringify(macroSummary, null, 2)}

Meals logged:
${mealSummary}

User question:
${question}
`;

    const openAiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        }),
      }
    );

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return Response.json(
        {
          error:
            data?.error?.message ||
            "OpenAI request failed. Check API key, billing, model, and environment variables.",
        },
        { status: openAiResponse.status }
      );
    }

    const answer =
      data?.choices?.[0]?.message?.content ||
      "I could not generate a coach response.";

    return Response.json({ answer });
  } catch (error) {
    return Response.json(
      {
        error: error.message || "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}