/**
 * Locale-aware formatting utilities for currency and dates.
 *
 * All components should use these helpers instead of constructing
 * `Intl.NumberFormat` / `Date.toLocaleDateString` inline with a hardcoded
 * "en-US" locale string.  Pass the `[locale]` route segment (from
 * `useLocale()` / Next.js params) as the first argument; the helpers fall
 * back to `"en-US"` for any locale not recognised by the runtime.
 *
 * See issue #536.
 */

import { DEFAULT_MODE, DISPLAY_DECIMAL_PLACES, RoundingMode } from "../../../lib/money/format";

const FALLBACK_LOCALE = "en-US";

/** money-policy.json rounding mode, as `Intl.NumberFormat` names it. */
const INTL_ROUNDING_MODE: Record<RoundingMode, Intl.NumberFormatOptions["roundingMode"]> = {
  [RoundingMode.HalfEven]: "halfEven",
  [RoundingMode.HalfUp]: "halfExpand",
  [RoundingMode.Floor]: "floor",
  [RoundingMode.Ceil]: "ceil",
};

/**
 * Format a numeric `amount` as a USD currency string in the given locale,
 * rounded to the display precision and mode in money-policy.json (half-even
 * to 2 decimals), so a shown balance never exceeds what is owed.
 *
 * @example
 *   formatCurrency(1234.5, "es")   // "1234,50 US$"
 *   formatCurrency(1234.5, "tl")   // "US$1,234.50"
 *   formatCurrency(1234.5)         // "$1,234.50"  (en-US fallback)
 */
export function formatCurrency(amount: number, locale: string = FALLBACK_LOCALE): string {
  const resolvedLocale = resolveLocale(locale);
  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: DISPLAY_DECIMAL_PLACES,
    maximumFractionDigits: DISPLAY_DECIMAL_PLACES,
    roundingMode: INTL_ROUNDING_MODE[DEFAULT_MODE],
  }).format(amount);
}

/**
 * Format an ISO date/timestamp string in the given locale.
 *
 * @example
 *   formatDate("2024-03-15T00:00:00Z", "es")  // "15 mar 2024"
 *   formatDate("2024-03-15T00:00:00Z", "tl")  // "Mar 15, 2024"
 *   formatDate("2024-03-15T00:00:00Z")         // "Mar 15, 2024"  (en-US fallback)
 */
export function formatDate(iso: string, locale: string = FALLBACK_LOCALE): string {
  const resolvedLocale = resolveLocale(locale);
  const date = new Date(iso);
  // Undated items (e.g. a loan still being indexed) render blank, not "Invalid Date".
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(resolvedLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a Date object as a locale-aware date string.
 *
 * Convenience overload for callers that already hold a `Date` instance.
 */
export function formatDateObj(
  date: Date,
  locale: string = FALLBACK_LOCALE,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  const resolvedLocale = resolveLocale(locale);
  return date.toLocaleDateString(resolvedLocale, options);
}

/**
 * Format a locale-aware date+time string (used e.g. in notification timestamps).
 */
export function formatDateTime(
  iso: string,
  locale: string = FALLBACK_LOCALE,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
): string {
  const resolvedLocale = resolveLocale(locale);
  return new Date(iso).toLocaleString(resolvedLocale, options);
}

/**
 * Format a plain number with locale-aware grouping separators.
 *
 * @example
 *   formatNumber(1234567.89, "es")  // "1.234.567,89"
 *   formatNumber(1234567.89)         // "1,234,567.89"
 */
export function formatNumber(
  value: number,
  locale: string = FALLBACK_LOCALE,
  options?: Intl.NumberFormatOptions,
): string {
  const resolvedLocale = resolveLocale(locale);
  return new Intl.NumberFormat(resolvedLocale, options).format(value);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Validate that `locale` is a well-formed BCP-47 tag supported by the
 * runtime, returning the fallback when it isn't.  This prevents
 * `RangeError: invalid language tag` from propagating to the UI.
 */
function resolveLocale(locale: string): string {
  try {
    // `Intl.getCanonicalLocales` throws on invalid tags.
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch {
    return FALLBACK_LOCALE;
  }
}
