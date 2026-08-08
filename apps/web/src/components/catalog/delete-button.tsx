"use client";

import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe } from "@/lib/use-api";

/**
 * Delete, behind a confirmation that spells out what else goes with it.
 *
 * Uses a dialog rather than `window.confirm`: a native modal blocks the whole
 * page, and "are you sure?" without naming the cascade is not informed consent.
 */
export function DeleteButton({
  path,
  label,
  cascadeWarning,
  onDeleted,
}: {
  path: string;
  label: string;
  cascadeWarning: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    setFailure(null);
    setPending(true);

    try {
      await apiFetch(path, z.undefined(), { method: "DELETE" });
      setOpen(false);
      onDeleted();
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>{cascadeWarning}</DialogDescription>
        </DialogHeader>

        {failure ? <ErrorBanner message={failure} /> : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
