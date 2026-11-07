import { CircleAlert, Loader2, Star, StarOff, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeliveryStatus, HookStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  loading,
  accent,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: ReactNode;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          )}
          {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("rounded-lg p-2", accent ? "bg-star/15 text-star" : "bg-muted text-muted-foreground")}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-2 rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function UserAvatar({ src, login, size = 32 }: { src?: string | null; login: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase"
        style={{ width: size, height: size }}
      >
        {login.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={login}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-muted"
    />
  );
}

export function ActionBadge({ action }: { action: "created" | "deleted" }) {
  return action === "created" ? (
    <Badge variant="star">
      <Star className="fill-current" />
      Star
    </Badge>
  ) : (
    <Badge variant="secondary">
      <StarOff />
      Unstar
    </Badge>
  );
}

const hookVariants: Record<HookStatus, { label: string; variant: "success" | "destructive" | "warning" | "outline" }> = {
  active: { label: "Active", variant: "success" },
  error: { label: "Error", variant: "destructive" },
  missing: { label: "Missing", variant: "warning" },
  none: { label: "None", variant: "outline" },
};

export function HookBadge({ status }: { status: HookStatus }) {
  const v = hookVariants[status];
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

const deliveryVariants: Record<DeliveryStatus, "success" | "destructive" | "warning" | "secondary"> = {
  success: "success",
  failed: "destructive",
  retrying: "warning",
  pending: "secondary",
};

export function DeliveryBadge({ status, label }: { status: DeliveryStatus; label?: string }) {
  return <Badge variant={deliveryVariants[status]}>{label ?? status}</Badge>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {pending && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
