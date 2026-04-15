# 📦 A4S-ERP

Lightweight ERP system for **Stock, Orders, and Warehouse Management**

Built with:

- HTML
- CSS
- Vanilla JavaScript
- Supabase (PostgreSQL)
- GitHub Pages

---

# 🚀 Features

✔ Product Management
✔ Category Management
✔ Warehouse Management
✔ Stock Adjustment
✔ Stock Movement
✔ Purchase Orders (PO)
✔ Sales Orders (SO)
✔ Requisition System
✔ Reports
✔ Database Viewer
✔ User Management

---

# 🧱 Architecture

Frontend

HTML + CSS + Vanilla JS

Backend

Supabase REST API

Hosting

GitHub Pages

Authentication

Browser session storage

---

# 📁 Project Structure

/modules
dashboard
stock
document
report
settings

/shared
auth.js
sidebar.js
responsive.js
supabase.js

/assets
css

---

# ⚙️ Setup

1 Open **Settings page**

```
modules/settings/settings.html
```

2 Add Supabase credentials

```
SUPABASE_URL
SUPABASE_ANON_KEY
```

3 Click **Connect**

---

# 🌐 Live System

GitHub Pages

```
https://zepyros11.github.io/A4S-ERP-G/
```

---

# 📊 Database

Supabase PostgreSQL

Tables used

products
categories
warehouses
suppliers
customers
movements
stock_adjustments

---

# 👨‍💻 Development

Requirements

- VS Code
- Git
- Supabase account

Recommended extensions

- Live Server
- GitHub Pull Requests

---

# 📌 Notes

This ERP is a **static web application**

Frontend hosted on GitHub Pages
Backend powered by Supabase

No Node.js server required.

---

# 🏗 Future Roadmap

Inventory valuation
Accounting integration
Multi-warehouse transfer
Barcode system
Purchase approval flow

---

# 🧑‍💻 Author

A4S ERP Projec

==================================================================

# Changelog

All notable changes to A4S-ERP will be documented here.

---

## v0.1 — Initial System

Added

- Sidebar navigation
- Authentication system
- Supabase connection
- Settings page

---

## v0.2 — Stock Module

Added

- Product management
- Category management
- Warehouse management
- Stock movement

---

## v0.3 — Documents

Added

- Purchase Order
- Sales Order
- Requisition

---

## v0.4 — Admin Tools

Added

- Database Viewer
- # User management
  =====================================================

# A4S ERP Database Relation

This document describes the database relationships used in the A4S ERP system.

Database engine: PostgreSQL (Supabase)

---

# Core Master Data

## categories

Product categories.

| column        | description   |
| ------------- | ------------- |
| category_id   | primary key   |
| category_name | category name |

Relation

categories  
↓  
products

---

## products

Product master data.

| column       | description        |
| ------------ | ------------------ |
| product_id   | primary key        |
| product_code | SKU code           |
| product_name | product name       |
| category_id  | reference category |
| base_unit    | base unit          |
| cost_price   | cost               |
| sale_price   | selling price      |

Relation

categories → products

products → stock_movements  
products → po_items  
products → so_items

---

## warehouses

Warehouse storage locations.

| column         | description        |
| -------------- | ------------------ |
| warehouse_id   | primary key        |
| warehouse_name | name               |
| location       | warehouse location |

Relation

warehouses  
↓  
stock_movements

---

# Inventory System

## stock_movements

Tracks inventory movement.

| column        | description         |
| ------------- | ------------------- |
| movement_id   | primary key         |
| product_id    | product reference   |
| warehouse_id  | warehouse reference |
| qty           | quantity            |
| movement_type | IN / OUT / ADJUST   |
| ref_doc       | reference document  |
| created_at    | timestamp           |

Relation

products → stock_movements  
warehouses → stock_movements

---

# Business Partners

## customers

Customer master data.

| column        | description   |
| ------------- | ------------- |
| customer_id   | primary key   |
| customer_name | customer name |
| phone         | contact       |
| email         | email         |

Relation

customers  
↓  
sales_orders

---

## suppliers

Supplier master data.

