import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { CurrentUser, SetupStatus } from "@/lib/types";

export function useSetupStatus() {
  return useQuery({ queryKey: ["setup-status"], queryFn: () => api.get<SetupStatus>("/setup/status"), staleTime: 30_000 });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: CurrentUser }>("/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}
