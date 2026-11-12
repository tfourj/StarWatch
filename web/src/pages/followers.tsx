import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, Search, UserMinus, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  ConfirmDialog,
  DeliveryBadge,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  StatCard,
  UserAvatar,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import type {
  Delivery,
  FollowerEventRow,
  FollowerEventsResponse,
  FollowersResponse,
  FollowerStatus,
  FollowerSyncSummary,
} from "@/lib/types";
import { cn, formatDateTime, formatNumber, timeAgo } from "@/lib/utils";

const EVENTS_PAGE_SIZE = 25;
const FOLLOWERS_PAGE_SIZE = 50;
// Both cards share a capped height and scroll their body, so long lists never stretch the page.
const LIST_CARD_CLASS = "max-h-[40rem] gap-0 py-0";
const LIST_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto px-0";

function useFollowerMutations() {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["followers"] });

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.put<FollowerStatus>("/followers", { enabled }),
    onSuccess: (status) => {
      toast.success(status.enabled ? "Follower tracking is on" : "Follower tracking is off");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const sync = useMutation({
    mutationFn: () => api.post<FollowerSyncSummary>("/followers/sync"),
    onSuccess: (s) => {
      if (s.skipped) toast.info("Check skipped, the GitHub rate limit is low");
      else if (s.imported) toast.success(`Imported ${formatNumber(s.followers)} followers`);
      else if (s.followed || s.unfollowed) toast.success(`${s.followed} new, ${s.unfollowed} unfollowed`);
      else toast.success("No follower changes");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const retry = useMutation({
    mutationFn: (delivery: Delivery) => api.post(`/followers/deliveries/${delivery.id}/retry`),
    onSuccess: () => {
      toast.success("Retry queued");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return { setEnabled, sync, retry };
}

function FollowBadge({ action }: { action: FollowerEventRow["action"] }) {
  return action === "followed" ? (
    <Badge variant="success">
      <UserPlus />
      Follow
    </Badge>
  ) : (
    <Badge variant="secondary">
      <UserMinus />
      Unfollow
    </Badge>
  );
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft />
        Previous
      </Button>
      <span className="tabular-nums">
        {page} / {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
        <ChevronRight />
      </Button>
    </div>
  );
}

function DeliveryList({ event, onRetry }: { event: FollowerEventRow; onRetry: (d: Delivery) => void }) {
  if (event.deliveries.length === 0) return <span className="text-xs text-muted-foreground">No channels</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {event.deliveries.map((d) => {
        const canRetry = d.status === "failed" || d.status === "retrying";
        const title = [d.lastError, canRetry ? "Click to retry now" : null].filter(Boolean).join(". ");
        return (
          <button
            key={d.id}
            type="button"
            disabled={!canRetry}
            onClick={() => onRetry(d)}
            title={title || undefined}
            className="disabled:cursor-default"
          >
            <DeliveryBadge status={d.status} label={d.channelName} />
          </button>
        );
      })}
    </div>
  );
}

function ActivityCard({ onRetry }: { onRetry: (d: Delivery) => void }) {
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: String(EVENTS_PAGE_SIZE) });
  const { data, isPending, error } = useQuery({
    queryKey: ["followers", "events", params.toString()],
    queryFn: () => api.get<FollowerEventsResponse>(`/followers/events?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [page]);

  return (
    <Card className={cn(LIST_CARD_CLASS, "xl:col-span-3")}>
      <CardHeader className="border-b py-4">
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent ref={bodyRef} className={cn(LIST_BODY_CLASS, "[&_[data-slot=table-container]]:overflow-visible")}>
        {error && (
          <div className="p-4">
            <ErrorNote>{error.message}</ErrorNote>
          </div>
        )}
        {isPending ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No follower changes yet"
            description="New followers and unfollows show up here."
          />
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Deliveries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-4">
                    <a
                      href={e.actorUrl ?? `https://github.com/${e.actorLogin}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      <UserAvatar src={e.actorAvatarUrl} login={e.actorLogin} size={28} />
                      {e.actorLogin}
                    </a>
                  </TableCell>
                  <TableCell>
                    <FollowBadge action={e.action} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatNumber(e.followerCount)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span title={formatDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>
                  </TableCell>
                  <TableCell>
                    <DeliveryList event={e} onRetry={onRetry} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
}

function FollowersCard({ status }: { status: FollowerStatus }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(FOLLOWERS_PAGE_SIZE) });
  if (search) params.set("q", search);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["followers", "list", params.toString()],
    queryFn: () => api.get<FollowersResponse>(`/followers/list?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: status.importing ? 3_000 : 30_000,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [page, search]);

  return (
    <Card className={cn(LIST_CARD_CLASS, "xl:col-span-2")}>
      <CardHeader className="border-b py-4">
        <CardTitle>Followers</CardTitle>
      </CardHeader>
      <div className="relative border-b p-3">
        <Search className="absolute top-1/2 left-6 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by user"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
        {isFetching && !isPending && (
          <Spinner className="absolute top-1/2 right-6 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>
      <CardContent ref={listRef} className={LIST_BODY_CLASS}>
        {error && (
          <div className="p-4">
            <ErrorNote>{error.message}</ErrorNote>
          </div>
        )}
        {isPending ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? "No matching users" : status.importing ? "Importing followers" : "No followers yet"}
            description={search ? "Try a different name." : undefined}
          />
        ) : (
          <ul className="divide-y">
            {data.items.map((f) => (
              <li key={f.githubUserId} className="flex items-center gap-3 px-4 py-2">
                <UserAvatar src={f.avatarUrl} login={f.login} size={28} />
                <a
                  href={`https://github.com/${f.login}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {f.login}
                </a>
                {f.followedAt && (
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(f.followedAt)}>
                    {timeAgo(f.followedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
}

function TrackingOff({
  status,
  pending,
  onEnable,
}: {
  status: FollowerStatus;
  pending: boolean;
  onEnable: () => void;
}) {
  if (!status.connected) {
    return (
      <Card>
        <EmptyState
          icon={Users}
          title="No GitHub token"
          description="Add a token to track who follows your GitHub account."
          action={
            <Button asChild>
              <Link to="/settings?tab=github">Open GitHub settings</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState
        icon={Users}
        title="Follower tracking is off"
        description={
          `Get notified when someone follows or unfollows ${status.login ? `@${status.login}` : "your account"}. ` +
          "Current followers are imported without alerts."
        }
        action={
          <Button onClick={onEnable} disabled={pending}>
            {pending ? <Spinner /> : <UserPlus />}
            Track followers
          </Button>
        }
      />
    </Card>
  );
}

export function FollowersPage() {
  const [confirmOff, setConfirmOff] = useState(false);
  const mutations = useFollowerMutations();
  const { data: status, isPending, error } = useQuery({
    queryKey: ["followers", "status"],
    queryFn: () => api.get<FollowerStatus>("/followers"),
    refetchInterval: (q) => (q.state.data?.importing ? 3_000 : 30_000),
  });

  if (isPending) return <Skeleton className="h-64" />;
  if (error || !status) return <ErrorNote>{error?.message ?? "Could not load followers"}</ErrorNote>;

  if (!status.enabled) {
    return (
      <TrackingOff
        status={status}
        pending={mutations.setEnabled.isPending}
        onEnable={() => mutations.setEnabled.mutate(true)}
      />
    );
  }

  const checked = status.checkedAt ? `Checked ${timeAgo(status.checkedAt)}` : "Not checked yet";
  const headerActions = (
    <>
      <Button variant="outline" onClick={() => setConfirmOff(true)}>
        Stop tracking
      </Button>
      <Button onClick={() => mutations.sync.mutate()} disabled={mutations.sync.isPending || status.importing}>
        {mutations.sync.isPending ? <Spinner /> : <RefreshCw />}
        Check now
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title="Followers"
        description={status.login ? `@${status.login} · ${checked}` : checked}
        actions={headerActions}
      />

      <div className="mb-4 flex flex-col gap-3 empty:hidden">
        {status.error && <ErrorNote>Last check failed: {status.error}</ErrorNote>}
        {status.importing && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Spinner />
            Importing your current followers. Alerts start after the import.
          </p>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Followers" value={formatNumber(status.followerCount)} icon={Users} accent />
        <StatCard label="New in 30 days" value={formatNumber(status.followed30d)} icon={UserPlus} />
        <StatCard label="Unfollows in 30 days" value={formatNumber(status.unfollowed30d)} icon={UserMinus} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <ActivityCard onRetry={(d) => mutations.retry.mutate(d)} />
        <FollowersCard status={status} />
      </div>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Stop tracking followers?"
        description={
          "The stored follower list is cleared and past activity stays. " +
          "Turning it back on imports your followers again without alerts."
        }
        confirmLabel="Stop tracking"
        destructive
        pending={mutations.setEnabled.isPending}
        onConfirm={() => mutations.setEnabled.mutate(false, { onSettled: () => setConfirmOff(false) })}
      />
    </>
  );
}
