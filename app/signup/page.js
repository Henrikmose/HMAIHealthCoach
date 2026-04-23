"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [sent, setSent]         = useState(false);

  async function handleSignUp(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 6)  { setError("Password must be at least 6 characters"); return; }
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/profile/setup` }
    });

    if (error) { setError(error.message); setLoading(false); return; }

    // If email confirmation is disabled in Supabase — go straight to profile setup
    if (data.session) {
      localStorage.setItem("user_id", data.user.id);
      router.push("/profile/setup");
    } else {
      // Email confirmation required — show confirmation screen
      setSent(true);
    }
    setLoading(false);
  }

  const T = {
    bg: "#1c1c1e", surface: "#242424", border: "#2c2c2c",
    text: "#f0f0f0", sub: "#888", accent: "#2563eb",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; }
        input::placeholder { color: #555; }
        input:focus { outline: none; border-color: #2563eb !important; }
      `}</style>

      <div style={{ minHeight:"100vh", background: T.bg, display:"flex",
        flexDirection:"column", alignItems:"center", justifyContent:"center",
        padding:"24px", fontFamily:"'DM Sans', sans-serif" }}>

        {sent ? (
          // Email sent confirmation screen
          <div style={{ textAlign:"center", maxWidth:340 }}>
            <div style={{ fontSize:48, marginBottom:16 }}>📬</div>
            <h2 style={{ fontSize:22, fontWeight:800, color: T.text, marginBottom:8 }}>
              Check your email
            </h2>
            <p style={{ fontSize:14, color: T.sub, lineHeight:1.6 }}>
              We sent a verification link to <strong style={{ color: T.text }}>{email}</strong>.
              Click the link to activate your account.
            </p>
            <button onClick={() => router.push("/signin")}
              style={{ marginTop:24, fontSize:13, color:"#2563eb", fontWeight:600,
                background:"none", border:"none", cursor:"pointer",
                fontFamily:"'DM Sans', sans-serif" }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            {/* Logo */}
            <div style={{ marginBottom:40, textAlign:"center" }}>
              <div style={{ width:64, height:64, borderRadius:20, background:"#2563eb",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:28, margin:"0 auto 16px", boxShadow:"0 8px 32px #2563eb44" }}>
                💬
              </div>
              <p style={{ fontSize:11, fontWeight:700, color:"#2563eb",
                textTransform:"uppercase", letterSpacing:".15em", marginBottom:4 }}>CURA</p>
              <h1 style={{ fontSize:26, fontWeight:800, color: T.text, letterSpacing:"-.02em" }}>
                Create your account
              </h1>
              <p style={{ fontSize:14, color: T.sub, marginTop:6 }}>
                Your personal health coach awaits
              </p>
            </div>

            {/* Form */}
            <div style={{ width:"100%", maxWidth:380,
              background: T.surface, borderRadius:24,
              border:`1px solid ${T.border}`, padding:28 }}>

              {error && (
                <div style={{ background:"#ef444422", border:"1px solid #ef4444",
                  borderRadius:12, padding:"10px 14px", marginBottom:16,
                  fontSize:13, color:"#ef4444" }}>
                  {error}
                </div>
              )}

              {[
                { label:"Email", type:"email", val:email, set:setEmail, ph:"you@example.com" },
                { label:"Password", type:"password", val:password, set:setPassword, ph:"Min 6 characters" },
                { label:"Confirm Password", type:"password", val:confirm, set:setConfirm, ph:"Repeat password" },
              ].map(({ label, type, val, set, ph }) => (
                <div key={label} style={{ marginBottom:16 }}>
                  <label style={{ fontSize:12, fontWeight:600, color: T.sub,
                    textTransform:"uppercase", letterSpacing:".05em",
                    display:"block", marginBottom:8 }}>{label}</label>
                  <input type={type} value={val} onChange={e => set(e.target.value)}
                    placeholder={ph}
                    style={{ width:"100%", background:"#2c2c2c", border:"1px solid #3a3a3a",
                      borderRadius:12, padding:"14px 16px", fontSize:15, color: T.text,
                      fontFamily:"'DM Sans', sans-serif", transition:"border-color .2s" }} />
                </div>
              ))}

              <div style={{ marginBottom:24 }} />

              <button onClick={handleSignUp}
                disabled={loading || !email || !password || !confirm}
                style={{ width:"100%", padding:"16px", borderRadius:14, border:"none",
                  background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
                  color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
                  opacity: (loading || !email || !password || !confirm) ? .5 : 1,
                  boxShadow:"0 4px 16px #2563eb44",
                  fontFamily:"'DM Sans', sans-serif" }}>
                {loading ? "Creating account..." : "Create Account"}
              </button>

              <div style={{ textAlign:"center", marginTop:20 }}>
                <span style={{ fontSize:13, color: T.sub }}>Already have an account? </span>
                <button onClick={() => router.push("/signin")}
                  style={{ fontSize:13, color:"#2563eb", fontWeight:600,
                    background:"none", border:"none", cursor:"pointer",
                    fontFamily:"'DM Sans', sans-serif" }}>
                  Sign in
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}