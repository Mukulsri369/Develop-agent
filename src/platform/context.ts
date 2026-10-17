import { createContext, useContext } from "react";
import type { Database } from "@/integrations/supabase/types";

import type { StoreSettings, PublicStoreSettings } from "./settings/types";

export type SiteSettingsRow = Database["public"]["Tables"]["site_settings"]["Row"];

/**
 * Standard store context interface defining the tenant contract for multi-tenancy.
 * In Phase 1 & 2, defaults to Tenant 0 ("Our Visible Universe") while supporting arbitrary tenant stores.
 */
export interface StoreContextValue {
  storeId: string;
  storeSlug: string;
  isOwner: boolean;
  isAdmin: boolean;
  planTier: "starter" | "pro" | "enterprise";
  status: "active" | "suspended" | "draft";
  customDomain?: string | null;
  settings?: StoreSettings | PublicStoreSettings | Partial<SiteSettingsRow> | null;
}

import { LEGACY_STORE_ID, LEGACY_STORE_SLUG } from "./tenancy/constants";

export const StoreContext = createContext<StoreContextValue>({
  storeId: LEGACY_STORE_ID,
  storeSlug: LEGACY_STORE_SLUG,
  isOwner: true,
  isAdmin: true,
  planTier: "enterprise",
  status: "active",
  customDomain: null,
  settings: null,
});

export function useStoreContext(): StoreContextValue {
  return useContext(StoreContext);
}
