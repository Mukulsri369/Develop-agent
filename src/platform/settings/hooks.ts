import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { StoreSettingsService } from "./service";
import type { PublicStoreSettings, StoreSettings, UpdateStoreSettingsInput } from "./types";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import { useStoreContext } from "@/platform/context";

export function publicStoreSettingsQuery(storeId: string = LEGACY_STORE_ID) {
  return queryOptions({
    queryKey: ["store-settings", "public", storeId],
    queryFn: () => StoreSettingsService.getPublicSettings(storeId),
    staleTime: 60_000,
  });
}

export function adminStoreSettingsQuery(storeId: string = LEGACY_STORE_ID) {
  return queryOptions({
    queryKey: ["store-settings", "admin", storeId],
    queryFn: () => StoreSettingsService.getAdminSettings(storeId),
    staleTime: 30_000,
  });
}

export function usePublicStoreSettings(storeId?: string) {
  const storeContext = useStoreContext();
  const effectiveStoreId = storeId || storeContext.storeId || LEGACY_STORE_ID;

  return useQuery(publicStoreSettingsQuery(effectiveStoreId));
}

export function useAdminStoreSettings(storeId?: string) {
  const storeContext = useStoreContext();
  const effectiveStoreId = storeId || storeContext.storeId || LEGACY_STORE_ID;

  return useQuery(adminStoreSettingsQuery(effectiveStoreId));
}

export function useUpdateStoreSettings(storeId?: string) {
  const queryClient = useQueryClient();
  const storeContext = useStoreContext();
  const effectiveStoreId = storeId || storeContext.storeId || LEGACY_STORE_ID;

  return useMutation({
    mutationFn: (input: UpdateStoreSettingsInput) =>
      StoreSettingsService.updateSettings(effectiveStoreId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(["store-settings", "admin", effectiveStoreId], data);
      queryClient.invalidateQueries({
        queryKey: ["store-settings", "public", effectiveStoreId],
      });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["festival"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
  });
}
