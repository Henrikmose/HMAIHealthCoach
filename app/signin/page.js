"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true); // Default to true
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message || "Failed to sign in");
        setLoading(false);
        return;
      }

      if (data?.session && data?.user) {
        // Store the REAL user_id from Supabase auth
        localStorage.setItem("user_id", data.user.id);
        localStorage.setItem("user_name", data.user.user_metadata?.name || email.split("@")[0]);

        // Save "Remember Me" preference
        if (rememberMe) {
          localStorage.setItem("rememberMe", "true");
          localStorage.setItem("userEmail", email);
        } else {
          localStorage.removeItem("rememberMe");
          localStorage.removeItem("userEmail");
        }

        // Redirect to coach page
        router.push("/");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
      setLoading(false);
    }
  };

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
          maxWidth: "400px",
          width: "100%",
          background: "#242424",
          border: "1px solid #2c2c2c",
          borderRadius: "16px",
          padding: "40px",
        }}
      >
        <h1
          style={{
            fontSize: "32px",
            fontWeight: 800,
            color: "#f0f0f0",
            marginBottom: "8px",
            fontFamily: "DM Sans, sans-serif",
            textAlign: "center",
          }}
        >
          CURA
        </h1>

        <p
          style={{
            color: "#888",
            fontSize: "14px",
            textAlign: "center",
            marginBottom: "30px",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          AI Health Coaching
        </p>

        <form onSubmit={handleSignIn}>
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
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
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
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
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

          {/* ── Remember Me Checkbox ── */}
          <div
            style={{
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <input
              type="checkbox"
              id="rememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{
                width: "18px",
                height: "18px",
                cursor: "pointer",
                accentColor: "#2563eb",
              }}
            />
            <label
              htmlFor="rememberMe"
              style={{
                color: "#f0f0f0",
                fontSize: "14px",
                cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Remember me
            </label>
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
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              background: loading ? "#666" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              fontSize: "16px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "DM Sans, sans-serif",
              marginBottom: "10px",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div
          style={{
            textAlign: "center",
            marginTop: "20px",
          }}
        >
          <span style={{ color: "#888", fontSize: "14px", fontFamily: "DM Sans, sans-serif" }}>
            Don't have an account?{" "}
          </span>
          <button
            onClick={() => router.push("/signup")}
            style={{
              background: "none",
              border: "none",
              color: "#2563eb",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            Sign up
          </button>
        </div>
      </div>
    </div>
  );
}