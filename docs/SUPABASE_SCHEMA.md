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
