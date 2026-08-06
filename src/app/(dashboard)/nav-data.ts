import {
  BarChart3,
  Boxes,
  CreditCard,
  HandCoins,
  MonitorSmartphone,
  PackageSearch,
  ScanLine,
  Settings,
  Share2,
  Tags,
  Truck,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavSection = { label: string; items: NavItem[] };

// Grouped sections mirror the SortSwift dashboard's sidebar *pattern*
// (sectioned nav with uppercase labels), not their exact category names --
// Sort Hero's own module set doesn't map 1:1 onto SortSwift's.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Tools",
    items: [
      { href: "/scanning", label: "Scanning", icon: ScanLine },
      { href: "/inventory", label: "Inventory", icon: Boxes },
      { href: "/autopricing", label: "Autopricing", icon: Tags },
    ],
  },
  {
    label: "Sell",
    items: [
      { href: "/pos", label: "POS", icon: CreditCard },
      { href: "/buylist", label: "Buylist", icon: HandCoins },
      { href: "/orders", label: "Orders", icon: PackageSearch },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/settings/marketplaces", label: "Marketplaces", icon: Share2 },
      { href: "/settings/shipping", label: "Shipping", icon: Truck },
      { href: "/settings/kiosk", label: "Kiosk", icon: MonitorSmartphone },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "Account",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
