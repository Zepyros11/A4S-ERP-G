# Visual component drift audit

สำรวจ class-name prefix ของ visual component ทั่วทั้ง `modules/` + `css/`
แต่ละ row คือ "1 module ทำ component นี้แบบของตัวเอง"

## hero / page header banner

พบ **21** prefix ที่ต่างกัน

| prefix | ตัวอย่าง class | count |
|---|---|---:|
| `att` | att-hero | 33 |
| `cat` | cat-hero | 27 |
| `sync` | sync-hero | 25 |
| `ds` | ds-hero | 25 |
| `ci` | ci-hero | 25 |
| `wp` | wp-hero | 22 |
| `ibd` | ibd-hero | 21 |
| `man` | man-hero | 16 |
| `sp` | sp-hero | 14 |
| `po` | po-hero | 13 |
| `reg` | reg-hero | 12 |
| `tpl` | tpl-hero | 12 |
| `tm` | tm-hero | 7 |
| `wz` | wz-hero | 7 |
| `ed` | ed-hero | 7 |
| `confirm` | confirm-hero | 6 |
| `dt` | dt-hero | 6 |
| `btn` | btn-hero | 6 |
| `st` | st-hero | 5 |
| `cs` | cs-hero | 5 |
| `panel` | panel-hero | 1 |

## stats row / kpi card

พบ **13** prefix ที่ต่างกัน

| prefix | ตัวอย่าง class | count |
|---|---|---:|
| `ibd` | ibd-kpi | 57 |
| `ed` | ed-kpi | 49 |
| `cs` | cs-stats | 13 |
| `sp` | sp-stats | 4 |
| `tm` | tm-stats | 3 |
| `att` | att-stats | 3 |
| `sm` | sm-stats | 3 |
| `member` | member-stats | 2 |
| `promo` | promo-stats | 2 |
| `hero` | hero-stats | 2 |
| `po` | po-stats | 2 |
| `card` | card-stats | 2 |
| `level` | level-stats | 1 |

## page card / panel

พบ **50** prefix ที่ต่างกัน

| prefix | ตัวอย่าง class | count |
|---|---|---:|
| `stat` | stat-card | 194 |
| `epg` | epg-card | 39 |
| `pp` | pp-card | 37 |
| `cat` | cat-card | 34 |
| `table` | table-card | 30 |
| `ibd` | ibd-card | 29 |
| `role` | role-card | 28 |
| `type` | type-card | 25 |
| `promo` | promo-card | 22 |
| `section` | section-card | 19 |
| `budget` | budget-card | 18 |
| `report` | report-card | 12 |
| `method` | method-card | 12 |
| `picker` | picker-card | 12 |
| `rec` | rec-card | 10 |
| `member` | member-card | 9 |
| `step` | step-card | 8 |
| `kpi` | kpi-card | 8 |
| `cs` | cs-card | 8 |
| `bt` | bt-card | 6 |
| `add` | add-card | 6 |
| `reg` | reg-card | 6 |
| `hub` | hub-card | 6 |
| `room` | room-card | 6 |
| `task` | task-card | 5 |
| `filter` | filter-card | 5 |
| `tpl` | tpl-card | 5 |
| `modal` | modal-card | 5 |
| `purpose` | purpose-card | 5 |
| `donut` | donut-card | 4 |
| `success` | success-card | 4 |
| `cover` | cover-card | 4 |
| `trend` | trend-card | 3 |
| `scanner` | scanner-card | 3 |
| `manual` | manual-card | 3 |
| `pin` | pin-card | 3 |
| `category` | category-card | 3 |
| `meta` | meta-card | 3 |
| `row` | row-card | 3 |
| `imp` | imp-card | 2 |
| `info` | info-card | 2 |
| `feed` | feed-card | 2 |
| `up` | up-card | 2 |
| `cal` | cal-card | 2 |
| `per` | per-card | 2 |
| `preview` | preview-card | 2 |
| `tl` | tl-card | 1 |
| `items` | items-card | 1 |
| `note` | note-card | 1 |
| `detail` | detail-card | 1 |

## filter bar / toolbar

พบ **17** prefix ที่ต่างกัน

