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

settings
settings.html
db_viewer.html
users.html
suppliers.html
customers.html

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