| column        | description   |
| ------------- | ------------- |
| supplier_id   | primary key   |
| supplier_name | supplier name |
| phone         | contact       |

Relation

suppliers  
↓  
purchase_orders

---

# Purchasing

## purchase_orders

Purchase orders to suppliers.

| column      | description        |
| ----------- | ------------------ |
| po_id       | primary key        |
| supplier_id | supplier reference |
| po_date     | order date         |
| status      | document status    |

Relation

suppliers → purchase_orders

purchase_orders → po_items

---

## po_items

Purchase order line items.

| column     | description    |
| ---------- | -------------- |
| po_item_id | primary key    |
| po_id      | purchase order |
| product_id | product        |
| qty        | quantity       |
| cost_price | cost           |

Relation

purchase_orders → po_items  
products → po_items

---

# Sales

## sales_orders

Customer sales orders.

| column      | description        |
| ----------- | ------------------ |
| so_id       | primary key        |
| customer_id | customer reference |
| so_date     | order date         |
| status      | document status    |

Relation

customers → sales_orders

sales_orders → so_items

---

## so_items

Sales order line items.

| column     | description |
| ---------- | ----------- |
| so_item_id | primary key |
| so_id      | sales order |
| product_id | product     |
| qty        | quantity    |
| sale_price | price       |

Relation

sales_orders → so_items  
products → so_items

---

# Inventory Flow

Stock movement flow

Supplier  
↓  
Purchase Order  
↓  
PO Items  
↓  
Stock IN  
↓  
Warehouse

Customer  
↓  
Sales Order  
↓  
SO Items  
↓  
Stock OUT

---

# ERP Relationship Overview

categories
↓
products
↓
stock_movements
↓
warehouses

suppliers
↓
purchase_orders
↓
po_items
↓
products

customers
↓
sales_orders
↓
so_items
↓
products

---

# Future Tables

Possible future extensions

inventory_balance  
inventory_lot  
barcode  
accounting_entries  
audit_log
=====================================

# A4S ERP Architecture

This document describes the architecture of the A4S ERP system.

The system is a lightweight web-based ERP designed for inventory, purchasing, and sales management.

---

# 1. Technology Stack

Frontend

- HTML
- CSS
- JavaScript (Vanilla JS)

Backend

- Supabase (PostgreSQL)
- Supabase REST API

Hosting

- GitHub Pages

Database

- PostgreSQL (via Supabase)

---

# 2. Project Folder Structure

