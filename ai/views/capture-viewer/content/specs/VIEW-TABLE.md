---
title: View Spec — Table Panel
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Table Panel View

The table panel renders SQLite data as a scrollable, sortable, filterable GUI. Each table workspace has its own .db file, scripts folder, and tools manifest. This is how users build apps.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  [Customers ▾]  [+ New Record]  [Search...]  [Filter]   │
├──────────────────────────────────────────────────────────┤
│  Name          │ Email              │ Phone    │ Since   │
│────────────────│────────────────────│──────────│─────────│
│  Acme Corp     │ billing@acme.com   │ 555-0100 │ 2024    │
│  Smith & Co    │ john@smith.co      │ 555-0200 │ 2025    │
│  ...           │ ...                │ ...      │ ...     │
├──────────────────────────────────────────────────────────┤
│  Showing 1-50 of 234  │  [< Prev]  [Next >]             │
└──────────────────────────────────────────────────────────┘

Click row -> Detail view:
┌──────────────────────────────────────────────────────────┐
│  [← Back]  Acme Corp                          [Edit]     │
│                                                          │
│  Email: billing@acme.com                                 │
│  Phone: 555-0100                                         │
│  Since: 2024                                             │
│                                                          │
│  Related:                                                │
│  ┌──────────┐ ┌──────────┐                              │
│  │ Invoice  │ │ Invoice  │                              │
│  │ #1042    │ │ #1089    │  → linked via foreign key    │
│  └──────────┘ └──────────┘                              │
└──────────────────────────────────────────────────────────┘
```

---

## Workspace Structure

```
ai/views/{workspace}/
  index.json          ← { type: "table", icon: "table_chart", db: "data.db" }
  data.db             ← SQLite database (Knex managed)
  tools.json          ← scripts → callable agent tools
  scripts/
    create-record.js  ← CRUD and business logic
    import.js
    export.js
    custom-logic.js
  migrations/
    001_initial.js    ← Knex migration (Robin generates)
  chat/
    PROMPT.md         ← agent persona for this workspace
    SESSION.md
    threads/...
```

### index.json

```json
{
  "name": "Customers",
  "type": "table",
  "icon": "people",
  "db": "customers.db",
  "default_table": "customers",
  "mode": "develop"
}
```

### tools.json

```json
{
  "skills": [
    {
      "name": "create-customer",
      "script": "scripts/create-customer.js",
      "access": "write",
      "locked_in_production": true
    },
    {
      "name": "query-customers",
      "script": "scripts/query-customers.js",
      "access": "read"
    },
    {
      "name": "import-csv",
      "script": "scripts/import-csv.js",
      "access": "write",
      "locked_in_production": false
    }
  ]
}
```

---

## Table GUI Features

### Core (ships with app)
- Render any SQLite table as scrollable rows + columns
- Column headers from schema introspection (`PRAGMA table_info`)
- Sort by any column (click header)
- Filter/search (text input filters visible rows)
- Pagination (configurable page size)
- Click row → detail view
- Foreign key linking → click related record → navigate to its table/row

### Schema Introspection

The table view auto-discovers:
- Table names (`SELECT name FROM sqlite_master WHERE type='table'`)
- Column names and types (`PRAGMA table_info(tablename)`)
- Foreign keys (`PRAGMA foreign_key_list(tablename)`)

No manual configuration needed. Point it at a .db file, it renders.

### Multi-Table Navigation

If the database has multiple tables, a dropdown or tab bar at the top switches between them. The `default_table` in index.json controls which table shows first.

### Foreign Key Relationships

When a row has a foreign key, the detail view shows linked records as clickable cards. Click → navigate to that table, filtered to the linked row.

---

## Develop vs Production Mode

Controlled by `mode` in index.json. Robin can toggle it.

| Mode | What changes |
|------|-------------|
| `develop` | All scripts callable. Schema can be modified. Agent has full write. |
| `production` | Scripts marked `locked_in_production: true` bounce with restriction message. Schema locked. Agent read-only unless script is explicitly unlocked. |

The user builds the app in develop mode. When it's ready, they lock it down. Their app-level agents can query but not accidentally corrupt data.

---

## How Users Build Apps

1. **User:** "Robin, I need a bookkeeping app"
2. **Robin:** Creates `ai/views/invoices/`, scaffolds from table-panel template
3. **Robin:** Generates Knex migration with invoice schema (id, customer_id, amount, date, status)
4. **Robin:** Runs migration → tables exist in invoices.db
5. **Robin:** Generates scripts: create-invoice.js, query-invoices.js, send-invoice.js
6. **Robin:** Writes tools.json listing the scripts
7. **Robin:** Writes PROMPT.md for the workspace agent
8. **User:** Panel appears in sidebar. Table renders. Agent can help manage data.
9. **User:** "Robin, connect invoices to customers" → Robin adds foreign key, updates scripts
10. **User:** "Lock it down" → Robin flips mode to production

The AI generates the schema, the scripts, the migrations, the agent config. The user describes what they want. Robin builds it.

---

## Template

```
ai/system/templates/table-panel/
  index.json          ← { type: "table" }
  PROMPT.md           ← generic table agent
  SESSION.md          ← default permissions
  tools.json          ← starter CRUD skills
  scripts/
    create-record.js  ← generic insert
    query.js          ← generic select
    update-record.js  ← generic update
    delete-record.js  ← generic delete
  migrations/
    (empty — Robin generates per-app)
```

---

## The SaaS Killer

With table panels + triggers + agents + connectors:

| SaaS | Replaced by |
|------|-------------|
| QuickBooks | Bookkeeping project (invoices, expenses, customers, tax-prep agent) |
| Trello/Asana | Issues workspace (ticket board + calendar view) |
| Notion | Wiki + capture + table panels |
| Zapier/N8N | TRIGGERS.md + event bus + scripts |
| Airtable | Table panels with linked databases |
| CRM (HubSpot etc.) | Customers table + email integration + agents |
| Inventory systems | Table panel + barcode/receipt scanning agent |

All local. All yours. No monthly fees. No vendor lock-in. Data on your machine. AI helps you build and run it.

---

## TODO

- [ ] Table view component (renders any SQLite table)
- [ ] Schema introspection (auto-discover tables, columns, foreign keys)
- [ ] Sort, filter, search, pagination
- [ ] Row detail view with foreign key navigation
- [ ] Multi-table dropdown/tabs
- [ ] Knex migration runner for user app schemas
- [ ] Table panel template
- [ ] Develop/production mode toggle
- [ ] Robin scaffolding flow (describe app → generate schema + scripts + tools.json)
