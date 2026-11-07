import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookMarked, CalendarDays, Star, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GitHubIcon } from "@/components/icons";
import { ActionBadge, EmptyState, ErrorNote, StatCard, UserAvatar } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { formatNumber, timeAgo } from "@/lib/utils";

function shortDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Dashboard["chart"][number] }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{shortDate(point.date)}</p>
      <p className="flex items-center gap-2">
        <span className="size-2 rounded-sm bg-chart-star" />
        {point.stars} new {point.stars === 1 ? "star" : "stars"}
      </p>
      {point.unstars > 0 && <p className="mt-0.5 text-muted-foreground">{point.unstars} removed</p>}
    </div>
  );
}

function StarsChart({ data }: { data: Dashboard["chart"] }) {
  const total = data.reduce((sum, d) => sum + d.stars, 0);
  // Size the axis to the largest label so values like 100 or 1,000 are not clipped.
  const maxLabel = formatNumber(Math.max(4, ...data.map((d) => d.stars)));
  const axisWidth = 16 + maxLabel.length * 7;
  return (
    <Card>
      <CardHeader>
        <CardTitle>New stars per day</CardTitle>
        <CardDescription>Last 30 days across monitored repositories</CardDescription>
        <CardAction>
          <span className="text-sm font-medium tabular-nums">{formatNumber(total)}</span>
        </CardAction>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={axisWidth}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip />} />
            <Bar dataKey="stars" fill="var(--chart-star)" radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function RecentEvents({ events }: { events: Dashboard["recentEvents"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Latest stars and unstars</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/events">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {events.length === 0 ? (
          <EmptyState icon={Star} title="No events yet" description="New stars and unstars will show up here." />
        ) : (
          <ul className="divide-y">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-6 py-3">
                <UserAvatar src={e.actorAvatarUrl} login={e.actorLogin} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <a href={e.actorUrl ?? "#"} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {e.actorLogin}
                    </a>{" "}
                    <span className="text-muted-foreground">{e.action === "created" ? "starred" : "unstarred"}</span>{" "}
                    <a href={e.repoUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {e.repoFullName}
                    </a>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(e.occurredAt)} · via {e.source} · {formatNumber(e.starCount)} stars
                  </p>
                </div>
                <ActionBadge action={e.action} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SideCards({ data }: { data: Dashboard }) {
  const rate = data.github.rateLimit;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitHubIcon className="size-4" />
            GitHub
          </CardTitle>
          <CardDescription>
            {data.github.connected ? `Connected as ${data.github.login}` : "No token configured"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {!data.github.connected && (
            <Button asChild size="sm">
              <Link to="/settings">Add a GitHub token</Link>
            </Button>
          )}
          {data.github.connected && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last sync</span>
                <span>{timeAgo(data.github.lastSyncAt)}</span>
              </div>
              {rate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">API requests left</span>
                  <span className="tabular-nums">
                    {formatNumber(rate.remaining)} / {formatNumber(rate.limit)}
                  </span>
                </div>
              )}
            </>
          )}
          {data.github.lastSyncError && <ErrorNote>{data.github.lastSyncError}</ErrorNote>}
          {data.stats.hookErrors > 0 && (
            <Link to="/repositories" className="flex items-center gap-2 text-sm text-warning hover:underline">
              <AlertTriangle className="size-4" />
              {data.stats.hookErrors} webhook {data.stats.hookErrors === 1 ? "problem" : "problems"}
            </Link>
          )}
          {data.stats.failedDeliveries > 0 && (
            <Link to="/events?status=failed" className="flex items-center gap-2 text-sm text-destructive hover:underline">
              <AlertTriangle className="size-4" />
              {data.stats.failedDeliveries} failed {data.stats.failedDeliveries === 1 ? "delivery" : "deliveries"} this week
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top repositories</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {data.topRepos.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">Run a sync to import your repositories.</p>
          ) : (
            <ul className="divide-y">
              {data.topRepos.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-6 py-2.5 text-sm">
                  <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {r.fullName}
                  </a>
                  <Badge variant="outline" className="tabular-nums">
                    <Star className="fill-star text-star" />
                    {formatNumber(r.starCount)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/dashboard"),
    refetchInterval: 30_000,
  });
  const s = data?.stats;

  return (
    <>
      {error && <ErrorNote>{error.message}</ErrorNote>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total stars"
          value={formatNumber(s?.totalStars ?? 0)}
          icon={Star}
          accent
          loading={isPending}
          hint={s ? `${s.monitored} of ${s.repositories} repositories monitored` : undefined}
        />
        <StatCard label="Stars today" value={formatNumber(s?.starsToday ?? 0)} icon={TrendingUp} loading={isPending} />
        <StatCard label="Last 7 days" value={formatNumber(s?.stars7d ?? 0)} icon={CalendarDays} loading={isPending} />
        <StatCard label="Last 30 days" value={formatNumber(s?.stars30d ?? 0)} icon={BookMarked} loading={isPending} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {data ? (
          <>
            <div className="flex flex-col gap-6 lg:col-span-2">
              <StarsChart data={data.chart} />
              <RecentEvents events={data.recentEvents} />
            </div>
            <SideCards data={data} />
          </>
        ) : (
          <>
            <Skeleton className="h-80 lg:col-span-2" />
            <Skeleton className="h-80" />
          </>
        )}
      </div>
    </>
  );
}