A4S-ERP-G
│
├─ assets
│ └─ css
│ ├─ common.css
│ └─ product_form.css
│
├─ modules
│
│ ├─ dashboard
│ │ ├─ dashboard.html
│ │ └─ dashboard.js
│
│ ├─ document
│ │ ├─ po_form.html
│ │ ├─ po_form.js
│ │ ├─ requisition.html
│ │ ├─ requisition.js
│ │ ├─ so_form.html
│ │ └─ so_form.js
│
│ ├─ report
│ │ ├─ reports.html
│ │ └─ reports.js
│
│ ├─ customer
│ │ ├─ customers.html
│ │ ├─ customers.js
│ │ ├─ members-list.html
│ │ ├─ members-list.js
│ │ ├─ members-import.html
│ │ └─ members-import.js
│
│ ├─ supplier
│ │ ├─ suppliers.html
│ │ └─ suppliers.js
│
│ ├─ settings
│ │ ├─ settings.html
│ │ ├─ settings.js
│ │ ├─ db_viewer.html
│ │ ├─ users.html
│ │ └─ users.js
│
│ └─ stock
│ ├─ products.html
│ ├─ products.js
│ ├─ product_form.html
│ ├─ product_form.js
│ ├─ categories.html
│ ├─ categories.js
│ ├─ warehouses.html
│ ├─ warehouses.js
│ ├─ movements.html
│ ├─ movements.js
│ ├─ stock_adjustment.html
│ └─ stock_adjustment.js
│
├─ shared
│ ├─ sidebar.js
│ ├─ auth.js
│ ├─ responsive.js
│ └─ supabase.js
│
├─ login.html
│
├─ README.md
├─ AI_CONTEXT.md
├─ ERP_ARCHITECTURE.md
├─ ERP_DEVELOPER_GUIDE.md
├─ ERP_ROADMAP.md
├─ CHANGELOG.md
└─ SUPABASE_SCHEMA.md
A4S-ERP-G
│
├─ assets
│ └─ css
│ ├─ common.css
│ └─ product_form.css
│
├─ modules
│
│ ├─ dashboard
│ │ ├─ dashboard.html
│ │ └─ dashboard.js
│
│ ├─ document
│ │ ├─ po_form.html
│ │ ├─ po_form.js
│ │ ├─ requisition.html
│ │ ├─ requisition.js
│ │ ├─ so_form.html
│ │ └─ so_form.js
│
│ ├─ report
│ │ ├─ reports.html
│ │ └─ reports.js
│
│ ├─ customer
│ │ ├─ customers.html
│ │ ├─ customers.js
│ │ ├─ members-list.html
│ │ ├─ members-list.js
│ │ ├─ members-import.html
│ │ └─ members-import.js
│
│ ├─ supplier
│ │ ├─ suppliers.html
│ │ └─ suppliers.js
│
│ ├─ settings
│ │ ├─ settings.html
│ │ ├─ settings.js
│ │ ├─ db_viewer.html
│ │ ├─ users.html
│ │ └─ users.js
│
│ └─ stock
│ ├─ products.html
│ ├─ products.js
│ ├─ product_form.html
│ ├─ product_form.js
│ ├─ categories.html
│ ├─ categories.js
│ ├─ warehouses.html
│ ├─ warehouses.js
│ ├─ movements.html
│ ├─ movements.js
│ ├─ stock_adjustment.html
│ └─ stock_adjustment.js
│
├─ shared
│ ├─ sidebar.js
│ ├─ auth.js
│ ├─ responsive.js
│ └─ supabase.js
│
├─ login.html
│
├─ README.md
├─ AI_CONTEXT.md
├─ ERP_ARCHITECTURE.md
├─ ERP_DEVELOPER_GUIDE.md
├─ ERP_ROADMAP.md
├─ CHANGELOG.md
└─ SUPABASE_SCHEMA.md 4. Module Architecture

Each module follows the structure

page.html
page.js

Example

products.html
products.js

Responsibilities

HTML

layout

tables

forms

UI structure

JS

database queries

event handling

UI rendering

5. ERP Modules
   Dashboard

System overview.

modules/dashboard

Contains

summary widgets

quick system stats

Stock Module

Handles inventory management.

modules/stock

Features

Product management

Category management

Warehouse management

Stock movements

Stock adjustment

Document Module

Handles business documents.

modules/document

Features

Purchase Order (PO)

Sales Order (SO)

Requisition

Settings Module

System configuration and master data.

modules/settings

Features

System settings

Database viewer

Customer management

Supplier management

User management

Reports Module

Handles ERP reports.

modules/report

Features

stock reports

document reports

analytics

6. Database Architecture

Database is hosted on Supabase PostgreSQL.

Core tables include

products
categories
warehouses
stock_movements
customers
suppliers
users
purchase_orders
sales_orders

Full schema is documented in

SUPABASE_SCHEMA.md 7. Data Flow

Typical flow inside ERP

User Action
↓
HTML UI
↓
Module JavaScript
↓
Supabase Client
↓
Supabase API
↓
PostgreSQL Database 8. Deployment

Hosting platform

GitHub Pages

Deployment flow

Local development
↓
Git commit
↓
Git push
↓
GitHub Pages build
↓
Live website update 9. Future Architecture

Planned improvements

role based access control

audit log system

barcode support

batch inventory

accounting integration

# advanced reporting

# A4S-ERP Developer Guide

## Project Overview

A4S-ERP is a lightweight ERP web application for **Stock, Orders, and Warehouse management**.

Architecture:

Frontend
HTML + CSS + Vanilla JavaScript

Backend
Supabase (PostgreSQL + REST API)

Hosting
GitHub Pages (Static hosting)

Authentication
Custom session stored in browser storage.

The application is designed to be **framework-free** and easy to maintain.

---

# 1. Folder Structure

