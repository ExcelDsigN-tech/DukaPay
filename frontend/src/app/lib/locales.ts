// Every locale here must have a matching messages/<code>.json file.
// DukaPay ships in English only for now. To add a language: add its code here,
// add messages/<code>.json, and add it to the middleware matcher.
export const LOCALES = ["en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// next-intl's proxy reads this cookie to pick the locale for unprefixed URLs.
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
