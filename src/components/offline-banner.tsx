"use client";

import { useOnlineStatus } from "@/hooks/use-online-status";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div role="alert" className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      You&apos;re offline — changes won&apos;t save until connection is restored.
    </div>
  );
}
