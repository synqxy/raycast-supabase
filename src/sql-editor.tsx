import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Detail,
  Form,
  Icon,
  List,
  LocalStorage,
  openCommandPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import type { Preferences, PostgrestSchema, RowData } from "./types";
import { getPrefs, executeSQL, fetchSchema, getTableNames, getTableDefinition, getColumnNames } from "./utils/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Setup SQL
// ---------------------------------------------------------------------------

const SETUP_SQL = `CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  trimmed text;
BEGIN
  trimmed := lower(btrim(query));
  -- For SELECT queries, wrap in json_agg to return rows as JSON
  IF trimmed LIKE 'select %' OR trimmed LIKE 'with %' THEN
    EXECUTE 'SELECT COALESCE(json_agg(t), ''[]''::json) FROM (' || query || ') t' INTO result;
    RETURN result;
  END IF;
  -- For DDL/DML (CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, etc.), just execute
  EXECUTE query;
  RETURN '[{"status": "OK"}]'::json;
END;
$$;

GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;`;

// ---------------------------------------------------------------------------
// Query templates
// ---------------------------------------------------------------------------

function getTemplates(schema: PostgrestSchema | null): Array<{ name: string; category: string; sql: string }> {
  const tables = schema ? getTableNames(schema) : [];
  const t = tables[0] ? `"${tables[0]}"` : '"my_table"';

  const firstTableCols = schema && tables[0] ? getColumnNames(getTableDefinition(schema, tables[0])!) : [];
  const c = firstTableCols[0] ? `"${firstTableCols[0]}"` : '"id"';

  return [
    // SELECT templates
    { name: "Select all rows", category: "SELECT", sql: `SELECT * FROM ${t} LIMIT 100;` },
    { name: "Select with filter", category: "SELECT", sql: `SELECT * FROM ${t} WHERE ${c} = 'value';` },
    { name: "Count rows", category: "SELECT", sql: `SELECT COUNT(*) FROM ${t};` },
    { name: "Select specific columns", category: "SELECT", sql: `SELECT ${c} FROM ${t} LIMIT 100;` },
    { name: "Order by column", category: "SELECT", sql: `SELECT * FROM ${t} ORDER BY ${c} DESC LIMIT 100;` },
    // INSERT templates
    { name: "Insert one row", category: "INSERT", sql: `INSERT INTO ${t} (${c}) VALUES ('value');` },
    // UPDATE templates
    { name: "Update rows", category: "UPDATE", sql: `UPDATE ${t} SET ${c} = 'new_value' WHERE ${c} = 'old_value';` },
    // DELETE templates
    { name: "Delete rows", category: "DELETE", sql: `DELETE FROM ${t} WHERE ${c} = 'value';` },
    // DDL templates
    {
      name: "Create table",
      category: "DDL",
      sql: `CREATE TABLE "new_table" (\n  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  "created_at" timestamptz DEFAULT now()\n);`,
    },
    { name: "Add column", category: "DDL", sql: `ALTER TABLE ${t} ADD COLUMN "new_column" text;` },
    { name: "Drop column", category: "DDL", sql: `ALTER TABLE ${t} DROP COLUMN "column_name";` },
    { name: "Rename column", category: "DDL", sql: `ALTER TABLE ${t} RENAME COLUMN "old_name" TO "new_name";` },
    { name: "Drop table", category: "DDL", sql: `DROP TABLE "table_name";` },
    // Utility
    {
      name: "List all tables",
      category: "Utility",
      sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`,
    },
    {
      name: "List columns of table",
      category: "Utility",
      sql: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${
        tables[0] || "my_table"
      }' ORDER BY ordinal_position;`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

export default function Command() {
  const prefs = getPrefs();

  if (!prefs.supabaseKey || !prefs.supabaseUrl) {
    return (
      <Detail
        markdown="API key or URL incorrect. Please update it in extension preferences and try again."
        actions={
          <ActionPanel>
            <Action title="Open Extension Preferences" onAction={openCommandPreferences} />
          </ActionPanel>
        }
      />
    );
  }

  if (!prefs.serviceRoleKey) {
    return (
      <Detail
        markdown={`# Service Role Key Required

The SQL Editor requires the **service_role** key.

1. Go to your Supabase Dashboard → Settings → API
2. Copy the **service_role** key
3. Open Raycast Extension Preferences and paste it in the "Service Role Key" field

> ⚠️ The service_role key bypasses Row Level Security. Keep it safe.`}
        actions={
          <ActionPanel>
            <Action title="Open Extension Preferences" onAction={openCommandPreferences} />
          </ActionPanel>
        }
      />
    );
  }

  return <MainView prefs={prefs} />;
}

// ---------------------------------------------------------------------------
// Main view — saved queries + templates
// ---------------------------------------------------------------------------

function MainView({ prefs }: { prefs: Preferences }) {
  const { push } = useNavigation();
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [schema, setSchema] = useState<PostgrestSchema | null>(null);

  // Load saved queries and schema
  useEffect(() => {
    (async () => {
      const stored = await LocalStorage.getItem<string>("saved-queries");
      if (stored) {
        try {
          setSavedQueries(JSON.parse(stored));
        } catch {
          // ignore
        }
      }

      // Fetch schema for templates and table/column picker
      try {
        const s = await fetchSchema(prefs.supabaseUrl, prefs.supabaseKey);
        setSchema(s);
      } catch {
        // schema fetch failed, templates will use defaults
      }

      setIsLoading(false);
    })();
  }, []);

  const persistQueries = useCallback(async (queries: SavedQuery[]) => {
    setSavedQueries(queries);
    await LocalStorage.setItem("saved-queries", JSON.stringify(queries));
  }, []);

  const deleteQuery = useCallback(
    async (id: string) => {
      const confirmed = await confirmAlert({
        title: "Delete saved query?",
        message: "This cannot be undone.",
        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
      });
      if (confirmed) {
        await persistQueries(savedQueries.filter((q) => q.id !== id));
        showToast(Toast.Style.Success, "Query deleted");
      }
    },
    [savedQueries, persistQueries]
  );

  const templates = getTemplates(schema);
  const templateCategories = [...new Set(templates.map((t) => t.category))];

  if (needsSetup) {
    return <SetupView onBack={() => setNeedsSetup(false)} />;
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search queries and templates...">
      {/* New Query */}
      <List.Section title="Actions">
        <List.Item
          title="New Query"
          subtitle="Write and execute SQL"
          icon={Icon.Plus}
          actions={
            <ActionPanel>
              <Action
                title="New Query"
                icon={Icon.Plus}
                onAction={() =>
                  push(
                    <QueryForm
                      prefs={prefs}
                      schema={schema}
                      onNeedsSetup={() => setNeedsSetup(true)}
                      onSaved={(name, sql) => {
                        const newQuery: SavedQuery = {
                          id: String(Date.now()),
                          name,
                          sql,
                          createdAt: new Date().toISOString(),
                        };
                        persistQueries([newQuery, ...savedQueries]);
                      }}
                    />
                  )
                }
              />
            </ActionPanel>
          }
        />
      </List.Section>

      {/* Saved Queries */}
      {savedQueries.length > 0 && (
        <List.Section title="Saved Queries">
          {savedQueries.map((q) => (
            <List.Item
              key={q.id}
              title={q.name}
              subtitle={q.sql.length > 60 ? q.sql.slice(0, 60) + "..." : q.sql}
              icon={Icon.Bookmark}
              accessories={[{ text: new Date(q.createdAt).toLocaleDateString() }]}
              detail={
                <List.Item.Detail
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="Name" text={q.name} />
                      <List.Item.Detail.Metadata.Label title="Created" text={new Date(q.createdAt).toLocaleString()} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="SQL" />
                      {q.sql.split("\n").map((line, i) => (
                        <List.Item.Detail.Metadata.Label key={i} title="" text={line} />
                      ))}
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Run Query"
                    icon={Icon.Play}
                    onAction={() =>
                      push(
                        <QueryForm
                          prefs={prefs}
                          schema={schema}
                          initialSQL={q.sql}
                          onNeedsSetup={() => setNeedsSetup(true)}
                        />
                      )
                    }
                  />
                  <Action
                    title="Edit Query"
                    icon={Icon.Pencil}
                    onAction={() =>
                      push(
                        <QueryForm
                          prefs={prefs}
                          schema={schema}
                          initialSQL={q.sql}
                          queryName={q.name}
                          onNeedsSetup={() => setNeedsSetup(true)}
                          onSaved={(name, sql) => {
                            persistQueries(savedQueries.map((sq) => (sq.id === q.id ? { ...sq, name, sql } : sq)));
                          }}
                        />
                      )
                    }
                  />
                  <Action
                    title="Run as-is"
                    icon={Icon.Play}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() =>
                      push(<SQLResult sql={q.sql} prefs={prefs} onNeedsSetup={() => setNeedsSetup(true)} />)
                    }
                  />
                  <Action.CopyToClipboard title="Copy SQL" content={q.sql} />
                  <Action
                    title="Delete Query"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => deleteQuery(q.id)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {/* Templates */}
      <List.Section title="Templates">
        {templateCategories.map((cat) => (
          <List.Item
            key={cat}
            title={cat}
            subtitle={`${templates.filter((t) => t.category === cat).length} templates`}
            icon={Icon.Code}
            actions={
              <ActionPanel>
                <ActionPanel.Submenu title={`Use ${cat} Template`} icon={Icon.Code}>
                  {templates
                    .filter((t) => t.category === cat)
                    .map((t, i) => (
                      <Action
                        key={i}
                        title={t.name}
                        onAction={() =>
                          push(
                            <QueryForm
                              prefs={prefs}
                              schema={schema}
                              initialSQL={t.sql}
                              onNeedsSetup={() => setNeedsSetup(true)}
                              onSaved={(name, sql) => {
                                const newQuery: SavedQuery = {
                                  id: String(Date.now()),
                                  name,
                                  sql,
                                  createdAt: new Date().toISOString(),
                                };
                                persistQueries([newQuery, ...savedQueries]);
                              }}
                            />
                          )
                        }
                      />
                    ))}
                </ActionPanel.Submenu>
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

// ---------------------------------------------------------------------------
// Query form — the editor
// ---------------------------------------------------------------------------

function QueryForm({
  prefs,
  schema,
  initialSQL = "",
  queryName,
  onNeedsSetup,
  onSaved,
}: {
  prefs: Preferences;
  schema: PostgrestSchema | null;
  initialSQL?: string;
  queryName?: string;
  onNeedsSetup: () => void;
  onSaved?: (name: string, sql: string) => void;
}) {
  const { push } = useNavigation();
  const [isExecuting, setIsExecuting] = useState(false);
  const [sql, setSql] = useState(initialSQL);
  const [name, setName] = useState(queryName || "");
  const tables = schema ? getTableNames(schema) : [];

  function appendToSQL(text: string) {
    setSql((prev) => {
      const trimmed = prev.trimEnd();
      // Add space separator if there's existing content
      return trimmed ? trimmed + " " + text : text;
    });
  }

  async function handleExecute() {
    const trimmed = sql?.trim();
    if (!trimmed) {
      showToast(Toast.Style.Failure, "SQL query is empty");
      return;
    }
    setIsExecuting(true);
    try {
      push(<SQLResult sql={trimmed} prefs={prefs} onNeedsSetup={onNeedsSetup} />);
    } finally {
      setIsExecuting(false);
    }
  }

  function handleSave() {
    const trimmed = sql?.trim();
    if (!trimmed) {
      showToast(Toast.Style.Failure, "SQL query is empty");
      return;
    }
    const qName = name?.trim() || `Query ${new Date().toLocaleString()}`;
    onSaved?.(qName, trimmed);
    showToast(Toast.Style.Success, "Query saved", qName);
  }

  return (
    <Form
      isLoading={isExecuting}
      actions={
        <ActionPanel>
          <Action
            title="Execute Query"
            icon={Icon.Play}
            onAction={handleExecute}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
          />
          {onSaved && (
            <Action
              title="Save Query"
              icon={Icon.Bookmark}
              shortcut={{ modifiers: ["cmd"], key: "s" }}
              onAction={handleSave}
            />
          )}
          {/* Insert Table Name submenu */}
          {tables.length > 0 && (
            <ActionPanel.Submenu title="Insert Table Name" icon={Icon.List} shortcut={{ modifiers: ["cmd"], key: "t" }}>
              {tables.map((t) => (
                <Action key={t} title={t} onAction={() => appendToSQL(t)} />
              ))}
            </ActionPanel.Submenu>
          )}
          {/* Insert Column Name submenu */}
          {schema && tables.length > 0 && (
            <ActionPanel.Submenu title="Insert Column" icon={Icon.Tag} shortcut={{ modifiers: ["cmd"], key: "k" }}>
              {tables.map((t) => {
                const table = getTableDefinition(schema, t);
                if (!table) return null;
                const cols = getColumnNames(table);
                return (
                  <ActionPanel.Submenu key={t} title={t} icon={Icon.List}>
                    {cols.map((c) => (
                      <Action key={c} title={c} onAction={() => appendToSQL(c)} />
                    ))}
                  </ActionPanel.Submenu>
                );
              })}
            </ActionPanel.Submenu>
          )}
        </ActionPanel>
      }
    >
      <Form.TextField
        id="queryName"
        title="Query Name"
        placeholder="My awesome query"
        value={name}
        onChange={setName}
      />
      <Form.TextArea
        id="sql"
        title="SQL Query"
        placeholder="SELECT * FROM my_table LIMIT 10;"
        value={sql}
        onChange={setSql}
        enableMarkdown={false}
      />
      <Form.Separator />
      <Form.Description text="💡 Actions: ⌘E Execute · ⌘S Save · ⌘T Insert Table · ⌘K Insert Column" />
      {tables.length > 0 && (
        <>
          <Form.Separator />
          <Form.Description text="📋 Available tables:" />
          {tables.slice(0, 10).map((t) => {
            const table = getTableDefinition(schema!, t);
            const colCount = table ? getColumnNames(table).length : 0;
            return <Form.Description key={t} text={`  ${t} (${colCount} columns)`} />;
          })}
          {tables.length > 10 && <Form.Description text={`  ... and ${tables.length - 10} more`} />}
        </>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------------------
// SQL result
// ---------------------------------------------------------------------------

function SQLResult({ sql, prefs, onNeedsSetup }: { sql: string; prefs: Preferences; onNeedsSetup: () => void }) {
  const [result, setResult] = useState<RowData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const startTime = Date.now();
      try {
        const data = await executeSQL(prefs.supabaseUrl, prefs.serviceRoleKey!, sql);
        setExecutionTime(Date.now() - startTime);
        setResult(data);
      } catch (e) {
        const errStr = String(e);
        setExecutionTime(Date.now() - startTime);
        if (errStr.includes("PGRST202")) {
          onNeedsSetup();
          return;
        }
        setError(errStr);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const timeStr = executionTime !== null ? `${executionTime}ms` : "";

  if (isLoading) {
    return <Detail markdown={`# Executing...\n\n\`\`\`sql\n${sql}\n\`\`\``} />;
  }

  if (error) {
    return (
      <Detail
        markdown={`# Query Failed\n\n\`\`\`sql\n${sql}\n\`\`\`\n\n## Error\n\n\`\`\`\n${error}\n\`\`\`\n\n${
          timeStr ? `⏱ ${timeStr}` : ""
        }`}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Error" content={error} />
            <Action.CopyToClipboard title="Copy SQL" content={sql} />
          </ActionPanel>
        }
      />
    );
  }

  if (!result || result.length === 0) {
    return (
      <Detail
        markdown={`# Query Executed\n\n\`\`\`sql\n${sql}\n\`\`\`\n\n**Result:** 0 rows returned\n\n${
          timeStr ? `⏱ ${timeStr}` : ""
        }`}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy SQL" content={sql} />
          </ActionPanel>
        }
      />
    );
  }

  const columns = Object.keys(result[0]);

  return (
    <List isShowingDetail searchBarPlaceholder="Search results...">
      <List.Section title={`${result.length} rows · ${timeStr}`}>
        {result.map((row, index) => (
          <List.Item
            key={index}
            title={`Row ${index + 1}`}
            subtitle={columns.length > 0 ? String(row[columns[0]] ?? "NULL") : ""}
            icon={Icon.Terminal}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Query" text={sql} />
                    <List.Item.Detail.Metadata.Separator />
                    {columns.map((col) => (
                      <List.Item.Detail.Metadata.Label
                        key={col}
                        title={col}
                        text={row[col] === null ? "NULL" : String(row[col])}
                      />
                    ))}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Row as JSON" content={JSON.stringify(row, null, 2)} />
                <Action.CopyToClipboard
                  title="Copy All Results as JSON"
                  content={JSON.stringify(result, null, 2)}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                />
                <Action.CopyToClipboard title="Copy SQL" content={sql} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

// ---------------------------------------------------------------------------
// Setup view
// ---------------------------------------------------------------------------

function SetupView({ onBack }: { onBack: () => void }) {
  return (
    <Detail
      markdown={`# Setup Required: \`exec_sql\` Function

The SQL Editor needs a helper function called \`exec_sql\` in your Supabase database. This function doesn't exist yet.

## How to set it up

1. Copy the setup SQL below (**⌘⇧C** or use the action)
2. Open your Supabase Dashboard → **SQL Editor** → **New Query**
3. Paste and **Run** the SQL

> **Self-hosted?** Open your Supabase Studio at your own URL, or connect directly to your Postgres database and run the SQL there.

## What this does

Creates a PostgreSQL function that executes arbitrary SQL queries. It uses \`SECURITY DEFINER\` so it runs with the function owner's privileges (superuser), which is necessary for DDL operations like CREATE TABLE.

> ⚠️ Only grant access to trusted roles (like \`service_role\`).`}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Setup SQL" content={SETUP_SQL} />
          <Action title="Back to Editor" icon={Icon.ArrowLeft} onAction={onBack} />
        </ActionPanel>
      }
    />
  );
}