/modules
dashboard
stock
products.html
categories.html
warehouses.html
stock_adjustment.html
movements.html

document
po_form.html
so_form.html
requisition.html

report
reports.html

customer
customers.html
members-list.html
members-import.html

supplier
suppliers.html

settings
settings.html
db_viewer.html
users.html

/shared
auth.js
sidebar.js
responsive.js
supabase.js

/assets
/css
common.css
product_form.css

---

# 2. Page Layout System

Every page must follow this base structure:

<body>

<div class="topbar"></div>

<div class="page">
    Page Content
</div>

<script src="../../shared/auth.js"></script>

<script src="../../shared/sidebar.js"></script>

<script src="../../shared/responsive.js"></script>

The sidebar script automatically converts this into:

Topbar
Sidebar + Main Content Layout

Developers must **not change this structure**.

---

# 3. Sidebar Navigation

Navigation is controlled by:

shared/sidebar.js

Menu configuration:

const MENU = []

Page availability:

const READY = []

If a page is not listed in READY it will appear as:

SOON

and cannot be opened.

---

# 4. Authentication System

Authentication is handled by:

shared/auth.js

Session storage:

localStorage.erp_session
or
sessionStorage.erp_session

If session does not exist:

User is redirected to:

/login.html

Auth.js also injects the user dropdown into the topbar.

---

# 5. Supabase Connection

The system communicates with Supabase using REST API.

Example request:

fetch(`${SUPABASE_URL}/rest/v1/products`)

Headers:

apikey
Authorization: Bearer

Connection credentials are stored in:

localStorage

sb_url
sb_key

These are configured via the **Settings page**.

---

# 6. Settings Module

Location:

modules/settings/settings.html

Functions include:

• Connect Supabase
• Configure company information
• Configure document prefixes
• Manage product categories

Connection test verifies:

products
warehouses
suppliers
customers

---

# 7. CSS System

Global style file:

assets/css/common.css

Includes styling for:

Topbar
Buttons
Tables
Forms
Panels
Modals
Toast notifications
Responsive layout

Theme is controlled using CSS variables:

--accent
--border
--surface
--text

---

# 8. Product Form System

CSS file:

product_form.css

Uses a **step wizard layout**

Steps:

1 Product Type
2 SKU Builder
3 Product Information
4 Variants
5 Images

Layout structure:

pf-layout
pf-sidebar
pf-main

---

# 9. Responsive System

File:

shared/responsive.js

Features:

Mobile panel overlay
Floating action button
Auto backdrop for side panels

Mobile breakpoint:

767px

---

# 10. Supabase Configuration

Supabase config is defined in:

shared/supabase.js

Example:

window.supabaseConfig = {
url: "...",
anon: "..."
}

---

# 11. Completed Modules

Dashboard
Products
Categories
Warehouses
Stock Adjustment
Stock Movement
Purchase Orders
Sales Orders
Requisition
Reports
Settings
Database Viewer
Suppliers
Customers
Users

---

# 12. Development Rules

Rule 1
Do not change the base layout system.

Rule 2
Do not modify common.css core structure.

Rule 3
Every page must contain:

<div class="page">

Rule 4
Only Vanilla JavaScript is allowed.

Frameworks such as React, Vue, Angular are not used.

---

# 13. Architecture

This ERP is a **Static ERP System**.

Frontend
GitHub Pages

Backend
Supabase

There is no Node.js server.

---

# 14. Development Goal

Current focus:

Database Viewer
Product System
ERP Module Expansion

---

# End of Guide

============================

# A4S ERP Roadmap

## Phase 1 — Core System

✔ Authentication
✔ Product management
✔ Warehouse management
✔ Stock movement

---

## Phase 2 — Documents

✔ Purchase Orders
✔ Sales Orders
✔ Requisition

---

## Phase 3 — Advanced Inventory

- Barcode system
- Batch / lot tracking
- Multi-warehouse transfer

---

## Phase 4 — Finance

- Inventory valuation
- Cost tracking
- Accounting integration

---

## Phase 5 — Analytics

- Inventory dashboard
- Sales analytics
- # Profit report
  =======================================================

# Supabase Database Schema

A4S-ERP

