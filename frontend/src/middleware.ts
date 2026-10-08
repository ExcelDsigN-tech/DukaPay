import createMiddleware from "next-intl/middleware";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./app/lib/locales";
import { NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware({
  // A list of all locales that are supported
  locales: LOCALES,

  // Used when no locale matches
  defaultLocale: DEFAULT_LOCALE,

  // Remember the chosen language across visits
  localeCookie: { name: LOCALE_COOKIE, maxAge: LOCALE_COOKIE_MAX_AGE },
});

// Spanish and Tagalog were removed. Send old links to the English page.
const RETIRED_LOCALE = /^\/(es|tl)(?=\/|$)/;

export default function middleware(request: NextRequest) {
  if (RETIRED_LOCALE.test(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname.replace(RETIRED_LOCALE, `/${DEFAULT_LOCALE}`);
    return NextResponse.redirect(url, 308);
  }

  // 1. Run intl middleware first to get the base response and handle routing
  const response = intlMiddleware(request);

  // 2. Generate nonce
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  // 3. Construct CSP
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' data: https:;
    font-src 'self' https: data:;
    connect-src 'self' https: ${apiUrl};
    frame-ancestors 'self';
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  // 4. Set headers in response
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("x-nonce", nonce);

  // 5. Pass headers to the request so they can be read in Server Components (like layout.tsx) via headers()
  // Next.js uses the 'x-middleware-request-' prefix to pass headers downstream.
  response.headers.set("x-middleware-request-x-nonce", nonce);
  response.headers.set("x-middleware-request-content-security-policy", cspHeader);

  return response;
}

export const config = {
  // Match only internationalized pathnames
  matcher: ["/", "/(en|es|tl)/:path*"],
};
