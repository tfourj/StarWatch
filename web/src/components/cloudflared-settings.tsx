import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ErrorNote, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import type { TunnelMode, TunnelSettings, TunnelState, TunnelUpdateResponse } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const ZERO_TRUST_URL = "https://one.dash.cloudflare.com/";

const STATE_BADGE: Record<TunnelState, { label: string; variant: "outline" | "warning" | "success" | "destructive" }> = {
  stopped: { label: "Off", variant: "outline" },
  starting: { label: "Connecting", variant: "warning" },
  connected: { label: "Connected", variant: "success" },
  error: { label: "Error", variant: "destructive" },
};

type TunnelPatch = Partial<{ enabled: boolean; mode: TunnelMode; token: string; hostname: string }>;

export function CloudflaredSettings() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["settings", "cloudflared"],
    queryFn: () => api.get<TunnelSettings>("/settings/cloudflared"),
    refetchInterval: (q) => (q.state.data?.status.state === "starting" ? 2_000 : 15_000),
  });

  const [mode, setMode] = useState<TunnelMode>("token");
  const [token, setToken] = useState("");
  const [hostname, setHostname] = useState("");
  useEffect(() => {
    if (!data) return;
    setMode(data.mode);
    setHostname(data.hostname ?? "");
  }, [data?.mode, data?.hostname]);

  const update = useMutation({
    mutationFn: (body: TunnelPatch) => api.put<TunnelSettings>("/settings/cloudflared", body),
    onSuccess: (next, body) => {
      queryClient.setQueryData(["settings", "cloudflared"], next);
      void queryClient.invalidateQueries({ queryKey: ["settings"], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
      setToken("");
      if (body.enabled === false) toast.success("Tunnel stopped");
      else toast.success(next.enabled ? "Saved. Tunnel is restarting." : "Saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const checkUpdate = useMutation({
    mutationFn: () => api.post<TunnelUpdateResponse>("/settings/cloudflared/update"),
    onSuccess: ({ update: result, ...next }) => {
      queryClient.setQueryData(["settings", "cloudflared"], next);
      if (!result) return;
      toast.success(result.updated ? `Updated to ${result.version}` : `${result.version} is the latest version`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (isPending || !data) return <Skeleton className="h-64" />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ mode, hostname, ...(token.trim() ? { token } : {}) });
  }

  const badge = STATE_BADGE[data.status.state];
  const binary = data.status.binary;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tunnel</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="tunnel-enabled">Enabled</Label>
            <Switch
              id="tunnel-enabled"
              checked={data.enabled}
              disabled={update.isPending}
              onCheckedChange={(enabled) => update.mutate({ enabled })}
            />
          </div>

          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="tunnel-mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as TunnelMode)}>
                <SelectTrigger id="tunnel-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="token">Tunnel token</SelectItem>
                  <SelectItem value="quick">Quick tunnel</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "token" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="tunnel-token">{data.tokenHint ? "Replace token" : "Token"}</Label>
                  <Input
                    id="tunnel-token"
                    type="password"
                    autoComplete="off"
                    placeholder={data.tokenHint ?? "eyJ..."}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tunnel-hostname">Public hostname</Label>
                  <Input
                    id="tunnel-hostname"
                    placeholder="stars.example.com"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    In the tunnel&apos;s public hostname settings, set the service to{" "}
                    <code>{data.localService}</code>.
                  </p>
                </div>
                <a
                  href={ZERO_TRUST_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  Create a tunnel in Cloudflare Zero Trust
                  <ExternalLink className="size-3" />
                </a>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No Cloudflare account needed. The URL changes every time the tunnel starts and webhooks are updated
                automatically.
              </p>
            )}

            <div>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Spinner />}
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">State</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          {data.status.state !== "stopped" && (
            <>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Connections</span>
                <span className="tabular-nums">{data.status.connections}</span>
              </div>
              {data.status.since && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Since</span>
                  <span>{timeAgo(data.status.since)}</span>
                </div>
              )}
            </>
          )}
          {data.webhookUrl && (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {data.webhookUrl}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Copy webhook URL"
                onClick={() => {
                  void navigator.clipboard.writeText(data.webhookUrl!);
                  toast.success("Copied");
                }}
              >
                <Copy />
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">cloudflared</span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {binary.version ?? (binary.installed ? "Unknown version" : "Downloads on start")}
              </span>
              {binary.managed && binary.supported && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Check for cloudflared updates"
                  disabled={checkUpdate.isPending}
                  onClick={() => checkUpdate.mutate()}
                >
                  {checkUpdate.isPending ? <Spinner /> : <RefreshCw />}
                </Button>
              )}
            </div>
          </div>
          {binary.managed && binary.lastCheckAt && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Last update check</span>
              <span>{timeAgo(binary.lastCheckAt)}</span>
            </div>
          )}
          {!binary.supported && (
            <ErrorNote>No cloudflared build for this platform. Set CLOUDFLARED_PATH.</ErrorNote>
          )}
          {binary.updateError && binary.updateError !== data.status.error && (
            <ErrorNote>{binary.updateError}</ErrorNote>
          )}
          {data.status.error && <ErrorNote>{data.status.error}</ErrorNote>}
        </CardContent>
      </Card>
    </div>
  );
}
