"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

// ── Calorie calculation (Mifflin-St Jeor) ───────────────────────────
function calcCalories(weight, weightUnit, age, gender, activityLevel, goal) {
  const weightKg = weightUnit === "lbs" ? weight * 0.453592 : weight;
  // Assume average height 170cm for simplicity — user can adjust later
  const heightCm = 170;
  const bmr = gender === "female"
    ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
    : 10 * weightKg + 6.25 * heightCm - 5 * age + 5;

  const multipliers = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9
  };
  const tdee = Math.round(bmr * (multipliers[activityLevel] || 1.55));

  const adjustments = {
    fat_loss: -400, muscle_gain: 300, maintain: 0, health: 0, performance: 200
  };
  return Math.max(1200, tdee + (adjustments[goal] || 0));
}

function calcMacros(calories, goal) {
  const macros = {
    fat_loss:     { protein: 0.35, carbs: 0.35, fat: 0.30 },
    muscle_gain:  { protein: 0.30, carbs: 0.45, fat: 0.25 },
    maintain:     { protein: 0.25, carbs: 0.45, fat: 0.30 },
    health:       { protein: 0.25, carbs: 0.45, fat: 0.30 },
    performance:  { protein: 0.30, carbs: 0.50, fat: 0.20 },
  };
  const r = macros[goal] || macros.maintain;
  return {
    protein: Math.round((calories * r.protein) / 4),
    carbs:   Math.round((calories * r.carbs)   / 4),
    fat:     Math.round((calories * r.fat)      / 9),
  };
}

// ── Theme ─────────────────────────────────────────────────────────
const T = {
  bg: "#1c1c1e", surface: "#242424", border: "#2c2c2c",
  text: "#f0f0f0", sub: "#888", muted: "#3a3a3a", accent: "#2563eb",
};

// ── Step components ──────────────────────────────────────────────

function StepHeader({ step, total, title, subtitle }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ height:3, flex:1, borderRadius:9999,
            background: i < step ? "#2563eb" : T.muted,
            transition:"background .3s" }} />
        ))}
      </div>
      <p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
        textTransform:"uppercase", letterSpacing:".1em", marginBottom:6 }}>
        Step {step} of {total}
      </p>
      <h2 style={{ fontSize:22, fontWeight:800, color: T.text, letterSpacing:"-.02em" }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize:14, color: T.sub, marginTop:6, lineHeight:1.5 }}>{subtitle}</p>
      )}
    </div>
  );
}

function OptionCard({ label, sublabel, selected, onClick, emoji }) {
  return (
    <button onClick={onClick}
      style={{ width:"100%", textAlign:"left", padding:"14px 16px",
        borderRadius:14, border:`1px solid ${selected ? "#2563eb" : T.border}`,
        background: selected ? "#2563eb22" : T.surface,
        cursor:"pointer", display:"flex", alignItems:"center", gap:12,
        transition:"all .2s", marginBottom:8,
        fontFamily:"'DM Sans', sans-serif" }}>
      {emoji && <span style={{ fontSize:22 }}>{emoji}</span>}
      <div>
        <p style={{ fontSize:14, fontWeight:600, color: selected ? "#60a5fa" : T.text, margin:0 }}>
          {label}
        </p>
        {sublabel && (
          <p style={{ fontSize:12, color: T.sub, margin:"2px 0 0" }}>{sublabel}</p>
        )}
      </div>
      {selected && (
        <div style={{ marginLeft:"auto", width:20, height:20, borderRadius:"50%",
          background:"#2563eb", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:12, color:"#fff" }}>✓</div>
      )}
    </button>
  );
}

