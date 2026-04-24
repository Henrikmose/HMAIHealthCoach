"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // 1. Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setError("Failed to create account");
        setLoading(false);
        return;
      }

      // 2. Save user_id to localStorage as backup
      localStorage.setItem("user_id", authData.user.id);

      // 3. Wait a moment for session to establish
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 4. Redirect to setup wizard
      router.push("/profile/setup");
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
          width: "100%",
          maxWidth: "400px",
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
            marginBottom: "10px",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          Create Account
        </h1>
        <p
          style={{
            color: "#888",
            marginBottom: "30px",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          Let's get you set up with CURA
        </p>

        <form onSubmit={handleSignup}>
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
              required
              disabled={loading}
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
              placeholder="you@example.com"
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
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
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
              placeholder="At least 8 characters"
            />
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
              borderRadius: "14px",
              fontSize: "16px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "DM Sans, sans-serif",
              transition: "background 0.2s",
            }}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div
          style={{
            marginTop: "20px",
            textAlign: "center",
            color: "#888",
            fontSize: "14px",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          Already have an account?{" "}
          <a
            href="/signin"
            style={{
              color: "#2563eb",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}