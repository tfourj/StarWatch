import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { GitHubIcon } from "@/components/icons";
import { ErrorNote, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useSetupStatus } from "@/hooks/use-session";
import { authClient } from "@/lib/auth-client";
import { AuthLayout } from "./auth-layout";

type CodeMode = "totp" | "backup";

/** Second sign-in step for accounts with two-factor authentication. */
function TwoFactorForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [mode, setMode] = useState<CodeMode>("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const input = { code: code.replace(/\s+/g, ""), trustDevice };
    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp(input)
        : await authClient.twoFactor.verifyBackupCode(input);
    if (error) {
      setPending(false);
      setError(error.message ?? "Invalid code");
      return;
    }
    await onDone();
  }

  function switchMode() {
    setMode(mode === "totp" ? "backup" : "totp");
    setCode("");
    setError(null);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-2">
        <Label htmlFor="code">{mode === "totp" ? "Authenticator code" : "Backup code"}</Label>
        <Input
          id="code"
          autoFocus
          required
          autoComplete="one-time-code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          maxLength={mode === "totp" ? 6 : 32}
          placeholder={mode === "totp" ? "123456" : "XXXXX-XXXXX"}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={trustDevice} onCheckedChange={(v) => setTrustDevice(v === true)} />
        Trust this device for 30 days
      </label>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        Verify
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={onCancel}>
          Back
        </button>
        <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={switchMode}>
          {mode === "totp" ? "Use a backup code" : "Use authenticator app"}
        </button>
      </div>
    </form>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: setup } = useSetupStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);

  async function finish() {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate("/", { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Sign in failed");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setPassword("");
      setNeedsCode(true);
      return;
    }
    await finish();
  }

  async function signInWithGitHub() {
    const { error } = await authClient.signIn.social({ provider: "github", callbackURL: "/" });
    if (error) setError(error.message ?? "GitHub sign in failed");
  }

  if (needsCode) {
    return (
      <AuthLayout title="Two-factor authentication" description="Enter the code from your authenticator app.">
        <TwoFactorForm onDone={finish} onCancel={() => setNeedsCode(false)} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" description="Welcome back. Sign in to manage your star alerts.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Sign in
        </Button>
        {setup?.githubOAuth && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              or
              <Separator className="flex-1" />
            </div>
            <Button type="button" variant="outline" onClick={signInWithGitHub}>
              <GitHubIcon className="size-4" />
              Continue with GitHub
            </Button>
          </>
        )}
        {setup?.registrationOpen && (
          <p className="text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link to="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
              Register
            </Link>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
