import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/service";
import { getActiveGamesQuery } from "@/lib/games";
import { kioskCookieName, verifyKioskSession } from "@/lib/kiosk/session";
import { FullscreenToggle } from "./fullscreen-toggle";
import { PinEntryForm } from "./pin-entry-form";
import { KioskBrowser } from "./kiosk-browser";
import { KioskCartLink } from "./kiosk-cart-link";

export default async function KioskStorePage({ params }: { params: { storeSlug: string } }) {
  const supabase = getServiceClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, name")
    .eq("slug", params.storeSlug)
    .maybeSingle();

  if (!store) notFound();

  const cookieStore = await cookies();
  const token = cookieStore.get(kioskCookieName())?.value;
  const unlocked = verifyKioskSession(token, store.id as string);
  const games = unlocked ? await getActiveGamesQuery(supabase) : [];

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <span className="text-lg font-semibold text-foreground">{store.name as string}</span>
        <div className="flex items-center gap-1">
          {unlocked && <KioskCartLink storeSlug={params.storeSlug} />}
          <FullscreenToggle />
        </div>
      </header>

      {unlocked ? (
        <KioskBrowser storeSlug={params.storeSlug} games={games} />
      ) : (
        <PinEntryForm storeSlug={params.storeSlug} storeName={store.name as string} />
      )}
    </main>
  );
}
