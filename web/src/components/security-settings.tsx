import { getChannelType } from "@shared/channels";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Send } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { encode } from "uqr";
import { ErrorNote, Spinner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { Channel, LoginAlertTestResult, SecurityStatus } from "@/lib/types";

export function useSecurity() {
  return useQuery({ queryKey: ["security"], queryFn: () => api.get<SecurityStatus>("/security") });
}

/* -------------------------------- Widgets ------------------------------- */

/** QR code drawn as one SVG path. Always dark on white so every scanner can read it. */
function QrCode({ value }: { value: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { border: 2 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-44 rounded-md bg-white" shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");

  function download() {
    const url = URL.createObjectURL(new Blob([`StarWatch backup codes\n\n${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "starwatch-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("Backup codes copied"))}
        >
          <Copy />
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download />
          Download
        </Button>
      </div>
    </div>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="2fa-password">Password</Label>
      <Input
        id="2fa-password"
        type="password"
        required
        autoFocus
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* -------------------------------- Dialogs ------------------------------- */

type EnableStep =
  | { step: "password" }
  | { step: "scan"; totpURI: string; backupCodes: string[] }
  | { step: "codes"; backupCodes: string[] };

function EnableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<EnableStep>({ step: "password" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setState({ step: "password" });
    setPassword("");
    setCode("");
    setError(null);
  }, [open]);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password, method: "totp" });
    setPending(false);
    if (error || !data || data.method !== "totp") return setError(error?.message ?? "Could not start setup");
    setPassword("");
    setState({ step: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (state.step !== "scan") return;
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, "") });
    setPending(false);
    if (error) return setError(error.message ?? "Invalid code");
    void queryClient.invalidateQueries({ queryKey: ["security"] });
    setState({ step: "codes", backupCodes: state.backupCodes });
  }

  const secret = state.step === "scan" ? new URL(state.totpURI).searchParams.get("secret") : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && state.step !== "scan" && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state.step === "codes" ? "Save your backup codes" : "Set up two-factor authentication"}
          </DialogTitle>
          <DialogDescription>
            {state.step === "password" && "Confirm your password to continue."}
            {state.step === "scan" && "Scan the code with an authenticator app, then enter the 6-digit code it shows."}
            {state.step === "codes" &&
              "Each code works once. Use one to sign in if you lose access to your authenticator app."}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorNote>{error}</ErrorNote>}

        {state.step === "password" && (
          <form onSubmit={submitPassword} className="flex flex-col gap-4">
            <PasswordField value={password} onChange={setPassword} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {state.step === "scan" && (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2">
              <QrCode value={state.totpURI} />
              {secret && (
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all select-all">{secret}</code>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="2fa-code">Code</Label>
              <Input
                id="2fa-code"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Turn on
              </Button>
            </DialogFooter>
          </form>
        )}

        {state.step === "codes" && (
          <>
            <BackupCodes codes={state.backupCodes} />
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (error) return setError(error.message ?? "Could not turn off two-factor authentication");
    void queryClient.invalidateQueries({ queryKey: ["security"] });
    toast.success("Two-factor authentication is off");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Turn off two-factor authentication</DialogTitle>
            <DialogDescription>
              Signing in will only need your password. Trusted devices are forgotten.
            </DialogDescription>
          </DialogHeader>
          {error && <ErrorNote>{error}</ErrorNote>}
          <PasswordField value={password} onChange={setPassword} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Spinner />}
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewCodesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setCodes(null);
    setError(null);
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    setPending(false);
    if (error || !data) return setError(error?.message ?? "Could not create backup codes");
    setCodes(data.backupCodes);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New backup codes</DialogTitle>
          <DialogDescription>
            {codes ? "Your old codes no longer work." : "Your current backup codes stop working."}
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorNote>{error}</ErrorNote>}
        {codes ? (
          <>
            <BackupCodes codes={codes} />
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <PasswordField value={password} onChange={setPassword} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Create codes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Cards -------------------------------- */

type DialogName = "enable" | "disable" | "codes";

function TwoFactorCard({ status }: { status: SecurityStatus }) {
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const close = () => setDialog(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication
          <Badge variant={status.twoFactorEnabled ? "success" : "outline"}>
            {status.twoFactorEnabled ? "On" : "Off"}
          </Badge>
        </CardTitle>
        {!status.hasPassword && (
          <CardDescription>
            Your account signs in with GitHub only. Two-factor authentication needs a password, which an admin can
            set in Settings → Users.
          </CardDescription>
        )}
        {status.hasPassword && status.twoFactorEnabled && (
          <CardDescription>Password sign-ins ask for a code from your authenticator app.</CardDescription>
        )}
      </CardHeader>
      {status.hasPassword && (
        <CardContent className="flex flex-wrap gap-2">
          {status.twoFactorEnabled ? (
            <>
              <Button variant="outline" onClick={() => setDialog("codes")}>
                New backup codes
              </Button>
              <Button variant="outline" onClick={() => setDialog("disable")}>
                Turn off
              </Button>
            </>
          ) : (
            <Button onClick={() => setDialog("enable")}>Set up</Button>
          )}
        </CardContent>
      )}
      <EnableDialog open={dialog === "enable"} onClose={close} />
      <DisableDialog open={dialog === "disable"} onClose={close} />
      <NewCodesDialog open={dialog === "codes"} onClose={close} />
    </Card>
  );
}

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function LoginAlertsCard({ status }: { status: SecurityStatus }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<{ channels: Channel[] }>("/channels"),
  });
  const saved = status.loginAlerts.channelIds;
  const savedKey = saved.join(",");
  const [selected, setSelected] = useState<number[]>(saved);
  // Reset only when the saved ids change, not on every refetch.
  useEffect(() => setSelected(saved), [savedKey]);

  const save = useMutation({
    mutationFn: () => api.put<SecurityStatus>("/security/login-alerts", { channelIds: selected }),
    onSuccess: (next) => {
      queryClient.setQueryData(["security"], next);
      toast.success(next.loginAlerts.channelIds.length ? "Login alerts saved" : "Login alerts turned off");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const test = useMutation({
    mutationFn: () => api.post<LoginAlertTestResult>("/security/login-alerts/test", { channelIds: selected }),
    onSuccess: ({ results }) => {
      for (const r of results) {
        if (r.ok) toast.success(`Test alert sent to ${r.name}`);
        else toast.error(`${r.name}: ${r.error}`);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = (id: number, on: boolean) =>
    setSelected((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  const channels = data?.channels ?? [];
  const dirty = !sameIds(selected, saved);
  const hasEnabled = channels.some((c) => c.enabled && selected.includes(c.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Login alerts
          <Badge variant={saved.length ? "success" : "outline"}>{saved.length ? "On" : "Off"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16" />
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No channels yet.{" "}
            <Link to="/channels" className="font-medium text-foreground underline-offset-4 hover:underline">
              Add a channel
            </Link>{" "}
            to get login alerts.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {channels.map((channel) => (
              <label key={channel.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Checkbox
                  checked={selected.includes(channel.id)}
                  onCheckedChange={(v) => toggle(channel.id, v === true)}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{channel.name}</span>
                {!channel.enabled && <Badge variant="outline">Disabled</Badge>}
                <span className="text-xs text-muted-foreground">
                  {getChannelType(channel.type)?.name ?? channel.type}
                </span>
              </label>
            ))}
          </div>
        )}
      </CardContent>
      {channels.length > 0 && (
        <CardFooter className="flex justify-end gap-2">
          <Button variant="outline" disabled={!hasEnabled || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Spinner /> : <Send />}
            Send test
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            Save
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function SecuritySettings() {
  const { data, isPending, error } = useSecurity();
  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (isPending || !data) return <Skeleton className="h-40" />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <TwoFactorCard status={data} />
      <LoginAlertsCard status={data} />
    </div>
  );
}
