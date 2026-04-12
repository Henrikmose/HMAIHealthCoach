"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import HamburgerMenu from "../components/HamburgerMenu";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function ProfilePage() {
  const [profile, setProfile] = useState({
    user_id: "henrik-uuid-1111-1111-1111-111111111111",
    name: "Henrik",
    email: "Henrikmose@gmail.com",
    password: "Hm070978",
    current_weight: "210",
    target_weight: "190",
    weight_unit: "lbs",
    activity_level: "moderately_active",
  });

  const [calculatedMacros, setCalculatedMacros] = useState({
    goal_type: "",
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Load existing profile on mount
  useEffect(() => {
    loadProfile();
  }, []);

  // Auto-calculate macros when weight/activity changes
  useEffect(() => {
    if (profile.current_weight && profile.target_weight) {
      calculateMacros();
    }
  }, [profile.current_weight, profile.target_weight, profile.activity_level, profile.weight_unit]);

  async function loadProfile() {
    setLoading(true);
    
    // Check if user_id exists in localStorage
    let userId = localStorage.getItem("user_id");
    
    if (!userId) {
      // Generate new user_id
      userId = uuidv4();
      localStorage.setItem("user_id", userId);
    }

    // Try to load existing profile from database
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (data) {
      setProfile({
        user_id: userId,
        name: data.name || "",
        email: data.email || "",
        password: "", // Don't load password
        current_weight: data.current_weight || "",
        target_weight: data.target_weight || "",
        weight_unit: data.weight_unit || "lbs",
        activity_level: data.activity_level || "moderately_active",
      });
    } else {
      // New user - set user_id
      setProfile((prev) => ({ ...prev, user_id: userId }));
    }

    setLoading(false);
  }

  function calculateMacros() {
    const current = parseFloat(profile.current_weight);
    const target = parseFloat(profile.target_weight);
    
    if (!current || !target) return;

    // Convert to lbs if needed for calculation
    const currentLbs = profile.weight_unit === "kg" ? current * 2.205 : current;
    const targetLbs = profile.weight_unit === "kg" ? target * 2.205 : target;

    // Determine goal type
    let goalType = "";
    if (targetLbs < currentLbs) goalType = "fat_loss";
    else if (targetLbs > currentLbs) goalType = "muscle_gain";
    else goalType = "maintenance";

    // Activity multipliers
    const activityMultipliers = {
      sedentary: 11,
      lightly_active: 12,
      moderately_active: 13,
      very_active: 15,
      extremely_active: 17,
    };

    const multiplier = activityMultipliers[profile.activity_level] || 13;

    // Calculate calories
    let calories = 0;
    if (goalType === "fat_loss") {
      calories = Math.round(currentLbs * multiplier - 500); // 500 cal deficit
    } else if (goalType === "muscle_gain") {
      calories = Math.round(currentLbs * multiplier + 300); // 300 cal surplus
    } else {
      calories = Math.round(currentLbs * multiplier); // Maintenance
    }

    // Calculate protein (1g per lb of body weight)
    const protein = Math.round(currentLbs);

    // Calculate fat (25% of calories)
    const fatCalories = Math.round(calories * 0.25);
    const fat = Math.round(fatCalories / 9); // 9 cal per gram of fat

    // Calculate carbs (remaining calories)
    const proteinCalories = protein * 4; // 4 cal per gram
    const remainingCalories = calories - proteinCalories - fatCalories;
    const carbs = Math.round(remainingCalories / 4); // 4 cal per gram of carbs

    setCalculatedMacros({
      goal_type: goalType,
      calories,
      protein,
      carbs,
      fat,
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      // Save profile to user_profiles table
      const { error: profileError } = await supabase
        .from("user_profiles")
        .upsert([{
          user_id: profile.user_id,
          name: profile.name,
          email: profile.email,
          current_weight: parseFloat(profile.current_weight),
          target_weight: parseFloat(profile.target_weight),
          weight_unit: profile.weight_unit,
          activity_level: profile.activity_level,
          updated_at: new Date().toISOString(),
        }], { onConflict: "user_id" });

      if (profileError) throw profileError;

      // Save/update goals
      const { error: goalsError } = await supabase
        .from("goals")
        .upsert([{
          user_id: profile.user_id,
          goal_type: calculatedMacros.goal_type,
          calories: calculatedMacros.calories,
          protein: calculatedMacros.protein,
          carbs: calculatedMacros.carbs,
          fat: calculatedMacros.fat,
          updated_at: new Date().toISOString(),
        }], { onConflict: "user_id" });

      if (goalsError) throw goalsError;

      setMessage("✅ Profile saved successfully!");
      
      // Redirect to chat after 1.5 seconds
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);

    } catch (error) {
      console.error("Error saving profile:", error);
      setMessage("❌ Error saving profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleInputChange(field, value) {
    setProfile((prev) => {
      const updated = { ...prev, [field]: value };
      
      // Auto-set target weight to current weight if empty
      if (field === "current_weight" && !prev.target_weight) {
        updated.target_weight = value;
      }
      
      return updated;
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-xl">Loading profile...</div>
      </div>
    );
  }

  return (
    <>
      <HamburgerMenu />
      
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Your Profile</h1>
          <p className="text-gray-600 mb-8">Set up your profile to get personalized nutrition coaching</p>

        {/* User ID (read-only) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            User ID
          </label>
          <input
            type="text"
            value={profile.user_id}
            readOnly
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-500 font-mono text-sm"
          />
        </div>

        {/* Name */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Name *
          </label>
          <input
            type="text"
            value={profile.name}
            onChange={(e) => handleInputChange("name", e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        {/* Email */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email *
          </label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => handleInputChange("email", e.target.value)}
            placeholder="your@email.com"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

       

        {/* Current Weight */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Current Weight *
          </label>
          <div className="flex gap-3">
            <input
              type="number"
              value={profile.current_weight}
              onChange={(e) => handleInputChange("current_weight", e.target.value)}
              placeholder="175"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
            <select
              value={profile.weight_unit}
              onChange={(e) => handleInputChange("weight_unit", e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>

        {/* Target Weight */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Target Weight *
          </label>
          <input
            type="number"
            value={profile.target_weight}
            onChange={(e) => handleInputChange("target_weight", e.target.value)}
            placeholder="165"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="text-sm text-gray-500 mt-1">Defaults to current weight, but you can change it</p>
        </div>

        {/* Activity Level */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Activity Level *
          </label>
          <select
            value={profile.activity_level}
            onChange={(e) => handleInputChange("activity_level", e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="sedentary">Sedentary (little/no exercise)</option>
            <option value="lightly_active">Lightly Active (1-3 days/week)</option>
            <option value="moderately_active">Moderately Active (3-5 days/week)</option>
            <option value="very_active">Very Active (6-7 days/week)</option>
            <option value="extremely_active">Extremely Active (athlete/physical job)</option>
          </select>
        </div>

        {/* Calculated Macros Preview */}
        {calculatedMacros.calories > 0 && (
          <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Calculated Goals</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-sm text-gray-600">Goal Type</div>
                <div className="text-xl font-bold text-blue-600 capitalize">
                  {calculatedMacros.goal_type.replace("_", " ")}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Daily Calories</div>
                <div className="text-xl font-bold text-blue-600">
                  {calculatedMacros.calories} cal
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-gray-600">Protein</div>
                <div className="text-lg font-semibold text-gray-900">{calculatedMacros.protein}g</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Carbs</div>
                <div className="text-lg font-semibold text-gray-900">{calculatedMacros.carbs}g</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Fat</div>
                <div className="text-lg font-semibold text-gray-900">{calculatedMacros.fat}g</div>
              </div>
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.includes("✅") ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {message}
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving || !profile.name || !profile.email || !profile.current_weight || !profile.target_weight}
          className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Profile"}
        </button>

        {/* Link to Chat */}
        <div className="mt-6 text-center">
          <a href="/" className="text-blue-600 hover:underline">
            ← Back to Chat
          </a>
        </div>
      </div>
    </div>
    </>
  );
}