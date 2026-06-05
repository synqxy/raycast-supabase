import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Detail,
  Form,
  Icon,
  List,
  openCommandPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useFetch } from "@raycast/utils";
import { useState, useEffect, useRef } from "react";
import type { Preferences, PostgrestSchema, TableDefinition, RowData, FetchRowsOptions } from "./types";
import { POSTGRES_TYPES } from "./types";
import {
  getPrefs,
  authHeaders,
  getTableNames,
  getTableDefinition,
  getColumnNames,
  fetchRows,
  insertRow,
  updateRow,
  deleteRow,
  addColumn,
  dropColumn,
  deleteTable,
  renameTable,
  editColumn,
} from "./utils/supabase";

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

  return <TableList prefs={prefs} />;
}

// ---------------------------------------------------------------------------
// Table list (main view)
// ---------------------------------------------------------------------------

function TableList({ prefs }: { prefs: Preferences }) {
  const { push } = useNavigation();
  const { isLoading, error, data, revalidate } = useFetch<PostgrestSchema>(`${prefs.supabaseUrl}/rest/v1/`, {
    headers: authHeaders(prefs.supabaseKey),
  });

  if (error) {
    return (
      <Detail
        markdown={`## Error\n\n${error.message}`}
        actions={
          <ActionPanel>
            <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
          </ActionPanel>
        }
      />
    );
  }

  const tableNames = data ? getTableNames(data) : [];

  return (
    <List isShowingDetail isLoading={isLoading} searchBarPlaceholder="Search tables...">
      {tableNames.map((name) => {
        const table = getTableDefinition(data!, name)!;
        const columns = getColumnNames(table);
        return (
          <List.Item
            key={name}
            title={name}
            icon={Icon.List}
            subtitle={table.description || undefined}
            accessories={[{ text: `${columns.length} columns`, tooltip: "Column count" }]}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Table" text={name} />
                    {table.description && (
                      <List.Item.Detail.Metadata.Label title="Description" text={table.description} />
                    )}
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.TagList title="Columns">
                      {columns.map((col) => (
                        <List.Item.Detail.Metadata.TagList.Item key={col} text={col} color={Color.Blue} />
                      ))}
                    </List.Item.Detail.Metadata.TagList>
                    <List.Item.Detail.Metadata.Separator />
                    {columns.map((col) => {
                      const colDef = table.properties[col];
                      return (
                        <List.Item.Detail.Metadata.Label
                          key={col}
                          title={col}
                          text={[colDef.type, colDef.format].filter(Boolean).join(" · ")}
                        />
                      );
                    })}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="View Rows"
                  icon={Icon.Eye}
                  onAction={() => push(<RowList prefs={prefs} tableName={name} table={table} />)}
                />
                <Action
                  title="Add Row"
                  icon={Icon.Plus}
                  onAction={() => push(<RowForm prefs={prefs} tableName={name} table={table} />)}
                />
                <ActionPanel.Submenu title="Manage Table" icon={Icon.Gear}>
                  <Action
                    title="Edit Table"
                    icon={Icon.Pencil}
                    onAction={() => push(<EditTableForm prefs={prefs} tableName={name} />)}
                  />
                  <Action
                    title="Add Column"
                    icon={Icon.Plus}
                    onAction={() => push(<AddColumnForm prefs={prefs} tableName={name} />)}
                  />
                  <Action
                    title="Edit Column"
                    icon={Icon.Pencil}
                    onAction={() =>
                      push(<EditColumnPicker prefs={prefs} tableName={name} columns={columns} table={table} />)
                    }
                  />
                  <Action
                    title="Drop Column"
                    icon={Icon.Trash}
                    onAction={() => push(<DropColumnPicker prefs={prefs} tableName={name} columns={columns} />)}
                  />
                  <Action
                    title="Delete Table"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={async () => {
                      const confirmed = await confirmAlert({
                        title: `Delete table "${name}"?`,
                        message: "This action cannot be undone. All data will be lost.",
                        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
                      });
                      if (confirmed) {
                        try {
                          const serviceKey = prefs.serviceRoleKey || prefs.supabaseKey;
                          await deleteTable(prefs.supabaseUrl, serviceKey, name);
                          showToast(Toast.Style.Success, "Table deleted", name);
                          revalidate();
                        } catch (e) {
                          showToast(Toast.Style.Failure, "Failed to delete table", String(e));
                        }
                      }
                    }}
                  />
                </ActionPanel.Submenu>
                <ActionPanel.Submenu title="Table Info" icon={Icon.Info}>
                  <Action.CopyToClipboard title="Copy Table Name" content={name} />
                  <Action.CopyToClipboard title="Copy Column Names" content={columns.join(", ")} />
                </ActionPanel.Submenu>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Column detail (pushed from tag tap)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Row list
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

function RowList({ prefs, tableName, table }: { prefs: Preferences; tableName: string; table: TableDefinition }) {
  const { push } = useNavigation();
  const columns = getColumnNames(table);
  const pkColumn = columns.includes("id") ? "id" : columns[0];

  // Separate text columns (safe for ilike) from other columns
  // PostgREST format field is the most reliable indicator
  const ilikeFormats = new Set(["text", "character varying", "varchar", "char", "character", "name", "citext"]);
  const eqTypes = new Set([
    "integer",
    "number",
    "bigint",
    "smallint",
    "numeric",
    "real",
    "double precision",
    "boolean",
  ]);
  const textColumns = columns.filter((col) => {
    const def = table.properties[col];
    if (!def) return false;
    // If format is a known text format, it's searchable
    if (def.format && ilikeFormats.has(def.format)) return true;
    // If type is "text", it's searchable
    if (def.type === "text") return true;
    return false;
  });
  const numericColumns = columns.filter((col) => {
    const def = table.properties[col];
    return def && eqTypes.has(def.type);
  });

  const offsetRef = useRef(0);
  const [allRows, setAllRows] = useState<RowData[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const [searchText, setSearchText] = useState("");
  const [filterColumn, setFilterColumn] = useState<string>("");
  const searchTimerRef = useRef<NodeJS.Timeout>();

  // Determine the PostgREST operator for a column type
  function getOperator(col: string, value: string): string {
    const def = table.properties[col];
    if (!def) return "eq";
    const type = def.type;
    const format = def.format;
    // Text-like columns: use ilike for partial match
    if (ilikeFormats.has(format || "") || type === "text") return "ilike";
    // Boolean
    if (type === "boolean") return "eq";
    // Numeric: exact match
    if (eqTypes.has(type)) return "eq";
    // UUID, timestamp, etc: exact match
    return "eq";
  }

  async function loadRows(reset = false, search?: string, filterCol?: string) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const currentOffset = reset ? 0 : offsetRef.current;
      const useFilter = filterCol && search;
      const opts: FetchRowsOptions = {
        table: tableName,
        limit: PAGE_SIZE,
        offset: currentOffset,
        orderBy: columns.includes("created_at") ? "created_at" : undefined,
        orderDirection: "desc",
      };
      if (useFilter) {
        const op = getOperator(filterCol!, search!);
        opts.filterColumn = filterCol;
        opts.filterOperator = op;
        opts.filterValue = op === "ilike" ? `*${search}*` : search;
      } else if (search) {
        opts.search = search;
        opts.searchColumns = textColumns;
        opts.numericSearchColumns = numericColumns;
      }
      const result = await fetchRows(prefs.supabaseUrl, prefs.supabaseKey, opts);
      if (reset) {
        setAllRows(result.data);
        offsetRef.current = PAGE_SIZE;
      } else {
        setAllRows((prev) => [...prev, ...result.data]);
        offsetRef.current = currentOffset + PAGE_SIZE;
      }
      setTotalCount(result.totalCount);
    } catch (e) {
      setError(String(e));
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }

  // Load on mount
  useEffect(() => {
    loadRows(true);
  }, []);

  // Debounced server-side search
  function onSearchTextChange(text: string) {
    setSearchText(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      offsetRef.current = 0;
      loadRows(true, text || undefined, filterColumn || undefined);
    }, 300);
  }

  // Column filter change
  function onFilterChange(col: string) {
    setFilterColumn(col);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      offsetRef.current = 0;
      loadRows(true, searchText || undefined, col || undefined);
    }, 100);
  }

  const hasMore =
    !searchText &&
    (totalCount !== null ? allRows.length < totalCount : allRows.length % PAGE_SIZE === 0 && allRows.length > 0);

  if (error) {
    return (
      <Detail
        markdown={`## Error loading rows\n\n${error}\n\nMake sure your API key has access to this table.`}
        actions={
          <ActionPanel>
            <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => loadRows(true)} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isShowingDetail
      isLoading={isLoading}
      searchBarPlaceholder={filterColumn ? `Filter ${filterColumn}...` : `Search ${tableName} rows...`}
      searchText={searchText}
      onSearchTextChange={onSearchTextChange}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by Column" value={filterColumn} onChange={onFilterChange}>
          <List.Dropdown.Item title="All Columns" value="" icon={Icon.MagnifyingGlass} />
          <List.Dropdown.Section title="Columns">
            {columns.map((col) => (
              <List.Dropdown.Item key={col} title={col} value={col} icon={Icon.Tag} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {allRows.map((row, index) => {
        const pkValue = row[pkColumn];
        return (
          <List.Item
            key={`${pkValue}-${index}`}
            title={String(pkValue ?? index)}
            subtitle={tableName}
            icon={Icon.Terminal}
            accessories={[{ text: `Row ${index + 1}`, tooltip: "Row number" }]}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Primary Key" text={`${pkColumn} = ${String(pkValue)}`} />
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
                <Action
                  title="Edit Row"
                  icon={Icon.Pencil}
                  onAction={() =>
                    push(
                      <RowForm
                        prefs={prefs}
                        tableName={tableName}
                        table={table}
                        editMode
                        initialRow={row}
                        pkColumn={pkColumn}
                        pkValue={pkValue}
                      />
                    )
                  }
                />
                <Action
                  title="Delete Row"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    const confirmed = await confirmAlert({
                      title: `Delete row?`,
                      message: `${pkColumn} = ${String(pkValue)}`,
                      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
                    });
                    if (confirmed) {
                      try {
                        await deleteRow(prefs.supabaseUrl, prefs.supabaseKey, tableName, pkColumn, pkValue);
                        showToast(Toast.Style.Success, "Row deleted");
                        setAllRows((prev) => prev.filter((r) => String(r[pkColumn]) !== String(pkValue)));
                      } catch (e) {
                        showToast(Toast.Style.Failure, "Delete failed", String(e));
                      }
                    }
                  }}
                />
                <Action
                  title="Add Row"
                  icon={Icon.Plus}
                  onAction={() => push(<RowForm prefs={prefs} tableName={tableName} table={table} />)}
                />
                {!isLoading && (
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => loadRows(true)}
                  />
                )}
                {hasMore && !isLoading && (
                  <Action
                    title="Load More"
                    icon={Icon.ArrowDown}
                    shortcut={{ modifiers: ["cmd"], key: "m" }}
                    onAction={() => loadRows(false)}
                  />
                )}
                <Action.CopyToClipboard
                  title="Copy Row as JSON"
                  content={JSON.stringify(row, null, 2)}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
              </ActionPanel>
            }
          />
        );
      })}
      {!isLoading && allRows.length === 0 && (
        <List.EmptyView
          icon={Icon.Tray}
          title="No Rows"
          description="This table is empty"
          actions={
            <ActionPanel>
              <Action
                title="Add Row"
                icon={Icon.Plus}
                onAction={() => push(<RowForm prefs={prefs} tableName={tableName} table={table} />)}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Row form (add / edit)
// ---------------------------------------------------------------------------

function RowForm({
  prefs,
  tableName,
  table,
  editMode = false,
  initialRow,
  pkColumn,
  pkValue,
}: {
  prefs: Preferences;
  tableName: string;
  table: TableDefinition;
  editMode?: boolean;
  initialRow?: RowData;
  pkColumn?: string;
  pkValue?: string | number;
}) {
  const { pop } = useNavigation();
  const columns = getColumnNames(table);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: Record<string, string>) {
    setIsSubmitting(true);
    try {
      // Convert form string values to appropriate types
      const row: RowData = {};
      for (const col of columns) {
        const val = values[col];
        if (val === undefined || val === "") {
          row[col] = null;
          continue;
        }
        const colDef = table.properties[col];
        switch (colDef.type) {
          case "integer":
          case "bigint":
          case "smallint":
          case "number":
          case "numeric":
          case "real":
          case "double precision":
            row[col] = Number(val);
            break;
          case "boolean":
            row[col] = val === "true";
            break;
          case "jsonb":
          case "json":
          case "object":
          case "array":
            try {
              row[col] = JSON.parse(val);
            } catch {
              row[col] = val;
            }
            break;
          // date, timestamp, uuid, text, etc. stay as strings
          default:
            row[col] = val;
        }
      }

      if (editMode && pkColumn && pkValue !== undefined) {
        await updateRow(prefs.supabaseUrl, prefs.supabaseKey, tableName, pkColumn, pkValue, row);
        showToast(Toast.Style.Success, "Row updated");
      } else {
        await insertRow(prefs.supabaseUrl, prefs.supabaseKey, tableName, row);
        showToast(Toast.Style.Success, "Row inserted");
      }
      pop();
    } catch (e) {
      showToast(Toast.Style.Failure, editMode ? "Update failed" : "Insert failed", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={editMode ? "Update Row" : "Insert Row"} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        text={editMode ? `Editing row in "${tableName}" (${pkColumn} = ${pkValue})` : `Inserting into "${tableName}"`}
      />
      {columns.map((col) => {
        const colDef = table.properties[col];
        const defaultValue = initialRow ? String(initialRow[col] ?? "") : "";
        const fieldId = col;

        // Enum columns → dropdown
        if (colDef.enum && colDef.enum.length > 0) {
          return (
            <Form.Dropdown key={fieldId} id={fieldId} title={col} defaultValue={defaultValue || undefined}>
              <Form.Dropdown.Item value="" title="(null)" />
              {colDef.enum.map((v) => (
                <Form.Dropdown.Item key={v} value={v} title={v} />
              ))}
            </Form.Dropdown>
          );
        }

        // Boolean columns → dropdown
        if (colDef.type === "boolean") {
          return (
            <Form.Dropdown key={fieldId} id={fieldId} title={col} defaultValue={defaultValue || "false"}>
              <Form.Dropdown.Item value="true" title="true" />
              <Form.Dropdown.Item value="false" title="false" />
            </Form.Dropdown>
          );
        }

        // Number columns → text field with type hint
        if (colDef.type === "integer" || colDef.type === "number") {
          return (
            <Form.TextField
              key={fieldId}
              id={fieldId}
              title={col}
              placeholder={colDef.type}
              defaultValue={defaultValue}
            />
          );
        }

        // JSON columns → text area
        if (colDef.type === "object" || colDef.type === "array" || colDef.format === "jsonb") {
          return (
            <Form.TextArea key={fieldId} id={fieldId} title={col} placeholder="JSON" defaultValue={defaultValue} />
          );
        }

        // Default → text field
        return (
          <Form.TextField
            key={fieldId}
            id={fieldId}
            title={col}
            placeholder={colDef.type || "text"}
            defaultValue={defaultValue}
          />
        );
      })}
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Add column form
// ---------------------------------------------------------------------------

function AddColumnForm({ prefs, tableName }: { prefs: Preferences; tableName: string }) {
  const { pop } = useNavigation();
  const serviceKey = prefs.serviceRoleKey || prefs.supabaseKey;
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: {
    columnName: string;
    columnType: string;
    nullable: string;
    defaultValue: string;
  }) {
    if (!values.columnName?.trim()) {
      showToast(Toast.Style.Failure, "Column name is required");
      return;
    }
    setIsSubmitting(true);
    try {
      await addColumn(
        prefs.supabaseUrl,
        serviceKey,
        tableName,
        values.columnName,
        values.columnType,
        values.nullable === "true",
        values.defaultValue || undefined
      );
      showToast(Toast.Style.Success, "Column added", values.columnName);
      pop();
    } catch (e) {
      showToast(Toast.Style.Failure, "Failed to add column", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Column" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Add a new column to "${tableName}"`} />
      <Form.TextField id="columnName" title="Column Name" placeholder="my_column" />
      <Form.Dropdown id="columnType" title="Type" defaultValue="text">
        {POSTGRES_TYPES.map((t) => (
          <Form.Dropdown.Item key={t} value={t} title={t} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="nullable" title="Nullable" defaultValue="true">
        <Form.Dropdown.Item value="true" title="Yes (nullable)" />
        <Form.Dropdown.Item value="false" title="No (NOT NULL)" />
      </Form.Dropdown>
      <Form.TextField id="defaultValue" title="Default Value" placeholder="e.g. now(), 'text', 0" />
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Drop column picker
// ---------------------------------------------------------------------------

function DropColumnPicker({ prefs, tableName, columns }: { prefs: Preferences; tableName: string; columns: string[] }) {
  const { pop } = useNavigation();
  const serviceKey = prefs.serviceRoleKey || prefs.supabaseKey;

  async function handleDrop(columnName: string) {
    const confirmed = await confirmAlert({
      title: `Drop column "${columnName}"?`,
      message: `This will permanently remove the "${columnName}" column from "${tableName}". This action cannot be undone.`,
      primaryAction: { title: "Drop Column", style: Alert.ActionStyle.Destructive },
    });
    if (confirmed) {
      try {
        await dropColumn(prefs.supabaseUrl, serviceKey, tableName, columnName);
        showToast(Toast.Style.Success, "Column dropped", columnName);
        pop();
      } catch (e) {
        showToast(Toast.Style.Failure, "Failed to drop column", String(e));
      }
    }
  }

  return (
    <List searchBarPlaceholder="Select column to drop...">
      {columns.map((col) => (
        <List.Item
          key={col}
          title={col}
          icon={Icon.Trash}
          actions={
            <ActionPanel>
              <Action
                title={`Drop "${col}"`}
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => handleDrop(col)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Edit table form (rename)
// ---------------------------------------------------------------------------

function EditTableForm({ prefs, tableName }: { prefs: Preferences; tableName: string }) {
  const { pop } = useNavigation();
  const serviceKey = prefs.serviceRoleKey || prefs.supabaseKey;
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: { newTableName: string }) {
    const newName = values.newTableName?.trim();
    if (!newName) {
      showToast(Toast.Style.Failure, "Table name is required");
      return;
    }
    if (newName === tableName) {
      showToast(Toast.Style.Failure, "New name is the same as current name");
      return;
    }
    setIsSubmitting(true);
    try {
      await renameTable(prefs.supabaseUrl, serviceKey, tableName, newName);
      showToast(Toast.Style.Success, "Table renamed", `${tableName} → ${newName}`);
      pop();
    } catch (e) {
      showToast(Toast.Style.Failure, "Failed to rename table", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Rename Table" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Rename table "${tableName}"`} />
      <Form.TextField id="newTableName" title="New Table Name" placeholder="new_table_name" defaultValue={tableName} />
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Edit column picker → edit form
// ---------------------------------------------------------------------------

function EditColumnPicker({
  prefs,
  tableName,
  columns,
  table,
}: {
  prefs: Preferences;
  tableName: string;
  columns: string[];
  table: TableDefinition;
}) {
  const { push } = useNavigation();

  return (
    <List searchBarPlaceholder="Select column to edit...">
      {columns.map((col) => {
        const colDef = table.properties[col];
        return (
          <List.Item
            key={col}
            title={col}
            subtitle={[colDef.type, colDef.format].filter(Boolean).join(" · ")}
            icon={Icon.Pencil}
            actions={
              <ActionPanel>
                <Action
                  title={`Edit "${col}"`}
                  icon={Icon.Pencil}
                  onAction={() =>
                    push(<EditColumnForm prefs={prefs} tableName={tableName} columnName={col} column={colDef} />)
                  }
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Edit column form
// ---------------------------------------------------------------------------

function EditColumnForm({
  prefs,
  tableName,
  columnName,
  column,
}: {
  prefs: Preferences;
  tableName: string;
  columnName: string;
  column: { type: string; format?: string; default?: unknown };
}) {
  const { pop } = useNavigation();
  const serviceKey = prefs.serviceRoleKey || prefs.supabaseKey;
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: {
    newName: string;
    newType: string;
    nullable: string;
    defaultValue: string;
    dropDefault: string;
  }) {
    setIsSubmitting(true);
    try {
      await editColumn(prefs.supabaseUrl, serviceKey, tableName, columnName, {
        newName: values.newName?.trim() || undefined,
        newType: values.newType !== column.type ? values.newType : undefined,
        nullable: values.nullable === "true" ? true : values.nullable === "false" ? false : undefined,
        defaultValue: values.dropDefault === "true" ? undefined : values.defaultValue || undefined,
        dropDefault: values.dropDefault === "true",
      });
      showToast(Toast.Style.Success, "Column updated", columnName);
      pop();
    } catch (e) {
      showToast(Toast.Style.Failure, "Failed to update column", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Column" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Edit column "${columnName}" in "${tableName}"`} />
      <Form.TextField id="newName" title="Column Name" placeholder="column_name" defaultValue={columnName} />
      <Form.Dropdown id="newType" title="Type" defaultValue={column.type}>
        {POSTGRES_TYPES.map((t) => (
          <Form.Dropdown.Item key={t} value={t} title={t} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="nullable" title="Nullable" defaultValue="keep">
        <Form.Dropdown.Item value="keep" title="Keep current" />
        <Form.Dropdown.Item value="true" title="Yes (nullable)" />
        <Form.Dropdown.Item value="false" title="No (NOT NULL)" />
      </Form.Dropdown>
      <Form.TextField
        id="defaultValue"
        title="Default Value"
        placeholder="e.g. now(), 'text', 0"
        defaultValue={column.default !== undefined ? String(column.default) : ""}
      />
      <Form.Checkbox id="dropDefault" label="Drop default value" defaultValue={false} />
    </Form>
  );
}
