"use client";

// ═══ [v97] SHARED BOTTOM NAV ═════════════════════════════════════════════════
// ONE nav for the whole app. Previously this markup was copy-pasted into every
// page (and had already drifted: dashboard used router.push, coach used
// window.location). Adding the Plan tab meant editing N files — now it's one.
//
// Props:
//   active — "coach" | "plan" | "dashboard" | "profile" (highlights that tab)
//   t      — the page's theme object (needs .surface, .border, .sub)
//   fixed  — true (default): fixed to viewport bottom (dashboard/plan/profile
//            pattern). false: renders inline at the end of a flex column (coach
//            pattern, where the chat input sits above it).

import { useRouter } from "next/navigation";

const TABS = [
  { id: "coach",     icon: "💬", label: "Coach",     path: "/" },
  { id: "plan",      icon: "📅", label: "Plan",      path: "/plan" },
  { id: "dashboard", icon: "📊", label: "Dashboard", path: "/dashboard" },
  { id: "profile",   icon: "⚙️", label: "Profile",   path: "/profile" },
];

export default function BottomNav({ active, t, fixed = true }) {
  const router = useRouter();

  const outerStyle = fixed
    ? {
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 430,
        background: t.surface, borderTop: `1px solid ${t.border}`,
        display: "flex", zIndex: 100,
        paddingBottom: "env(safe-area-inset-bottom, 8px)",
      }
    : {
        background: t.surface, borderTop: `1px solid ${t.border}`,
        display: "flex", zIndex: 100,
        paddingBottom: "env(safe-area-inset-bottom, 8px)",
      };

  return (
    <div style={outerStyle}>
      {TABS.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => router.push(tab.path)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 3, padding: "10px 0 4px",
              border: "none", background: "transparent", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: isActive ? 700 : 500,
              color: isActive ? "#2563eb" : t.sub,
              letterSpacing: ".03em", fontFamily: "'DM Sans', sans-serif",
            }}>
              {tab.label}
            </span>
            {isActive && (
              <div style={{ width: 18, height: 2, background: "#2563eb", borderRadius: 9999 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}