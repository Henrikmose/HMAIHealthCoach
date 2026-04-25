"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

// ── Helper Functions ────────────────────────────────────────────────────
function calculateCaloriesFromMacros(p, c, f) {
  return Math.round((p * 4) + (c * 4) + (f * 9));
}

function kgToLbs(kg) {
  return parseFloat((kg * 2.20462).toFixed(2));
}

function lbsToKg(lbs) {
  return parseFloat((lbs / 2.20462).toFixed(2));
}

function convertMacrosToPercentages(p, c, f) {
  const totalCals = calculateCaloriesFromMacros(p, c, f);
  if (totalCals === 0) return { p: 0, c: 0, f: 0 };
  return {
    p: Math.round((p * 4 / totalCals) * 100),
    c: Math.round((c * 4 / totalCals) * 100),
    f: Math.round((f * 9 / totalCals) * 100),
  };
}

function convertMacrosFromPercentages(pPct, cPct, fPct, calories) {
  return {
    p: Math.round((pPct / 100) * calories / 4),
    c: Math.round((cPct / 100) * calories / 4),
    f: Math.round((fPct / 100) * calories / 9),
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [goals, setGoals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Basic Info ──
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("male");

  // ── Weight ──
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("lbs");

  // ── Goals ──
  const [goal, setGoal] = useState("maintain");
  const [activityLevel, setActivityLevel] = useState("moderate");

  // ── Calories ──
  const [calorieMode, setCalorieMode] = useState("calculated");
  const [calorieGoal, setCalorieGoal] = useState(2486);

  // ── Macros: Grams ──
  const [proteinG, setProteinG] = useState(224);
  const [carbsG, setCarbsG] = useState(224);
  const [fatG, setFatG] = useState(85);

  // ── Macros: Percentage ──
  const [proteinPct, setProteinPct] = useState(40);
  const [carbsPct, setCarbsPct] = useState(40);
  const [fatPct, setFatPct] = useState(20);

  // ── UI Mode ──
  const [macroMode, setMacroMode] = useState("grams");

  // Load user profile and goals
  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        router.push("/signin");
        return;
      }

      setUserId(session.user.id);

      // Fetch from user_profiles table
      const { data: profileData, error: profileError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (profileError) {
        setError(`Failed to load profile: ${profileError.message}`);
        setLoading(false);
        return;
      }

      // Fetch from goals table
      const { data: goalsData, error: goalsError } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (goalsError) {
        console.log("No goals found, that's okay");
      }

      if (profileData) {
        setUserProfile(profileData);
        setName(profileData.name || "");
        setAge(profileData.age || "");
        setGender(profileData.gender || "male");
        setActivityLevel(profileData.activity_level || "moderate");
        setGoal(profileData.goal_type || "maintain");

        // Weight: Display in lbs by default
        let currentW = profileData.current_weight || 0;
        let targetW = profileData.target_weight || 0;
        let unit = profileData.weight_unit || "kg";

        // If stored as kg, convert to lbs for display
        if (unit === "kg") {
          currentW = kgToLbs(currentW);
          targetW = kgToLbs(targetW);
        }

        setCurrentWeight(currentW);
        setTargetWeight(targetW);
        setWeightUnit("lbs");
      }

      if (goalsData) {
        setGoals(goalsData);
        setCalorieGoal(goalsData.calories || goalsData.daily_calorie_target || 2486);
        setProteinG(goalsData.protein || goalsData.daily_protein_target || 224);
        setCarbsG(goalsData.carbs || goalsData.carbs_target_g || 224);
        setFatG(goalsData.fat || goalsData.fat_target_g || 85);

        const pcts = convertMacrosToPercentages(
          goalsData.protein || goalsData.daily_protein_target || 224,
          goalsData.carbs || goalsData.carbs_target_g || 224,
          goalsData.fat || goalsData.fat_target_g || 85
        );
        setProteinPct(pcts.p);
        setCarbsPct(pcts.c);
        setFatPct(pcts.f);
      }

      setLoading(false);
    };

    loadProfile();
  }, [router]);

  // ── Handle Weight Unit Change ──
  const handleWeightUnitChange = (newUnit) => {
    if (newUnit === "kg" && weightUnit === "lbs") {
      setCurrentWeight(lbsToKg(currentWeight));
      setTargetWeight(lbsToKg(targetWeight));
    } else if (newUnit === "lbs" && weightUnit === "kg") {
      setCurrentWeight(kgToLbs(currentWeight));
      setTargetWeight(kgToLbs(targetWeight));
    }
    setWeightUnit(newUnit);
  };

  // ── Convert Grams to Percentages ──
  const convertGramsToPercentages = () => {
    const pcts = convertMacrosToPercentages(proteinG, carbsG, fatG);
    setProteinPct(pcts.p);
    setCarbsPct(pcts.c);
    setFatPct(pcts.f);
    setMacroMode("percentage");
  };

  // ── Convert Percentages to Grams ──
  const convertPercentagesToGrams = () => {
    const macros = convertMacrosFromPercentages(
      proteinPct,
      carbsPct,
      fatPct,
      calorieGoal
    );
    setProteinG(macros.p);
    setCarbsG(macros.c);
    setFatG(macros.f);
    setMacroMode("grams");
  };

  // ── Check for changes ──
  const hasChanges =
    userProfile &&
    (name !== (userProfile.name || "") ||
      parseInt(age) !== (userProfile.age || 0) ||
      gender !== (userProfile.gender || "male") ||
      parseFloat(currentWeight.toString()) !== parseFloat((userProfile.current_weight ? kgToLbs(userProfile.current_weight) : 0).toString()) ||
      parseFloat(targetWeight.toString()) !== parseFloat((userProfile.target_weight ? kgToLbs(userProfile.target_weight) : 0).toString()) ||
      goal !== (userProfile.goal_type || "maintain") ||
      activityLevel !== (userProfile.activity_level || "moderate") ||
      parseInt(calorieGoal.toString()) !== parseInt((goals?.calories || goals?.daily_calorie_target || 2486).toString()) ||
      parseInt(proteinG.toString()) !== parseInt((goals?.protein || goals?.daily_protein_target || 224).toString()) ||
      parseInt(carbsG.toString()) !== parseInt((goals?.carbs || goals?.carbs_target_g || 224).toString()) ||
      parseInt(fatG.toString()) !== parseInt((goals?.fat || goals?.fat_target_g || 85).toString()));

  // ── Save Profile & Goals ──
  const handleSave = async () => {
    if (!userId || !hasChanges) return;

    setSaving(true);
    setError("");

    try {
      // Convert weight to kg for storage
      let storageCurrentWeight = currentWeight;
      let storageTargetWeight = targetWeight;

      if (weightUnit === "lbs") {
        storageCurrentWeight = lbsToKg(currentWeight);
        storageTargetWeight = lbsToKg(targetWeight);
      }

      // Update user_profiles
      const { error: profileError } = await supabase
        .from("user_profiles")
        .update({
          name,
          age: parseInt(age) || null,
          gender,
          current_weight: parseFloat(storageCurrentWeight.toFixed(2)),
          target_weight: parseFloat(storageTargetWeight.toFixed(2)),
          weight_unit: "kg", // Store as kg internally
          activity_level: activityLevel,
          goal_type: goal,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (profileError) {
        setError(`Failed to save profile: ${profileError.message}`);
        setSaving(false);
        return;
      }

      // Update goals (user should already have a goals row)
      const { error: goalsError } = await supabase
        .from("goals")
        .update({
          goal_type: goal,
          calories: calorieGoal,
          protein: proteinG,
          carbs: carbsG,
          fat: fatG,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (goalsError) {
        setError(`Failed to save goals: ${goalsError.message}`);
        setSaving(false);
        return;
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);

      setUserProfile({
        ...userProfile,
        name,
        age: parseInt(age),
        gender,
        current_weight: storageCurrentWeight,
        target_weight: storageTargetWeight,
        weight_unit: "kg",
        activity_level: activityLevel,
        goal_type: goal,
        updated_at: new Date().toISOString(),
      });

      setSaving(false);
    } catch (err) {
      setError(err.message || "An error occurred");
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("user_id");
    router.push("/signin");
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
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { background: #1c1c1e; font-family: 'DM Sans', sans-serif; }
      `}</style>

      <div style={{ display:"flex", flexDirection:"column", height:"100vh",
        background: "#1c1c1e", fontFamily:"'DM Sans', sans-serif",
        maxWidth: 430, margin:"0 auto" }}>

        {/* ── Sticky Header ── */}
        <div style={{ position:"sticky", top:0, zIndex:50, background: "#242424",
          borderBottom:"1px solid #2c2c2c", padding:"52px 20px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
                textTransform:"uppercase", letterSpacing:".1em", margin:0 }}>CURA</p>
              <h1 style={{ fontSize:20, fontWeight:800, color: "#f0f0f0",
                margin:"2px 0 0", letterSpacing:"-.02em" }}>Profile</h1>
            </div>
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"16px 20px 100px",
          background: "#1c1c1e" }}>

        {/* ── Basic Info ── */}
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
            Age
          </label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
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

        {/* ── Body Metrics ── */}
        <h3
          style={{
            color: "#f0f0f0",
            fontSize: "14px",
            fontWeight: 700,
            marginBottom: "15px",
            marginTop: "30px",
            fontFamily: "DM Sans, sans-serif",
            textTransform: "uppercase",
            letterSpacing: ".05em",
          }}
        >
          Body Metrics
        </h3>

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
            Current Weight
          </label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="number"
              step="0.1"
              value={currentWeight}
              onChange={(e) => setCurrentWeight(e.target.value ? parseFloat(e.target.value) : "")}
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
            />
            <select
              value={weightUnit}
              onChange={(e) => handleWeightUnitChange(e.target.value)}
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
            Target Weight
          </label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="number"
              step="0.1"
              value={targetWeight}
              onChange={(e) => setTargetWeight(e.target.value ? parseFloat(e.target.value) : "")}
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
            />
            <select
              value={weightUnit}
              onChange={(e) => handleWeightUnitChange(e.target.value)}
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
            Goal
          </label>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
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
          >
            <option value="fat-loss">Lose Fat</option>
            <option value="muscle-gain">Build Muscle</option>
            <option value="maintain">Maintain Weight</option>
            <option value="health">Improve Health</option>
            <option value="performance">Athletic Performance</option>
          </select>
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
            Activity Level
          </label>
          <select
            value={activityLevel}
            onChange={(e) => setActivityLevel(e.target.value)}
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
          >
            <option value="sedentary">Sedentary</option>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="active">Active</option>
            <option value="very-active">Very Active</option>
          </select>
        </div>

        {/* ── Calorie & Macro Targets ── */}
        <h3
          style={{
            color: "#f0f0f0",
            fontSize: "14px",
            fontWeight: 700,
            marginBottom: "15px",
            marginTop: "30px",
            fontFamily: "DM Sans, sans-serif",
            textTransform: "uppercase",
            letterSpacing: ".05em",
          }}
        >
          Nutrition Targets
        </h3>

        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              color: "#f0f0f0",
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "10px",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            Daily Calorie Goal
          </label>
          <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
            <button
              onClick={() => setCalorieMode("calculated")}
              style={{
                flex: 1,
                padding: "10px",
                background: calorieMode === "calculated" ? "#2563eb" : "#1c1c1e",
                border: `1px solid ${calorieMode === "calculated" ? "#2563eb" : "#2c2c2c"}`,
                borderRadius: "10px",
                color: "#f0f0f0",
                cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              Calculated
            </button>
            <button
              onClick={() => setCalorieMode("manual")}
              style={{
                flex: 1,
                padding: "10px",
                background: calorieMode === "manual" ? "#2563eb" : "#1c1c1e",
                border: `1px solid ${calorieMode === "manual" ? "#2563eb" : "#2c2c2c"}`,
                borderRadius: "10px",
                color: "#f0f0f0",
                cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              Manual
            </button>
          </div>

          <div
            style={{
              background: "#1c1c1e",
              border: "1px solid #2c2c2c",
              borderRadius: "12px",
              padding: "12px",
              marginBottom: "10px",
            }}
          >
            {calorieMode === "calculated" && (
              <div>
                <div style={{ marginBottom: "10px" }}>
                  <span style={{ color: "#f0f0f0", fontWeight: 600 }}>
                    {calorieGoal.toLocaleString()} cal
                  </span>
                  <span style={{ color: "#888", fontSize: "12px", marginLeft: "8px" }}>
                    (calculated)
                  </span>
                </div>
              </div>
            )}
            {calorieMode === "manual" && (
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="number"
                  value={calorieGoal}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setCalorieGoal(e.target.value ? parseInt(e.target.value) : 0)}
                  style={{
                    flex: 1,
                    padding: "10px",
                    background: "#242424",
                    border: "1px solid #2c2c2c",
                    borderRadius: "8px",
                    color: "#f0f0f0",
                    fontSize: "14px",
                    fontFamily: "DM Sans, sans-serif",
                  }}
                />
                <span style={{ color: "#888", padding: "10px" }}>cal</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Macro Breakdown ── */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              color: "#f0f0f0",
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "10px",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            Macro Breakdown
          </label>
          <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
            <button
              onClick={() => setMacroMode("grams")}
              style={{
                flex: 1,
                padding: "10px",
                background: macroMode === "grams" ? "#2563eb" : "#1c1c1e",
                border: `1px solid ${macroMode === "grams" ? "#2563eb" : "#2c2c2c"}`,
                borderRadius: "10px",
                color: "#f0f0f0",
                cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              By Grams
            </button>
            <button
              onClick={() => setMacroMode("percentage")}
              style={{
                flex: 1,
                padding: "10px",
                background: macroMode === "percentage" ? "#2563eb" : "#1c1c1e",
                border: `1px solid ${macroMode === "percentage" ? "#2563eb" : "#2c2c2c"}`,
                borderRadius: "10px",
                color: "#f0f0f0",
                cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              By %
            </button>
          </div>

          {/* ── By Grams ── */}
          {macroMode === "grams" && (
            <div
              style={{
                background: "#1c1c1e",
                border: "1px solid #2c2c2c",
                borderRadius: "12px",
                padding: "12px",
              }}
            >
              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    color: "#888",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Protein
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    value={proteinG}
                    onChange={(e) => setProteinG(e.target.value ? parseInt(e.target.value) : 0)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: "#242424",
                      border: "1px solid #2c2c2c",
                      borderRadius: "8px",
                      color: "#f0f0f0",
                      fontSize: "14px",
                      fontFamily: "DM Sans, sans-serif",
                    }}
                  />
                  <span style={{ color: "#888", padding: "10px", minWidth: "30px" }}>g</span>
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    color: "#888",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Carbs
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    value={carbsG}
                    onChange={(e) => setCarbsG(e.target.value ? parseInt(e.target.value) : 0)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: "#242424",
                      border: "1px solid #2c2c2c",
                      borderRadius: "8px",
                      color: "#f0f0f0",
                      fontSize: "14px",
                      fontFamily: "DM Sans, sans-serif",
                    }}
                  />
                  <span style={{ color: "#888", padding: "10px", minWidth: "30px" }}>g</span>
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    color: "#888",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Fat
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    value={fatG}
                    onChange={(e) => setFatG(e.target.value ? parseInt(e.target.value) : 0)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: "#242424",
                      border: "1px solid #2c2c2c",
                      borderRadius: "8px",
                      color: "#f0f0f0",
                      fontSize: "14px",
                      fontFamily: "DM Sans, sans-serif",
                    }}
                  />
                  <span style={{ color: "#888", padding: "10px", minWidth: "30px" }}>g</span>
                </div>
              </div>

              <div
                style={{
                  background: "#2563eb22",
                  border: "1px solid #2563eb44",
                  borderRadius: "8px",
                  padding: "10px",
                  marginBottom: "10px",
                  color: "#2563eb",
                  fontWeight: 600,
                  fontSize: "13px",
                }}
              >
                Total: {calculateCaloriesFromMacros(proteinG, carbsG, fatG).toLocaleString()} cal
              </div>

              <button
                onClick={convertGramsToPercentages}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                  fontWeight: 600,
                  fontSize: "13px",
                }}
              >
                💯 Convert to %
              </button>
            </div>
          )}

          {/* ── By Percentage ── */}
          {macroMode === "percentage" && (
            <div
              style={{
                background: "#1c1c1e",
                border: "1px solid #2c2c2c",
                borderRadius: "12px",
                padding: "12px",
              }}
            >
              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    color: "#888",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Protein
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    value={proteinPct}
                    onChange={(e) => setProteinPct(e.target.value ? parseInt(e.target.value) : 0)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: "#242424",
                      border: "1px solid #2c2c2c",
                      borderRadius: "8px",
                      color: "#f0f0f0",
                      fontSize: "14px",
                      fontFamily: "DM Sans, sans-serif",
                    }}
                  />
                  <span style={{ color: "#888", padding: "10px", minWidth: "30px" }}>%</span>
                </div>
                <small style={{ color: "#888", marginTop: "4px", display: "block" }}>
                  {convertMacrosFromPercentages(proteinPct, carbsPct, fatPct, calorieGoal).p}g
                </small>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    color: "#888",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Carbs
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    value={carbsPct}
                    onChange={(e) => setCarbsPct(e.target.value ? parseInt(e.target.value) : 0)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: "#242424",
                      border: "1px solid #2c2c2c",
                      borderRadius: "8px",
                      color: "#f0f0f0",
                      fontSize: "14px",
                      fontFamily: "DM Sans, sans-serif",
                    }}
                  />
                  <span style={{ color: "#888", padding: "10px", minWidth: "30px" }}>%</span>
                </div>
                <small style={{ color: "#888", marginTop: "4px", display: "block" }}>
                  {convertMacrosFromPercentages(proteinPct, carbsPct, fatPct, calorieGoal).c}g
                </small>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    color: "#888",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Fat
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    value={fatPct}
                    onChange={(e) => setFatPct(e.target.value ? parseInt(e.target.value) : 0)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      background: "#242424",
                      border: "1px solid #2c2c2c",
                      borderRadius: "8px",
                      color: "#f0f0f0",
                      fontSize: "14px",
                      fontFamily: "DM Sans, sans-serif",
                    }}
                  />
                  <span style={{ color: "#888", padding: "10px", minWidth: "30px" }}>%</span>
                </div>
                <small style={{ color: "#888", marginTop: "4px", display: "block" }}>
                  {convertMacrosFromPercentages(proteinPct, carbsPct, fatPct, calorieGoal).f}g
                </small>
              </div>

              <div
                style={{
                  background:
                    proteinPct + carbsPct + fatPct === 100 ? "#10b98122" : "#f5424422",
                  border:
                    proteinPct + carbsPct + fatPct === 100
                      ? "1px solid #10b981"
                      : "1px solid #f54242",
                  borderRadius: "8px",
                  padding: "10px",
                  color:
                    proteinPct + carbsPct + fatPct === 100 ? "#10b981" : "#f54242",
                  fontWeight: 600,
                  fontSize: "13px",
                }}
              >
                Total: {proteinPct + carbsPct + fatPct}%{" "}
                {proteinPct + carbsPct + fatPct === 100 ? "✓" : "⚠️ Must equal 100%"}
              </div>
            </div>
          )}
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

        {saveSuccess && (
          <div
            style={{
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid #22c55e",
              color: "#86efac",
              padding: "12px",
              borderRadius: "12px",
              fontSize: "14px",
              marginBottom: "20px",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            ✅ Changes saved successfully!
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          style={{
            width: "100%",
            padding: "14px",
            background: !hasChanges || saving ? "#666" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "14px",
            fontSize: "16px",
            fontWeight: 600,
            cursor: !hasChanges || saving ? "not-allowed" : "pointer",
            fontFamily: "DM Sans, sans-serif",
            marginBottom: "10px",
          }}
        >
          {saving ? "Saving..." : hasChanges ? "Save Changes" : "No Changes"}
        </button>

        <button
          onClick={handleSignOut}
          style={{
            width: "100%",
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
          Sign Out
        </button>
      </div>

        {/* ── Bottom Nav ── */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: "100%",
            maxWidth: 430,
            background: "#242424",
            borderTop: "1px solid #2c2c2c",
            display: "flex",
            zIndex: 100,
            paddingBottom: "env(safe-area-inset-bottom, 8px)",
          }}
        >
          {[
            { id: "coach", icon: "💬", label: "Coach", path: "/" },
            { id: "dashboard", icon: "📊", label: "Dashboard", path: "/dashboard" },
            { id: "profile", icon: "⚙️", label: "Profile", path: "/profile" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => (window.location.href = tab.path)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "10px 0 4px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 20 }}>{tab.icon}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: tab.id === "profile" ? 700 : 500,
                  color: tab.id === "profile" ? "#2563eb" : "#888",
                  letterSpacing: ".03em",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                {tab.label}
              </span>
              {tab.id === "profile" && (
                <div
                  style={{
                    width: 18,
                    height: 2,
                    background: "#2563eb",
                    borderRadius: 9999,
                  }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}