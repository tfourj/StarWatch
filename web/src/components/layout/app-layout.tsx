import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  BookMarked,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Settings,
  Star,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useTheme } from "@/components/theme-provider";
import { UserAvatar } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import type { CurrentUser } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/repositories", label: "Repositories", icon: BookMarked },
  { to: "/events", label: "Events", icon: Activity },
  { to: "/channels", label: "Channels", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 px-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-star/15">
        <Star className="size-4 fill-star text-star" />
      </div>
      <span className="text-base font-semibold tracking-tight">StarWatch</span>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )
          }
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light" as const, icon: Sun, label: "Light" },
    { value: "dark" as const, icon: Moon, label: "Dark" },
    { value: "system" as const, icon: Monitor, label: "System" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          aria-label={`${o.label} theme`}
          onClick={() => setTheme(o.value)}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md py-1 text-muted-foreground transition-colors",
            theme === o.value ? "bg-accent text-foreground" : "hover:text-foreground",
          )}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function UserMenu({ user }: { user: CurrentUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    navigate("/login", { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60"
        >
          <UserAvatar src={user.image} login={user.name} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Signed in as {user.role === "admin" ? "admin" : "user"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings?tab=account")}>
          <Settings />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarBody({ user, onNavigate }: { user: CurrentUser; onNavigate?: () => void }) {
  return (
    <>
      <Brand />
      <NavItems onNavigate={onNavigate} />
      <div className="flex flex-col gap-3 border-t border-sidebar-border p-3">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </>
  );
}

export function AppLayout({ user }: { user: CurrentUser }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = NAV.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarBody user={user} />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody user={user} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="md:pl-64">
        <header
          className={
            "sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:hidden"
          }
        >
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <Star className="size-4 fill-star text-star" />
          <span className="font-semibold">{current?.label ?? "StarWatch"}</span>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={<Skeleton className="h-64" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
