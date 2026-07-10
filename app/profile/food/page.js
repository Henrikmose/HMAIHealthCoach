"use client";

// ═══ [v83] FOOD PROFILE — interview + "What CURA knows about you", ONE surface ═══
// First visit: sections are empty — that's the interview.
// Every visit after: it renders the stored facts with remove — that's the
// visibility page. Chat-extracted facts appear here too; a bad extraction is
// visible and deletable exactly where you'd expect it.
//
// Consent model: a chip the user taps themselves IS the confirmation, so interview
// answers save directly (no review card). The review card exists for AI extraction,
// where the machine might have misheard — not for the user's own taps.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

const T = {
  bg: "#1c1c1e",
  surface: "#242424",
  border: "#2c2c2c",
  text: "#f0f0f0",
  sub: "#888888",
  accent: "#2563eb",
  intel: "#8b5cf6",
};

const DIET_STYLE_PRESETS = ["vegetarian", "vegan", "pescatarian", "keto", "paleo", "low-carb", "mediterranean"];
const ALLERGEN_PRESETS = ["shellfish", "peanuts", "tree nuts", "dairy", "eggs", "gluten", "soy", "fish", "sesame"];
const LIFESTYLE_PRESETS = ["works nights", "skips breakfast", "eats late", "intermittent fasting", "early riser", "shift worker"];

function Chip({ label, active, onClick, disabled, removable }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 12px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "'DM Sans', sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
        border: `1px solid ${active ? T.accent : T.border}`,
        background: active ? "#2563eb22" : T.surface,
        color: active ? "#3b82f6" : T.sub,
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {label}
      {active && removable && <span style={{ fontSize: 11 }}>✕</span>}
    </button>
  );
}

function Section({ icon, title, hint, children }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 16, padding: 16, marginBottom: 14,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 2 }}>
        {icon} {title}
      </div>
      {hint && <div style={{ fontSize: 12, color: T.sub, marginBottom: 10 }}>{hint}</div>}
      {children}
    </div>
  );
}

function TextAdder({ placeholder, onAdd, disabled }) {
  const [val, setVal] = useState("");
  const submit = () => {
    const v = val.trim();
    if (!v) return;
    onAdd(v);
    setVal("");
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          flex: 1, padding: "10px 12px", borderRadius: 12, fontSize: 13,
          border: `1px solid ${T.border}`, background: T.bg, color: T.text,
          outline: "none", fontFamily: "'DM Sans', sans-serif",
        }}
      />
      <button
        onClick={submit}
        disabled={disabled || !val.trim()}
        style={{
          padding: "10px 14px", borderRadius: 12, border: "none",
          background: (!val.trim() || disabled) ? "#374151" : T.accent,
          color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        + Add
      </button>
    </div>
  );
}

