export interface Preferences {
  supabaseUrl: string;
  supabaseKey: string;
  serviceRoleKey?: string;
}

export interface TableDefinition {
  description?: string;
  properties: Record<string, ColumnDefinition>;
  required?: string[];
}

export interface ColumnDefinition {
  description?: string;
  type: string;
  format?: string;
  enum?: string[];
  default?: unknown;
  maxLength?: number;
}

export interface PostgrestSchema {
  definitions: Record<string, TableDefinition>;
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RowData = Record<string, any>;

export interface SupabaseUser {
  id: string;
  aud?: string;
  role?: string;
  email?: string;
  phone?: string;
  created_at: string;
  updated_at?: string;
  last_sign_in_at?: string;
  email_confirmed_at?: string;
  phone_confirmed_at?: string;
  confirmation_sent_at?: string;
  recovery_sent_at?: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
  identities?: Array<{
    id: string;
    user_id: string;
    identity_data: Record<string, unknown>;
    provider: string;
    created_at: string;
    last_sign_in_at: string;
  }>;
}

export interface UsersResponse {
  users: SupabaseUser[];
  aud?: string;
}

export interface FetchRowsOptions {
  table: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  search?: string;
  searchColumns?: string[];
  numericSearchColumns?: string[];
  filterColumn?: string;
  filterOperator?: string;
  filterValue?: string;
}

// Shared Postgres type list used across all forms (create table, add column, edit column)
export const POSTGRES_TYPES = [
  "uuid",
  "text",
  "integer",
  "bigint",
  "smallint",
  "boolean",
  "timestamp with time zone",
  "timestamp without time zone",
  "date",
  "time",
  "numeric",
  "real",
  "double precision",
  "jsonb",
  "json",
  "bytea",
  "inet",
  "ARRAY",
] as const;
