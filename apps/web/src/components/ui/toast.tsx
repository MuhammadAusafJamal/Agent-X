"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { CheckCircle2, Info, XCircle, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitive.Provider;

function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "fixed right-0 bottom-0 z-100 flex w-full max-w-sm flex-col gap-2 p-4 outline-none",
        className,
      )}
      {...props}
    />
  );
}

const TONE = {
  success: {
    icon: CheckCircle2,
    className: "border-border bg-card",
    iconClassName: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    icon: XCircle,
    className: "border-destructive/40 bg-destructive/10",
    iconClassName: "text-destructive",
  },
  info: {
    icon: Info,
    className: "border-border bg-card",
    iconClassName: "text-muted-foreground",
  },
} as const;

export type ToastTone = keyof typeof TONE;

function Toast({
  tone = "info",
  title,
  description,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & {
  tone?: ToastTone;
  title: string;
  description?: string;
}) {
  const { icon: Icon, className, iconClassName } = TONE[tone];

  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClassName)} />

      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-sm font-medium">
          {title}
        </ToastPrimitive.Title>
        {description ? (
          <ToastPrimitive.Description className="text-muted-foreground mt-0.5 text-sm">
            {description}
          </ToastPrimitive.Description>
        ) : null}
      </div>

      <ToastPrimitive.Close
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <XIcon className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export { Toast, ToastProvider, ToastViewport };
