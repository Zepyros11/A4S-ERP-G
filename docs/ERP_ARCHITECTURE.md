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
│ ├─ settings
│ │ ├─ settings.html
│ │ ├─ settings.js
│ │ ├─ db_viewer.html
│ │ ├─ customers.html
│ │ ├─ customers.js
│ │ ├─ suppliers.html
│ │ ├─ suppliers.js
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
│ ├─ settings
│ │ ├─ settings.html
│ │ ├─ settings.js
│ │ ├─ db_viewer.html
│ │ ├─ customers.html
│ │ ├─ customers.js
│ │ ├─ suppliers.html
│ │ ├─ suppliers.js
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

advanced reporting
