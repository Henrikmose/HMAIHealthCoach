"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

// Mifflin-St Jeor formula for BMR
function calculateBMR(weight, height, age, gender) {
  if (gender === "male") {
    return 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    return 10 * weight + 6.25 * height - 5 * age - 161;
  }
}

// Calculate TDEE
function calculateTDEE(bmr, activityLevel) {
  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    "very-active": 1.9,
  };
  return Math.round(bmr * (multipliers[activityLevel] || 1.55));
}

// Apply goal adjustments
function applyGoalAdjustment(tdee, goal) {
  const adjustments = {
    "fat-loss": -400,
    "muscle-gain": 300,
    maintain: 0,
    health: 0,
    performance: 200,
  };
  return Math.max(1200, tdee + (adjustments[goal] || 0));
}

// Calculate macros based on goal
function calculateMacros(calories, goal) {
  const ratios = {
    "fat-loss": { protein: 0.35, carbs: 0.35, fat: 0.3 },
    "muscle-gain": { protein: 0.3, carbs: 0.45, fat: 0.25 },
    maintain: { protein: 0.25, carbs: 0.45, fat: 0.3 },
    health: { protein: 0.25, carbs: 0.45, fat: 0.3 },
    performance: { protein: 0.3, carbs: 0.5, fat: 0.2 },
  };

  const ratio = ratios[goal] || ratios.maintain;
  return {
    protein: Math.round(calories * ratio.protein / 4),
    carbs: Math.round(calories * ratio.carbs / 4),
    fat: Math.round(calories * ratio.fat / 9),
  };
}

