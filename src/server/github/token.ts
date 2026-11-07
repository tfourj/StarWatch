import { GitHubClient, GitHubError } from "./client";

export interface TokenInfo {
  login: string;
  avatarUrl: string;
  /** null for fine-grained tokens, which do not report scopes. */
  scopes: string[] | null;
  missing: string[];
  warnings: string[];
}

/** Classic PAT requirements: public_repo (or repo for private repos) and admin:repo_hook. */
export function checkScopes(scopes: string[] | null): { missing: string[]; warnings: string[] } {
  if (scopes === null) {
    return {
      missing: [],
      warnings: [
        "Scopes are not reported for fine-grained tokens. Make sure it has Webhooks (read and write) " +
          "and Metadata access on your repositories.",
      ],
    };
  }
  const set = new Set(scopes);
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!set.has("repo") && !set.has("public_repo")) missing.push("public_repo");
  if (!set.has("admin:repo_hook")) missing.push("admin:repo_hook");
  if (!set.has("repo")) warnings.push("Without the repo scope, private repositories cannot be monitored.");
  return { missing, warnings };
}

export async function validateToken(token: string, fetchImpl: typeof fetch = fetch): Promise<TokenInfo> {
  const client = new GitHubClient(token, `validate:${token.slice(-6)}`, fetchImpl);
  try {
    const { user, scopes } = await client.getAuthenticatedUser();
    return { login: user.login, avatarUrl: user.avatar_url, scopes, ...checkScopes(scopes) };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 401) throw new GitHubError("Token is invalid or expired", 401);
    throw err;
  }
}
