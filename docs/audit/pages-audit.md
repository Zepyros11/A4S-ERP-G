# Page audit (auto-generated)

Total HTML files scanned: **78**

## Classification

| Kind | Count | Description |
|---|---:|---|
| internal   | 63   | Internal ERP page — full shell expected (topbar+sidebar) |
| standalone | 7 | Public/LIFF/kiosk page — intentionally no ERP shell |
| fragment   | 2  | Modal HTML loaded via fetch into another page |
| portal     | 6     | External customer portal (ibd-portal) — separate baseline |
| empty      | 0      | 0-byte / abandoned file |

### Modal fragments (not standalone pages — loaded via fetch)
- `modules/inventory/categories-form.html`
- `modules/inventory/warehouses-form.html`

### Standalone pages (public / LIFF / kiosk — separate design baseline)
- `modules/event/check-in.html`
- `modules/event/cs-view/event-poster-gallery-view.html`
- `modules/event/cs-view/events-bookingRoom.html`
- `modules/event/cs-view/events-calendar.html`
- `modules/event/register.html`
- `modules/tour/check-seat.html`
- `modules/trip/check-seat.html`

## Summary by criterion (internal pages only)

| Criterion | Has | Missing |
|---|---:|---:|
| imports css/main.css | 63 | 0 |
| imports module css | 38 | 25 |
| imports modal.css separately | 0 | 63 |
| imports table.css separately | 0 | 63 |
| has modalManager.js | 62 | 1 |
| has confirmModal.js | 21 | 42 |
| has auth.js | 63 | 0 |
| has authz.js | 56 | 7 |
| has permissions.js | 13 | 50 |
| has sidebar.js | 63 | 0 |
| has date-format.js | 63 | 0 |
| has supabase.js | 1 | 62 |
| has topbar markup | 63 | 0 |
| has layout shell | 13 | 50 |
| has sidebar slot | 0 | 63 |
| has content-area | 11 | 52 |
| has page wrap | 62 | 1 |
| has toast element | 62 | 1 |
| has loading overlay | 62 | 1 |
| has DOMContentLoaded | 5 | 58 |

## Drift: pages MISSING / VIOLATING required pieces (internal)

### Missing main.css — 0 page(s)
_none_

### Missing modalManager — 1 page(s)
- `modules/manual/manual-view.html`

### Missing auth.js — 0 page(s)
_none_

### Missing authz.js — 7 page(s)
- `modules/event/event-form.html`
- `modules/event/event-log.html`
- `modules/event/event-suppliers.html`
- `modules/event/events-place-form.html`
- `modules/inventory/product-form.html`
- `modules/settings/role.html`
- `modules/transactions/purchase_order/po_form.html`

### Missing permissions.js — 50 page(s)
- `modules/customer-service/daily-sale.html`
- `modules/customer-service/promotion-gallery.html`
- `modules/customer-service/promotion-list.html`
- `modules/customer/line-members.html`
- `modules/customer/members-dashboard.html`
- `modules/customer/members-import.html`
- `modules/customer/members-list.html`
- `modules/customer/members-sync.html`
- `modules/customer/members-tree.html`
- `modules/dashboard/dashboard.html`
- `modules/dev-tool/autocheck.html`
- `modules/dev-tool/automation.html`
- `modules/dev-tool/settings.html`
- `modules/dev-tool/test-members.html`
- `modules/dev-tool/wizard.html`
- `modules/event/attendees.html`
- `modules/event/booking-attendees.html`
- `modules/event/event-budget.html`
- `modules/event/event-form.html`
- `modules/event/event-log.html`
- `modules/event/event-poster-gallery.html`
- `modules/event/event-requests.html`
- `modules/event/event-suppliers.html`
- `modules/event/events-category.html`
- `modules/event/events-list.html`
- `modules/event/events-place-form.html`
- `modules/event/events-place-list.html`
- `modules/event/line-promote.html`
- `modules/event/media-schedule.html`
- `modules/inventory/categories-list.html`
- `modules/inventory/movements.html`
- `modules/inventory/product-form.html`
- `modules/inventory/products-list.html`
- `modules/inventory/stock-initial-list.html`
- `modules/inventory/warehouses-list.html`
- `modules/report/reports.html`
- `modules/settings/db_viewer.html`
- `modules/settings/line-templates.html`
- `modules/settings/notification-rules.html`
- `modules/settings/role.html`
- `modules/settings/settings.html`
- `modules/settings/staff-groups.html`
- `modules/settings/staff-messaging.html`
- `modules/supplier/suppliers.html`
- `modules/transactions/purchase_order/po-list.html`
- `modules/transactions/purchase_order/po_form.html`
- `modules/transactions/requisition/requisition.html`
- `modules/transactions/sales_order/so_form.html`
- `modules/work-plan/work-plan-edit.html`
- `modules/work-plan/work-plan-list.html`

