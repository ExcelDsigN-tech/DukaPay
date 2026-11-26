import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  THEME_STORAGE_KEY,
  type Theme,
  getSystemTheme,
  getStoredTheme,
  applyTheme,
  resolveInitialTheme,
} from "../lib/theme";

interface ThemeState {
  theme: Theme;
  hydrated: boolean;
}

interface ThemeActions {
  initializeTheme: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export type ThemeStore = ThemeState & ThemeActions;

let hasAttachedSystemThemeListener = false;

export const useThemeStore = create<ThemeStore>()(
  devtools(
    (set, get) => ({
      theme: "dark",
      hydrated: false,

      initializeTheme: () => {
        const theme = resolveInitialTheme();
        applyTheme(theme);
        set({ theme, hydrated: true }, false, "theme/initializeTheme");

        if (typeof window === "undefined" || hasAttachedSystemThemeListener) {
          return;
        }

        hasAttachedSystemThemeListener = true;
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleSystemThemeChange = () => {
          // Only users who chose "system" in Settings follow the OS.
          if (getStoredTheme() !== "system") return;
          applyTheme("system");
          set({ theme: "system" }, false, "theme/syncSystemTheme");
        };

        mediaQuery.addEventListener("change", handleSystemThemeChange);
      },

      setTheme: (theme) => {
        applyTheme(theme);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        }
        set({ theme, hydrated: true }, false, "theme/setTheme");
      },

      toggleTheme: () => {
        // The header switch is two-way: light and dark. "System" stays a Settings option.
        const current = get().theme;
        const resolved = current === "system" ? getSystemTheme() : current;
        get().setTheme(resolved === "dark" ? "light" : "dark");
      },
    }),
    { name: "ThemeStore" },
  ),
);

export const selectTheme = (state: ThemeStore) => state.theme;
export const selectThemeHydrated = (state: ThemeStore) => state.hydrated;
