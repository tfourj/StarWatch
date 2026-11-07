import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ErrorNote, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetupStatus } from "@/hooks/use-session";
import { api, errorMessage } from "@/lib/api";
import { AuthLayout } from "./auth-layout";

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: setup } = useSetupStatus();
  const firstRun = setup?.needsSetup ?? false;
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post("/setup/register", { name: form.name, email: form.email, password: form.password });
      await queryClient.invalidateQueries();
      toast.success(firstRun ? "Admin account created" : "Account created");
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title={firstRun ? "Create the admin account" : "Create an account"}
      description={
        firstRun
          ? "No users exist yet. The first account becomes the administrator."
          : "Register a new StarWatch account."
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" autoComplete="name" required value={form.name} onChange={update("name")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={form.password}
            onChange={update("password")}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={form.confirm}
            onChange={update("confirm")}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {firstRun ? "Create admin account" : "Create account"}
        </Button>
        {!firstRun && (
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