### Missing sidebar.js — 0 page(s)
_none_

### Missing date-format.js — 0 page(s)
_none_

### Missing topbar markup — 0 page(s)
_none_

### Missing layout shell — 50 page(s)
- `modules/customer-service/daily-sale.html`
- `modules/customer-service/promotion-gallery.html`
- `modules/customer-service/promotion-list.html`
- `modules/customer/line-members.html`
- `modules/customer/members-dashboard.html`
- `modules/customer/members-import.html`
- `modules/customer/members-list.html`
- `modules/customer/members-sync.html`
- `modules/customer/members-tree.html`
- `modules/dashboard/dashboard.html`
- `modules/dev-tool/autocheck.html`
- `modules/dev-tool/automation.html`
- `modules/dev-tool/settings.html`
- `modules/dev-tool/test-members.html`
- `modules/dev-tool/wizard.html`
- `modules/event/attendees.html`
- `modules/event/booking-attendees.html`
- `modules/event/course-series.html`
- `modules/event/event-budget.html`
- `modules/event/event-poster-gallery.html`
- `modules/event/event-requests.html`
- `modules/event/event-suppliers.html`
- `modules/event/events-dashboard.html`
- `modules/event/events-place-form.html`
- `modules/event/line-promote.html`
- `modules/event/media-schedule.html`
- `modules/ibd/ibd-complaints.html`
- `modules/ibd/ibd-dashboard.html`
- `modules/ibd/ibd-ewallet.html`
- `modules/ibd/ibd-relocation.html`
- `modules/inventory/categories-list.html`
- `modules/inventory/movements.html`
- `modules/inventory/stock-initial-list.html`
- `modules/inventory/warehouses-list.html`
- `modules/manual/manual-list.html`
- `modules/notifications/notifications.html`
- `modules/report/reports.html`
- `modules/settings/db_viewer.html`
- `modules/settings/line-templates.html`
- `modules/settings/notification-rules.html`
- `modules/settings/role.html`
- `modules/settings/staff-groups.html`
- `modules/settings/staff-messaging.html`
- `modules/supplier/suppliers.html`
- `modules/transactions/purchase_order/po-list.html`
- `modules/transactions/purchase_order/po_form.html`
- `modules/transactions/requisition/requisition.html`
- `modules/transactions/sales_order/so_form.html`
- `modules/work-plan/work-plan-edit.html`
- `modules/work-plan/work-plan-list.html`

### Missing toast element — 1 page(s)
- `modules/settings/db_viewer.html`

### Missing loading overlay — 1 page(s)
- `modules/settings/db_viewer.html`

### Native alert() used — 0 page(s)
_none_

### Native confirm() used — 0 page(s)
_none_

### Native prompt() used — 0 page(s)
_none_

### Imports modal.css separately (should fold into main.css) — 0 page(s)
_none_

### Imports table.css separately (should fold into main.css) — 0 page(s)
_none_

## Per-page table (internal)

Legend: M=main.css · m=modalMgr · a=auth · z=authz · p=perm · s=sidebar · d=date · T=topbar markup · L=layout · S=sidebarSlot · t=toast · A#=alert · C#=confirm

