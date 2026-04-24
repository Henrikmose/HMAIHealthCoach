"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function ProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("male");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
  const [goal, setGoal] = useState("maintain");
  const [activityLevel, setActivityLevel] = useState("moderate");

  // Load user profile
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

      const { data, error: fetchError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (fetchError) {
        setError(`Failed to load profile: ${fetchError.message}`);
        setLoading(false);
        return;
      }

      if (data) {
        setProfile(data);
        setName(data.name || "");
        setAge(data.age || "");
        setGender(data.gender || "male");
        setWeight(data.current_weight || "");
        setWeightUnit(data.weight_unit || "kg");
        setGoal(data.goal_type || "maintain");
        setActivityLevel(data.activity_level || "moderate");
      }

      setLoading(false);
    };

    loadProfile();
  }, [router]);

  const handleSave = async () => {
    if (!userId) return;

    setSaving(true);
    setError("");

    try {
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({
          name,
          age: parseInt(age),
          gender,
          current_weight: parseFloat(weight),
          weight_unit: weightUnit,
          goal_type: goal,
          activity_level: activityLevel,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (updateError) {
        setError(`Failed to save: ${updateError.message}`);
        setSaving(false);
        return;
      }

      setSaving(false);
      alert("Profile updated!");
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
    <div
      style={{
        minHeight: "100vh",
        background: "#1c1c1e",
        padding: "20px",
        paddingBottom: "100px",
      }}
    >
      <div
        style={{
          maxWidth: "600px",
          margin: "0 auto",
          background: "#242424",
          border: "1px solid #2c2c2c",
          borderRadius: "16px",
          padding: "40px",
        }}
      >
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "#f0f0f0",
            marginBottom: "30px",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          Profile Settings
        </h1>

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
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
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

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: "100%",
            padding: "14px",
            background: saving ? "#666" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "14px",
            fontSize: "16px",
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "DM Sans, sans-serif",
            marginBottom: "10px",
          }}
        >
          {saving ? "Saving..." : "Save Changes"}
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
    </div>
  );
}