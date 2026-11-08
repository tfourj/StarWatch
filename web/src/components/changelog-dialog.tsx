import { ChevronRight, ExternalLink, GitCommitHorizontal, Tag } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANGELOG, type ChangelogRelease } from "@/lib/changelog";
import type { SetupStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/tfourj/StarWatch";
export const RELEASES_URL = `${REPO_URL}/releases`;

/** Renders `code` and **bold** inside a changelog line. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function formatDate(date: string | null) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

const SECTION_DOTS: Record<string, string> = {
  added: "bg-success",
  changed: "bg-star",
  fixed: "bg-warning",
  removed: "bg-destructive",
  security: "bg-destructive",
};

function sectionDot(title: string) {
  return SECTION_DOTS[title.toLowerCase()] ?? "bg-muted-foreground";
}

/** "7 added · 5 changed · 2 fixed", for a collapsed release. */
function summary(release: ChangelogRelease) {
  return release.sections
    .filter((section) => section.title && section.items.length)
    .map((section) => `${section.items.length} ${section.title!.toLowerCase()}`)
    .join(" · ");
}

function BuildStatus({ version, commit, ahead }: Pick<SetupStatus, "version" | "commit" | "ahead">) {
  const Icon = commit ? GitCommitHorizontal : Tag;
  let detail = "Stable release";
  let link = `${RELEASES_URL}/tag/v${version}`;
  if (commit && ahead) {
    detail = `${ahead.commits} ${ahead.commits === 1 ? "commit" : "commits"} ahead of v${ahead.release}`;
    link = `${REPO_URL}/compare/v${ahead.release}...${commit}`;
  } else if (commit) {
    detail = "Unreleased build";
    link = `${REPO_URL}/commit/${commit}`;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <DialogDescription asChild>
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-sm text-foreground tabular-nums">{commit ?? `v${version}`}</span>
          <span className="text-xs">{detail}</span>
        </div>
      </DialogDescription>
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {commit && ahead ? "Compare" : "View"}
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

function ReleaseNotes({ release }: { release: ChangelogRelease }) {
  return (
    <div className="flex flex-col gap-4 pt-1 pb-4 pl-9">
      {release.sections.map((section, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          {section.title && (
            <h4 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span className={cn("size-1.5 rounded-full", sectionDot(section.title))} />
              {section.title}
            </h4>
          )}
          {section.paragraphs.map((p, j) => (
            <p key={j} className="text-sm">
              {inline(p)}
            </p>
          ))}
          {section.items.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted-foreground">
              {section.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ReleaseItem({
  release,
  defaultOpen,
  badge,
}: {
  release: ChangelogRelease;
  defaultOpen: boolean;
  badge: ReactNode;
}) {
  const counts = summary(release);
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/release border-b last:border-b-0">
      <CollapsibleTrigger
        className={
          "flex w-full items-center gap-3 rounded-md px-1 py-3 text-left outline-none " +
          "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        }
      >
        <div className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]/release:rotate-90" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold">v{release.version}</span>
            {badge}
          </div>
          {counts && (
            <span className="truncate text-xs text-muted-foreground group-data-[state=open]/release:hidden">
              {counts}
            </span>
          )}
        </div>
        {release.date && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(release.date)}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent
        className={
          "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
        }
      >
        <ReleaseNotes release={release} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChangelogDialog({
  open,
  status,
  onOpenChange,
}: {
  open: boolean;
  status: Pick<SetupStatus, "version" | "commit" | "ahead"> | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  // Releases above the one a commit build is ahead of are in the changelog but not tagged yet.
  const baseIndex = status?.ahead ? CHANGELOG.findIndex((r) => r.version === status.ahead!.release) : -1;

  function badgeFor(release: ChangelogRelease, index: number) {
    if (index < baseIndex) return <Badge variant="warning">Unreleased</Badge>;
    if (!status?.commit && release.version === status?.version) return <Badge variant="success">Current</Badge>;
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
        </DialogHeader>

        {status ? (
          <BuildStatus {...status} />
        ) : (
          <DialogDescription className="sr-only">Release notes</DialogDescription>
        )}

        <div className="-mx-1 flex max-h-[55dvh] flex-col overflow-y-auto px-1">
          {CHANGELOG.map((release, i) => (
            <ReleaseItem key={release.version} release={release} defaultOpen={i === 0} badge={badgeFor(release, i)} />
          ))}
        </div>

        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          All releases on GitHub
          <ExternalLink className="size-3.5" />
        </a>
      </DialogContent>
    </Dialog>
  );
}
