import React, { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Check } from "lucide-react";
import { LEGACY_STORE_ID, LEGACY_STORE_SLUG, type StoreRole } from "@/platform/tenancy/constants";
import type { AccessibleStoreSummary } from "@/platform/auth/tenant-context-manager";
import { getAccessibleStoresForUser, resolveAdminStoreContext } from "./store-context-resolver";

export interface AdminStoreContextValue {
  activeStoreId: string;
  activeStoreSlug: string;
  activeStoreName: string;
  role: StoreRole;
  isSuperAdmin: boolean;
  accessibleStores: AccessibleStoreSummary[];
  setActiveStoreId: (storeId: string) => void;
  isLoading: boolean;
}

const defaultAdminStore: AdminStoreContextValue = {
  activeStoreId: LEGACY_STORE_ID,
  activeStoreSlug: LEGACY_STORE_SLUG,
  activeStoreName: "Our Visible Universe",
  role: "admin",
  isSuperAdmin: false,
  accessibleStores: [
    {
      storeId: LEGACY_STORE_ID,
      storeSlug: LEGACY_STORE_SLUG,
      storeName: "Our Visible Universe",
      role: "admin",
      status: "active",
    },
  ],
  setActiveStoreId: () => {},
  isLoading: true,
};

const AdminStoreContext = createContext<AdminStoreContextValue>(defaultAdminStore);

export function useAdminStore(): AdminStoreContextValue {
  return useContext(AdminStoreContext);
}

export function AdminStoreProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const qc = useQueryClient();
  const [accessibleStores, setAccessibleStores] = useState<AccessibleStoreSummary[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("admin_active_store_id") || LEGACY_STORE_ID;
    }
    return LEGACY_STORE_ID;
  });
  const [role, setRole] = useState<StoreRole>("admin");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load user's accessible stores
  useEffect(() => {
    let mounted = true;
    async function loadStores() {
      setIsLoading(true);
      try {
        const stores = await getAccessibleStoresForUser(userId);
        if (!mounted) return;
        setAccessibleStores(stores);

        // Verify activeStoreId is within accessible stores; otherwise fallback
        const savedId = localStorage.getItem("admin_active_store_id");
        const matched = stores.find((s) => s.storeId === savedId);
        const resolvedId = matched ? matched.storeId : (stores[0]?.storeId ?? LEGACY_STORE_ID);

        const resolvedContext = await resolveAdminStoreContext({
          userId,
          requestedStoreId: resolvedId,
        });

        if (!mounted) return;
        setActiveStoreIdState(resolvedContext.activeStoreId);
        setRole(resolvedContext.role);
        setIsSuperAdmin(resolvedContext.isSuperAdmin);
      } catch (err) {
        console.warn("[AdminStoreProvider] Failed to load stores:", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadStores();
    return () => {
      mounted = false;
    };
  }, [userId]);

  function setActiveStoreId(storeId: string) {
    if (storeId === activeStoreId) return;

    // Check that store is accessible or user is super admin
    const target = accessibleStores.find((s) => s.storeId === storeId);
    if (!target && !isSuperAdmin) {
      console.error(`[AdminStoreContext] Unauthorized switch attempt to store ${storeId}`);
      return;
    }

    // Invalidate and remove queries for the previous store to prevent cache leakage
    qc.removeQueries({ queryKey: ["admin"] });
    qc.removeQueries({ queryKey: ["categories"] });
    qc.removeQueries({ queryKey: ["settings"] });

    if (typeof window !== "undefined") {
      localStorage.setItem("admin_active_store_id", storeId);
    }

    setActiveStoreIdState(storeId);
    if (target) {
      setRole(target.role);
    }
  }

  const currentStore = accessibleStores.find((s) => s.storeId === activeStoreId) || {
    storeId: activeStoreId,
    storeSlug: LEGACY_STORE_SLUG,
    storeName: "Our Visible Universe",
    role,
    status: "active" as const,
  };

  const value: AdminStoreContextValue = {
    activeStoreId,
    activeStoreSlug: currentStore.storeSlug,
    activeStoreName: currentStore.storeName,
    role,
    isSuperAdmin,
    accessibleStores,
    setActiveStoreId,
    isLoading,
  };

  return <AdminStoreContext.Provider value={value}>{children}</AdminStoreContext.Provider>;
}

/**
 * Reusable Admin Store Switcher UI component for the admin navigation header/sidebar.
 */
export function AdminStoreSwitcher() {
  const { activeStoreId, activeStoreName, accessibleStores, setActiveStoreId, isSuperAdmin } =
    useAdminStore();
  const [isOpen, setIsOpen] = useState(false);

  // If user only manages 1 store and is not super admin, display store badge
  if (accessibleStores.length <= 1 && !isSuperAdmin) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-xs">
        <Building2 className="size-4 shrink-0 text-primary" />
        <div className="flex-1 truncate">
          <p className="truncate font-semibold text-sidebar-foreground">{activeStoreName}</p>
          <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
            Active Store
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mb-4">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left text-xs transition-colors hover:bg-sidebar-accent"
      >
        <div className="flex items-center gap-2 truncate">
          <Building2 className="size-4 shrink-0 text-primary" />
          <div className="truncate">
            <p className="truncate font-semibold text-sidebar-foreground">{activeStoreName}</p>
            <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
              {accessibleStores.length} Stores Accessible
            </p>
          </div>
        </div>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg backdrop-blur-md">
            <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Switch Managed Store
            </div>
            {accessibleStores.map((store) => {
              const isSelected = store.storeId === activeStoreId;
              return (
                <button
                  key={store.storeId}
                  type="button"
                  onClick={() => {
                    setActiveStoreId(store.storeId);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <div className="truncate">
                    <p className="truncate">{store.storeName}</p>
                    <p
                      className={`text-[9px] capitalize ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                    >
                      {store.role} · {store.status}
                    </p>
                  </div>
                  {isSelected && <Check className="size-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
