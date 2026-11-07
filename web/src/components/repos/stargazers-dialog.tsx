import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, ErrorNote, Spinner, UserAvatar } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { Repo, StargazersResponse } from "@/lib/types";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 50;

function ImportStatus({ data }: { data: StargazersResponse }) {
  const { repo } = data;
  if (repo.backfilledAt) return null;
  if (repo.importing) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Spinner />
        Importing existing stargazers from GitHub. The list fills in when it finishes.
      </p>
    );
  }
  if (repo.backfillError) {
    return (
      <ErrorNote>
        <p>
          Import of existing stargazers failed and retries on the next sync. Only stars seen since monitoring
          started are listed.
        </p>
        <p className="mt-1 text-xs opacity-80">{repo.backfillError}</p>
      </ErrorNote>
    );
  }
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      The import of existing stargazers has not started yet. Only stars seen since monitoring started are listed.
    </p>
  );
}

export function StargazersDialog({ repo, onClose }: { repo: Repo | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setPage(1);
    setQuery("");
    setSearch("");
  }, [repo?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) params.set("q", search);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["stargazers", repo?.id, params.toString()],
    queryFn: () => api.get<StargazersResponse>(`/repos/${repo!.id}/stargazers?${params}`),
    enabled: Boolean(repo),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => {
      const r = q.state.data?.repo;
      return r && !r.backfilledAt && !r.backfillError ? 3_000 : false;
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Dialog open={Boolean(repo)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <Star className="size-4 fill-star text-star" />
            <span className="truncate">{repo?.fullName}</span>
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${formatNumber(data.total)} ${search ? "matching" : "tracked"} stargazers` +
                ` · ${formatNumber(data.repo.starCount)} on GitHub`
              : "Tracked stargazers"}
          </DialogDescription>
        </DialogHeader>

        {data && <ImportStatus data={data} />}
        {error && <ErrorNote>{error.message}</ErrorNote>}

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by user"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
          {isFetching && !isPending && (
            <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>

        <div className="max-h-[50dvh] overflow-y-auto rounded-md border">
          {isPending ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={Star}
              title={search ? "No matching users" : "No stargazers tracked yet"}
              description={search ? "Try a different name." : undefined}
            />
          ) : (
            <ul className="divide-y">
              {data.items.map((s) => (
                <li key={s.githubUserId} className="flex items-center gap-3 px-3 py-2">
                  <UserAvatar src={s.avatarUrl} login={s.login} size={28} />
                  <a
                    href={`https://github.com/${s.login}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {s.login}
                  </a>
                  <span
                    className="shrink-0 text-xs text-muted-foreground"
                    title={s.starredAt ? formatDateTime(s.starredAt) : undefined}
                  >
                    {s.starredAt ? timeAgo(s.starredAt) : "unknown"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data && totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
              Previous
            </Button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
              <ChevronRight />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
