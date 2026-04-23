"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

function calcCalories(weight, weightUnit, age, gender, activityLevel, goal) {
  const weightKg = weightUnit === "lbs" ? weight * 0.453592 : weight;
  const heightCm = 170;
  const bmr = gender === "female"
    ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
    : 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  const multipliers = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9 };
  const tdee = Math.round(bmr * (multipliers[activityLevel] || 1.55));
  const adjustments = { fat_loss:-400, muscle_gain:300, maintain:0, health:0, performance:200 };
  return Math.max(1200, tdee + (adjustments[goal] || 0));
}

function calcMacros(calories, goal) {
  const macros = {
    fat_loss:    { protein:0.35, carbs:0.35, fat:0.30 },
    muscle_gain: { protein:0.30, carbs:0.45, fat:0.25 },
    maintain:    { protein:0.25, carbs:0.45, fat:0.30 },
    health:      { protein:0.25, carbs:0.45, fat:0.30 },
    performance: { protein:0.30, carbs:0.50, fat:0.20 },
  };
  const r = macros[goal] || macros.maintain;
  return {
    protein: Math.round((calories * r.protein) / 4),
    carbs:   Math.round((calories * r.carbs)   / 4),
    fat:     Math.round((calories * r.fat)      / 9),
  };
}

function getTheme(dark) {
  return dark ? {
    bg:"#1c1c1e", surface:"#242424", card:"#2a2a2a", border:"#2c2c2c",
    text:"#f0f0f0", sub:"#888888", muted:"#3a3a3a",
  } : {
    bg:"#f5f5f5", surface:"#ffffff", card:"#f8f8f8", border:"#ebebeb",
    text:"#111111", sub:"#aaaaaa", muted:"#f0f0f0",
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const [dark, setDark]               = useState(true);
  const [userId, setUserId]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  // Profile fields
  const [name, setName]               = useState("");
  const [age, setAge]                 = useState("");
  const [gender, setGender]           = useState("male");
  const [weight, setWeight]           = useState("");
  const [weightUnit, setWeightUnit]   = useState("lbs");
  const [goal, setGoal]               = useState("fat_loss");
  const [activityLevel, setActivity]  = useState("moderate");
  const [customCals, setCustomCals]   = useState("");
  const [useCustom, setUseCustom]     = useState(false);
  const [email, setEmail]             = useState("");

  const t = getTheme(dark);

  useEffect(() => {
    const d = localStorage.getItem("cura_dark");
    setDark(d !== "false");

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push("/signin"); return; }
      const uid = session.user.id;
      setUserId(uid);
      setEmail(session.user.email || "");

      const { data: profile } = await supabase
        .from("user_profiles").select("*").eq("user_id", uid).single();
      if (profile) {
        setName(profile.name || "");
        setAge(String(profile.age || ""));
        setGender(profile.gender || "male");
        setWeight(String(profile.current_weight || ""));
        setWeightUnit(profile.weight_unit || "lbs");
        setGoal(profile.goal_type || "fat_loss");
        setActivity(profile.activity_level || "moderate");
      }

      const { data: goals } = await supabase
        .from("goals").select("*").eq("user_id", uid).single();
      if (goals) {
        const autoCals = profile ? calcCalories(
          parseFloat(profile.current_weight || 0),
          profile.weight_unit || "lbs",
          parseInt(profile.age || 30),
          profile.gender || "male",
          profile.activity_level || "moderate",
          profile.goal_type || "fat_loss"
        ) : 2000;
        if (Math.abs(goals.calories - autoCals) > 100) {
          setCustomCals(String(goals.calories));
          setUseCustom(true);
        }
      }
      setLoading(false);
    });
  }, []);

  function handleDarkToggle() {
    const newDark = !dark;
    setDark(newDark);
    localStorage.setItem("cura_dark", newDark ? "true" : "false");
  }

  const calculatedCals = (weight && age && activityLevel && goal && gender)
    ? calcCalories(parseFloat(weight), weightUnit, parseInt(age), gender, activityLevel, goal)
    : null;

  const finalCals = useCustom && customCals ? parseInt(customCals) : calculatedCals;
  const macros = finalCals ? calcMacros(finalCals, goal) : null;

  async function handleSave() {
    if (!userId || !finalCals) return;
    setSaving(true);
    localStorage.setItem("user_name", name);
    localStorage.setItem("cura_dark", dark ? "true" : "false");

    await supabase.from("user_profiles").upsert({
      user_id: userId, name, age: parseInt(age), gender,
      current_weight: parseFloat(weight), weight_unit: weightUnit,
      goal_type: goal, activity_level: activityLevel,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    await supabase.from("goals").upsert({
      user_id: userId, calories: finalCals,
      protein: macros.protein, carbs: macros.carbs, fat: macros.fat,
    }, { onConflict: "user_id" });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("user_id");
    localStorage.removeItem("user_name");
    router.push("/signin");
  }

  // ── Bottom Nav ──
  function BottomNav() {
    return (
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430, background: t.surface,
        borderTop:`1px solid ${t.border}`, display:"flex",
        paddingBottom:"env(safe-area-inset-bottom, 8px)", zIndex:100 }}>
        {[
          { id:"coach",     icon:"💬", label:"Coach",     path:"/"          },
          { id:"dashboard", icon:"📊", label:"Dashboard", path:"/dashboard" },
          { id:"profile",   icon:"⚙️", label:"Profile",   path:"/profile"   },
        ].map(tab => (
          <button key={tab.id} onClick={() => router.push(tab.path)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              gap:3, padding:"10px 0 4px", border:"none",
              background:"transparent", cursor:"pointer" }}>
            <span style={{ fontSize:20 }}>{tab.icon}</span>
            <span style={{ fontSize:10,
              fontWeight: tab.id === "profile" ? 700 : 500,
              color: tab.id === "profile" ? "#2563eb" : t.sub,
              letterSpacing:".03em" }}>
              {tab.label}
            </span>
            {tab.id === "profile" && (
              <div style={{ width:18, height:2, background:"#2563eb", borderRadius:9999 }} />
            )}
          </button>
        ))}
      </div>
    );
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", background: t.bg, display:"flex",
      alignItems:"center", justifyContent:"center" }}>
      <p style={{ color: t.sub, fontFamily:"'DM Sans', sans-serif" }}>Loading...</p>
    </div>
  );

  const SECTION = { marginBottom:24 };
  const LABEL = { fontSize:12, fontWeight:600, color: t.sub,
    textTransform:"uppercase", letterSpacing:".05em",
    display:"block", marginBottom:8 };
  const INPUT = {
    width:"100%", background: dark ? "#2c2c2c" : "#f5f5f5",
    border:`1px solid ${t.border}`, borderRadius:12,
    padding:"13px 16px", fontSize:15, color: t.text,
    fontFamily:"'DM Sans', sans-serif",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${t.bg}; font-family: 'DM Sans', sans-serif; }
        input:focus { outline: none; border-color: #2563eb !important; }
        select:focus { outline: none; }
      `}</style>

      <div style={{ background: t.bg, minHeight:"100vh", maxWidth:430,
        margin:"0 auto", fontFamily:"'DM Sans', sans-serif", paddingBottom:100 }}>

        {/* Header */}
        <div style={{ padding:"52px 20px 20px",
          background: t.surface, borderBottom:`1px solid ${t.border}`,
          marginBottom:20 }}>
          <p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
            textTransform:"uppercase", letterSpacing:".1em", marginBottom:4 }}>CURA</p>
          <h1 style={{ fontSize:22, fontWeight:800, color: t.text, letterSpacing:"-.02em" }}>
            {name || "Profile"}
          </h1>
          <p style={{ fontSize:13, color: t.sub, marginTop:4 }}>{email}</p>
        </div>

        <div style={{ padding:"0 20px" }}>

          {/* Appearance */}
          <div style={{ ...SECTION }}>
            <div style={{ background: t.surface, borderRadius:16,
              border:`1px solid ${t.border}`, overflow:"hidden" }}>
              <div style={{ display:"flex", alignItems:"center",
                justifyContent:"space-between", padding:"16px" }}>
                <div>
                  <p style={{ fontSize:14, fontWeight:600, color: t.text, margin:0 }}>Dark mode</p>
                  <p style={{ fontSize:12, color: t.sub, margin:"2px 0 0" }}>App appearance</p>
                </div>
                <button onClick={handleDarkToggle}
                  style={{ width:48, height:28, borderRadius:14,
                    background: dark ? "#2563eb" : "#ccc",
                    border:"none", cursor:"pointer", position:"relative",
                    transition:"background .2s" }}>
                  <div style={{ position:"absolute", top:4,
                    left: dark ? 24 : 4, width:20, height:20,
                    borderRadius:"50%", background:"#fff",
                    transition:"left .2s" }} />
                </button>
              </div>
            </div>
          </div>

          {/* Personal Info */}
          <div style={{ ...SECTION }}>
            <p style={{ fontSize:13, fontWeight:700, color: t.sub,
              textTransform:"uppercase", letterSpacing:".08em", marginBottom:12 }}>
              Personal Info
            </p>
            <div style={{ background: t.surface, borderRadius:16,
              border:`1px solid ${t.border}`, padding:16, display:"flex",
              flexDirection:"column", gap:12 }}>

              <div>
                <label style={LABEL}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name" style={INPUT} />
              </div>

              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}>
                  <label style={LABEL}>Age</label>
                  <input type="number" value={age} onChange={e => setAge(e.target.value)}
                    placeholder="35" style={INPUT} />
                </div>
                <div style={{ flex:1 }}>
                  <label style={LABEL}>Gender</label>
                  <select value={gender} onChange={e => setGender(e.target.value)}
                    style={{ ...INPUT, appearance:"none" }}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={LABEL}>Weight</label>
                <div style={{ display:"flex", gap:8 }}>
                  <input type="number" value={weight} onChange={e => setWeight(e.target.value)}
                    placeholder={weightUnit === "lbs" ? "185" : "84"}
                    style={{ ...INPUT, flex:1 }} />
                  <div style={{ display:"flex", borderRadius:12,
                    border:`1px solid ${t.border}`, overflow:"hidden" }}>
                    {["lbs","kg"].map(u => (
                      <button key={u} onClick={() => setWeightUnit(u)}
                        style={{ padding:"0 16px", border:"none", cursor:"pointer",
                          background: weightUnit === u ? "#2563eb" : t.surface,
                          color: weightUnit === u ? "#fff" : t.sub,
                          fontSize:13, fontWeight:600,
                          fontFamily:"'DM Sans', sans-serif" }}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Goal */}
          <div style={{ ...SECTION }}>
            <p style={{ fontSize:13, fontWeight:700, color: t.sub,
              textTransform:"uppercase", letterSpacing:".08em", marginBottom:12 }}>
              Health Goal
            </p>
            <div style={{ background: t.surface, borderRadius:16,
              border:`1px solid ${t.border}`, padding:16 }}>
              <select value={goal} onChange={e => setGoal(e.target.value)}
                style={{ ...INPUT, appearance:"none" }}>
                <option value="fat_loss">Lose weight</option>
                <option value="muscle_gain">Build muscle</option>
                <option value="maintain">Maintain weight</option>
                <option value="health">Improve health</option>
                <option value="performance">Athletic performance</option>
              </select>
            </div>
          </div>

          {/* Activity */}
          <div style={{ ...SECTION }}>
            <p style={{ fontSize:13, fontWeight:700, color: t.sub,
              textTransform:"uppercase", letterSpacing:".08em", marginBottom:12 }}>
              Activity Level
            </p>
            <div style={{ background: t.surface, borderRadius:16,
              border:`1px solid ${t.border}`, padding:16 }}>
              <select value={activityLevel} onChange={e => setActivity(e.target.value)}
                style={{ ...INPUT, appearance:"none" }}>
                <option value="sedentary">Sedentary (desk job, little exercise)</option>
                <option value="light">Lightly active (1-3 days/week)</option>
                <option value="moderate">Moderately active (3-5 days/week)</option>
                <option value="active">Very active (6-7 days/week)</option>
                <option value="very_active">Athlete (multiple sessions daily)</option>
              </select>
            </div>
          </div>

          {/* Calorie Target */}
          {finalCals && macros && (
            <div style={{ ...SECTION }}>
              <p style={{ fontSize:13, fontWeight:700, color: t.sub,
                textTransform:"uppercase", letterSpacing:".08em", marginBottom:12 }}>
                Daily Targets
              </p>
              <div style={{ background: t.surface, borderRadius:16,
                border:`1px solid ${t.border}`, padding:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:14 }}>
                  <span style={{ fontSize:13, color: t.sub }}>Calories</span>
                  <span style={{ fontSize:20, fontWeight:800, color:"#2563eb" }}>
                    {finalCals.toLocaleString()}
                  </span>
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  {[
                    { label:"Protein", val:`${macros.protein}g`, color:"#3b82f6" },
                    { label:"Carbs",   val:`${macros.carbs}g`,   color:"#10b981" },
                    { label:"Fat",     val:`${macros.fat}g`,      color:"#f59e0b" },
                  ].map(m => (
                    <div key={m.label} style={{ flex:1, background: dark ? "#3a3a3a" : "#f0f0f0",
                      borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
                      <p style={{ fontSize:15, fontWeight:700, color: m.color, margin:0 }}>
                        {m.val}
                      </p>
                      <p style={{ fontSize:10, color: t.sub, margin:"2px 0 0",
                        textTransform:"uppercase" }}>{m.label}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => setUseCustom(!useCustom)}
                  style={{ fontSize:12, color:"#2563eb", background:"none",
                    border:"none", cursor:"pointer", padding:0,
                    fontFamily:"'DM Sans', sans-serif" }}>
                  {useCustom ? "Use auto-calculated target" : "Set custom calorie target"}
                </button>
                {useCustom && (
                  <input type="number" value={customCals}
                    onChange={e => setCustomCals(e.target.value)}
                    placeholder={String(calculatedCals || 2000)}
                    style={{ ...INPUT, marginTop:10 }} />
                )}
              </div>
            </div>
          )}

          {/* Save button */}
          <button onClick={handleSave} disabled={saving}
            style={{ width:"100%", padding:"16px", borderRadius:14, border:"none",
              background: saved ? "#10b981" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
              marginBottom:12, boxShadow:"0 4px 16px #2563eb33",
              fontFamily:"'DM Sans', sans-serif",
              transition:"background .3s" }}>
            {saving ? "Saving..." : saved ? "✅ Saved!" : "Save Changes"}
          </button>

          {/* Sign out */}
          <button onClick={handleSignOut}
            style={{ width:"100%", padding:"14px", borderRadius:14,
              border:`1px solid ${t.border}`, background: t.surface,
              color: t.sub, fontSize:14, fontWeight:600, cursor:"pointer",
              fontFamily:"'DM Sans', sans-serif" }}>
            Sign Out
          </button>
        </div>

        <BottomNav />
      </div>
    </>
  );
}