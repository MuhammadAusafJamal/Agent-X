"use client";

import { useSyncExternalStore } from "react";
import type { ToastTone } from "@/components/ui/toast";

/**
 * Transient confirmations, from anywhere.
 *
 * A module-level store rather than context, because the callers are scattered
 * — a dialog three levels deep, an SSE handler, a copy button — and threading a
 * provider through all of them buys nothing when there is exactly one viewport.
 *
 * Deliberately small: a toast confirms something already visible in the data.
 * Anything a user must act on belongs on the page, not in a message that
 * disappears after five seconds.
 */

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

let messages: ToastMessage[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function push(tone: ToastTone, title: string, description?: string): void {
  messages = [...messages, { id: nextId++, tone, title, description }];
  emit();
}

export function dismissToast(id: number): void {
  messages = messages.filter((message) => message.id !== id);
  emit();
}

export const toast = {
  success: (title: string, description?: string) =>
    push("success", title, description),
  error: (title: string, description?: string) =>
    push("error", title, description),
  info: (title: string, description?: string) =>
    push("info", title, description),
};

export function useToasts(): ToastMessage[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => messages,
    // The server renders none; toasts only ever come from an interaction.
    () => EMPTY,
  );
}

const EMPTY: ToastMessage[] = [];
