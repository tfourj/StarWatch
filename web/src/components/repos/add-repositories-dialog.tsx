import { ArrowDownUp, BookMarked, ListFilter, Lock, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HIDE_OPTIONS,
  NO_HIDDEN_KINDS,
  SORT_OPTIONS,
  hiddenCount,
  isVisible,
  matchesQuery,
  sortRepos,
  type HiddenKinds,
  type RepoSort,
} from "@/lib/repo-filters";
import type { Repo, RepoMode } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

const MODE_HELP: Record<RepoMode, string> = {
  webhook: "Instant alerts. Creates a webhook on each repo, so GitHub must reach your webhook URL.",
  polling: "Checks every polling interval. No webhook and no public URL needed.",
  both: "Webhook for instant alerts, polling to catch anything missed.",
};

export function AddRepositoriesDialog({
  open,
  repos,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Repositories that are not monitored yet. */
  repos: Repo[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (repoIds: number[], mode: RepoMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<RepoMode>("webhook");
  const [sort, setSort] = useState<RepoSort>("name");
  const [hidden, setHidden] = useState<HiddenKinds>(NO_HIDDEN_KINDS);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(new Set());
    }
  }, [open]);

  const shown = useMemo(
    () => sortRepos(repos.filter((r) => matchesQuery(r, query) && isVisible(r, hidden)), sort),
    [repos, query, hidden, sort],
  );
  const hiding = hiddenCount(hidden);
  const narrowed = query.trim() !== "" || hiding > 0;

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  function toggle(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleShown(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add repositories</DialogTitle>
          <DialogDescription>Pick the repositories StarWatch should watch for stars.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search repositories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as RepoSort)}>
              <SelectTrigger className="flex-1 sm:w-36 sm:flex-none" aria-label="Sort">
                <span className="flex min-w-0 items-center gap-2">
                  <ArrowDownUp className="size-4 text-muted-foreground" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Filter repositories">
                  <ListFilter />
                  Filter
                  {hiding > 0 && (
                    <Badge variant="secondary" className="px-1.5 tabular-nums">
                      {hiding}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {HIDE_OPTIONS.map((o) => (
                  <DropdownMenuCheckboxItem
                    key={o.key}
                    checked={hidden[o.key]}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(value) => setHidden((prev) => ({ ...prev, [o.key]: value === true }))}
                  >
                    {o.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="rounded-md border">
          {repos.length === 0 ? (
            <EmptyState
              icon={BookMarked}
              title="Everything is monitored"
              description="All your repositories are already monitored. Run a sync to pick up new ones."
            />
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm">
                <Checkbox
                  checked={allShownSelected}
                  disabled={shown.length === 0}
                  onCheckedChange={(v) => toggleShown(v === true)}
                />
                <span className="font-medium">
                  {narrowed ? `Select all ${shown.length} matching` : `Select all ${shown.length}`}
                </span>
                {selected.size > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">{selected.size} selected</span>
                )}
              </label>
              <ul className="max-h-[45dvh] divide-y overflow-y-auto">
                {shown.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching repositories</li>
                )}
                {shown.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{r.fullName}</span>
                          {r.private && (
                            <Badge variant="outline">
                              <Lock />
                              Private
                            </Badge>
                          )}
                          {r.fork && <Badge variant="outline">Fork</Badge>}
                          {r.archived && <Badge variant="outline">Archived</Badge>}
                        </div>
                        {r.description && <p className="truncate text-xs text-muted-foreground">{r.description}</p>}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm tabular-nums">
                        <Star className="size-3.5 fill-star text-star" />
                        {formatNumber(r.starCount)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="add-mode">Mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as RepoMode)}>
            <SelectTrigger id="add-mode" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="polling">Polling</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{MODE_HELP[mode]}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={selected.size === 0 || pending} onClick={() => onSubmit([...selected], mode)}>
            {pending && <Spinner />}
            {selected.size === 1 ? "Monitor 1 repository" : `Monitor ${selected.size} repositories`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
