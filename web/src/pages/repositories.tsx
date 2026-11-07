import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Bell, ChevronDown, Copy, Eye, EyeOff, Lock, RefreshCw, Search, Star, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { StargazersDialog } from "@/components/repos/stargazers-dialog";
import { ConfirmDialog, EmptyState, ErrorNote, HookBadge, PageHeader, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api";
import type { BulkMonitoringResult, ChannelSummary, Repo, RepoMode, ReposResponse, SyncSummary } from "@/lib/types";
import { formatNumber, timeAgo } from "@/lib/utils";

const MODES: { value: RepoMode; label: string }[] = [
  { value: "webhook", label: "Webhook" },
  { value: "polling", label: "Polling" },
  { value: "both", label: "Both" },
];

type Filter = "all" | "monitored" | "unmonitored" | "problems";

function useRepoMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["repos"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: number; monitored?: boolean; mode?: RepoMode }) =>
      api.patch<Repo>(`/repos/${id}`, patch),
    onSuccess: (repo) => {
      if (repo?.hookStatus === "error" && repo.hookError) toast.warning(`${repo.fullName}: ${repo.hookError}`);
      else toast.success(`${repo?.fullName ?? "Repository"} updated`);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setChannels = useMutation({
    mutationFn: ({ id, channelIds }: { id: number; channelIds: number[] }) =>
      api.put(`/repos/${id}/channels`, { channelIds }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const ping = useMutation({
    mutationFn: (id: number) => api.post(`/repos/${id}/ping`),
    onSuccess: () => toast.success("Ping sent. GitHub will deliver it within a few seconds."),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const sync = useMutation({
    mutationFn: () => api.post<SyncSummary>("/repos/sync"),
    onSuccess: (s) => {
      const parts = [`${s.repos} repositories`];
      if (s.added) parts.push(`${s.added} new`);
      if (s.hooksCreated) parts.push(`${s.hooksCreated} webhooks created`);
      if (s.hooksRepaired) parts.push(`${s.hooksRepaired} repaired`);
      if (s.hooksDeleted) parts.push(`${s.hooksDeleted} removed`);
      toast.success(`Sync complete: ${parts.join(", ")}`);
      if (s.hookErrors) toast.warning(`${s.hookErrors} webhooks have problems`);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const bulk = useMutation({
    mutationFn: (body: { monitored: boolean; repoIds?: number[] }) =>
      api.post<BulkMonitoringResult>("/repos/bulk", body),
    onSuccess: (result, { monitored }) => {
      const verb = monitored ? "Turned on" : "Turned off";
      const hooks = result.hooksPending
        ? ` ${monitored ? "Creating" : "Removing"} ${result.hooksPending} webhooks in the background.`
        : "";
      toast.success(`${verb} monitoring for ${result.updated} repositories.${hooks}`);
      invalidate();
      // Webhook statuses change in the background, refresh again shortly.
      setTimeout(invalidate, 5_000);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return { update, setChannels, ping, sync, bulk };
}

function ChannelPicker({
  repo,
  channels,
  onChange,
}: {
  repo: Repo;
  channels: ChannelSummary[];
  onChange: (ids: number[]) => void;
}) {
  const global = channels.filter((c) => c.allRepos);
  const scoped = channels.filter((c) => !c.allRepos);
  const assigned = channels.filter((c) => c.allRepos || repo.channelIds.includes(c.id));

  if (channels.length === 0) {
    return (
      <Link to="/channels" className="text-xs text-muted-foreground hover:underline">
        Add a channel
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-48 justify-between">
          <span className="truncate">
            {assigned.length === 0 ? "None" : assigned.map((c) => c.name).join(", ")}
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {global.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">All repositories</DropdownMenuLabel>
            {global.map((c) => (
              <DropdownMenuCheckboxItem key={c.id} checked disabled>
                {c.name}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
        {scoped.length > 0 && (
          <>
            {global.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Selected repositories</DropdownMenuLabel>
            {scoped.map((c) => {
              const checked = repo.channelIds.includes(c.id);
              return (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={checked}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(value) =>
                    onChange(value ? [...repo.channelIds, c.id] : repo.channelIds.filter((id) => id !== c.id))
                  }
                >
                  {c.name}
                  {!c.enabled && <span className="ml-auto text-xs text-muted-foreground">off</span>}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WebhookCell({ repo, onPing }: { repo: Repo; onPing: () => void }) {
  if (!repo.monitored) {
    if (repo.hookStatus !== "error") return <span className="text-xs text-muted-foreground">Off</span>;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="cursor-help">
            Not removed
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          The webhook is still on GitHub. The next sync retries. {repo.hookError}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (repo.mode === "polling") {
    return (
      <span className="text-xs text-muted-foreground">
        Polled {repo.lastPolledAt ? timeAgo(repo.lastPolledAt) : "soon"}
      </span>
    );
  }
  const badge = <HookBadge status={repo.hookStatus} />;
  return (
    <div className="flex items-center gap-1.5">
      {repo.hookError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">{badge}</span>
          </TooltipTrigger>
          <TooltipContent>{repo.hookError}</TooltipContent>
        </Tooltip>
      ) : (
        badge
      )}
      {repo.hookId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onPing} aria-label="Send test ping">
              <Zap className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ask GitHub to send a ping</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ImportNote({ repo }: { repo: Repo }) {
  if (!repo.monitored || repo.backfilledAt) return null;
  if (repo.backfillError) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="cursor-help">
            Import failed
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{repo.backfillError}</TooltipContent>
      </Tooltip>
    );
  }
  return <Badge variant="secondary">Importing stargazers</Badge>;
}

function RepoRow({
  repo,
  channels,
  mutations,
  onShowStargazers,
}: {
  repo: Repo;
  channels: ChannelSummary[];
  mutations: ReturnType<typeof useRepoMutations>;
  onShowStargazers: () => void;
}) {
  const busy = mutations.update.isPending && mutations.update.variables?.id === repo.id;
  return (
    <TableRow>
      <TableCell className="max-w-80 pl-4">
        <div className="flex items-center gap-2">
          <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
            {repo.fullName}
          </a>
          {repo.private && (
            <Badge variant="outline">
              <Lock />
              Private
            </Badge>
          )}
          {repo.fork && <Badge variant="outline">Fork</Badge>}
          {repo.archived && <Badge variant="outline">Archived</Badge>}
          <ImportNote repo={repo} />
        </div>
        {repo.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{repo.description}</p>}
      </TableCell>
      <TableCell className="tabular-nums">
        <button
          type="button"
          onClick={onShowStargazers}
          title="Show stargazers"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted"
        >
          <Star className="size-3.5 fill-star text-star" />
          {formatNumber(repo.starCount)}
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={repo.monitored}
            disabled={busy}
            onCheckedChange={(monitored) => mutations.update.mutate({ id: repo.id, monitored })}
            aria-label={`Monitor ${repo.fullName}`}
          />
          {busy && <Spinner className="text-muted-foreground" />}
        </div>
      </TableCell>
      <TableCell>
        <Select
          value={repo.mode}
          disabled={busy}
          onValueChange={(mode) => mutations.update.mutate({ id: repo.id, mode: mode as RepoMode })}
        >
          <SelectTrigger className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <WebhookCell repo={repo} onPing={() => mutations.ping.mutate(repo.id)} />
      </TableCell>
      <TableCell>
        <ChannelPicker
          repo={repo}
          channels={channels}
          onChange={(channelIds) => mutations.setChannels.mutate({ id: repo.id, channelIds })}
        />
      </TableCell>
    </TableRow>
  );
}

export function RepositoriesPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<ReposResponse>("/repos"),
    refetchInterval: 20_000,
  });
  const mutations = useRepoMutations();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const repos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.repos ?? []).filter((r) => {
      if (q && !r.fullName.toLowerCase().includes(q)) return false;
      if (filter === "monitored") return r.monitored;
      if (filter === "unmonitored") return !r.monitored;
      if (filter === "problems") return r.hookStatus === "error" || (r.monitored && Boolean(r.backfillError));
      return true;
    });
  }, [data, query, filter]);

  const [bulkTarget, setBulkTarget] = useState<boolean | null>(null);
  const [stargazersRepo, setStargazersRepo] = useState<Repo | null>(null);
  const filtered = query.trim() !== "" || filter !== "all";

  function runBulk(monitored: boolean) {
    mutations.bulk.mutate(
      { monitored, repoIds: filtered ? repos.map((r) => r.id) : undefined },
      { onSettled: () => setBulkTarget(null) },
    );
  }

  const syncButton = (
    <Button onClick={() => mutations.sync.mutate()} disabled={mutations.sync.isPending || !data?.hasToken}>
      {mutations.sync.isPending ? <Spinner /> : <RefreshCw />}
      Sync webhooks
    </Button>
  );

  const headerActions = (
    <>
      <Button variant="outline" onClick={() => setBulkTarget(false)} disabled={repos.length === 0}>
        <EyeOff />
        {filtered ? "Turn listed off" : "Turn all off"}
      </Button>
      <Button variant="outline" onClick={() => setBulkTarget(true)} disabled={repos.length === 0}>
        <Eye />
        {filtered ? "Turn listed on" : "Turn all on"}
      </Button>
      {syncButton}
    </>
  );

  return (
    <>
      <PageHeader
        title="Repositories"
        description={
          data?.lastSyncAt ? `Last synced ${timeAgo(data.lastSyncAt)}` : "Repositories you own on GitHub."
        }
        actions={headerActions}
      />

      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data?.lastSyncError && (
        <div className="mb-4">
          <ErrorNote>Last sync failed: {data.lastSyncError}</ErrorNote>
        </div>
      )}

      {data && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Webhook URL:</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{data.webhookUrl}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy webhook URL"
            onClick={() => {
              void navigator.clipboard.writeText(data.webhookUrl);
              toast.success("Webhook URL copied");
            }}
          >
            <Copy className="size-3.5" />
          </Button>
        </div>
      )}

      <Card className="py-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter repositories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All repositories</SelectItem>
              <SelectItem value="monitored">Monitored</SelectItem>
              <SelectItem value="unmonitored">Not monitored</SelectItem>
              <SelectItem value="problems">With problems</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CardContent className="px-0">
          {isPending ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !data?.hasToken ? (
            <EmptyState
              icon={BookMarked}
              title="Connect GitHub first"
              description="Add a personal access token with public_repo (or repo) and admin:repo_hook scopes."
              action={
                <Button asChild>
                  <Link to="/settings">Open settings</Link>
                </Button>
              }
            />
          ) : repos.length === 0 ? (
            <EmptyState
              icon={data.repos.length ? Search : Bell}
              title={data.repos.length ? "No matching repositories" : "No repositories yet"}
              description={data.repos.length ? "Try a different filter." : "Run a sync to import your repositories."}
              action={data.repos.length ? undefined : syncButton}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Repository</TableHead>
                  <TableHead>Stars</TableHead>
                  <TableHead>Monitor</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Webhook</TableHead>
                  <TableHead>Channels</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repos.map((repo) => (
                  <RepoRow
                    key={repo.id}
                    repo={repo}
                    channels={data.channels}
                    mutations={mutations}
                    onShowStargazers={() => setStargazersRepo(repo)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <StargazersDialog repo={stargazersRepo} onClose={() => setStargazersRepo(null)} />
      <ConfirmDialog
        open={bulkTarget !== null}
        onOpenChange={(open) => !open && setBulkTarget(null)}
        title={bulkTarget ? "Turn on monitoring?" : "Turn off monitoring?"}
        description={
          bulkTarget
            ? `Monitor ${repos.length} ${filtered ? "listed " : ""}repositories. Webhooks are created on GitHub ` +
              "for repos in webhook or both mode, so check the webhook URL first."
            : `Stop monitoring ${repos.length} ${filtered ? "listed " : ""}repositories and remove their webhooks ` +
              "from GitHub."
        }
        confirmLabel={bulkTarget ? "Turn on" : "Turn off"}
        destructive={bulkTarget === false}
        pending={mutations.bulk.isPending}
        onConfirm={() => bulkTarget !== null && runBulk(bulkTarget)}
      />
    </>
  );
}
