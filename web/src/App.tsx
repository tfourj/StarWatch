import { Loader2 } from "lucide-react";
import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/components/layout/app-layout";
import { useMe, useSetupStatus } from "@/hooks/use-session";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";

const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const RepositoriesPage = lazy(() => import("@/pages/repositories").then((m) => ({ default: m.RepositoriesPage })));
const EventsPage = lazy(() => import("@/pages/events").then((m) => ({ default: m.EventsPage })));
const ChannelsPage = lazy(() => import("@/pages/channels").then((m) => ({ default: m.ChannelsPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })));

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function App() {
  const setup = useSetupStatus();
  const me = useMe();

  if (setup.isPending || me.isPending) return <Splash />;

  if (setup.data?.needsSetup) {
    return (
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    );
  }

  const user = me.data;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {setup.data?.registrationOpen && <Route path="/register" element={<RegisterPage />} />}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout user={user} />}>
        <Route index element={<DashboardPage />} />
        <Route path="repositories" element={<RepositoriesPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="settings" element={<SettingsPage user={user} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
