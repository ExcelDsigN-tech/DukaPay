"use client";

import { useEffect } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useThemeStore } from "../../stores/useThemeStore";

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

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const label = theme === "dark" ? "Dark mode" : theme === "light" ? "Light mode" : "System";
  const nextLabel = theme === "dark" ? "system" : theme === "system" ? "light" : "dark";

  return (
    <button
      onClick={toggleTheme}
      className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-fg transition-colors hover:bg-subtle"
      aria-label={`${label} active, switch to ${nextLabel} mode`}
      aria-live="polite"
      title={label}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
