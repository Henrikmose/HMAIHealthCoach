import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function middleware(req) {
  const res = NextResponse.next();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Allow /profile/setup without profile check (needed for onboarding)
  if (req.nextUrl.pathname === "/profile/setup") {
    if (!session) {
      return NextResponse.redirect(new URL("/signin", req.url));
    }
    return res; // Allow access to setup page
  }

  // Protect routes that require authentication
  const protectedPaths = ["/profile", "/dashboard"];
  const isProtectedPath = protectedPaths.some((path) =>
    req.nextUrl.pathname.startsWith(path)
  );

  // Redirect to signin if not authenticated
  if (isProtectedPath && !session) {
    return NextResponse.redirect(new URL("/signin", req.url));
  }

  // Redirect to profile setup if authenticated but no profile
  if (session && req.nextUrl.pathname === "/") {
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("id", session.user.id)
        .single();

      if (!profile) {
        return NextResponse.redirect(new URL("/profile/setup", req.url));
      }
    } catch (error) {
      console.log("Profile check error:", error);
    }
  }

  return res;
}

export const config = {
  matcher: ["/", "/profile/:path*", "/dashboard/:path*"],
};