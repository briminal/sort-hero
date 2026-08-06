"use client";

import { useEffect, useRef, useState } from "react";
import { updateKioskPin } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function KioskPinForm({ kioskUrl }: { kioskUrl: string }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);

    const result = await updateKioskPin({ pin });
    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setPin("");
    setSuccess(true);
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(kioskUrl);
    setCopied(true);
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" variant="outline" size="sm" onClick={copyUrl}>
          {copied ? "Copied!" : "Copy kiosk URL"}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor="new-kiosk-pin">Set/rotate PIN (4-6 digits)</Label>
          <Input
            id="new-kiosk-pin"
            type="text"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            PIN updated.
          </p>
        )}
        <div>
          <Button type="submit" disabled={submitting || pin.length < 4}>
            {submitting ? "Saving..." : "Save PIN"}
          </Button>
        </div>
      </form>
    </div>
  );
}
