"use client";

import { useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../../stores/useThemeStore";
import { getSystemTheme } from "../../lib/theme";

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const hydrated = useThemeStore((state) => state.hydrated);
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  useEffect(() => {
    if (!hydrated) {
      initializeTheme();
    }
  }, [hydrated, initializeTheme]);

  // Prevent hydration mismatch and flash of unstyled icon
  if (!hydrated) {
    return (
      <button className="h-10 w-10 text-transparent" aria-hidden="true" disabled>
        <div className="h-5 w-5" />
      </button>
    );
  }

  // The icon shows where the switch goes, as in the Figma nav: sun on Cobalt, moon on Paper.
  const isDark = (theme === "system" ? getSystemTheme() : theme) === "dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-fg transition-colors hover:bg-subtle"
      aria-label={label}
      title={label}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
