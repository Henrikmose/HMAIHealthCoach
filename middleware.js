import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Pages that don't need auth
  const publicPages = ["/signin", "/signup"];
  if (publicPages.includes(pathname)) {
    return NextResponse.next();
  }

  // Check if user has auth token in cookies
  const authToken = request.cookies.get("sb-auth-token")?.value;
  const isLoggedIn = !!authToken;

  // Protected routes - redirect to signin if not logged in
  const protectedRoutes = ["/profile", "/dashboard", "/"];
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtectedRoute && !isLoggedIn) {
    // Not logged in on protected route → redirect to signin
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};