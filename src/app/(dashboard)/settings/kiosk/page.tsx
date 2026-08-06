import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { KioskPinForm } from "./kiosk-pin-form";
import { ReservationsList, type ReservationRow } from "./reservations-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function KioskSettingsPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data: store } = await supabase.from("stores").select("slug").eq("id", storeId).single();

  const { data: settings } = await supabase
    .from("kiosk_settings")
    .select("updated_at")
    .eq("store_id", storeId)
    .maybeSingle();

  const { data: reservationRows } = await supabase
    .from("kiosk_reservations")
    .select("id, customer_name_or_phone, total_cents, created_at, kiosk_reservation_items(id)")
    .eq("store_id", storeId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const reservations: ReservationRow[] = (reservationRows ?? []).map((r) => ({
    id: r.id as string,
    customerNameOrPhone: r.customer_name_or_phone as string,
    totalCents: r.total_cents as number,
    createdAt: r.created_at as string,
    itemCount: (r.kiosk_reservation_items as unknown[]).length,
  }));

  const kioskUrl = `${process.env.NEXT_PUBLIC_APP_URL}/kiosk/${store?.slug ?? ""}`;

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Kiosk</h1>
      <Card>
        <CardHeader>
          <CardTitle>Kiosk access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Kiosk URL: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{kioskUrl}</code>
          </p>
          {settings ? (
            <p className="text-sm text-muted-foreground">
              PIN configured (last updated {new Date(settings.updated_at as string).toLocaleString()}).
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No kiosk PIN set yet.</p>
          )}
          <KioskPinForm kioskUrl={kioskUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kiosk Reservations</CardTitle>
        </CardHeader>
        <CardContent>
          <ReservationsList initialReservations={reservations} />
        </CardContent>
      </Card>
    </main>
  );
}
