"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bug,
  ClipboardCheck,
  FolderTree,
  HeartPulse,
  Home,
  Play,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Toaster } from "./toaster";
import { TooltipProvider } from "./ui/tooltip";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Applications", icon: FolderTree },
  { href: "/features", label: "Feature checks", icon: ClipboardCheck },
  { href: "/executions", label: "Runs", icon: Play },
  { href: "/healings", label: "Healing", icon: HeartPulse },
  { href: "/bugs", label: "Bugs", icon: Bug },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <TooltipProvider>
    <div className="flex min-h-dvh">
      <aside className="bg-sidebar border-border hidden w-60 shrink-0 flex-col border-r md:flex">
        <Link
          href="/"
          className="border-border hover:bg-sidebar-accent/60 flex h-14 items-center gap-2 border-b px-5 transition-colors"
        >
          <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded font-mono text-xs font-bold">
            X
          </span>
          <span className="font-heading text-sm font-semibold">Agent X</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            // "/" would otherwise be a prefix of every route and light up
            // permanently, so the root matches exactly and nothing else does.
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <p className="text-muted-foreground border-border border-t px-5 py-3 text-xs">
          Local MVP — no auth
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
          <nav className="flex gap-4 md:hidden">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden md:block" />
          <ThemeToggle />
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

      <Toaster />
    </div>
    </TooltipProvider>
  );
}