export default function FoodProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [prefs, setPrefs] = useState({
    dietary_style: [], allergens: [], intolerances: [],
    restrictions: [], loves: [], dislikes: [],
  });
  const [conditions, setConditions] = useState([]);
  const [nutrients, setNutrients] = useState([]);
  const [facts, setFacts] = useState([]); // lifestyle + constraints from user_facts

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      let uid = session?.user?.id;
      if (!uid && typeof window !== "undefined") uid = localStorage.getItem("user_id");
      if (!uid) { router.push("/signup"); return; }
      setUserId(uid);
      await loadAll(uid);
      setLoading(false);
    }
    init();
  }, []);

  async function loadAll(uid) {
    try {
      const [dp, hc, np, uf] = await Promise.all([
        supabase.from("user_dietary_preferences").select("*").eq("user_id", uid).limit(1),
        supabase.from("user_health_conditions").select("id, condition, reason").eq("user_id", uid).eq("is_active", true),
        supabase.from("user_nutrient_preferences").select("id, nutrient, frequency_per_week, reason").eq("user_id", uid).eq("is_active", true),
        supabase.from("user_facts").select("id, kind, value, reason, expires_at").eq("user_id", uid).eq("is_active", true),
      ]);
      const d = dp?.data?.[0];
      setPrefs({
        dietary_style: d?.dietary_style || [],
        allergens: d?.allergens || [],
        intolerances: d?.intolerances || [],
        restrictions: d?.restrictions || [],
        loves: d?.loves || [],
        dislikes: d?.dislikes || [],
      });
      setConditions(hc?.data || []);
      setNutrients(np?.data || []);
      setFacts((uf?.data || []).filter(f => !f.expires_at || f.expires_at >= new Date().toISOString().slice(0, 10)));
    } catch (e) {
      console.log("Food profile load error:", e);
    }
  }

  async function callFacts(payload) {
    if (busy || !userId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, source: "interview", ...payload }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");
      await loadAll(userId);
    } catch (e) {
      alert(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const addFact = (kind, value, extra = {}) => callFacts({ fact: { kind, value, ...extra } });
  const removeFact = (kind, value, id = null) => callFacts({ remove: true, fact: { kind, value, id } });

  // Toggle for preset chips backed by an array column
  const togglePref = (kind, listKey, value) => {
    const active = prefs[listKey].some(x => x.toLowerCase() === value.toLowerCase());
    return active ? removeFact(kind, value) : addFact(kind, value);
  };

  const has = (listKey, value) => prefs[listKey].some(x => x.toLowerCase() === value.toLowerCase());

  // Custom (non-preset) entries in an array, so they render as removable chips too
  const customOf = (listKey, presets) =>
    prefs[listKey].filter(v => !presets.some(p => p.toLowerCase() === v.toLowerCase()));

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex",
        alignItems: "center", justifyContent: "center", color: T.text }}>
        🔄 Loading...
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, maxWidth: 430,
        margin: "0 auto", padding: "52px 16px 40px", fontFamily: "'DM Sans', sans-serif" }}>

        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <button onClick={() => router.push("/profile")}
            style={{ background: "transparent", border: "none", color: T.sub,
              fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 8 }}>
            ← Basics & targets
          </button>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.intel,
            textTransform: "uppercase", letterSpacing: ".1em", margin: 0 }}>
            🧠 FOOD PROFILE
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: "4px 0 4px" }}>
            What CURA knows about you
          </h1>
          <p style={{ fontSize: 13, color: T.sub, margin: 0, lineHeight: 1.5 }}>
            Everything here shapes what your coach suggests — and never blocks or judges
            what you log. Facts saved from chat show up here too; remove anything that's wrong.
          </p>
        </div>

        {/* 1 — Diet style */}
        <Section icon="🥗" title="Diet style" hint="Hard rules — suggestions will never violate these.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {DIET_STYLE_PRESETS.map(p => (
              <Chip key={p} label={p} active={has("dietary_style", p)} removable
                disabled={busy} onClick={() => togglePref("dietary_style", "dietary_style", p)} />
            ))}
            {customOf("dietary_style", DIET_STYLE_PRESETS).map(v => (
              <Chip key={v} label={v} active removable disabled={busy}
                onClick={() => removeFact("dietary_style", v)} />
            ))}
          </div>
        </Section>

        {/* 2 — Allergies & hard exclusions */}
        <Section icon="⚠️" title="Allergies & hard exclusions"
          hint="Safety-critical. These are never suggested, ever.">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase",
            letterSpacing: ".05em", marginBottom: 6 }}>Allergies</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALLERGEN_PRESETS.map(p => (
              <Chip key={p} label={p} active={has("allergens", p)} removable
                disabled={busy} onClick={() => togglePref("allergen", "allergens", p)} />
            ))}
            {customOf("allergens", ALLERGEN_PRESETS).map(v => (
              <Chip key={v} label={v} active removable disabled={busy}
                onClick={() => removeFact("allergen", v)} />
            ))}
          </div>
          <TextAdder placeholder="Add another allergy..." disabled={busy}
            onAdd={(v) => addFact("allergen", v)} />

          <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase",
            letterSpacing: ".05em", margin: "14px 0 6px" }}>Intolerances</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {prefs.intolerances.map(v => (
              <Chip key={v} label={v} active removable disabled={busy}
                onClick={() => removeFact("intolerance", v)} />
            ))}
          </div>
          <TextAdder placeholder="e.g. lactose..." disabled={busy}
            onAdd={(v) => addFact("intolerance", v)} />

          <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase",
            letterSpacing: ".05em", margin: "14px 0 6px" }}>Never suggest</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {prefs.restrictions.map(v => (
              <Chip key={v} label={v} active removable disabled={busy}
                onClick={() => removeFact("restriction", v)} />
            ))}
          </div>
          <TextAdder placeholder='e.g. "pork", "cilantro-heavy dishes"...' disabled={busy}
            onAdd={(v) => addFact("restriction", v)} />
        </Section>

        {/* 3 — Loves & dislikes */}
        <Section icon="❤️" title="Loves & dislikes"
          hint="Soft preferences — the coach leans toward loves and away from dislikes.">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase",
            letterSpacing: ".05em", marginBottom: 6 }}>Loves</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {prefs.loves.map(v => (
              <Chip key={v} label={v} active removable disabled={busy}
                onClick={() => removeFact("love", v)} />
            ))}
          </div>
          <TextAdder placeholder="e.g. salmon, ginger, greek yogurt..." disabled={busy}
            onAdd={(v) => addFact("love", v)} />

          <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, textTransform: "uppercase",
            letterSpacing: ".05em", margin: "14px 0 6px" }}>Dislikes</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {prefs.dislikes.map(v => (
              <Chip key={v} label={v} active removable disabled={busy}
                onClick={() => removeFact("dislike", v)} />
            ))}
          </div>
          <TextAdder placeholder="e.g. mushrooms, olives..." disabled={busy}
            onAdd={(v) => addFact("dislike", v)} />
        </Section>

        {/* 4 — Lifestyle rhythm */}
        <Section icon="🕐" title="Lifestyle rhythm"
          hint="Shapes timing — your 'morning' doesn't have to be 7am.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LIFESTYLE_PRESETS.map(p => {
              const row = facts.find(f => f.kind === "lifestyle" && f.value.toLowerCase() === p.toLowerCase());
              return (
                <Chip key={p} label={p} active={!!row} removable disabled={busy}
                  onClick={() => row ? removeFact("lifestyle", p, row.id) : addFact("lifestyle", p)} />
              );
            })}
            {facts.filter(f => f.kind === "lifestyle" &&
              !LIFESTYLE_PRESETS.some(p => p.toLowerCase() === f.value.toLowerCase())).map(f => (
              <Chip key={f.id} label={f.value} active removable disabled={busy}
                onClick={() => removeFact("lifestyle", f.value, f.id)} />
            ))}
          </div>
          <TextAdder placeholder="e.g. train at 6am tuesdays..." disabled={busy}
            onAdd={(v) => addFact("lifestyle", v)} />
        </Section>

        {/* 5 — Active commitments (time-bounded, usually created in chat) */}
        {facts.some(f => f.kind === "constraint") && (
          <Section icon="⏳" title="Active commitments"
            hint="Time-bounded — these retire themselves when their window closes.">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {facts.filter(f => f.kind === "constraint").map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 8, padding: "8px 10px",
                  borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg }}>
                  <span style={{ fontSize: 13, color: T.text }}>
                    {f.value}{f.expires_at ? <span style={{ color: T.sub }}> · until {f.expires_at}</span> : null}
                  </span>
                  <button onClick={() => removeFact("constraint", f.value, f.id)} disabled={busy}
                    style={{ background: "transparent", border: "none", color: "#ef4444",
                      cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    End now
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 6 — Nutrient habits (usually created in chat) */}
        {nutrients.length > 0 && (
          <Section icon="🌿" title="Nutrient habits"
            hint="Things you're working into your week.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {nutrients.map(n => (
                <Chip key={n.id}
                  label={`${n.nutrient}${n.frequency_per_week ? ` ${n.frequency_per_week}x/wk` : ""}`}
                  active removable disabled={busy}
                  onClick={() => removeFact("nutrient", n.nutrient, n.id)} />
              ))}
            </div>
          </Section>
        )}

        {/* 7 — Health conditions (optional, private) */}
        <Section icon="🩺" title="Health conditions"
          hint="Optional. Stored privately and used only to shape food suggestions.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {conditions.map(c => (
              <Chip key={c.id} label={c.condition} active removable disabled={busy}
                onClick={() => removeFact("health_condition", c.condition, c.id)} />
            ))}
          </div>
          <TextAdder placeholder="e.g. high blood pressure..." disabled={busy}
            onAdd={(v) => addFact("health_condition", v)} />
        </Section>

        <p style={{ fontSize: 12, color: T.sub, textAlign: "center", lineHeight: 1.5 }}>
          You can also just tell your coach in chat — "I'm allergic to shellfish" —
          and it'll ask to save it here.
        </p>
      </div>
    </>
  );
}