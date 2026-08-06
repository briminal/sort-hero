"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useKioskCart } from "@/hooks/use-kiosk-cart";
import { cartItemCount } from "@/lib/kiosk/cart";
import { Badge } from "@/components/ui/badge";

export function KioskCartLink({ storeSlug }: { storeSlug: string }) {
  const [cart] = useKioskCart(storeSlug);
  const count = cartItemCount(cart);

  return (
    <Link href={`/kiosk/${storeSlug}/cart`} className="relative flex items-center justify-center rounded-md p-2 hover:bg-accent" aria-label="View cart">
      <ShoppingCart className="size-5 text-foreground" />
      {count > 0 && (
        <Badge variant="destructive" className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full p-0 text-[10px]">
          {count}
        </Badge>
      )}
    </Link>
  );
}
