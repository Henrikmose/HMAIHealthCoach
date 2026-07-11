import { createClient } from "@supabase/supabase-js";

// ═══ [v83] FACTS & GOALS SAVE ENDPOINT ══════════════════════════════════════
// The single write path for the intelligence layer. Chat confirmation cards call
// this today; the interview-style profile UI will call the SAME endpoint later —
// two front doors, one store, one writer.
//
// Routing (live schema, confirmed 2026-07-09):
//   dietary_style / allergen / intolerance / restriction / love / dislike
//     -> user_dietary_preferences (one row per user; ARRAY columns; reasons jsonb)
//   health_condition -> user_health_conditions (row per condition, is_active)
//   nutrient         -> user_nutrient_preferences (row per nutrient, frequency, is_active)
//   lifestyle / constraint -> user_facts (NEW table — the one place the existing
//     schema had no home: array elements can't carry an expiry date)
//   goal -> goals (+ user_profiles.target_weight / goal_type)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ARRAY_COLUMN_FOR_KIND = {
  dietary_style: "dietary_style",
  allergen: "allergens",
  intolerance: "intolerances",
  restriction: "restrictions",
  love: "loves",
  dislike: "dislikes",
};

function cleanValue(v) {
  return (v || "").toString().trim().toLowerCase().slice(0, 120);
}

