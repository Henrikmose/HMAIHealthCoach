"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [mounted, setMounted]   = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Check if already signed in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push("/");
    });
  }, []);

  async function handleSignIn(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Store user info
    const uid = data.user.id;
    localStorage.setItem("user_id", uid);
    // Load profile name
    const { data: profile } = await supabase
      .from("user_profiles").select("name").eq("user_id", uid).maybeSingle();
    if (profile?.name) localStorage.setItem("user_name", profile.name);
    router.push("/");
  }

  const T = {
    bg: "#1c1c1e", surface: "#242424", border: "#2c2c2c",
    text: "#f0f0f0", sub: "#888", accent: "#2563eb",
  };

  if (!mounted) return null;

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
            Welcome back
          </h1>
          <p style={{ fontSize:14, color: T.sub, marginTop:6 }}>
            Your personal health coach
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

          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:12, fontWeight:600, color: T.sub,
              textTransform:"uppercase", letterSpacing:".05em",
              display:"block", marginBottom:8 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width:"100%", background:"#2c2c2c", border:"1px solid #3a3a3a",
                borderRadius:12, padding:"14px 16px", fontSize:15, color: T.text,
                fontFamily:"'DM Sans', sans-serif", transition:"border-color .2s" }} />
          </div>

          <div style={{ marginBottom:24 }}>
            <label style={{ fontSize:12, fontWeight:600, color: T.sub,
              textTransform:"uppercase", letterSpacing:".05em",
              display:"block", marginBottom:8 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === "Enter" && handleSignIn(e)}
              style={{ width:"100%", background:"#2c2c2c", border:"1px solid #3a3a3a",
                borderRadius:12, padding:"14px 16px", fontSize:15, color: T.text,
                fontFamily:"'DM Sans', sans-serif", transition:"border-color .2s" }} />
          </div>

          <button onClick={handleSignIn} disabled={loading || !email || !password}
            style={{ width:"100%", padding:"16px", borderRadius:14, border:"none",
              background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
              opacity: (loading || !email || !password) ? .5 : 1,
              boxShadow:"0 4px 16px #2563eb44", transition:"opacity .2s",
              fontFamily:"'DM Sans', sans-serif" }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div style={{ textAlign:"center", marginTop:20 }}>
            <span style={{ fontSize:13, color: T.sub }}>Don't have an account? </span>
            <button onClick={() => router.push("/signup")}
              style={{ fontSize:13, color:"#2563eb", fontWeight:600,
                background:"none", border:"none", cursor:"pointer",
                fontFamily:"'DM Sans', sans-serif" }}>
              Create one
            </button>
          </div>
        </div>
      </div>
    </>
  );
}