| File | M | m | a | z | p | s | d | T | L | S | t | A | C | module css |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| modules/account/account.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./account.css |
| modules/customer-service/daily-sale.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./daily-sale.css |
| modules/customer-service/promotion-gallery.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./promotion-catalog.css |
| modules/customer-service/promotion-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./promotions.css |
| modules/customer/line-members.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/customer/members-dashboard.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/customer/members-import.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/customer/members-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/customer/members-sync.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/customer/members-tree.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/dashboard/dashboard.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/dev-tool/autocheck.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/dev-tool/automation.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/dev-tool/settings.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/dev-tool/test-members.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/dev-tool/wizard.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/event/attendees.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./attendees.css |
| modules/event/booking-attendees.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./attendees.css |
| modules/event/course-series.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/event/event-budget.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./procurement.css |
| modules/event/event-form.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | events.css;./event-form.css |
| modules/event/event-log.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | events.css;./event-log.css |
| modules/event/event-poster-gallery.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | events.css;./event-poster-gallery.css |
| modules/event/event-requests.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./event-requests.css |
| modules/event/event-suppliers.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./procurement.css |
| modules/event/events-category.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./events.css;./events-category.css |
| modules/event/events-dashboard.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/event/events-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./events.css |
| modules/event/events-place-form.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./events.css;./event-form.css;./events-place-form.css |
| modules/event/events-place-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./events.css;./events-place-list.css |
| modules/event/line-promote.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./media-schedule.css;./line-promote.css |
| modules/event/media-schedule.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./media-schedule.css |
| modules/ibd/ibd-complaints.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./ibd-shared.css |
| modules/ibd/ibd-dashboard.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./ibd-dashboard.css |
| modules/ibd/ibd-ewallet.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./ibd-shared.css |
| modules/ibd/ibd-relocation.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./ibd-shared.css |
| modules/inventory/categories-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./categories.css |
| modules/inventory/movements.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/inventory/product-form.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./product-form.css |
| modules/inventory/products-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./products.css |
| modules/inventory/stock-initial-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./stock-initial.css |
| modules/inventory/warehouses-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./warehouse.css |
| modules/manual/manual-edit.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./manual.css |
| modules/manual/manual-list.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./manual.css |
| modules/manual/manual-view.html | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./manual.css |
| modules/notifications/notifications.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ../ibd/ibd-shared.css |
| modules/report/reports.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/settings/db_viewer.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | · | · | · |  |
| modules/settings/line-templates.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/settings/notification-rules.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/settings/role.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./role.css |
| modules/settings/roles.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./roles.css |
| modules/settings/settings.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · |  |
| modules/settings/staff-groups.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/settings/staff-messaging.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/settings/users.html | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · | ./users.css |
| modules/supplier/suppliers.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/transactions/purchase_order/po-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./po-list.css |
| modules/transactions/purchase_order/po_form.html | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./po_form.css |
| modules/transactions/requisition/requisition.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/transactions/sales_order/so_form.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · |  |
| modules/work-plan/work-plan-edit.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./work-plan.css |
| modules/work-plan/work-plan-list.html | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | ✓ | · | · | ./work-plan.css |

## Portal pages (separate baseline — informational)

| File | M | module css | js |
|---|:-:|---|---|
| modules/ibd-portal/complaint-form.html | · | ./portal-shared.css | ./portal-config.js;../../js/core/crypto.js;./portal-shared.js |
| modules/ibd-portal/ewallet-form.html | · | ./portal-shared.css | ./portal-config.js;../../js/core/crypto.js;./portal-shared.js |
| modules/ibd-portal/home.html | · | ./portal-shared.css | ./portal-config.js;../../js/core/crypto.js;./portal-shared.js |
| modules/ibd-portal/login.html | · | ./portal-shared.css | ./portal-config.js;../../js/core/crypto.js;./portal-shared.js |
| modules/ibd-portal/my-requests.html | · | ./portal-shared.css | ./portal-config.js;../../js/core/crypto.js;./portal-shared.js |
| modules/ibd-portal/relocation-form.html | · | ./portal-shared.css | ./portal-config.js;../../js/core/crypto.js;./portal-shared.js |

## Native popup violations (any kind)

Memory rule: ห้ามใช้ native confirm/alert/prompt — ใช้ ConfirmModal/PromptModal

| File | kind | alert | confirm | prompt |
|---|:-:|---:|---:|---:|
