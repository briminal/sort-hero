import Link from "next/link";
import { Share2, Truck, MonitorSmartphone, Receipt, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const SETTINGS_LINKS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  {
    href: "/settings/store",
    label: "Store",
    description: "Tax rate and total rounding for POS checkout",
    icon: Receipt,
  },
  {
    href: "/settings/marketplaces",
    label: "Marketplaces",
    description: "Connect Shopify and TCGplayer, manage sync",
    icon: Share2,
  },
  {
    href: "/settings/shipping",
    label: "Shipping",
    description: "Connect Shippo and manage your ship-from address",
    icon: Truck,
  },
  {
    href: "/settings/kiosk",
    label: "Kiosk",
    description: "Set the in-store kiosk PIN and get its URL",
    icon: MonitorSmartphone,
  },
];

export default function SettingsPage() {
  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader className="flex-row items-center gap-3 space-y-0">
                  <Icon className="size-5 text-primary" />
                  <CardTitle>{item.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{item.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
