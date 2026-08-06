import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OfflineBanner } from "@/components/offline-banner";
import { ServiceWorkerRegister } from "../service-worker-register";
import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <ServiceWorkerRegister />
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar userEmail={user.email ?? ""} />
        <OfflineBanner />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
