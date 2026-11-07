import { ExternalLink } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANGELOG } from "@/lib/changelog";

export const RELEASES_URL = "https://github.com/tfourj/StarWatch/releases";

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
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(parsed);
}

export function ChangelogDialog({
  open,
  currentVersion,
  onOpenChange,
}: {
  open: boolean;
  currentVersion: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>
            {currentVersion ? `You are running StarWatch v${currentVersion}.` : "StarWatch release notes."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60dvh] flex-col gap-6 overflow-y-auto pr-1">
          {CHANGELOG.map((release) => (
            <section key={release.version} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">v{release.version}</h3>
                {release.version === currentVersion && <Badge variant="secondary">Current</Badge>}
                {release.date && (
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(release.date)}</span>
                )}
              </div>
              {release.sections.map((section, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  {section.title && (
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
            </section>
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
