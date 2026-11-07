import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHANNEL_TYPES, getChannelType, type ChannelField } from "@shared/channels";
import { TEMPLATE_VARIABLES, type MessageTemplates } from "@shared/templates";
import { Bell, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  defaultTierDrafts,
  FrequencySettings,
  type FrequencyMode,
  type TierDraft,
} from "@/components/frequency-settings";
import { ConfirmDialog, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import type { Channel, ReposResponse } from "@/lib/types";

type ConfigValues = Record<string, string | number | boolean>;

interface FormState {
  name: string;
  type: string;
  config: ConfigValues;
  enabled: boolean;
  allRepos: boolean;
  repoIds: number[];
  notifyStar: boolean;
  notifyUnstar: boolean;
  frequencyMode: FrequencyMode;
  milestoneEvery: string;
  tiers: TierDraft[];
  templates: Partial<MessageTemplates>;
}

const TEMPLATE_FIELDS: { key: keyof MessageTemplates; label: string }[] = [
  { key: "starTitle", label: "Star title" },
  { key: "starBody", label: "Star message" },
  { key: "unstarTitle", label: "Unstar title" },
  { key: "unstarBody", label: "Unstar message" },
];

function defaultsFor(type: string): ConfigValues {
  const values: ConfigValues = {};
  for (const f of getChannelType(type)?.fields ?? []) if (f.default !== undefined) values[f.key] = f.default;
  return values;
}

function initialState(channel: Channel | null): FormState {
  if (channel) {
    return {
      name: channel.name,
      type: channel.type,
      config: { ...defaultsFor(channel.type), ...channel.config },
      enabled: channel.enabled,
      allRepos: channel.allRepos,
      repoIds: channel.repoIds,
      notifyStar: channel.notifyStar,
      notifyUnstar: channel.notifyUnstar,
      frequencyMode: channel.frequencyTiers?.length ? "dynamic" : channel.milestoneEvery ? "milestone" : "every",
      milestoneEvery: channel.milestoneEvery ? String(channel.milestoneEvery) : "",
      tiers: channel.frequencyTiers?.length
        ? channel.frequencyTiers.map((t) => ({ from: String(t.from), every: String(t.every) }))
        : defaultTierDrafts(),
      templates: channel.templates ?? {},
    };
  }
  return {
    name: "",
    type: "discord",
    config: defaultsFor("discord"),
    enabled: true,
    allRepos: true,
    repoIds: [],
    notifyStar: true,
    notifyUnstar: true,
    frequencyMode: "every",
    milestoneEvery: "",
    tiers: defaultTierDrafts(),
    templates: {},
  };
}

function ConfigField({
  field,
  value,
  secretHint,
  onChange,
}: {
  field: ChannelField;
  value: string | number | boolean | undefined;
  secretHint: string | null | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  const id = `field-${field.key}`;
  const placeholder = secretHint ? `Saved (${secretHint}). Leave empty to keep.` : field.placeholder;
  const required = field.required && !(field.secret && secretHint);

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        <Label htmlFor={id} className="font-normal">
          {field.label}
        </Label>
      </div>
    );
  }

  let control;
  if (field.type === "select") {
    control = (
      <Select value={String(value ?? field.default ?? "")} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (field.type === "textarea") {
    control = (
      <Textarea
        id={id}
        rows={3}
        className="font-mono text-xs"
        placeholder={placeholder}
        required={required}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    const type = field.type === "password" || field.secret ? "password" : field.type === "url" ? "url" : field.type;
    control = (
      <Input
        id={id}
        type={type}
        autoComplete="off"
        placeholder={placeholder}
        required={required}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.type === "number" ? e.target.value : e.target.value)}
      />
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </Label>
      {control}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}

function ChannelDialog({
  open,
  channel,
  onClose,
}: {
  open: boolean;
  channel: Channel | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialState(channel));
  const [error, setError] = useState<string | null>(null);
  const repos = useQuery({ queryKey: ["repos"], queryFn: () => api.get<ReposResponse>("/repos"), enabled: open });

  useEffect(() => {
    if (open) {
      setForm(initialState(channel));
      setError(null);
    }
  }, [open, channel]);

  const save = useMutation({
    mutationFn: (body: unknown) => (channel ? api.patch(`/channels/${channel.id}`, body) : api.post("/channels", body)),
    onSuccess: () => {
      toast.success(channel ? "Channel updated" : "Channel created");
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const info = getChannelType(form.type);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate({
      name: form.name,
      type: form.type,
      config: form.config,
      enabled: form.enabled,
      allRepos: form.allRepos,
      repoIds: form.repoIds,
      notifyStar: form.notifyStar,
      notifyUnstar: form.notifyUnstar,
      milestoneEvery: form.frequencyMode === "milestone" && form.milestoneEvery ? Number(form.milestoneEvery) : null,
      frequencyTiers:
        form.frequencyMode === "dynamic"
          ? form.tiers.map((t) => ({ from: Number(t.from), every: Number(t.every) }))
          : null,
      templates: form.templates,
    });
  }

  const monitoredRepos = (repos.data?.repos ?? []).filter((r) => r.monitored || form.repoIds.includes(r.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{channel ? `Edit ${channel.name}` : "Add channel"}</DialogTitle>
            <DialogDescription>{info?.description}</DialogDescription>
          </DialogHeader>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                required
                placeholder="My Discord"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="channel-type">Type</Label>
              <Select
                value={form.type}
                disabled={Boolean(channel)}
                onValueChange={(type) => setForm((f) => ({ ...f, type, config: defaultsFor(type) }))}
              >
                <SelectTrigger id="channel-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_TYPES.map((t) => (
                    <SelectItem key={t.type} value={t.type}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {info?.fields.map((field) => (
              <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
                <ConfigField
                  field={field}
                  value={form.config[field.key]}
                  secretHint={channel?.secrets[field.key]}
                  onChange={(value) => set("config", { ...form.config, [field.key]: value })}
                />
              </div>
            ))}
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Events</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="notify-star"
                  checked={form.notifyStar}
                  onCheckedChange={(v) => set("notifyStar", v === true)}
                />
                <Label htmlFor="notify-star" className="font-normal">
                  New stars
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="notify-unstar"
                  checked={form.notifyUnstar}
                  onCheckedChange={(v) => set("notifyUnstar", v === true)}
                />
                <Label htmlFor="notify-unstar" className="font-normal">
                  Unstars
                </Label>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="all-repos">All repositories</Label>
                <Switch id="all-repos" checked={form.allRepos} onCheckedChange={(v) => set("allRepos", v)} />
              </div>
              {!form.allRepos && (
                <div className="max-h-48 overflow-y-auto rounded-md border p-2">
                  {monitoredRepos.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">No monitored repositories yet.</p>
                  ) : (
                    monitoredRepos.map((r) => (
                      <label
                        key={r.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={form.repoIds.includes(r.id)}
                          onCheckedChange={(v) =>
                            set(
                              "repoIds",
                              v === true ? [...form.repoIds, r.id] : form.repoIds.filter((id) => id !== r.id),
                            )
                          }
                        />
                        <span className="truncate">{r.fullName}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="channel-enabled">Enabled</Label>
                <Switch id="channel-enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
              </div>
            </div>
          </div>

          <FrequencySettings
            mode={form.frequencyMode}
            milestoneEvery={form.milestoneEvery}
            tiers={form.tiers}
            onModeChange={(mode) => set("frequencyMode", mode)}
            onMilestoneChange={(value) => set("milestoneEvery", value)}
            onTiersChange={(tiers) => set("tiers", tiers)}
          />

          <details className="group rounded-md border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Custom message templates</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Leave empty to use the templates from Settings. Variables:{" "}
              {TEMPLATE_VARIABLES.map((v) => `{${v.name}}`).join(" ")}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {TEMPLATE_FIELDS.map((t) => (
                <div key={t.key} className="grid gap-1.5">
                  <Label htmlFor={`tpl-${t.key}`} className="text-xs">
                    {t.label}
                  </Label>
                  <Textarea
                    id={`tpl-${t.key}`}
                    rows={2}
                    className="text-xs"
                    value={form.templates[t.key] ?? ""}
                    onChange={(e) => set("templates", { ...form.templates, [t.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </details>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {channel ? "Save changes" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function describeFilters(channel: Channel) {
  const parts: string[] = [];
  if (channel.notifyStar && channel.notifyUnstar) parts.push("Stars and unstars");
  else if (channel.notifyStar) parts.push("Stars only");
  else if (channel.notifyUnstar) parts.push("Unstars only");
  else parts.push("No events");
  if (channel.milestoneEvery) parts.push(`every ${channel.milestoneEvery} stars`);
  if (channel.frequencyTiers?.length) parts.push("dynamic frequency");
  parts.push(channel.allRepos ? "all repositories" : `${channel.repoIds.length} repositories`);
  return parts.join(" · ");
}

function ChannelCard({
  channel,
  onEdit,
  onDelete,
}: {
  channel: Channel;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const type = getChannelType(channel.type);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/channels/${channel.id}`, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["channels"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const test = useMutation({
    mutationFn: () => api.post(`/channels/${channel.id}/test`),
    onSuccess: () => toast.success(`Test notification sent to ${channel.name}`),
    onError: (err) => toast.error(`Test failed: ${errorMessage(err)}`),
  });

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="truncate">{channel.name}</CardTitle>
        <CardDescription className="flex items-center gap-2">
          <Badge variant="secondary">{type?.name ?? channel.type}</Badge>
          {!channel.enabled && <Badge variant="outline">Disabled</Badge>}
        </CardDescription>
        <CardAction>
          <Switch
            checked={channel.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label={`Enable ${channel.name}`}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 text-sm text-muted-foreground">{describeFilters(channel)}</CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <Spinner /> : <Send />}
          Test
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
          Edit
        </Button>
        <Button variant="ghost" size="icon-sm" className="ml-auto text-destructive" onClick={onDelete} aria-label="Delete">
          <Trash2 />
        </Button>
      </CardFooter>
    </Card>
  );
}

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<{ channels: Channel[] }>("/channels"),
  });
  const [dialog, setDialog] = useState<{ open: boolean; channel: Channel | null }>({ open: false, channel: null });
  const [deleting, setDeleting] = useState<Channel | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/channels/${id}`),
    onSuccess: () => {
      toast.success("Channel deleted");
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const addButton = (
    <Button onClick={() => setDialog({ open: true, channel: null })}>
      <Plus />
      Add channel
    </Button>
  );

  return (
    <>
      <PageHeader title="Channels" actions={addButton} />
      {error && <ErrorNote>{error.message}</ErrorNote>}

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : data?.channels.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.channels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              onEdit={() => setDialog({ open: true, channel: c })}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Bell}
            title="No channels yet"
            description="Add Discord, Telegram, ntfy, Gotify, Slack, Pushover, email or a JSON webhook."
            action={addButton}
          />
        </Card>
      )}

      <ChannelDialog
        open={dialog.open}
        channel={dialog.channel}
        onClose={() => setDialog({ open: false, channel: null })}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="The channel and its delivery history will be removed."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
