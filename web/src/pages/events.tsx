import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ActionBadge, DeliveryBadge, EmptyState, ErrorNote, PageHeader, Spinner, UserAvatar } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import type { Delivery, DeliveryAttempt, EventRow, EventsResponse, ReposResponse } from "@/lib/types";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 25;

function DeliveryDialog({ delivery, onClose }: { delivery: Delivery | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const attempts = useQuery({
    queryKey: ["attempts", delivery?.id],
    queryFn: () => api.get<{ attempts: DeliveryAttempt[] }>(`/events/deliveries/${delivery!.id}/attempts`),
    enabled: Boolean(delivery),
  });
  const retry = useMutation({
    mutationFn: () => api.post(`/events/deliveries/${delivery!.id}/retry`),
    onSuccess: () => {
      toast.success("Retry queued");
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={Boolean(delivery)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Delivery to {delivery?.channelName}</DialogTitle>
          <DialogDescription>
            {delivery?.status === "retrying" && delivery.nextAttemptAt
              ? `Next attempt ${timeAgo(delivery.nextAttemptAt)}`
              : `Status: ${delivery?.status}`}
          </DialogDescription>
        </DialogHeader>
        {attempts.isPending ? (
          <Skeleton className="h-20" />
        ) : attempts.data?.attempts.length ? (
          <ul className="divide-y rounded-md border text-sm">
            {attempts.data.attempts.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Attempt {a.attempt}</span>
                  <DeliveryBadge status={a.success ? "success" : "failed"} label={a.success ? "ok" : "error"} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(a.createdAt)} · {a.durationMs} ms
                </span>
                {a.error && <code className="text-xs break-words text-destructive">{a.error}</code>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No attempts yet.</p>
        )}
        {delivery && delivery.status !== "success" && (
          <div className="flex justify-end">
            <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending ? <Spinner /> : <RotateCcw />}
              Retry now
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeliveryList({ event, onOpen }: { event: EventRow; onOpen: (d: Delivery) => void }) {
  if (event.deliveries.length === 0) return <span className="text-xs text-muted-foreground">No channels</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {event.deliveries.map((d) => (
        <button key={d.id} type="button" onClick={() => onOpen(d)} title={d.lastError ?? undefined}>
          <DeliveryBadge status={d.status} label={d.channelName} />
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
      <SelectTrigger className={className ?? "w-full sm:w-40"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const [openDelivery, setOpenDelivery] = useState<Delivery | null>(null);
  const page = Number(params.get("page") ?? 1) || 1;
  const filters = {
    q: params.get("q") ?? "",
    repoId: params.get("repoId") ?? "",
    action: params.get("action") ?? "",
    status: params.get("status") ?? "",
    source: params.get("source") ?? "",
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const search = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [k, v] of Object.entries(filters)) if (v) search.set(k, v);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["events", search.toString()],
    queryFn: () => api.get<EventsResponse>(`/events?${search}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const repos = useQuery({ queryKey: ["repos"], queryFn: () => api.get<ReposResponse>("/repos") });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Events"
        description="Every star and unstar, with the delivery status for each channel."
        actions={isFetching && !isPending ? <Spinner className="text-muted-foreground" /> : undefined}
      />
      {error && <ErrorNote>{error.message}</ErrorNote>}

      <Card className="py-0">
        <div className="flex flex-col gap-2 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by user"
              defaultValue={filters.q}
              onChange={(e) => setParam("q", e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <FilterSelect
              value={filters.repoId}
              onChange={(v) => setParam("repoId", v)}
              placeholder="All repositories"
              className="col-span-2 w-full sm:w-52"
              options={(repos.data?.repos ?? [])
                .filter((r) => r.monitored)
                .map((r) => ({ value: String(r.id), label: r.fullName }))}
            />
            <FilterSelect
              value={filters.action}
              onChange={(v) => setParam("action", v)}
              placeholder="All actions"
              options={[
                { value: "created", label: "Stars" },
                { value: "deleted", label: "Unstars" },
              ]}
            />
            <FilterSelect
              value={filters.status}
              onChange={(v) => setParam("status", v)}
              placeholder="Any delivery"
              options={[
                { value: "success", label: "Delivered" },
                { value: "failed", label: "Failed" },
                { value: "retrying", label: "Retrying" },
                { value: "pending", label: "Pending" },
                { value: "none", label: "No channels" },
              ]}
            />
            <FilterSelect
              value={filters.source}
              onChange={(v) => setParam("source", v)}
              placeholder="Any source"
              options={[
                { value: "webhook", label: "Webhook" },
                { value: "polling", label: "Polling" },
              ]}
            />
          </div>
        </div>

        <CardContent className="px-0">
          {isPending ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={hasFilters ? "No matching events" : "No events yet"}
              description={
                hasFilters ? "Try clearing some filters." : "Stars and unstars on monitored repositories appear here."
              }
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={() => setParams({}, { replace: true })}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Stars</TableHead>
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
                      <ActionBadge action={e.action} />
                    </TableCell>
                    <TableCell className="max-w-56">
                      <a href={e.repoUrl} target="_blank" rel="noreferrer" className="block truncate hover:underline">
                        {e.repoFullName}
                      </a>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatNumber(e.starCount)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span title={formatDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>
                      <Badge variant="outline" className="ml-2">
                        {e.source}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DeliveryList event={e} onOpen={setOpenDelivery} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {data && data.total > 0 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              {formatNumber((page - 1) * PAGE_SIZE + 1)} to {formatNumber(Math.min(page * PAGE_SIZE, data.total))} of{" "}
              {formatNumber(data.total)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam("page", String(page - 1))}
              >
                <ChevronLeft />
                Previous
              </Button>
              <span className="tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setParam("page", String(page + 1))}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <DeliveryDialog delivery={openDelivery} onClose={() => setOpenDelivery(null)} />
    </>
  );
}
