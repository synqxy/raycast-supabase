<br />
<p align="center">
  <p align="center">
    <img src="./assets/command-icon.png" width="140px"/>
    <img src="./assets/raycast-icon.png" width="140px"/>
</p>

  <h3 align="center">Supabase Raycast Extension</h3>

  <p align="center">
    <strong>Secured & Simple <a href="https://supabase.io/">Supabase</a> way to visualize, manage<br /> and query your Supabase project from Raycast.</strong>
    <br />
    <br />
    <a href="https://github.com/Rychillie/raycast-supabase/issues">Report Bug</a>
    ·
    <a href="https://github.com/Rychillie/raycast-supabase/issues">Request Feature</a>
  </p>
</p>

<br />

![Supabase Schema](./assets/supabase-project-manager.png)

## 🚀 Features

### List Tables and Details
- Query all tables and list them
- Query all column names and types in a detail panel
- View table descriptions and column metadata

### Row Management
- Browse all rows with pagination
- View row details in a side panel
- Add new rows with dynamic form fields
- Edit existing rows
- Delete rows with confirmation

### Table & Column Management
- Create new tables with custom columns and types
- Rename tables
- Delete tables with confirmation
- Add columns to existing tables
- Edit columns (rename, change type, set nullable, change default)
- Drop columns from tables

### User Management
- List all auth users with details
- Invite new users by email
- Edit user metadata and roles
- Delete users

### SQL Editor
- Execute arbitrary SQL queries
- View results in a searchable list
- Copy results as JSON
- Query execution timing

## 📇 About The Project

Raycast is an amazing tool for macOS with amazing integrations. This extension allows you to use all the powers of Supabase and access them more quickly while developing your projects.

## ROADMAP (to launch v1):

- [x] Query all tables and list them
- [x] Query all column names and list them on side
- [x] Improve Types
- [x] Query all rows and list them
- [x] Editing tables
  - [x] Add new row
  - [x] Delete row
  - [x] Edit row
  - [x] Create new table
  - [x] Delete table
  - [x] Edit table (rename)
  - [x] Create new column
  - [x] Delete column
  - [x] Edit column (rename, change type, nullable, default)
- [x] Query all users
  - [x] Invite new user
  - [x] Delete user
  - [x] Edit user
- [x] SQL Editor

## 🐾 Instructions

### 1. Clone this repository

```bash
git clone https://github.com/Rychillie/raycast-supabase.git
```

### 2. Install dependencies

```bash
yarn
// or
npm install
```

### 3. Run the project

```bash
yarn dev
// or
npm run dev
```

### 4. Open the project on Raycast

Open Raycast and type `Import Extension` and select the location folder.

### 5. Configure the project

Open your project on Supabase, copy the **Supabase URL** and the **Supabase Anon Key** (or **service_role** key) to use on Raycast.

> **Tip:** For full functionality (user management, SQL editor, table/column management), use the **service_role** key. You can optionally provide it separately in the "Service Role Key" field.

### 6. Use it

Simply use the project on Raycast and enjoy it. If you have any suggestion or bug report, please open an issue.

## 📜 License

Not Associated with Supabase.

Distributed under the MIT License. See `LICENSE` for more information.

# 📧 Contact

Rychillie - [@rychillie](https://twitter.com/rychillie) - contact@rychillie.net - [rychillie.net](https://rychillie.net)

Also, if you like my work, please [sponsor me at github](https://github.com/sponsors/Rychillie)