export default function ProfileSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("male");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("lbs");
  const [heightFeet, setHeightFeet] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [goal, setGoal] = useState("maintain");
  const [activityLevel, setActivityLevel] = useState("moderate");
  const [calories, setCalories] = useState(0);
  const [macros, setMacros] = useState({ protein: 0, carbs: 0, fat: 0 });

  // Check for logged-in user on mount
  useEffect(() => {
    const checkAuth = async () => {
      // First check session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user?.id) {
        setUserId(session.user.id);
        setLoading(false);
        return;
      }

      // Fallback to localStorage
      const storedId = localStorage.getItem("user_id");
      if (storedId) {
        setUserId(storedId);
        setLoading(false);
        return;
      }

      // Not logged in — redirect to signup
      router.push("/signup");
    };

    checkAuth();
  }, [router]);

  // Calculate calories and macros when goal or activity level changes
  useEffect(() => {
    if (!weight || !heightFeet || !heightInches || !birthDate) return;

    // Calculate age from birthDate
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    // Convert weight to kg
    const weightKg = weightUnit === "lbs" ? weight / 2.205 : parseFloat(weight);

    // Convert height to cm (feet + inches → total inches → cm)
    const totalInches = parseInt(heightFeet) * 12 + parseInt(heightInches);
    const heightCm = totalInches * 2.54;

    // Calculate
    const bmr = calculateBMR(weightKg, heightCm, age, gender);
    const tdee = calculateTDEE(bmr, activityLevel);
    const adjusted = applyGoalAdjustment(tdee, goal);
    const macroData = calculateMacros(adjusted, goal);

    setCalories(adjusted);
    setMacros(macroData);
  }, [weight, weightUnit, heightFeet, heightInches, birthDate, gender, goal, activityLevel]);

  const handleSaveProfile = async () => {
    if (!userId) {
      setError("User ID not found");
      return;
    }

    setSaving(true);
    setError("");

    try {
      // Calculate age from birthDate
      const today = new Date();
      const birth = new Date(birthDate);
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }

      // Convert weight to kg for storage
      const weightKg = weightUnit === "lbs" ? weight / 2.205 : parseFloat(weight);

      // 1. Save to user_profiles
      const { error: profileError } = await supabase
        .from("user_profiles")
        .upsert(
          {
            user_id: userId,
            name,
            age,
            gender,
            current_weight: weightKg,
            weight_unit: "kg",
            goal_type: goal,
            activity_level: activityLevel,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (profileError) {
        setError(`Profile save failed: ${profileError.message}`);
        setSaving(false);
        return;
      }

      // 2. Save to goals
      const { error: goalsError } = await supabase
        .from("goals")
        .upsert(
          {
            user_id: userId,
            calories,
            protein: macros.protein,
            carbs: macros.carbs,
            fat: macros.fat,
          },
          { onConflict: "user_id" }
        );

      if (goalsError) {
        setError(`Goals save failed: ${goalsError.message}`);
        setSaving(false);
        return;
      }

      // Success! Redirect to home
      router.push("/");
    } catch (err) {
      setError(err.message || "An error occurred");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#1c1c1e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f0f0f0",
        }}
      >
        🔄 Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1c1c1e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "500px",
          background: "#242424",
          border: "1px solid #2c2c2c",
          borderRadius: "16px",
          padding: "40px",
        }}
      >
        {/* Progress indicator */}
        <div style={{ marginBottom: "30px" }}>
          <div
            style={{
              fontSize: "12px",
              color: "#888",
              fontFamily: "DM Sans, sans-serif",
              marginBottom: "8px",
            }}
          >
            STEP {step} OF 5
          </div>
          <div
            style={{
              background: "#1c1c1e",
              height: "4px",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "#2563eb",
                height: "100%",
                width: `${(step / 5) * 100}%`,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "#f0f0f0",
                marginBottom: "20px",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Let's start with basics
            </h2>

            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  color: "#f0f0f0",
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "#1c1c1e",
                  border: "1px solid #2c2c2c",
                  borderRadius: "12px",
                  color: "#f0f0f0",
                  fontSize: "16px",
                  fontFamily: "DM Sans, sans-serif",
                  boxSizing: "border-box",
                }}
                placeholder="Your name"
              />
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  color: "#f0f0f0",
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Birthday
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "#1c1c1e",
                  border: "1px solid #2c2c2c",
                  borderRadius: "12px",
                  color: "#f0f0f0",
                  fontSize: "16px",
                  fontFamily: "DM Sans, sans-serif",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "30px" }}>
              <label
                style={{
                  display: "block",
                  color: "#f0f0f0",
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Gender
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                {["male", "female", "other"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    style={{
                      flex: 1,
                      padding: "12px",
                      background: gender === g ? "#2563eb" : "#1c1c1e",
                      border: `1px solid ${gender === g ? "#2563eb" : "#2c2c2c"}`,
                      borderRadius: "12px",
                      color: "#f0f0f0",
                      cursor: "pointer",
                      fontFamily: "DM Sans, sans-serif",
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!name || !birthDate}
              style={{
                width: "100%",
                padding: "14px",
                background: !name || !birthDate ? "#666" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "14px",
                fontSize: "16px",
                fontWeight: 600,
                cursor: !name || !birthDate ? "not-allowed" : "pointer",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2: Weight & Height */}
        {step === 2 && (
          <div>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "#f0f0f0",
                marginBottom: "20px",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Your measurements
            </h2>

            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  color: "#f0f0f0",
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Weight
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "#1c1c1e",
                    border: "1px solid #2c2c2c",
                    borderRadius: "12px",
                    color: "#f0f0f0",
                    fontSize: "16px",
                    fontFamily: "DM Sans, sans-serif",
                    boxSizing: "border-box",
                  }}
                  placeholder="Weight"
                />
                <select
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value)}
                  style={{
                    padding: "12px",
                    background: "#1c1c1e",
                    border: "1px solid #2c2c2c",
                    borderRadius: "12px",
                    color: "#f0f0f0",
                    fontSize: "16px",
                    fontFamily: "DM Sans, sans-serif",
                  }}
                >
                  <option value="lbs">lbs</option>
                  <option value="kg">kg</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: "30px" }}>
              <label
                style={{
                  display: "block",
                  color: "#f0f0f0",
                  fontSize: "14px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Height
              </label>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="number"
                    value={heightFeet}
                    onChange={(e) => setHeightFeet(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px",
                      background: "#1c1c1e",
                      border: "1px solid #2c2c2c",
                      borderRadius: "12px",
                      color: "#f0f0f0",
                      fontSize: "16px",
                      fontFamily: "DM Sans, sans-serif",
                      boxSizing: "border-box",
                    }}
                    placeholder="Feet"
                  />
                  <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>Feet</div>
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    type="number"
                    value={heightInches}
                    onChange={(e) => setHeightInches(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px",
                      background: "#1c1c1e",
                      border: "1px solid #2c2c2c",
                      borderRadius: "12px",
                      color: "#f0f0f0",
                      fontSize: "16px",
                      fontFamily: "DM Sans, sans-serif",
                      boxSizing: "border-box",
                    }}
                    placeholder="Inches"
                  />
                  <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>Inches</div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#1c1c1e",
                  color: "#f0f0f0",
                  border: "1px solid #2c2c2c",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!weight || !heightFeet || !heightInches}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: !weight || !heightFeet || !heightInches ? "#666" : "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: !weight || !heightFeet || !heightInches ? "not-allowed" : "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Goal */}
        {step === 3 && (
          <div>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "#f0f0f0",
                marginBottom: "20px",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              What's your goal?
            </h2>

            <div style={{ marginBottom: "30px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {[
                { value: "fat-loss", label: "🔥 Lose Fat" },
                { value: "muscle-gain", label: "💪 Build Muscle" },
                { value: "maintain", label: "⚖️ Maintain Weight" },
                { value: "health", label: "❤️ Improve Health" },
                { value: "performance", label: "⚡ Athletic Performance" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setGoal(opt.value)}
                  style={{
                    padding: "16px",
                    background: goal === opt.value ? "#2563eb" : "#1c1c1e",
                    border: `1px solid ${goal === opt.value ? "#2563eb" : "#2c2c2c"}`,
                    borderRadius: "12px",
                    color: "#f0f0f0",
                    cursor: "pointer",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "16px",
                    fontWeight: 600,
                    textAlign: "left",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setStep(2)}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#1c1c1e",
                  color: "#f0f0f0",
                  border: "1px solid #2c2c2c",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(4)}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Activity Level */}
        {step === 4 && (
          <div>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "#f0f0f0",
                marginBottom: "20px",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Activity level?
            </h2>

            <div style={{ marginBottom: "30px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {[
                { value: "sedentary", label: "🪑 Sedentary (little exercise)" },
                { value: "light", label: "🚶 Light (1-3 days/week)" },
                { value: "moderate", label: "🏃 Moderate (3-5 days/week)" },
                { value: "active", label: "🏋️ Active (6-7 days/week)" },
                { value: "very-active", label: "🤸 Very Active (athlete)" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setActivityLevel(opt.value)}
                  style={{
                    padding: "16px",
                    background: activityLevel === opt.value ? "#2563eb" : "#1c1c1e",
                    border: `1px solid ${activityLevel === opt.value ? "#2563eb" : "#2c2c2c"}`,
                    borderRadius: "12px",
                    color: "#f0f0f0",
                    cursor: "pointer",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "16px",
                    fontWeight: 600,
                    textAlign: "left",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setStep(3)}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#1c1c1e",
                  color: "#f0f0f0",
                  border: "1px solid #2c2c2c",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(5)}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                Review →
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "#f0f0f0",
                marginBottom: "20px",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Your plan
            </h2>

            <div
              style={{
                background: "#1c1c1e",
                border: "1px solid #2c2c2c",
                borderRadius: "12px",
                padding: "20px",
                marginBottom: "20px",
              }}
            >
              <div style={{ marginBottom: "15px" }}>
                <div
                  style={{
                    color: "#888",
                    fontSize: "12px",
                    fontFamily: "DM Sans, sans-serif",
                    textTransform: "uppercase",
                  }}
                >
                  Daily Calories
                </div>
                <div
                  style={{
                    color: "#f0f0f0",
                    fontSize: "32px",
                    fontWeight: 800,
                    fontFamily: "DM Sans, sans-serif",
                  }}
                >
                  {calories}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                {[
                  { label: "Protein", value: macros.protein, color: "#ff6b6b" },
                  { label: "Carbs", value: macros.carbs, color: "#ffd93d" },
                  { label: "Fat", value: macros.fat, color: "#6bcf7f" },
                ].map((m) => (
                  <div key={m.label}>
                    <div
                      style={{
                        color: "#888",
                        fontSize: "12px",
                        fontFamily: "DM Sans, sans-serif",
                      }}
                    >
                      {m.label}
                    </div>
                    <div
                      style={{
                        color: m.color,
                        fontSize: "20px",
                        fontWeight: 800,
                        fontFamily: "DM Sans, sans-serif",
                      }}
                    >
                      {m.value}g
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div
                style={{
                  background: "rgba(220, 38, 38, 0.1)",
                  border: "1px solid #dc2626",
                  color: "#fca5a5",
                  padding: "12px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  marginBottom: "20px",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setStep(4)}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: saving ? "#666" : "#1c1c1e",
                  color: "#f0f0f0",
                  border: "1px solid #2c2c2c",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: saving ? "#666" : "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "14px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                {saving ? "Saving..." : "Start coaching →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}