async function saveDietaryArrayFact(userId, fact, source) {
  const col = ARRAY_COLUMN_FOR_KIND[fact.kind];
  const value = cleanValue(fact.value);
  if (!value) throw new Error("Empty fact value");

  const { data: rows } = await supabase
    .from("user_dietary_preferences")
    .select("*")
    .eq("user_id", userId)
    .limit(1);

  const meta = { reason: fact.reason || "", source, added_at: new Date().toISOString() };

  if (!rows || rows.length === 0) {
    const insert = {
      user_id: userId,
      dietary_style: [], allergens: [], intolerances: [],
      restrictions: [], loves: [], dislikes: [],
      reasons: { [value]: meta },
      is_active: true,
    };
    insert[col] = [value];
    const { error } = await supabase.from("user_dietary_preferences").insert([insert]);
    if (error) throw new Error(error.message);
    return { stored: value, column: col, action: "created" };
  }

  const row = rows[0];
  const existing = Array.isArray(row[col]) ? row[col] : [];
  if (existing.some((x) => cleanValue(x) === value)) {
    return { stored: value, column: col, action: "already_present" };
  }
  const reasons = (row.reasons && typeof row.reasons === "object") ? row.reasons : {};
  reasons[value] = meta;
  const { error } = await supabase
    .from("user_dietary_preferences")
    .update({ [col]: [...existing, value], reasons, is_active: true, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  return { stored: value, column: col, action: "added" };
}

async function saveHealthCondition(userId, fact) {
  const value = cleanValue(fact.value);
  const { data: existing } = await supabase
    .from("user_health_conditions")
    .select("id, is_active")
    .eq("user_id", userId)
    .ilike("condition", value)
    .limit(1);
  if (existing && existing[0]) {
    if (!existing[0].is_active) {
      const { error } = await supabase
        .from("user_health_conditions")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", existing[0].id);
      if (error) throw new Error(error.message);
    }
    return { stored: value, action: "reactivated_or_present" };
  }
  const { error } = await supabase.from("user_health_conditions").insert([{
    user_id: userId, condition: value, reason: fact.reason || "", is_active: true,
  }]);
  if (error) throw new Error(error.message);
  return { stored: value, action: "created" };
}

async function saveNutrientPreference(userId, fact) {
  const value = cleanValue(fact.value);
  const freq = Number(fact.frequency_per_week) > 0 ? Math.min(21, Math.round(Number(fact.frequency_per_week))) : 3;
  const { data: existing } = await supabase
    .from("user_nutrient_preferences")
    .select("id")
    .eq("user_id", userId)
    .ilike("nutrient", value)
    .limit(1);
  if (existing && existing[0]) {
    const { error } = await supabase
      .from("user_nutrient_preferences")
      .update({ frequency_per_week: freq, reason: fact.reason || "", is_active: true, updated_at: new Date().toISOString() })
      .eq("id", existing[0].id);
    if (error) throw new Error(error.message);
    return { stored: value, action: "updated" };
  }
  const { error } = await supabase.from("user_nutrient_preferences").insert([{
    user_id: userId, nutrient: value, frequency_per_week: freq, reason: fact.reason || "", is_active: true,
  }]);
  if (error) throw new Error(error.message);
  return { stored: value, action: "created" };
}

async function saveUserFact(userId, fact, source) {
  const value = (fact.value || "").toString().trim().slice(0, 200);
  const { data: existing } = await supabase
    .from("user_facts")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", fact.kind)
    .ilike("value", value)
    .eq("is_active", true)
    .limit(1);
  if (existing && existing[0]) return { stored: value, action: "already_present" };
  const { error } = await supabase.from("user_facts").insert([{
    user_id: userId,
    kind: fact.kind,
    value,
    reason: fact.reason || "",
    tier: fact.kind === "constraint" ? 3 : 2,
    source,
    is_active: true,
    expires_at: fact.expires_at || null,
  }]);
  if (error) throw new Error(error.message);
  return { stored: value, action: "created" };
}

// Goal payload arrives ALREADY code-computed by the coach route (computeGoalTargets).
// This endpoint applies it — it never recomputes and never trusts client math beyond
// sanity bounds.
async function applyGoal(userId, goal) {
  const calories = Math.round(Number(goal.calories));
  const protein = Math.round(Number(goal.protein));
  const carbs = Math.round(Number(goal.carbs));
  const fat = Math.round(Number(goal.fat));
  if (!(calories >= 1000 && calories <= 6000)) throw new Error("Calorie target out of sane bounds");
  if (!(protein > 0 && carbs > 0 && fat > 0)) throw new Error("Invalid macro targets");

  const goalType = ["fat_loss", "muscle_gain", "maintain"].includes(goal.goal_type) ? goal.goal_type : "maintain";
  const stamp = new Date().toISOString();

  const { data: existing } = await supabase.from("goals").select("id").eq("user_id", userId).limit(1);
  const payload = {
    goal_type: goalType, calories, protein, carbs, fat,
    carbs_target_g: carbs, fat_target_g: fat, // legacy columns kept in lockstep
    updated_at: stamp,
  };
  if (existing && existing[0]) {
    const { error } = await supabase.from("goals").update(payload).eq("id", existing[0].id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("goals").insert([{ user_id: userId, ...payload }]);
    if (error) throw new Error(error.message);
  }

  const profileUpdate = { goal_type: goalType, updated_at: stamp };
  if (Number(goal.target_weight) > 0) profileUpdate.target_weight = Number(goal.target_weight);
  try {
    await supabase.from("user_profiles").update(profileUpdate).eq("user_id", userId);
  } catch (e) { /* profile row may not exist yet; goals are the operative targets */ }

  return { calories, protein, carbs, fat, goal_type: goalType };
}

// Remove = the visibility page's delete. Array kinds: pull the element (and its reason).
// Row kinds: deactivate (is_active=false) — history preserved, fact stops applying.
async function removeFactEntry(userId, fact) {
  const kind = (fact.kind || "").toString().toLowerCase();
  const value = cleanValue(fact.value);

  if (kind in ARRAY_COLUMN_FOR_KIND) {
    const col = ARRAY_COLUMN_FOR_KIND[kind];
    const { data: rows } = await supabase
      .from("user_dietary_preferences").select("*").eq("user_id", userId).limit(1);
    if (!rows || rows.length === 0) return { removed: false };
    const row = rows[0];
    const existing = Array.isArray(row[col]) ? row[col] : [];
    const next = existing.filter((x) => cleanValue(x) !== value);
    if (next.length === existing.length) return { removed: false };
    const reasons = (row.reasons && typeof row.reasons === "object") ? { ...row.reasons } : {};
    delete reasons[value];
    const { error } = await supabase.from("user_dietary_preferences")
      .update({ [col]: next, reasons, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { removed: true };
  }

  const deactivate = async (table, matchCol) => {
    let q = supabase.from(table).update({ is_active: false, updated_at: new Date().toISOString() }).eq("user_id", userId);
    if (fact.id) q = q.eq("id", fact.id);
    else q = q.ilike(matchCol, value);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { removed: true };
  };

  if (kind === "health_condition") return deactivate("user_health_conditions", "condition");
  if (kind === "nutrient") return deactivate("user_nutrient_preferences", "nutrient");
  if (kind === "lifestyle" || kind === "constraint" || kind === "activity") return deactivate("user_facts", "value");
  throw new Error(`Unknown fact kind: ${kind}`);
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { userId, fact, goal, source, remove } = body || {};
    if (!userId) {
      return Response.json({ success: false, error: "Missing userId" }, { status: 400 });
    }
    const src = source === "interview" ? "interview" : "chat";

    if (remove && fact && fact.kind) {
      const result = await removeFactEntry(userId, fact);
      return Response.json({ success: true, result });
    }

    if (goal) {
      const applied = await applyGoal(userId, goal);
      return Response.json({ success: true, applied });
    }

    if (fact && fact.kind) {
      const kind = fact.kind.toString().toLowerCase();
      let result;
      if (kind in ARRAY_COLUMN_FOR_KIND) {
        result = await saveDietaryArrayFact(userId, { ...fact, kind }, src);
      } else if (kind === "health_condition") {
        result = await saveHealthCondition(userId, fact);
      } else if (kind === "nutrient") {
        result = await saveNutrientPreference(userId, fact);
      } else if (kind === "lifestyle" || kind === "constraint" || kind === "activity") {
        result = await saveUserFact(userId, { ...fact, kind }, src);
      } else {
        return Response.json({ success: false, error: `Unknown fact kind: ${kind}` }, { status: 400 });
      }
      return Response.json({ success: true, result });
    }

    return Response.json({ success: false, error: "Provide a fact or a goal" }, { status: 400 });
  } catch (e) {
    console.error("facts endpoint error:", e);
    return Response.json({ success: false, error: e.message || "Save failed" }, { status: 500 });
  }
}