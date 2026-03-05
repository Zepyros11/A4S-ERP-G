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
