import { Action, ActionPanel, Detail, Form, Icon, openCommandPreferences, showToast, Toast } from "@raycast/api";
import React, { useState } from "react";
import type { Preferences } from "./types";
import { POSTGRES_TYPES } from "./types";
import { getPrefs, createTable } from "./utils/supabase";

interface ColumnInput {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string;
}

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
        markdown={`# Service Role Key Required\n\nCreating tables requires the **service_role** key.\n\n1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) → Settings → API\n2. Copy the **service_role** key\n3. Open Raycast Extension Preferences and paste it in the "Service Role Key" field\n\n> ⚠️ The service_role key bypasses Row Level Security. Keep it safe.`}
        actions={
          <ActionPanel>
            <Action title="Open Extension Preferences" onAction={openCommandPreferences} />
          </ActionPanel>
        }
      />
    );
  }

  return <CreateTableForm prefs={prefs} />;
}

function CreateTableForm({ prefs }: { prefs: Preferences }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [columnCount, setColumnCount] = useState(2);

  async function handleSubmit(values: Record<string, string>) {
    const tableName = values.tableName?.trim();
    if (!tableName) {
      showToast(Toast.Style.Failure, "Table name is required");
      return;
    }

    // Parse columns from form values
    const columns: ColumnInput[] = [];
    for (let i = 0; i < columnCount; i++) {
      const name = values[`col_name_${i}`]?.trim();
      if (!name) continue;
      columns.push({
        name,
        type: values[`col_type_${i}`] || "text",
        nullable: values[`col_nullable_${i}`] === "true",
        isPrimaryKey: values[`col_pk_${i}`] === "true",
        defaultValue: values[`col_default_${i}`]?.trim() || "",
      });
    }

    if (columns.length === 0) {
      showToast(Toast.Style.Failure, "At least one column is required");
      return;
    }

    setIsSubmitting(true);
    try {
      await createTable(prefs.supabaseUrl, prefs.serviceRoleKey!, tableName, columns);
      showToast(Toast.Style.Success, "Table created", tableName);
    } catch (e) {
      showToast(Toast.Style.Failure, "Failed to create table", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  const columnIndices = Array.from({ length: columnCount }, (_, i) => i);

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Table" onSubmit={handleSubmit} />
          <Action
            title="Add Another Column"
            icon={Icon.Plus}
            shortcut={{ modifiers: ["cmd"], key: "n" }}
            onAction={() => setColumnCount((prev) => prev + 1)}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="tableName" title="Table Name" placeholder="my_table" />
      <Form.Separator />
      <Form.Description text="Define columns for the new table" />

      {columnIndices.map((i) => (
        <React.Fragment key={i}>
          <Form.Separator />
          <Form.Description text={`Column ${i + 1}`} />
          <Form.TextField
            id={`col_name_${i}`}
            title="Name"
            placeholder="column_name"
            defaultValue={i === 0 ? "id" : ""}
          />
          <Form.Dropdown id={`col_type_${i}`} title="Type" defaultValue={i === 0 ? "uuid" : "text"}>
            {POSTGRES_TYPES.map((t) => (
              <Form.Dropdown.Item key={t} value={t} title={t} />
            ))}
          </Form.Dropdown>
          <Form.Checkbox id={`col_pk_${i}`} label="Primary Key" defaultValue={i === 0} />
          <Form.Checkbox id={`col_nullable_${i}`} label="Nullable" defaultValue={i > 0} />
          <Form.TextField id={`col_default_${i}`} title="Default" placeholder="e.g. gen_random_uuid(), now()" />
        </React.Fragment>
      ))}
    </Form>
  );
}
