import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "../(auth)/actions";
import { MobileNav } from "./mobile-nav";

export function AppTopbar({ userEmail }: { userEmail: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <MobileNav />
      <span className="text-lg font-bold md:hidden">
        Sort<span className="text-primary">Hero</span>
      </span>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">{userEmail}</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="gap-1.5">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