function TextInput({ label, type="text", value, onChange, placeholder, hint }) {
  return (
    <div style={{ marginBottom:16 }}>
      <label style={{ fontSize:12, fontWeight:600, color: T.sub,
        textTransform:"uppercase", letterSpacing:".05em",
        display:"block", marginBottom:8 }}>{label}</label>
      <input type={type} value={value} onChange={onChange}
        placeholder={placeholder}
        style={{ width:"100%", background: T.muted, border:`1px solid ${T.border}`,
          borderRadius:12, padding:"14px 16px", fontSize:15, color: T.text,
          fontFamily:"'DM Sans', sans-serif" }} />
      {hint && <p style={{ fontSize:12, color: T.sub, marginTop:6 }}>{hint}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function ProfileSetupPage() {
  const router = useRouter();
  const [step, setStep]               = useState(1);
  const TOTAL_STEPS = 5;

  // Form state
  const [name, setName]               = useState("");
  const [age, setAge]                 = useState("");
  const [gender, setGender]           = useState("");
  const [weight, setWeight]           = useState("");
  const [weightUnit, setWeightUnit]   = useState("lbs");
  const [goal, setGoal]               = useState("");
  const [activityLevel, setActivity]  = useState("");
  const [customCals, setCustomCals]   = useState("");
  const [useCustomCals, setUseCustom] = useState(false);
  const [darkMode, setDarkMode]       = useState(true);
  const [saving, setSaving]           = useState(false);
  const [userId, setUserId]           = useState(null);

  useEffect(() => {
    // Get user from auth session with retry
    async function loadSession() {
      for (let i = 0; i < 5; i++) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setUserId(session.user.id);
          localStorage.setItem("user_id", session.user.id);
          return;
        }
        // Wait 200ms before retry
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      // After 5 retries (1 second total), redirect to signin
      router.push("/signin");
    }
    loadSession();

    // Load dark mode preference
    const saved = localStorage.getItem("cura_dark");
    if (saved !== null) setDarkMode(saved !== "false");
  }, []);

  // Calculate calories from profile
  const calculatedCals = (weight && age && activityLevel && goal && gender)
    ? calcCalories(parseFloat(weight), weightUnit, parseInt(age), gender, activityLevel, goal)
    : null;

  const finalCals = useCustomCals && customCals
    ? parseInt(customCals)
    : calculatedCals;

  const macros = finalCals ? calcMacros(finalCals, goal) : null;

  async function handleSave() {
    if (!userId || !finalCals) return;
    setSaving(true);

    try {
      // Save dark mode preference
      localStorage.setItem("cura_dark", darkMode ? "true" : "false");
      localStorage.setItem("user_name", name);

      // Upsert user_profiles
      await supabase.from("user_profiles").upsert({
        user_id:        userId,
        name:           name,
        age:            parseInt(age),
        gender:         gender,
        current_weight: parseFloat(weight),
        weight_unit:    weightUnit,
        goal_type:      goal,
        activity_level: activityLevel,
        updated_at:     new Date().toISOString(),
      }, { onConflict: "user_id" });

      // Upsert goals
      await supabase.from("goals").upsert({
        user_id: userId,
        calories: finalCals,
        protein:  macros.protein,
        carbs:    macros.carbs,
        fat:      macros.fat,
      }, { onConflict: "user_id" });

      router.push("/");
    } catch (e) {
      console.error("Save error:", e);
    } finally {
      setSaving(false);
    }
  }

  function nextStep() { setStep(s => Math.min(s + 1, TOTAL_STEPS)); }
  function prevStep() { setStep(s => Math.max(s - 1, 1)); }

  const canNext = {
    1: name.trim().length > 0 && age && gender,
    2: weight.length > 0,
    3: goal.length > 0,
    4: activityLevel.length > 0,
    5: true,
  }[step];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; }
        input::placeholder { color: #555; }
        input:focus { outline: none; border-color: #2563eb !important; }
        button:active { transform: scale(0.97); }
      `}</style>

      <div style={{ minHeight:"100vh", background: T.bg,
        fontFamily:"'DM Sans', sans-serif", maxWidth:430, margin:"0 auto",
        padding:"48px 20px 32px", display:"flex", flexDirection:"column" }}>

        {/* CURA wordmark */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"#2563eb",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:18, boxShadow:"0 4px 12px #2563eb44" }}>💬</div>
          <p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
            textTransform:"uppercase", letterSpacing:".15em" }}>CURA</p>
        </div>

        {/* ── STEP 1: Basic Info ── */}
        {step === 1 && (
          <div>
            <StepHeader step={1} total={TOTAL_STEPS}
              title="Let's get started"
              subtitle="Tell us a bit about yourself so we can personalize your coaching." />

            <TextInput label="Your name" value={name} onChange={e => setName(e.target.value)}
              placeholder="Henrik" />

            <TextInput label="Age" type="number" value={age} onChange={e => setAge(e.target.value)}
              placeholder="35" />

            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:600, color: T.sub,
                textTransform:"uppercase", letterSpacing:".05em",
                display:"block", marginBottom:8 }}>Gender</label>
              <div style={{ display:"flex", gap:8 }}>
                {["male", "female", "other"].map(g => (
                  <button key={g} onClick={() => setGender(g)}
                    style={{ flex:1, padding:"12px 8px", borderRadius:12,
                      border:`1px solid ${gender === g ? "#2563eb" : T.border}`,
                      background: gender === g ? "#2563eb22" : T.surface,
                      color: gender === g ? "#60a5fa" : T.sub,
                      fontSize:13, fontWeight:600, cursor:"pointer", textTransform:"capitalize",
                      fontFamily:"'DM Sans', sans-serif" }}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Weight ── */}
        {step === 2 && (
          <div>
            <StepHeader step={2} total={TOTAL_STEPS}
              title="Your current weight"
              subtitle="Used to calculate your calorie needs and track your progress." />

            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {["lbs", "kg"].map(u => (
                <button key={u} onClick={() => setWeightUnit(u)}
                  style={{ flex:1, padding:"12px", borderRadius:12,
                    border:`1px solid ${weightUnit === u ? "#2563eb" : T.border}`,
                    background: weightUnit === u ? "#2563eb22" : T.surface,
                    color: weightUnit === u ? "#60a5fa" : T.sub,
                    fontSize:14, fontWeight:600, cursor:"pointer",
                    fontFamily:"'DM Sans', sans-serif" }}>
                  {u}
                </button>
              ))}
            </div>

            <TextInput label={`Weight (${weightUnit})`} type="number"
              value={weight} onChange={e => setWeight(e.target.value)}
              placeholder={weightUnit === "lbs" ? "185" : "84"} />
          </div>
        )}

        {/* ── STEP 3: Goal ── */}
        {step === 3 && (
          <div>
            <StepHeader step={3} total={TOTAL_STEPS}
              title="What's your main goal?"
              subtitle="Your coaching and calorie target will be tailored to this." />

            {[
              { val:"fat_loss",    label:"Lose weight",        sub:"Calorie deficit, high protein", emoji:"🎯" },
              { val:"muscle_gain", label:"Build muscle",        sub:"Calorie surplus, strength focus", emoji:"💪" },
              { val:"maintain",    label:"Maintain weight",     sub:"Balanced nutrition", emoji:"⚖️" },
              { val:"health",      label:"Improve health",      sub:"Better energy, whole foods", emoji:"❤️" },
              { val:"performance", label:"Athletic performance", sub:"Fuel for training and recovery", emoji:"🏆" },
            ].map(o => (
              <OptionCard key={o.val} label={o.label} sublabel={o.sub}
                emoji={o.emoji} selected={goal === o.val}
                onClick={() => setGoal(o.val)} />
            ))}
          </div>
        )}

        {/* ── STEP 4: Activity Level ── */}
        {step === 4 && (
          <div>
            <StepHeader step={4} total={TOTAL_STEPS}
              title="How active are you?"
              subtitle="This determines how many calories you burn daily." />

            {[
              { val:"sedentary",   label:"Sedentary",     sub:"Desk job, little or no exercise", emoji:"🪑" },
              { val:"light",       label:"Lightly active", sub:"Light exercise 1-3 days/week", emoji:"🚶" },
              { val:"moderate",    label:"Moderately active", sub:"Exercise 3-5 days/week", emoji:"🏃" },
              { val:"active",      label:"Very active",    sub:"Hard exercise 6-7 days/week", emoji:"⚡" },
              { val:"very_active", label:"Athlete",        sub:"Multiple sessions daily or physical job", emoji:"🏆" },
            ].map(o => (
              <OptionCard key={o.val} label={o.label} sublabel={o.sub}
                emoji={o.emoji} selected={activityLevel === o.val}
                onClick={() => setActivity(o.val)} />
            ))}
          </div>
        )}

        {/* ── STEP 5: Review & Customize ── */}
        {step === 5 && (
          <div>
            <StepHeader step={5} total={TOTAL_STEPS}
              title="Your daily targets"
              subtitle="We calculated these based on your profile. You can adjust if needed." />

            {/* Calculated summary */}
            {finalCals && macros && (
              <div style={{ background: T.surface, borderRadius:16,
                border:`1px solid ${T.border}`, padding:20, marginBottom:20 }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:16 }}>
                  <span style={{ fontSize:13, color: T.sub }}>Daily calories</span>
                  <span style={{ fontSize:22, fontWeight:800, color:"#2563eb" }}>
                    {finalCals.toLocaleString()}
                  </span>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {[
                    { label:"Protein", val:`${macros.protein}g`, color:"#3b82f6" },
                    { label:"Carbs",   val:`${macros.carbs}g`,   color:"#10b981" },
                    { label:"Fat",     val:`${macros.fat}g`,      color:"#f59e0b" },
                  ].map(m => (
                    <div key={m.label} style={{ flex:1, background: T.muted,
                      borderRadius:12, padding:"12px 10px", textAlign:"center" }}>
                      <p style={{ fontSize:16, fontWeight:700, color: m.color, margin:0 }}>
                        {m.val}
                      </p>
                      <p style={{ fontSize:10, color: T.sub, margin:"2px 0 0",
                        textTransform:"uppercase", letterSpacing:".05em" }}>
                        {m.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Custom calorie override */}
            <button onClick={() => setUseCustom(!useCustomCals)}
              style={{ width:"100%", textAlign:"left", padding:"12px 16px",
                borderRadius:12, border:`1px solid ${T.border}`,
                background: T.surface, color: T.sub, fontSize:13,
                cursor:"pointer", marginBottom: useCustomCals ? 8 : 20,
                fontFamily:"'DM Sans', sans-serif" }}>
              {useCustomCals ? "▲ Use calculated target" : "▼ Set my own calorie target"}
            </button>

            {useCustomCals && (
              <TextInput label="Custom daily calories" type="number"
                value={customCals} onChange={e => setCustomCals(e.target.value)}
                placeholder={String(calculatedCals || 2000)}
                hint="Override the auto-calculated target" />
            )}

            {/* Dark mode toggle */}
            <div style={{ display:"flex", alignItems:"center",
              justifyContent:"space-between", padding:"16px",
              background: T.surface, borderRadius:14,
              border:`1px solid ${T.border}`, marginBottom:20 }}>
              <div>
                <p style={{ fontSize:14, fontWeight:600, color: T.text, margin:0 }}>Dark mode</p>
                <p style={{ fontSize:12, color: T.sub, margin:"2px 0 0" }}>Default app appearance</p>
              </div>
              <button onClick={() => setDarkMode(!darkMode)}
                style={{ width:48, height:28, borderRadius:14,
                  background: darkMode ? "#2563eb" : T.muted,
                  border:"none", cursor:"pointer", position:"relative",
                  transition:"background .2s" }}>
                <div style={{ position:"absolute", top:4,
                  left: darkMode ? 24 : 4, width:20, height:20,
                  borderRadius:"50%", background:"#fff",
                  transition:"left .2s", boxShadow:"0 1px 4px rgba(0,0,0,.3)" }} />
              </button>
            </div>
          </div>
        )}

        {/* ── Navigation buttons ── */}
        <div style={{ marginTop:"auto", paddingTop:24, display:"flex", gap:10 }}>
          {step > 1 && (
            <button onClick={prevStep}
              style={{ flex:1, padding:"16px", borderRadius:14,
                border:`1px solid ${T.border}`, background: T.surface,
                color: T.sub, fontSize:15, fontWeight:600, cursor:"pointer",
                fontFamily:"'DM Sans', sans-serif" }}>
              Back
            </button>
          )}
          <button
            onClick={step === TOTAL_STEPS ? handleSave : nextStep}
            disabled={!canNext || saving}
            style={{ flex:2, padding:"16px", borderRadius:14, border:"none",
              background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
              opacity: (!canNext || saving) ? .5 : 1,
              boxShadow:"0 4px 16px #2563eb44",
              fontFamily:"'DM Sans', sans-serif" }}>
            {saving ? "Saving..." : step === TOTAL_STEPS ? "Start coaching →" : "Continue"}
          </button>
        </div>
      </div>
    </>
  );
}