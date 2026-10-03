import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale } from "./src/app/lib/locales";

export default getRequestConfig(async ({ locale, requestLocale }) => {
  // `locale` is only set when a server function is called with an explicit
  // locale; otherwise use the [locale] segment matched by the proxy.
  const requested = locale ?? (await requestLocale);
  const resolved = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  const enMessages = (await import(`./messages/${DEFAULT_LOCALE}.json`)).default;
  const localeMessages =
    resolved === DEFAULT_LOCALE
      ? enMessages
      : (await import(`./messages/${resolved}.json`)).default;

  return {
    locale: resolved,
    // Fall back to English for keys missing from the requested locale so
    // pages never render raw keys like "AgentDashboard.title". Merged per
    // namespace so a partially translated namespace still falls back key-wise.
    messages: Object.fromEntries(
      Object.keys(enMessages).map((ns) => [
        ns,
        {
          ...(enMessages[ns] as Record<string, unknown>),
          ...((localeMessages[ns] ?? {}) as Record<string, unknown>),
        },
      ]),
    ),
  };
});
