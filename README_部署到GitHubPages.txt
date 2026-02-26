GitHub Pages 部署版（前台主入口 + /admin 後台）
========================================

目錄結構
--------
- /                電商前台（客戶使用）
- /admin/          後台管理（公司內部使用）

主要入口
--------
- 前台首頁：index.html
- 後台登入：admin/login.html
- 後台主控台：admin/admin-dashboard.html

部署到 GitHub Pages
-------------------
假設你的 Pages 網址是：
https://<帳號>.github.io/<repo>/

則：
- 前台：https://<帳號>.github.io/<repo>/
- 後台：https://<帳號>.github.io/<repo>/admin/login.html

重要提醒（安全）
----------------
GitHub Pages 是公開靜態託管，/admin 路徑不是私密。
請務必在 GAS 端做後台操作權限檢查（admin 角色驗證）。

共用資料庫
----------
前台與後台都各自有 config.js，預設指向同一支 GAS / Google Sheet。
若更換 API URL，請同步修改：
- /config.js
- /admin/config.js