| prefix | ตัวอย่าง class | count |
|---|---|---:|
| `promo` | promo-toolbar | 8 |
| `table` | table-toolbar | 6 |
| `cat` | cat-filter-bar | 5 |
| `wp` | wp-toolbar | 5 |
| `epg` | epg-toolbar | 3 |
| `po` | po-toolbar | 3 |
| `lm` | lm-toolbar | 2 |
| `pos` | pos-filter-bar | 2 |
| `tm` | tm-toolbar | 2 |
| `input` | input-toolbar | 2 |
| `grp` | grp-toolbar | 2 |
| `si` | si-toolbar | 2 |
| `man` | man-toolbar | 2 |
| `db` | db-toolbar | 2 |
| `sg` | sg-toolbar | 2 |
| `sm` | sm-toolbar | 2 |
| `lp` | lp-toolbar | 2 |

## empty state

พบ **38** prefix ที่ต่างกัน

| prefix | ตัวอย่าง class | count |
|---|---|---:|
| `picker` | picker-empty | 11 |
| `man` | man-empty | 11 |
| `ibd` | ibd-empty | 10 |
| `report` | report-empty | 9 |
| `ed` | ed-empty | 8 |
| `dt` | dt-empty | 6 |
| `nr` | nr-empty | 6 |
| `ac` | ac-empty | 6 |
| `dq` | dq-empty | 4 |
| `log` | log-empty | 4 |
| `tree` | tree-empty | 4 |
| `tm` | tm-empty | 4 |
| `wz` | wz-empty | 4 |
| `cs` | cs-empty | 4 |
| `cal` | cal-empty | 4 |
| `bkq` | bkq-empty | 4 |
| `sg` | sg-empty | 4 |
| `sm` | sm-empty | 4 |
| `cat` | cat-empty | 4 |
| `is` | is-empty | 4 |
| `table` | table-empty | 3 |
| `combo` | combo-empty | 3 |
| `lm` | lm-empty | 2 |
| `bt` | bt-empty | 2 |
| `card` | card-empty | 2 |
| `panel` | panel-empty | 2 |
| `wp` | wp-empty | 2 |
| `cb` | cb-empty | 2 |
| `col` | col-empty | 1 |
| `suggest` | suggest-empty | 1 |
| `modal` | modal-empty | 1 |
| `att` | att-empty | 1 |
| `pop` | pop-empty | 1 |
| `chat` | chat-empty | 1 |
| `badge` | badge-empty | 1 |
| `group` | group-empty | 1 |
| `chapter` | chapter-empty | 1 |
| `result` | result-empty | 1 |

## page title

_ไม่พบ_

## หน้าที่มี inline `<style>` block (CSS ไม่ได้แยกออกไปไฟล์)

| File | inline style chars |
|---|---:|
| modules/customer/line-members.html | 5,412 |
| modules/customer/members-dashboard.html | 10,103 |
| modules/customer/members-import.html | 5,976 |
| modules/customer/members-list.html | 9,120 |
| modules/customer/members-sync.html | 15,917 |
| modules/customer/members-tree.html | 12,259 |
| modules/dashboard/dashboard.html | 16,592 |
| modules/dev-tool/autocheck.html | 3,462 |
| modules/dev-tool/automation.html | 10,729 |
| modules/dev-tool/settings.html | 4,436 |
| modules/dev-tool/test-members.html | 7,490 |
| modules/dev-tool/wizard.html | 7,212 |
| modules/event/booking-attendees.html | 2,320 |
| modules/event/check-in.html | 17,863 |
| modules/event/course-series.html | 6,434 |
| modules/event/cs-view/events-bookingRoom.html | 2,007 |
| modules/event/event-requests.html | 10,119 |
| modules/event/events-dashboard.html | 6,096 |
| modules/event/events-list.html | 2,242 |
| modules/event/register.html | 15,927 |
| modules/inventory/movements.html | 13,695 |
| modules/inventory/product-form.html | 1,930 |
| modules/manual/manual-view.html | 274 |
| modules/notifications/notifications.html | 1,017 |
| modules/report/reports.html | 8,899 |
| modules/settings/db_viewer.html | 676 |
| modules/settings/line-templates.html | 6,489 |
| modules/settings/notification-rules.html | 10,936 |
| modules/settings/settings.html | 3,538 |
| modules/settings/staff-groups.html | 4,770 |
| modules/settings/staff-messaging.html | 8,976 |
| modules/supplier/suppliers.html | 2,919 |
| modules/tour/check-seat.html | 30,957 |
| modules/transactions/requisition/requisition.html | 9,155 |
| modules/transactions/sales_order/so_form.html | 17,116 |
| modules/trip/check-seat.html | 35,253 |
