import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveLegacyRouteRedirect } from "@media-app/shared";

export function middleware(request: NextRequest) {
  const redirect = resolveLegacyRouteRedirect(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (!redirect) return NextResponse.next();
  return NextResponse.redirect(new URL(redirect, request.url));
}

export const config = {
  matcher: ["/media", "/library", "/watch", "/deck", "/favorites"],
};
