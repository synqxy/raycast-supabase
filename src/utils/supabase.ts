import { getPreferenceValues } from "@raycast/api";
import type {
  Preferences,
  PostgrestSchema,
  TableDefinition,
  RowData,
  SupabaseUser,
  UsersResponse,
  FetchRowsOptions,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getPrefs(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function authHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function jsonHeaders(key: string): Record<string, string> {
  return {
    ...authHeaders(key),
    "Content-Type": "application/json",
  };
}

// Safely quote a SQL default value.
// SQL expressions like now() and gen_random_uuid() are left unquoted.
// Numbers are left unquoted. Everything else is wrapped in single quotes.
function quoteDefaultValue(val: string): string {
  const trimmed = val.trim();
  // Already quoted
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed;
  // SQL expression (function call or keyword)
  if (/\w+\s*\(/.test(trimmed) || /^(current_|now|uuid)/i.test(trimmed)) return trimmed;
  // Numeric
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  // NULL/DEFAULT keywords
  if (/^(null|default)$/i.test(trimmed)) return trimmed;
  // Otherwise, quote it
  return `'${trimmed.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Schema / Tables
// ---------------------------------------------------------------------------

export async function fetchSchema(url: string, key: string): Promise<PostgrestSchema> {
  const res = await fetch(`${url}/rest/v1/`, { headers: authHeaders(key) });
  if (!res.ok) throw new Error(`Failed to fetch schema: ${res.status}`);
  return res.json();
}

export function getTableNames(schema: PostgrestSchema): string[] {
  return Object.keys(schema.definitions).sort();
}

export function getTableDefinition(schema: PostgrestSchema, tableName: string): TableDefinition | undefined {
  return schema.definitions[tableName];
}

export function getColumnNames(table: TableDefinition): string[] {
  return Object.keys(table.properties);
}

// ---------------------------------------------------------------------------
// Rows (CRUD)
// ---------------------------------------------------------------------------

export async function fetchRows(
  url: string,
  key: string,
  opts: FetchRowsOptions
): Promise<{ data: RowData[]; totalCount: number | null }> {
  const {
    table,
    limit = 50,
    offset = 0,
    orderBy,
    orderDirection = "asc",
    search,
    searchColumns,
    numericSearchColumns,
    filterColumn,
    filterOperator,
    filterValue,
  } = opts;

  const params = new URLSearchParams({ select: "*" });
  if (orderBy) params.set("order", `${orderBy}.${orderDirection}`);

  // Column-specific filter (e.g., name=eq.John)
  if (filterColumn && filterOperator && filterValue !== undefined) {
    params.set(filterColumn, `${filterOperator}.${filterValue}`);
  }
  // Global search across all text/numeric columns
  else if (search && (searchColumns?.length || numericSearchColumns?.length)) {
    const orParts: string[] = [];
    if (searchColumns) {
      orParts.push(...searchColumns.map((col) => `${col}.ilike.*${search}*`));
    }
    if (numericSearchColumns && !isNaN(Number(search))) {
      orParts.push(...numericSearchColumns.map((col) => `${col}.eq.${search}`));
    }
    if (orParts.length > 0) {
      params.set("or", `(${orParts.join(",")})`);
    }
  }

  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`;
  const res = await fetch(endpoint, {
    headers: {
      ...authHeaders(key),
      Range: `${offset}-${offset + limit - 1}`,
      Prefer: "count=exact",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch rows (${res.status}): ${body}`);
  }

  const contentRange = res.headers.get("Content-Range");
  let totalCount: number | null = null;
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match) totalCount = parseInt(match[1], 10);
  }

  const data = await res.json();
  return { data, totalCount };
}

export async function insertRow(url: string, key: string, table: string, row: RowData): Promise<RowData> {
  const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: { ...jsonHeaders(key), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Insert failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function updateRow(
  url: string,
  key: string,
  table: string,
  pkColumn: string,
  pkValue: string | number,
  row: RowData
): Promise<RowData> {
  const res = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?${encodeURIComponent(pkColumn)}=eq.${encodeURIComponent(
      String(pkValue)
    )}`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders(key), Prefer: "return=representation" },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Update failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function deleteRow(
  url: string,
  key: string,
  table: string,
  pkColumn: string,
  pkValue: string | number
): Promise<void> {
  const res = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?${encodeURIComponent(pkColumn)}=eq.${encodeURIComponent(
      String(pkValue)
    )}`,
    {
      method: "DELETE",
      headers: authHeaders(key),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Delete failed (${res.status}): ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Column management (via SQL RPC)
// ---------------------------------------------------------------------------

export async function executeSQL(url: string, serviceKey: string, sql: string): Promise<RowData[]> {
  // Strip trailing semicolons — the exec_sql wrapper embeds the query in a subquery,
  // so a trailing ; breaks the outer SQL syntax.
  const cleanSql = sql.replace(/;\s*$/, "").trim();

  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify({ query: cleanSql }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("PGRST202")) {
      throw new Error(
        "The exec_sql function is not set up in your database. Open the SQL Editor command for setup instructions."
      );
    }
    throw new Error(`SQL execution failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function addColumn(
  url: string,
  serviceKey: string,
  tableName: string,
  columnName: string,
  columnType: string,
  isNullable: boolean,
  defaultValue?: string
): Promise<void> {
  let sql = `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnType}`;
  if (!isNullable) sql += " NOT NULL";
  if (defaultValue !== undefined && defaultValue !== "") sql += ` DEFAULT ${quoteDefaultValue(defaultValue)}`;
  await executeSQL(url, serviceKey, sql);
}

export async function dropColumn(
  url: string,
  serviceKey: string,
  tableName: string,
  columnName: string
): Promise<void> {
  await executeSQL(url, serviceKey, `ALTER TABLE "${tableName}" DROP COLUMN "${columnName}"`);
}

export async function createTable(
  url: string,
  serviceKey: string,
  tableName: string,
  columns: Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean; defaultValue?: string }>
): Promise<void> {
  const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => `"${c.name}"`);

  const colDefs = columns.map((c) => {
    let def = `"${c.name}" ${c.type}`;
    // Don't add inline PRIMARY KEY — we handle it as a table constraint below
    if (!c.nullable && !c.isPrimaryKey) def += " NOT NULL";
    if (c.defaultValue !== undefined && c.defaultValue !== "") def += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`;
    return def;
  });

  // Add composite primary key constraint if any PK columns exist
  if (pkColumns.length > 0) {
    colDefs.push(`PRIMARY KEY (${pkColumns.join(", ")})`);
  }

  const sql = `CREATE TABLE "${tableName}" (${colDefs.join(", ")})`;
  await executeSQL(url, serviceKey, sql);
}

export async function deleteTable(url: string, serviceKey: string, tableName: string): Promise<void> {
  await executeSQL(url, serviceKey, `DROP TABLE "${tableName}"`);
}

export async function renameTable(url: string, serviceKey: string, oldName: string, newName: string): Promise<void> {
  await executeSQL(url, serviceKey, `ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
}

export async function editColumn(
  url: string,
  serviceKey: string,
  tableName: string,
  oldColumnName: string,
  options: { newName?: string; newType?: string; nullable?: boolean; defaultValue?: string; dropDefault?: boolean }
): Promise<void> {
  const statements: string[] = [];

  if (options.newName && options.newName !== oldColumnName) {
    statements.push(`ALTER TABLE "${tableName}" RENAME COLUMN "${oldColumnName}" TO "${options.newName}"`);
  }

  const colRef = options.newName && options.newName !== oldColumnName ? options.newName : oldColumnName;

  if (options.newType) {
    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colRef}" TYPE ${options.newType}`);
  }

  if (options.nullable === true) {
    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colRef}" DROP NOT NULL`);
  } else if (options.nullable === false) {
    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colRef}" SET NOT NULL`);
  }

  if (options.dropDefault) {
    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colRef}" DROP DEFAULT`);
  } else if (options.defaultValue !== undefined && options.defaultValue !== "") {
    statements.push(
      `ALTER TABLE "${tableName}" ALTER COLUMN "${colRef}" SET DEFAULT ${quoteDefaultValue(options.defaultValue)}`
    );
  }

  for (const sql of statements) {
    await executeSQL(url, serviceKey, sql);
  }
}

// ---------------------------------------------------------------------------
// User management (Auth Admin API)
// ---------------------------------------------------------------------------

export async function fetchUsers(url: string, serviceKey: string, page = 1, perPage = 50): Promise<UsersResponse> {
  const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
    headers: authHeaders(serviceKey),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch users (${res.status}): ${body}`);
  }
  return res.json();
}

export async function inviteUser(
  url: string,
  serviceKey: string,
  email: string,
  metadata?: Record<string, unknown>
): Promise<SupabaseUser> {
  const res = await fetch(`${url}/auth/v1/admin/invite`, {
    method: "POST",
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify({ email, data: metadata || {} }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Invite failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function updateUser(
  url: string,
  serviceKey: string,
  userId: string,
  data: {
    email?: string;
    password?: string;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  }
): Promise<SupabaseUser> {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Update user failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function deleteUser(url: string, serviceKey: string, userId: string): Promise<void> {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders(serviceKey),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Delete user failed (${res.status}): ${body}`);
  }
}
