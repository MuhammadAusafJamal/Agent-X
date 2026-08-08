"use client";

import { Moon, Sun } from "lucide-react";

/**
 * Flips the `dark` class and remembers the choice.
 *
 * Holds no React state on purpose: which icon to show is a pure function of the
 * `dark` class, so CSS can decide it. Tracking it in state would mean reading
 * the DOM in an effect and calling setState — a cascading render, and a
 * server/client mismatch on first paint.
 */
export function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("agentx-theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-9 items-center justify-center rounded-md transition-colors"
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </button>
  );
}
