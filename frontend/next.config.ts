import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./i18n.config.ts");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});

// The documented local/dev default (http://localhost:3001, see .env.example)
// is neither 'self' (different port) nor https:, so connect-src must name it
// explicitly or every browser fetch to the API is silently CSP-blocked.
// (Now handled in middleware.ts for nonce-based CSP)

// Next.js dev mode (webpack and Turbopack alike) executes hot-reloaded
// module chunks via eval() — without 'unsafe-eval' the dev bundle can't run
// at all, so nothing hydrates. Production builds don't need it.
// (Now handled in middleware.ts)

// The App Router streams its RSC/hydration payload through inline
// <script> tags (self.__next_f.push(...), self.__next_r, etc.) on every
// render, dev and prod alike. We now use a nonce-based CSP via middleware
// to secure these hydration scripts without relying on 'unsafe-inline'.


const nextConfig: NextConfig = {
  reactCompiler: true,
  // Issue #407: Security headers for XSS prevention
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        // HSTS: instruct browsers to only use HTTPS for 2 years, including
        // subdomains, and opt into the preload list. Downgrade attacks become
        // impossible once the browser has seen this header. See issue #535.
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        // COOP: prevents other browsing contexts (e.g. pop-ups opened by
        // this page) from sharing the same agent cluster, strengthening
        // cross-origin isolation. See issue #535.
        {
          key: "Cross-Origin-Opener-Policy",
          value: "same-origin",
        },
        // CORP: prevents other origins from loading our resources in their
        // own documents, reducing Spectre-style side-channel risk. See issue #535.
        {
          key: "Cross-Origin-Resource-Policy",
          value: "same-origin",
        },
      ],
    },
  ],
};

const config = withSerwist(nextConfig);

export default withNextIntl(
  withSentryConfig(config, {
    silent: !process.env.CI,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
    },
    autoInstrumentServerFunctions: true,
  }),
);
