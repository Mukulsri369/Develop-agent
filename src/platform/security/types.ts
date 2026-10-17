import type { StoreRole } from "@/platform/tenancy/constants";

export type SecurityActorRole = "anon" | StoreRole | "super_admin";

export interface SecurityContext {
  userId: string | null;
  role: SecurityActorRole;
  isSuperAdmin: boolean;
  storeMemberships: Array<{
    storeId: string;
    role: StoreRole;
    status: "active" | "invited" | "suspended";
  }>;
}

export type DbOperation = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export interface RlsEvaluationResult {
  allowed: boolean;
  reason?: string;
  violatingField?: string;
}

export interface TableAuditInfo {
  tableName: string;
  primaryKey: string;
  tenantKey: string | null;
  parentForeignKey?: { table: string; key: string };
  rlsEnabled: boolean;
  policies: {
    select: string;
    insert: string;
    update: string;
    delete: string;
  };
  immutableKeys?: string[];
}
