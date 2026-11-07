import { Download, Pause, Play, ScrollText, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  id: number;
  time: string;
  level: Level;
  scope: string | null;
  msg: string;
  fields: Record<string, unknown>;
}

interface LogsResponse {
  entries: LogEntry[];
  lastId: number;
  scopes: string[];
  logLevel: Level;
}

const POLL_MS = 3_000;
const MAX_ROWS = 1_000;

const LEVEL_STYLES: Record<Level, "secondary" | "outline" | "warning" | "destructive"> = {
  debug: "outline",
  info: "secondary",
  warn: "warning",
  error: "destructive",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object" && "message" in (value as object)) {
    return String((value as { message: unknown }).message);
  }
  return JSON.stringify(value);
}

function shortTime(iso: string) {
  const format = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return format.format(new Date(iso));
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const fields = Object.entries(entry.fields);
  return (
    <li className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-2 text-left font-mono text-xs hover:bg-muted/50"
      >
        <span className="shrink-0 text-muted-foreground tabular-nums" title={formatDateTime(entry.time)}>
          {shortTime(entry.time)}
        </span>
        <Badge variant={LEVEL_STYLES[entry.level]} className="w-12 shrink-0 justify-center uppercase">
          {entry.level}
        </Badge>
        <span className="hidden w-24 shrink-0 truncate text-muted-foreground sm:inline">
          {entry.scope ?? "app"}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(entry.level === "error" && "text-destructive", entry.level === "warn" && "text-warning")}
          >
            {entry.msg}
          </span>
          {!open && fields.length > 0 && (
            <span className="ml-2 break-all text-muted-foreground">
              {fields.map(([k, v]) => `${k}=${formatValue(v)}`).join(" ")}
            </span>
          )}
        </span>
      </button>
      {open && (
        <pre className="mx-4 mb-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {JSON.stringify(
            { time: entry.time, level: entry.level, scope: entry.scope, msg: entry.msg, ...entry.fields },
            null,
            2,
          )}
        </pre>
      )}
    </li>
  );
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [logLevel, setLogLevel] = useState<Level>("info");
  const [level, setLevel] = useState<"" | Level>("");
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchLogs = useCallback(
    async (incremental: boolean) => {
      const params = new URLSearchParams({ limit: "500" });
      if (incremental && lastId.current) params.set("after", String(lastId.current));
      if (level) params.set("level", level);
      if (scope) params.set("scope", scope);
      if (search) params.set("q", search);
      try {
        const data = await api.get<LogsResponse>(`/logs?${params}`);
        lastId.current = data.lastId;
        setScopes(data.scopes);
        setLogLevel(data.logLevel);
        setEntries((prev) => {
          const next = incremental ? [...prev, ...data.entries] : data.entries;
          return next.slice(-MAX_ROWS);
        });
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [level, scope, search],
  );

  // Reload from scratch whenever the filters change.
  useEffect(() => {
    lastId.current = 0;
    setLoading(true);
    void fetchLogs(false);
  }, [fetchLogs]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void fetchLogs(true), POLL_MS);
    return () => clearInterval(timer);
  }, [live, fetchLogs]);

  const newestFirst = useMemo(() => [...entries].reverse(), [entries]);

  function download() {
    const text = entries
      .map((e) => JSON.stringify({ time: e.time, level: e.level, scope: e.scope, msg: e.msg, ...e.fields }))
      .join("\n");
    const url = URL.createObjectURL(new Blob([text + "\n"], { type: "application/x-ndjson" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `starwatch-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Logs"
        actions={
          <>
            <Button variant="outline" onClick={() => setLive((l) => !l)}>
              {live ? <Pause /> : <Play />}
              {live ? "Pause" : "Resume"}
            </Button>
            <Button variant="outline" onClick={download} disabled={entries.length === 0}>
              <Download />
              Download
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-2 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search messages and fields"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={level || "all"} onValueChange={(v) => setLevel(v === "all" ? "" : (v as Level))}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="info">Info and above</SelectItem>
                <SelectItem value="warn">Warnings and errors</SelectItem>
                <SelectItem value="error">Errors only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scope || "all"} onValueChange={(v) => setScope(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All areas</SelectItem>
                {scopes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          <span>
            {entries.length} {entries.length === 1 ? "line" : "lines"}
            {logLevel !== "debug" && " · debug lines are not recorded, set LOG_LEVEL=debug to include them"}
          </span>
          {live && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-success" />
              Live
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : newestFirst.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={level || scope || search ? "No matching log lines" : "No log lines yet"}
            description={level || scope || search ? "Try other filters." : undefined}
          />
        ) : (
          <ul>
            {newestFirst.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
