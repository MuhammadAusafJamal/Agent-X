"use client";

import { Toast, ToastProvider, ToastViewport } from "@/components/ui/toast";
import { dismissToast, useToasts } from "@/lib/use-toast";

/** The single viewport every `toast.*` call renders into. Mounted in the shell. */
export function Toaster() {
  const toasts = useToasts();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, tone, title, description }) => (
        <Toast
          key={id}
          tone={tone}
          title={title}
          description={description}
          duration={5000}
          onOpenChange={(open) => {
            if (!open) dismissToast(id);
          }}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
