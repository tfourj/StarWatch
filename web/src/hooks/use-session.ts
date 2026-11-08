import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const SEEN_VERSION_KEY = ["seen-version"];

/** Last version whose release notes the signed-in user opened, shared across all their devices. */
export function useSeenVersion() {
  return useQuery({
    queryKey: SEEN_VERSION_KEY,
    queryFn: async () => (await api.get<{ version: string | null }>("/me/seen-version")).version,
  });
}

export function useMarkVersionSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => api.put<{ version: string }>("/me/seen-version", { version }),
    onMutate: (version) => queryClient.setQueryData(SEEN_VERSION_KEY, version),
    onError: () => queryClient.invalidateQueries({ queryKey: SEEN_VERSION_KEY }),
  });
}
