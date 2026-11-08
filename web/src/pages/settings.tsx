import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseLinks, renderTemplate, stripLinks, TEMPLATE_VARIABLES, type MessageTemplates } from "@shared/templates";
import { CheckCircle2, Copy, ExternalLink, KeyRound, Plus, RefreshCw, Trash2, UserCog } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { CloudflaredSettings } from "@/components/cloudflared-settings";
import { ConfirmDialog, ErrorNote, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { CurrentUser, ManagedUser, Role, Settings } from "@/lib/types";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/utils";

const TOKEN_URL =
  "https://github.com/settings/tokens/new?description=StarWatch&scopes=public_repo,admin:repo_hook";

function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
}

function useSaveSettings() {
  const queryClient = useQueryClient();
  return (data: Settings) => {
    queryClient.setQueryData(["settings"], data);
    void queryClient.invalidateQueries({ queryKey: ["repos"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

/* --------------------------------- GitHub -------------------------------- */

function GitHubTab({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const [token, setToken] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const gh = settings.github;

  const saveToken = useMutation({
    mutationFn: () => api.put<Settings>("/settings/github-token", { token }),
    onSuccess: (data) => {
      save(data);
      setToken("");
      toast.success(`Token saved for ${data.github.login}. Syncing repositories in the background.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const check = useMutation({
    mutationFn: () => api.post<Settings>("/settings/github-token/check"),
    onSuccess: (data) => {
      save(data);
      toast.success("Token is valid");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<Settings>("/settings/github-token"),
    onSuccess: (data) => {
      save(data);
      setConfirmRemove(false);
      toast.success("Token removed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    saveToken.mutate();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Personal access token</CardTitle>
          <CardDescription>
            A classic token with <code>public_repo</code> (or <code>repo</code> for private repositories) and{" "}
            <code>admin:repo_hook</code>. It is encrypted at rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {gh.connected && (
            <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="size-4 text-success" />
                  {gh.login}
                </span>
                <code className="text-xs text-muted-foreground">{gh.tokenHint}</code>
              </div>
              <div className="flex flex-wrap gap-1">
                {gh.scopes === null ? (
                  <Badge variant="outline">Fine-grained token</Badge>
                ) : gh.scopes.length === 0 ? (
                  <Badge variant="destructive">No scopes</Badge>
                ) : (
                  gh.scopes.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">Checked {timeAgo(gh.checkedAt)}</p>
            </div>
          )}
          {gh.missingScopes.length > 0 && (
            <ErrorNote>Missing scopes: {gh.missingScopes.join(", ")}. Webhooks and stargazer access will fail.</ErrorNote>
          )}
          {gh.warnings.map((w) => (
            <p key={w} className="text-xs text-muted-foreground">
              {w}
            </p>
          ))}
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <Label htmlFor="token">{gh.connected ? "Replace token" : "Token"}</Label>
            <div className="flex gap-2">
              <Input
                id="token"
                type="password"
                autoComplete="off"
                placeholder="ghp_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button type="submit" disabled={!token.trim() || saveToken.isPending}>
                {saveToken.isPending && <Spinner />}
                Validate and save
              </Button>
            </div>
            <a
              href={TOKEN_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              Create a token on GitHub
              <ExternalLink className="size-3" />
            </a>
          </form>
        </CardContent>
        {gh.connected && (
          <CardFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? <Spinner /> : <RefreshCw />}
              Re-check
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmRemove(true)}>
              <Trash2 />
              Remove
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Background sync runs hourly and after you save a token.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Row label="Last sync" value={gh.lastSyncAt ? formatDateTime(gh.lastSyncAt) : "Never"} />
          <Row label="Last poll" value={gh.lastPollAt ? formatDateTime(gh.lastPollAt) : "Never"} />
          {gh.rateLimit && (
            <>
              <Row
                label="API requests left"
                value={`${formatNumber(gh.rateLimit.remaining)} / ${formatNumber(gh.rateLimit.limit)}`}
              />
              <Row label="Rate limit resets" value={formatDateTime(gh.rateLimit.resetAt)} />
            </>
          )}
          {gh.lastSyncError && <ErrorNote>{gh.lastSyncError}</ErrorNote>}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove GitHub token?"
        description="Syncing and polling stop. Existing webhooks stay on GitHub until you disable monitoring first."
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

/* ----------------------------- Monitoring ----------------------------- */

function MonitoringTab({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const [interval, setIntervalValue] = useState(String(settings.pollingIntervalMinutes));
  const [baseUrl, setBaseUrl] = useState(settings.webhook.baseUrlOverride ?? "");

  const update = useMutation({
    mutationFn: (body: Partial<{ pollingIntervalMinutes: number; autoMonitorNew: boolean }>) =>
      api.patch<Settings>("/settings", body),
    onSuccess: (data) => {
      save(data);
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const updateApp = useMutation({
    mutationFn: () => api.patch<Settings>("/settings/app", { webhookBaseUrl: baseUrl || null }),
    onSuccess: (data) => {
      save(data);
      toast.success("Webhook URL saved. Webhooks are being updated.");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Polling</CardTitle>
          <CardDescription>
            Used by repositories in polling or both mode. Each run costs one request per 100 repositories, plus
            stargazer pages only when a count changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ pollingIntervalMinutes: Number(interval) });
            }}
          >
            <div className="grid flex-1 gap-2">
              <Label htmlFor="interval">Interval (minutes)</Label>
              <Input
                id="interval"
                type="number"
                min={1}
                max={1440}
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </form>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-monitor">Monitor new repositories</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                New repositories (not forks or archived) found during sync are monitored automatically.
              </p>
            </div>
            <Switch
              id="auto-monitor"
              checked={settings.autoMonitorNew}
              onCheckedChange={(v) => update.mutate({ autoMonitorNew: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>
            GitHub sends star events here. It must be reachable from the internet.
            {!settings.webhook.canEdit && " Only admins can change it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{settings.webhook.url}</code>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Copy webhook URL"
              onClick={() => {
                void navigator.clipboard.writeText(settings.webhook.url);
                toast.success("Copied");
              }}
            >
              <Copy />
            </Button>
          </div>
          {settings.webhook.tunnel && (
            <p className="text-xs text-muted-foreground">Set by the Cloudflared tunnel.</p>
          )}
          {settings.webhook.canEdit && !settings.webhook.tunnel && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                updateApp.mutate();
              }}
            >
              <Label htmlFor="base-url">Webhook base URL</Label>
              <div className="flex gap-2">
                <Input
                  id="base-url"
                  type="url"
                  placeholder={settings.webhook.defaultBaseUrl}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <Button type="submit" disabled={updateApp.isPending}>
                  {updateApp.isPending && <Spinner />}
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Leave empty to use BASE_URL ({settings.webhook.defaultBaseUrl}).</p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------ Templates ------------------------------ */

const SAMPLE_VARS = {
  user: "octocat",
  user_url: "https://github.com/octocat",
  avatar: "https://github.com/octocat.png",
  repo: "you/awesome-project",
  repo_url: "https://github.com/you/awesome-project",
  stars: "128",
  action: "starred",
  time: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
};

const TEMPLATE_FIELDS: { key: keyof MessageTemplates; label: string; unstar?: boolean }[] = [
  { key: "starTitle", label: "Star title" },
  { key: "starBody", label: "Star message" },
  { key: "unstarTitle", label: "Unstar title", unstar: true },
  { key: "unstarBody", label: "Unstar message", unstar: true },
];

function TemplatePreview({ text }: { text: string }) {
  return (
    <p className="rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
      {parseLinks(text).map((s, i) =>
        s.url ? (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2"
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function TemplatesTab({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const [templates, setTemplates] = useState<MessageTemplates>(settings.templates);
  useEffect(() => setTemplates(settings.templates), [settings.templates]);

  const update = useMutation({
    mutationFn: (value: MessageTemplates | null) => api.patch<Settings>("/settings", { templates: value }),
    onSuccess: (data) => {
      save(data);
      toast.success("Templates saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Message templates</CardTitle>
        <CardDescription>
          Defaults for every channel. A channel can override them. Use <code>{"{{"}</code> and <code>{"}}"}</code> for
          literal braces. Write <code>[text](url)</code> for a link, for example <code>{"[{user}]({user_url})"}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <Badge key={v.name} variant="outline" title={v.description} className="font-mono">
              {`{${v.name}}`}
            </Badge>
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {TEMPLATE_FIELDS.map((f) => {
            const vars = f.unstar ? { ...SAMPLE_VARS, action: "unstarred", stars: "127" } : SAMPLE_VARS;
            const rendered = renderTemplate(templates[f.key] || settings.defaultTemplates[f.key], vars);
            const isTitle = f.key.endsWith("Title");
            return (
              <div key={f.key} className="grid gap-2">
                <Label htmlFor={`t-${f.key}`}>{f.label}</Label>
                <Textarea
                  id={`t-${f.key}`}
                  rows={2}
                  value={templates[f.key]}
                  onChange={(e) => setTemplates((t) => ({ ...t, [f.key]: e.target.value }))}
                />
                <TemplatePreview text={isTitle ? stripLinks(rendered) : rendered} />
              </div>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={() => update.mutate(null)} disabled={update.isPending}>
          Reset to defaults
        </Button>
        <Button onClick={() => update.mutate(templates)} disabled={update.isPending}>
          {update.isPending && <Spinner />}
          Save templates
        </Button>
      </CardFooter>
    </Card>
  );
}

/* ------------------------------- Account ------------------------------- */

function AccountTab({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pending, setPending] = useState<"name" | "password" | null>(null);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setPending("name");
    const { error } = await authClient.updateUser({ name });
    setPending(null);
    if (error) return toast.error(error.message ?? "Could not update name");
    toast.success("Name updated");
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error("Passwords do not match");
    setPending("password");
    const { error } = await authClient.changePassword({
      currentPassword: pw.current,
      newPassword: pw.next,
      revokeOtherSessions: true,
    });
    setPending(null);
    if (error) return toast.error(error.message ?? "Could not change password");
    setPw({ current: "", next: "", confirm: "" });
    toast.success("Password changed. Other sessions were signed out.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            {user.email} · {user.role === "admin" ? "Administrator" : "User"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="flex items-end gap-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" disabled={pending === "name"}>
              {pending === "name" && <Spinner />}
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="flex flex-col gap-3">
            {(["current", "next", "confirm"] as const).map((key) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={`pw-${key}`}>
                  {key === "current" ? "Current password" : key === "next" ? "New password" : "Confirm new password"}
                </Label>
                <Input
                  id={`pw-${key}`}
                  type="password"
                  required
                  minLength={key === "current" ? undefined : 8}
                  autoComplete={key === "current" ? "current-password" : "new-password"}
                  value={pw[key]}
                  onChange={(e) => setPw((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
            <Button type="submit" className="self-end" disabled={pending === "password"}>
              {pending === "password" && <Spinner />}
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------- Users -------------------------------- */

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "user" as Role });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", password: "", role: "user" });
      setError(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.post("/users", form),
    onSuccess: () => {
      toast.success(`Created ${form.email}`);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Share the password with them. They can change it under Account.</DialogDescription>
          </DialogHeader>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="grid gap-2">
            <Label htmlFor="u-name">Name</Label>
            <Input id="u-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-email">Email</Label>
            <Input
              id="u-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-password">Password</Label>
            <Input
              id="u-password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-role">Role</Label>
            <Select value={form.role} onValueChange={(role) => setForm({ ...form, role: role as Role })}>
              <SelectTrigger id="u-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: ManagedUser | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  useEffect(() => setPassword(""), [user]);
  const reset = useMutation({
    mutationFn: () => api.post(`/users/${user!.id}/password`, { password }),
    onSuccess: () => {
      toast.success(`Password reset for ${user?.email}`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {user?.email}. Their other sessions are signed out.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending && <Spinner />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ users: ManagedUser[]; allowRegistration: boolean }>("/users"),
  });
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch(`/users/${id}`, { role }),
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success("User deleted");
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Public registration is {data?.allowRegistration ? "open (ALLOW_REGISTRATION=true)" : "closed"}.
        </CardDescription>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            Create user
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {isPending ? (
          <Skeleton className="mx-6 mb-6 h-24" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-6 font-medium">
                    {u.name}
                    {u.isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(u.createdAt)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Manage ${u.email}`}>
                          <UserCog />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setRole.mutate({ id: u.id, role: u.role === "admin" ? "user" : "admin" })}
                        >
                          <UserCog />
                          {u.role === "admin" ? "Demote to user" : "Promote to admin"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResetting(u)}>
                          <KeyRound />
                          Reset password
                        </DropdownMenuItem>
                        {!u.isSelf && (
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(u)}>
                            <Trash2 />
                            Delete user
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.email}?`}
        description="Their repositories, channels and event history are deleted. Webhooks they created stay on GitHub."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

/* --------------------------------- Page -------------------------------- */

export function SettingsPage({ user }: { user: CurrentUser }) {
  const { data, isPending, error } = useSettings();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "github";

  return (
    <>
      {error && <ErrorNote>{error.message}</ErrorNote>}
      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          {user.role === "admin" && <TabsTrigger value="cloudflared">Cloudflared</TabsTrigger>}
          {user.role === "admin" && <TabsTrigger value="users">Users</TabsTrigger>}
        </TabsList>
        {isPending || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <TabsContent value="github">
              <GitHubTab settings={data} />
            </TabsContent>
            <TabsContent value="monitoring">
              <MonitoringTab settings={data} />
            </TabsContent>
            <TabsContent value="templates">
              <TemplatesTab settings={data} />
            </TabsContent>
            <TabsContent value="account">
              <AccountTab user={user} />
            </TabsContent>
            {user.role === "admin" && (
              <TabsContent value="cloudflared">
                <CloudflaredSettings />
              </TabsContent>
            )}
            {user.role === "admin" && (
              <TabsContent value="users">
                <UsersTab />
              </TabsContent>
            )}
          </>
        )}
      </Tabs>
    </>
  );
}