This document describes the database structure used in the ERP system.

Database: PostgreSQL (Supabase)

---

# products

Stores product master data.

| column       | type         | description             |
| ------------ | ------------ | ----------------------- |
| product_id   | integer (PK) | product primary key     |
| product_code | text         | SKU / product code      |
| product_name | text         | product name            |
| category_id  | integer      | reference to categories |
| base_unit    | text         | unit of measurement     |
| cost_price   | numeric      | cost price              |
| sale_price   | numeric      | sale price              |
| created_at   | timestamp    | record creation time    |

---

# categories

Product categories.

| column        | type         | description          |
| ------------- | ------------ | -------------------- |
| category_id   | integer (PK) | category ID          |
| category_name | text         | category name        |
| description   | text         | category description |

---

# warehouses

Warehouse locations.

| column         | type         | description        |
| -------------- | ------------ | ------------------ |
| warehouse_id   | integer (PK) | warehouse ID       |
| warehouse_name | text         | warehouse name     |
| location       | text         | warehouse location |

---

# stock_adjustments

Manual stock corrections.

| column        | type         | description       |
| ------------- | ------------ | ----------------- |
| adjustment_id | integer (PK) | adjustment ID     |
| product_id    | integer      | reference product |
| warehouse_id  | integer      | warehouse         |
| quantity      | numeric      | quantity adjusted |
| reason        | text         | adjustment reason |
| created_at    | timestamp    | time              |

---

# movements

Stock movement history.

| column       | type         | description        |
| ------------ | ------------ | ------------------ |
| movement_id  | integer (PK) | movement ID        |
| product_id   | integer      | product            |
| warehouse_id | integer      | warehouse          |
| qty_in       | numeric      | incoming quantity  |
| qty_out      | numeric      | outgoing quantity  |
| reference    | text         | document reference |
| created_at   | timestamp    | movement time      |

---

# suppliers

Supplier master data.

| column        | type         | description   |
| ------------- | ------------ | ------------- |
| supplier_id   | integer (PK) | supplier ID   |
| supplier_name | text         | supplier name |
| phone         | text         | phone         |
| email         | text         | email         |
| address       | text         | address       |

---

# customers

Customer master data.

| column        | type         | description   |
| ------------- | ------------ | ------------- |
| customer_id   | integer (PK) | customer ID   |
| customer_name | text         | customer name |
| phone         | text         | phone         |
| email         | text         | email         |
| address       | text         | address       |

---

# purchase_orders

Purchase order documents.

| column       | type         | description                 |
| ------------ | ------------ | --------------------------- |
| po_id        | integer (PK) | PO ID                       |
| po_number    | text         | PO number                   |
| supplier_id  | integer      | supplier                    |
| total_amount | numeric      | total                       |
| status       | text         | draft / approved / received |
| created_at   | timestamp    | creation date               |

---

# sales_orders

Sales order documents.

| column       | type         | description                 |
| ------------ | ------------ | --------------------------- |
| so_id        | integer (PK) | sales order ID              |
| so_number    | text         | sales order number          |
| customer_id  | integer      | customer                    |
| total_amount | numeric      | total                       |
| status       | text         | draft / confirmed / shipped |
| created_at   | timestamp    | creation date               |

---

# requisitions

Internal stock request documents.

| column       | type         | description                 |
| ------------ | ------------ | --------------------------- |
| req_id       | integer (PK) | request ID                  |
| req_number   | text         | request number              |
| warehouse_id | integer      | warehouse                   |
| status       | text         | pending / approved / issued |
| created_at   | timestamp    | creation date               |

---

# ERP Relationship Overview

products
↓
categories

products
↓
movements
↓
warehouses

purchase_orders
↓
suppliers

sales_orders
↓
customers

---

# Notes

All tables are accessed using Supabase REST API.

Example

fetch(`${SUPABASE_URL}/rest/v1/products`)

Headers required

apikey
Authorization: Bearer

---

# End of Schema

# UI Component System

The UI is built using reusable components.

Location

assets/css/components

Components

card.css
panel.css
table.css
forms.css
buttons.css
modal.css
animations.css

These components are shared across all ERP modules.
