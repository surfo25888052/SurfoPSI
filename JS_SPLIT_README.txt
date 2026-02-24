進銷存系統 後台 JS 拆分說明
=================================
原始來源：/mnt/data/進銷存系統_後台專用版_v59_商品編輯高亮加速優化_20260224_014411.zip
原始 admin.js 長度：117929 chars / 3640 lines

拆分檔案（依序載入，順序不可更動）：
01. admin.core-utils-bootstrap.js  (20320 chars, 671 lines)
02. admin.products-ui.js  (18548 chars, 552 lines)
03. admin.products-edit-masters.js  (19312 chars, 588 lines)
04. admin.pickups-purchases-form.js  (20243 chars, 613 lines)
05. admin.transactions-orders-lists.js  (17154 chars, 530 lines)
06. admin.reports-history-media.js  (22352 chars, 691 lines)

注意：此版本為『結構優化』，功能邏輯不變；後續若修 bug 建議改對應 part 檔。

命名說明：本版將 admin.partXX.js 改為功能導向命名，方便後續維護與定位。