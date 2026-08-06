import Link from "next/link";
import { Button } from "@/components/ui/button";

// A real kiosk is a public device a customer walks away from -- unlike the
// reference video (recorded by one person driving both the kiosk and the
// staff POS), this deliberately does NOT navigate the customer's screen
// into the staff POS. Staff instead pull the reservation up on their own
// device via the Kiosk Reservations list.
export default async function OrderConfirmedPage({ params }: { params: { storeSlug: string } }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Order Submitted!</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        A staff member will have your cards ready shortly. Please see the counter to complete your purchase.
      </p>
      <Button asChild>
        <Link href={`/kiosk/${params.storeSlug}`}>Continue Browsing</Link>
      </Button>
    </main>
  );
}
