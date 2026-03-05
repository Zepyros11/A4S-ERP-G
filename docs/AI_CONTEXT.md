# AI_CONTEXT — A4S ERP

This document explains the coding conventions and architecture of the A4S ERP system.

AI assistants must read this before generating code.

---

# Project Type

Static ERP Web Application

Frontend

HTML
CSS
Vanilla JavaScript

Backend

Supabase PostgreSQL

Hosting

GitHub Pages

---

# Important Rule

Do NOT introduce frameworks.

React
Vue
Angular

are not used.

---

# Layout System

Every page must contain

<div class="topbar"></div>

<div class="page">
page content
</div>

Sidebar and layout are automatically injected by

shared/sidebar.js

---

# Authentication

Authentication system uses

shared/auth.js

Session stored in

localStorage.erp_session

If session is missing

user is redirected to

/login.html

---

# Navigation

Sidebar navigation is defined in

shared/sidebar.js

Menu configuration

const MENU = []

Page availability

const READY = []

If a page is not listed in READY it will display

SOON

---

# Database Access

Supabase REST API

Example

fetch(`${SUPABASE_URL}/rest/v1/products`)

Headers

apikey
Authorization: Bearer

Credentials stored in

localStorage

sb_url
sb_key

---

# CSS System

Global styles

assets/css/common.css

Do not modify base structure.

Only add new classes if needed.

---

# JavaScript Rules

Use vanilla JS only.

Avoid external dependencies.

Keep scripts modular.

---

# File Naming

HTML

snake_case

Example

stock_adjustment.html

JS

camelCase

Example

saveProduct()

---

# ERP Modules

dashboard
products
categories
warehouses
stock_adjustment
movements
purchase_orders
sales_orders
requisition
reports
settings
database_viewer

---

# AI Code Generation Rules

When generating new pages

Always include

auth.js
sidebar.js
responsive.js

Follow layout system.

Do not break sidebar injection.

---

# End of AI Context
