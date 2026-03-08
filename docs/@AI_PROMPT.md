**บอก Block Code ,บรรทัด ,จุดแทนที่หรือแก้ไข ให้ละเอียดัดเจนเสมอ
**หากมี CSS ใหม่ให้ดูว่าควรเป็นใส่ที่ไฟร์ไหน
**เมื่อมีการแก้ให้ส่ง Code เป็น Block ช่วงนั้นทั้งหมด เ่ช่น <div> .... </div> , ถ้าแก้ function ก็ขอทั้ง Function ไม่บอกเป็นช่วง
**สรุปข้อความให้กระชับไม่ยืดเยื้อ
\*บอกต่ำแหน่ง Code ให้ถูกต้องเพื่อให้ในการหาในช่อง Search

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

========================================================================

# AI_PROMPT — A4S ERP Development

This document provides instructions for AI assistants working on the **A4S-ERP** project.

AI must read this before generating or modifying code.

---

# Project Overview

A4S-ERP is a lightweight ERP system for

Stock management
Warehouse management
Purchase orders
Sales orders
Internal requisitions

---

# Technology Stack

Frontend

HTML
CSS
Vanilla JavaScript

Backend

Supabase PostgreSQL
Supabase REST API

Hosting

GitHub Pages

---

# Critical Development Rules

AI must follow these rules strictly.

1. Do NOT introduce frameworks.

The project does NOT use:

React
Vue
Angular
Next.js
Node.js server

Only Vanilla JavaScript is allowed.

---

2. Maintain the existing layout system.

Every page must contain:

```
<div class="topbar"></div>

<div class="page">
Page content
</div>
```

The layout is automatically injected by

```
shared/sidebar.js
```

Do not break this system.

---

3. Always include shared scripts.

Every page must include:

```
<script src="../../shared/auth.js"></script>
<script src="../../shared/sidebar.js"></script>
<script src="../../shared/responsive.js"></script>
```

---

4. Follow the project folder structure.

```
modules/
dashboard
stock
document
report
settings

shared/
auth.js
sidebar.js
responsive.js
supabase.js

assets/css/
common.css
product_form.css
```

---

5. Database access

The system communicates with Supabase using REST API.

Example request:

```
fetch(`${SUPABASE_URL}/rest/v1/products`)
```

Headers required:

```
apikey
Authorization: Bearer
```

Credentials are stored in:

```
localStorage

sb_url
sb_key
```

Configured via the Settings page.

---

6. CSS system

Global CSS file

```
assets/css/common.css
```

Rules:

Do not modify the base structure.

Only add new classes when necessary.

---

7. JavaScript standards

Use Vanilla JavaScript only.

Avoid external libraries.

Keep scripts modular.

Example naming style:

```
saveProduct()
loadProducts()
renderTable()
```

---

8. Module structure

Each page must follow:

```
page.html
page.js
```

Example:

```
products.html
products.js
```

HTML handles UI layout.

JavaScript handles:

database queries
event handling
UI rendering

---

9. Authentication

Authentication system uses:

```
shared/auth.js
```

Session stored in:

```
localStorage.erp_session
```

If session is missing:

```
redirect to /login.html
```

---

10. Sidebar navigation

Navigation configuration is defined in:

```
shared/sidebar.js
```

Menu list:

```
const MENU = []
```

Available pages:

```
const READY = []
```

Pages not listed in READY will display:

```
SOON
```

---

# Development Goal

The goal is to build a full ERP system including:

Inventory management
Purchase management
Sales management
Reporting system

---

# AI Behavior Guidelines

When generating code:

• Follow existing architecture
• Do not rewrite the system structure
• Avoid unnecessary complexity
• Maintain clean and readable code

When modifying code:

• Preserve current functionality
• Only change what is required
• Avoid breaking shared components

---

# End of AI Prompt

# UI Component System

The UI uses reusable CSS components located in

assets/css/components/

Components include

card.css
panel.css
table.css
forms.css
buttons.css
modal.css

Modules should reuse these components
instead of creating new styles.

Warehouse module is the reference
for UI layout structure.
