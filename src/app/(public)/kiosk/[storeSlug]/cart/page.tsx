import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/service";
import { kioskCookieName, verifyKioskSession } from "@/lib/kiosk/session";
import { CartView } from "./cart-view";

export default async function KioskCartPage({ params }: { params: { storeSlug: string } }) {
  const supabase = getServiceClient();
  const { data: store } = await supabase.from("stores").select("id, name").eq("slug", params.storeSlug).maybeSingle();

  if (!store) notFound();

  const cookieStore = await cookies();
  const token = cookieStore.get(kioskCookieName())?.value;
  const unlocked = verifyKioskSession(token, store.id as string);
  if (!unlocked) redirect(`/kiosk/${params.storeSlug}`);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <CartView storeSlug={params.storeSlug} />
    </main>
  );
}
