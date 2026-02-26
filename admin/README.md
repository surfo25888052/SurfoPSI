# 進銷存系統（前端）

這份程式以你原本的「商城＋後台」為基礎，將後台擴充為 **進銷存（商品/進貨/銷貨/庫存流水/報表/供應商）**。

## 新增/調整功能

- 商品主檔：新增欄位 `cost(進價/成本) / safety(安全庫存) / unit(單位)`。
- 進貨管理：新增進貨單（多品項），儲存後會增加庫存並寫入庫存流水（IN）。
- 銷貨管理：沿用原本訂單管理（orders），可視為銷貨單管理。
- 供應商管理：供應商主檔 CRUD。
- 庫存流水：IN/OUT/ADJ 異動紀錄查詢。
- 報表：期間銷售額、期間進貨額、毛利估算、庫存總數。

> 若後端尚未支援 suppliers/purchases/stockLedger：後台會自動使用 localStorage 做示範儲存。

## 變更的檔案

- `admin-dashboard.html`：後台選單與區塊改為進銷存（總覽/商品/進貨/銷貨/供應商/庫存流水/報表/設定）
- `admin.js`：後台 JS 重寫，加入 suppliers/purchases/stockLedger 與 localStorage fallback
- `config.js`：未變更（API 位址仍在此檔）
