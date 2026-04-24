// Force rebuild v3
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function middleware(req) {
  console.log("🔍 Middleware:", req.nextUrl.pathname);
  const res = NextResponse.next();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();
  
  console.log("👤 Session:", session ? "EXISTS" : "NONE");

  // Allow /profile/setup without profile check (needed for onboarding)
  if (req.nextUrl.pathname === "/profile/setup") {
    console.log("📝 Profile setup requested");
    if (!session) {
      console.log("❌ No session, redirect to signin");
      return NextResponse.redirect(new URL("/signin", req.url));
    }
    console.log("✅ Allowing profile setup");
    return res; // Allow access to setup page
  }

  // Protect routes that require authentication
  const protectedPaths = ["/profile", "/dashboard"];
  const isProtectedPath = protectedPaths.some((path) =>
    req.nextUrl.pathname.startsWith(path)
  );

  // Redirect to signin if not authenticated
  if (isProtectedPath && !session) {
    console.log("🔒 Protected path, no session");
    return NextResponse.redirect(new URL("/signin", req.url));
  }

  // Redirect to profile setup if authenticated but no profile
  if (session && req.nextUrl.pathname === "/") {
    console.log("🏠 Home page, checking for profile");
    try {
      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      console.log("📊 Profile check:", profile ? "FOUND" : "NOT FOUND", error ? `ERROR: ${error.message}` : "");
      
      if (!profile && !error) {
        console.log("➡️ Redirecting to profile setup");
        return NextResponse.redirect(new URL("/profile/setup", req.url));
      }
    } catch (error) {
      console.log("Profile check error:", error);
    }
  }

  return res;
}

export const config = {
  matcher: [],  // TEMPORARILY DISABLED - will re-enable after testing
};