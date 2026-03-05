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
