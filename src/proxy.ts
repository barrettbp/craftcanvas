import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Routes that do not require a Clerk session.
 * Everything else redirects signed-out visitors to the sign-in page
 * (pages) or returns 401 (API routes).
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/privacy",
  "/sign-in(.*)",
  "/api/webhooks(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // Clerk's `auth.protect()` answers a signed-out non-page request with a 404
  // rewrite, which would hide the handlers' own 401 (spec section 6 and 15:
  // "every API route returns 401 when signed out"). Answer 401 here instead;
  // the handlers still check `auth()` themselves as the primary guard.
  if (isApiRoute(req)) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return;
  }

  await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
