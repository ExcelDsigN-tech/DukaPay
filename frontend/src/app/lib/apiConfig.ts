/**
 * Shared API configuration constants for frontend.
 *
 * Consolidates backend base URL resolution so fallback logic is defined in
 * exactly one place rather than duplicated across components, hooks, middleware,
 * and route handlers.
 */

export const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Public client-side API base URL.
 * Accessible in both client components and server-side code.
 */
export const NEXT_PUBLIC_API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

/**
 * API base URL.
 * On server side, respects `API_URL` if set, otherwise falls back to
 * `NEXT_PUBLIC_API_URL` (or `DEFAULT_API_URL`).
 */
export const API_URL: string = process.env.API_URL ?? NEXT_PUBLIC_API_URL;
