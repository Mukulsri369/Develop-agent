/**
 * Database Environment Safety & Migration Isolation Guard
 *
 * Implements strict Phase 1/Phase 2 rules:
 * - Never execute migrations or schema mutations against an unverified or production backend.
 * - Detects whether the linked database URL is marked as production.
 * - Explicitly blocks migration execution when isolated staging/dev infrastructure is not confirmed.
 */

export class DatabaseMigrationBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`[Database Safety Guard] Migration execution blocked: ${reason}`);
    this.name = "DatabaseMigrationBlockedError";
  }
}

export interface DatabaseIsolationStatus {
  isIsolated: boolean;
  environment: "production" | "staging" | "development" | "unverified";
  supabaseUrl: string;
  hasDedicatedMigrationUrl: boolean;
  canExecuteMigrations: boolean;
  blockReason?: string;
}

/**
 * Inspects environment variables to verify whether the connected database is an isolated development/staging instance.
 */
export function verifyDatabaseIsolation(
  env: Record<string, string | undefined> = process.env,
): DatabaseIsolationStatus {
  const supabaseUrl =
    env["VITE_SUPABASE_URL"] ||
    env["SUPABASE_URL"] ||
    "https://c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud";

  const migrationUrl = env["LOVABLE_DB_MIGRATION_URL"] || "";

  // 1. Check if the URL explicitly targets production
  const isExplicitProd =
    supabaseUrl.includes("-prod.") ||
    supabaseUrl.includes("production") ||
    migrationUrl.includes("-prod.");

  // 2. Check if a dedicated migration connection string is provided
  const hasDedicatedMigrationUrl = Boolean(migrationUrl && migrationUrl.trim().length > 0);

  if (isExplicitProd) {
    return {
      isIsolated: false,
      environment: "production",
      supabaseUrl,
      hasDedicatedMigrationUrl,
      canExecuteMigrations: false,
      blockReason:
        "The connected database URL targets a production instance ('-prod.lovable.cloud'). Executing multi-tenant migrations directly against production without isolated staging verification is strictly prohibited.",
    };
  }

  if (!hasDedicatedMigrationUrl) {
    return {
      isIsolated: false,
      environment: "unverified",
      supabaseUrl,
      hasDedicatedMigrationUrl: false,
      canExecuteMigrations: false,
      blockReason:
        "No dedicated staging migration connection string (LOVABLE_DB_MIGRATION_URL) is configured. Database isolation cannot be confirmed.",
    };
  }

  return {
    isIsolated: true,
    environment: "development",
    supabaseUrl,
    hasDedicatedMigrationUrl: true,
    canExecuteMigrations: true,
  };
}

/**
 * Asserts that the current database environment is safe for schema migrations.
 * Throws DatabaseMigrationBlockedError if isolation cannot be verified.
 */
export function assertSafeMigrationTarget(
  env: Record<string, string | undefined> = process.env,
): void {
  const status = verifyDatabaseIsolation(env);
  if (!status.canExecuteMigrations) {
    throw new DatabaseMigrationBlockedError(
      status.blockReason || "Database isolation could not be verified.",
    );
  }
}
