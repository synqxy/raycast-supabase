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
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import type { Preferences, SupabaseUser } from "./types";
import { getPrefs, fetchUsers, inviteUser, updateUser, deleteUser } from "./utils/supabase";

const PAGE_SIZE = 50;

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
        markdown={`# Service Role Key Required\n\nUser management requires the **service_role** key.\n\n1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) → Settings → API\n2. Copy the **service_role** key\n3. Open Raycast Extension Preferences and paste it in the "Service Role Key" field\n\n> ⚠️ The service_role key bypasses Row Level Security. Keep it safe.`}
        actions={
          <ActionPanel>
            <Action title="Open Extension Preferences" onAction={openCommandPreferences} />
          </ActionPanel>
        }
      />
    );
  }

  return <UserList prefs={prefs} />;
}

// ---------------------------------------------------------------------------
// User list
// ---------------------------------------------------------------------------

function UserList({ prefs }: { prefs: Preferences }) {
  const [users, setUsers] = useState<SupabaseUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [editUser, setEditUser] = useState<SupabaseUser | null>(null);

  const loadUsers = useCallback(
    async (reset = false) => {
      setIsLoading(true);
      setError(null);
      try {
        const currentPage = reset ? 1 : page;
        const result = await fetchUsers(prefs.supabaseUrl, prefs.serviceRoleKey!, currentPage, PAGE_SIZE);
        if (reset) {
          setUsers(result.users);
          setPage(2);
        } else {
          setUsers((prev) => [...prev, ...result.users]);
          setPage((prev) => prev + 1);
        }
        setHasMore(result.users.length === PAGE_SIZE);
      } catch (e) {
        setError(String(e));
      } finally {
        setIsLoading(false);
      }
    },
    [prefs.supabaseUrl, prefs.serviceRoleKey, page]
  );

  useEffect(() => {
    loadUsers(true);
  }, []);

  if (showInviteForm) {
    return (
      <InviteUserForm
        prefs={prefs}
        onDone={() => {
          setShowInviteForm(false);
          loadUsers(true);
        }}
      />
    );
  }

  if (editUser) {
    return (
      <EditUserForm
        prefs={prefs}
        user={editUser}
        onDone={() => {
          setEditUser(null);
          loadUsers(true);
        }}
      />
    );
  }

  if (error) {
    return (
      <Detail
        markdown={`## Error\n\n${error}`}
        actions={
          <ActionPanel>
            <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => loadUsers(true)} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search users...">
      {users.map((user) => {
        const email = user.email || user.phone || "Unknown";
        const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : "Never";
        const created = new Date(user.created_at).toLocaleDateString();

        return (
          <List.Item
            key={user.id}
            title={email}
            subtitle={user.user_metadata?.full_name ? String(user.user_metadata.full_name) : undefined}
            icon={Icon.Person}
            accessories={[
              { text: `Last sign in: ${lastSignIn}`, tooltip: "Last Sign In" },
              { text: created, tooltip: "Created" },
            ]}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="ID" text={user.id} />
                    <List.Item.Detail.Metadata.Label title="Email" text={user.email || "—"} />
                    <List.Item.Detail.Metadata.Label title="Phone" text={user.phone || "—"} />
                    <List.Item.Detail.Metadata.Label title="Role" text={user.role || "—"} />
                    <List.Item.Detail.Metadata.Label title="Created" text={created} />
                    <List.Item.Detail.Metadata.Label title="Last Sign In" text={lastSignIn} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title="User Metadata" />
                    {Object.entries(user.user_metadata || {}).map(([k, v]) => (
                      <List.Item.Detail.Metadata.Label key={k} title={k} text={String(v)} />
                    ))}
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title="App Metadata" />
                    {Object.entries(user.app_metadata || {}).map(([k, v]) => (
                      <List.Item.Detail.Metadata.Label
                        key={k}
                        title={k}
                        text={typeof v === "object" ? JSON.stringify(v) : String(v)}
                      />
                    ))}
                    {user.identities && user.identities.length > 0 && (
                      <>
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label title="Identities" />
                        {user.identities.map((id) => (
                          <List.Item.Detail.Metadata.Label
                            key={id.id}
                            title={id.provider}
                            text={id.identity_data?.email ? String(id.identity_data.email) : id.id}
                          />
                        ))}
                      </>
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action title="Edit User" icon={Icon.Pencil} onAction={() => setEditUser(user)} />
                <Action
                  title="Delete User"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    const confirmed = await confirmAlert({
                      title: `Delete user "${email}"?`,
                      message: "This action cannot be undone.",
                      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
                    });
                    if (confirmed) {
                      try {
                        await deleteUser(prefs.supabaseUrl, prefs.serviceRoleKey!, user.id);
                        showToast(Toast.Style.Success, "User deleted");
                        setUsers((prev) => prev.filter((u) => u.id !== user.id));
                      } catch (e) {
                        showToast(Toast.Style.Failure, "Delete failed", String(e));
                      }
                    }
                  }}
                />
                <Action title="Invite User" icon={Icon.Plus} onAction={() => setShowInviteForm(true)} />
                <Action.CopyToClipboard title="Copy User ID" content={user.id} />
                {user.email && <Action.CopyToClipboard title="Copy Email" content={user.email} />}
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={() => loadUsers(true)}
                />
                {hasMore && (
                  <Action
                    title="Load More"
                    icon={Icon.ArrowDown}
                    shortcut={{ modifiers: ["cmd"], key: "m" }}
                    onAction={() => loadUsers(false)}
                  />
                )}
              </ActionPanel>
            }
          />
        );
      })}
      {!isLoading && users.length === 0 && (
        <List.EmptyView icon={Icon.Person} title="No Users" description="No users found in this project" />
      )}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Invite user form
// ---------------------------------------------------------------------------

function InviteUserForm({ prefs, onDone }: { prefs: Preferences; onDone: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: { email: string; fullName: string; role: string }) {
    setIsSubmitting(true);
    try {
      const metadata: Record<string, unknown> = {};
      if (values.fullName) metadata.full_name = values.fullName;
      if (values.role) metadata.role = values.role;
      await inviteUser(prefs.supabaseUrl, prefs.serviceRoleKey!, values.email, metadata);
      showToast(Toast.Style.Success, "Invitation sent", values.email);
      onDone();
    } catch (e) {
      showToast(Toast.Style.Failure, "Invite failed", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Invitation" onSubmit={handleSubmit} />
          <Action title="Cancel" onAction={onDone} />
        </ActionPanel>
      }
    >
      <Form.Description text="Invite a new user to your Supabase project" />
      <Form.TextField id="email" title="Email" placeholder="user@example.com" />
      <Form.TextField id="fullName" title="Full Name" placeholder="John Doe" />
      <Form.TextField id="role" title="Role" placeholder="e.g. admin, user" />
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Edit user form
// ---------------------------------------------------------------------------

function EditUserForm({ prefs, user, onDone }: { prefs: Preferences; user: SupabaseUser; onDone: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: { email: string; fullName: string; role: string; password: string }) {
    setIsSubmitting(true);
    try {
      const updateData: Record<string, unknown> = {};
      if (values.email && values.email !== user.email) updateData.email = values.email;
      if (values.password) updateData.password = values.password;
      updateData.user_metadata = {
        ...user.user_metadata,
        ...(values.fullName ? { full_name: values.fullName } : {}),
      };
      updateData.app_metadata = {
        ...user.app_metadata,
        ...(values.role ? { role: values.role } : {}),
      };
      await updateUser(
        prefs.supabaseUrl,
        prefs.serviceRoleKey!,
        user.id,
        updateData as Parameters<typeof updateUser>[3]
      );
      showToast(Toast.Style.Success, "User updated");
      onDone();
    } catch (e) {
      showToast(Toast.Style.Failure, "Update failed", String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update User" onSubmit={handleSubmit} />
          <Action title="Cancel" onAction={onDone} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Editing user: ${user.email || user.id}`} />
      <Form.TextField id="email" title="Email" placeholder="user@example.com" defaultValue={user.email} />
      <Form.TextField
        id="fullName"
        title="Full Name"
        placeholder="John Doe"
        defaultValue={user.user_metadata?.full_name ? String(user.user_metadata.full_name) : ""}
      />
      <Form.TextField
        id="role"
        title="Role"
        placeholder="e.g. admin, user"
        defaultValue={user.app_metadata?.role ? String(user.app_metadata.role) : ""}
      />
      <Form.PasswordField id="password" title="New Password" placeholder="Leave blank to keep current" />
    </Form>
  );
}
