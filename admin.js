/*
  進銷存系統 - 管理後台 JS
  -------------------------------------------------
  ✅ 可直接沿用原本 Google Apps Script(JSONP) API
  ✅ 若後端尚未加入 suppliers/purchases/stockLedger API，會自動 fallback 使用 localStorage

  建議（後端 GAS 需支援的 type）
  - products
  - manageProduct (action: add/update/delete)
  - orders
  - manageOrder (action: update/delete)
  - suppliers
  - manageSupplier (action: add/update/delete)
  - purchases
  - managePurchase (action: add/delete)
  - stockLedger
*/

// ------------------ 小工具 ------------------
const LS = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  del(key) {
    localStorage.removeItem(key);
  }
};

function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (res?.data && Array.isArray(res.data)) return res.data;
  if (res?.items && Array.isArray(res.items)) return res.items;
  if (res?.list && Array.isArray(res.list)) return res.list;

  // 兼容不同後端欄位命名
  const keys = ["orders","purchases","products","suppliers","ledger","stockLedger","records"];
  for (const k of keys) {
    if (res && Array.isArray(res[k])) return res[k];
    if (res && res[k]?.data && Array.isArray(res[k].data)) return res[k].data;
  }
  return [];
}

function todayISO() {
  // 以使用者本機時區為準（避免 UTC 跨日）
  // sv-SE 會輸出 YYYY-MM-DD
  return new Date().toLocaleDateString("sv-SE");
}

// 將各種日期格式統一成 YYYY-MM-DD（支援：Date、ISO、YYYY/MM/DD、民國YYY.MM.DD）
function toISODateStr(d){
  if (!d) return "";
  const pad = n => String(n).padStart(2,"0");

  // Date instance -> use local date parts (避免 UTC 少一天)
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  const s = String(d).trim();
  if (!s) return "";

  // ISO with time -> parse then use local date parts
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dtv = new Date(s);
    if (!isNaN(dtv.getTime())) {
      return `${dtv.getFullYear()}-${pad(dtv.getMonth()+1)}-${pad(dtv.getDate())}`;
    }
    return s.slice(0,10);
  }

  // ISO date only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // ISO prefix
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);

  // YYYY/MM/DD
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
    const parts = s.split(/[\sT]/)[0].split("/");
    const y = parts[0];
    const m = pad(parts[1]);
    const dd = pad(parts[2]);
    return `${y}-${m}-${dd}`;
  }

  // ROC: YYY.MM.DD / YYY/MM/DD / YYY-MM-DD (且年份非 4 碼)
  if (/^\d{2,3}[\.\/\-]\d{1,2}[\.\/\-]\d{1,2}/.test(s) && !/^\d{4}[\.\/\-]/.test(s)) {
    const base = s.split(/[\sT]/)[0];
    const parts = base.split(/[\.\/\-]/);
    const rocY = parseInt(parts[0],10);
    const y = (rocY + 1911).toString();
    const m = pad(parts[1]);
    const dd = pad(parts[2]);
    return `${y}-${m}-${dd}`;
  }

  // Fallback parse
  const dtv = new Date(s);
  if (!isNaN(dtv.getTime())) {
    return `${dtv.getFullYear()}-${pad(dtv.getMonth()+1)}-${pad(dtv.getDate())}`;
  }
  return "";
}


function nowISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function genId(prefix) {
  const t = Date.now().toString(36).toUpperCase();
  return `${prefix}${t}`;
}

function money(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("zh-Hant", { maximumFractionDigits: 0 });
}

function safeNum(v, d = 0) {
  if (v === null || v === undefined) return d;
  if (typeof v === "number") return Number.isFinite(v) ? v : d;

  const s = String(v).trim();
  if (!s) return d;

  // 去除常見格式：$、,、空白
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : d;
}



function getOrderTotal(order){
  // 若 total 缺失或非數字，嘗試用 items 計算
  const direct = safeNum(order?.total, NaN);
  if (!isNaN(direct)) return direct;

  let items = order?.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e){ items = []; }
  }
  if (!Array.isArray(items)) items = [];
  return items.reduce((sum, it) => sum + safeNum(it.qty, 0) * safeNum(it.price ?? it.unit_price, 0), 0);
}

function getPurchaseTotal(po){
  const direct = safeNum(po?.total, NaN);
  if (!isNaN(direct)) return direct;

  let items = po?.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e){ items = []; }
  }
  if (!Array.isArray(items)) items = [];
  return items.reduce((sum, it) => sum + safeNum(it.qty, 0) * safeNum(it.cost ?? it.price ?? it.unit_cost, 0), 0);
}

function getProductCostMap(products){
  const map = {};
  (products||[]).forEach(p => {
    const id = String(p.id ?? "").trim();
    if (!id) return;
    map[id] = safeNum(p.cost ?? p.purchase_price ?? p.in_price, 0);
  });
  return map;
}

// ------------------ API 包裝（避免 JSONP 無回應卡住） ------------------
const GAS_CALL_TIMEOUT_MS = 8000;
function gas(params, cb, timeoutMs = GAS_CALL_TIMEOUT_MS) {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    cb({ status: "timeout", message: "API timeout" });
  }, timeoutMs);

  try {
    // callGAS 來自 config.js（JSONP）
    window.callGAS(params, res => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(res);
    });
  } catch (e) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb({ status: "error", message: String(e) });
  }
}

// ------------------ 全域狀態 ------------------
let adminProducts = [];
let suppliers = [];
let purchases = [];
let ordersState = [];
let ledger = [];

let productPage = 1;
const productsPerPage = 10;

let orderPage = 1;
const ordersPerPage = 10;

let purchasePage = 1;
const purchasesPerPage = 8;

let supplierPage = 1;
const suppliersPerPage = 10;

let ledgerPage = 1;
const ledgerPerPage = 12;

// ------------------ 權限與導覽 ------------------
function requireAdmin() {
  const m = (typeof getMember === "function") ? getMember() : null;
  if (!m) {
    alert("請先登入，才能進入後台");
    window.location.href = "login.html";
    return false;
  }
  if (m.role !== "admin") {
    alert("權限不足（需要 admin）");
    window.location.href = "index.html";
    return false;
  }
  return true;
}

function initHeader() {
  const m = getMember();
  const nameEl = document.getElementById("adminUserName");
  if (nameEl) nameEl.textContent = `👤 ${m?.name || "admin"}`;

  const logoutBtn = document.getElementById("adminLogoutBtn");
  logoutBtn?.addEventListener("click", () => {
    if (typeof logout === "function") logout();
    else {
      localStorage.removeItem("member");
      window.location.href = "index.html";
    }
  });
}

function initSidebarNav() {
  const links = Array.from(document.querySelectorAll(".sidebar a"));
  links.forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      links.forEach(l => l.classList.remove("active"));
      link.classList.add("active");

      const targetId = link.dataset.target;
      document.querySelectorAll(".content-section").forEach(sec => {
        sec.classList.toggle("active", sec.id === targetId);
      });

      // 進入區塊時自動載入
      if (targetId === "dashboard-section") refreshDashboard();
      if (targetId === "product-section") loadAdminProducts();
      if (targetId === "order-section") loadOrders();
      if (targetId === "supplier-section") loadSuppliers();
      if (targetId === "purchase-section") {
        Promise.all([loadSuppliers(), loadAdminProducts()]).then(() => {
          initPurchaseForm();
          loadPurchases();
        });
      }
      if (targetId === "ledger-section") loadLedger();
    });
  });
}

// ------------------ Dashboard KPI ------------------
function refreshDashboard() {
  // KPI：以「已載入的最新資料」為準；localStorage 僅作快取
  const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
  const pos = (Array.isArray(purchases) && purchases.length) ? purchases : LS.get("purchases", []);
  const products = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);

  const today = todayISO();

  const todaySales = (orders || [])
    .filter(o => {
      const d = o.date ?? o.created_at ?? o.createdAt;
      return toISODateStr(d) === today;
    })
    .reduce((sum, o) => sum + getOrderTotal(o), 0);

  const todayPurchase = (pos || [])
    .filter(p => {
      const d = p.date ?? p.created_at ?? p.createdAt;
      return toISODateStr(d) === today;
    })
    .reduce((sum, p) => sum + getPurchaseTotal(p), 0);

  const skuCount = (products || []).length;
  const lowStock = (products || []).filter(p => safeNum(p.stock) <= safeNum(p.safety_stock || p.safety || 0)).length;

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setText("kpi-today-sales", `$${money(todaySales)}`);
  setText("kpi-today-purchase", `$${money(todayPurchase)}`);
  setText("kpi-sku-count", `${skuCount}`);
  setText("kpi-low-stock", lowStock ? `${lowStock} 項` : "0");
}

// ------------------ 商品主檔 ------------------
function bindProductEvents() {
  document.getElementById("add-product-btn")?.addEventListener("click", addProduct);
  document.getElementById("searchInput")?.addEventListener("input", searchProducts);
  document.getElementById("reload-products")?.addEventListener("click", () => {
    LS.del("products");
    loadAdminProducts(true);
  });
}

function loadAdminProducts(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("products", null);
    if (!force && Array.isArray(cached) && cached.length) {
      adminProducts = cached;
      renderAdminProducts(adminProducts, 1);
      renderCategoryFilter(adminProducts);
      refreshDashboard();
      resolve(adminProducts);
      return;
    }

    gas({ type: "products" }, res => {
      const list = normalizeList(res);
      adminProducts = list;
      LS.set("products", list);
      renderAdminProducts(list, 1);
      renderCategoryFilter(list);
      refreshDashboard();
      resolve(list);
    });
  });
}

function renderCategoryFilter(products) {
  const container = document.getElementById("category-filter");
  if (!container) return;
  const categories = ["全部商品", ...new Set((products || []).map(p => p.category).filter(Boolean))];
  container.innerHTML = "";
  categories.forEach(c => {
    const btn = document.createElement("button");
    btn.textContent = c;
    btn.className = "category-btn";
    if (c === "全部商品") btn.classList.add("active");
    btn.addEventListener("click", () => {
      container.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const filtered = (c === "全部商品") ? adminProducts : adminProducts.filter(p => p.category === c);
      renderAdminProducts(filtered, 1);
    });
    container.appendChild(btn);
  });
}

function searchProducts() {
  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const filtered = adminProducts.filter(p => (p.name || "").toLowerCase().includes(keyword));
  renderAdminProducts(filtered, 1);
}

function renderAdminProducts(products, page = 1) {
  productPage = page;
  const tbody = document.querySelector("#admin-product-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((products || []).length / productsPerPage));
  productPage = Math.min(productPage, totalPages);

  const start = (productPage - 1) * productsPerPage;
  const end = start + productsPerPage;

  tbody.innerHTML = "";
  (products || []).slice(start, end).forEach(p => {
    const safety = p.safety_stock ?? p.safety ?? "";
    const cost = p.cost ?? p.purchase_price ?? "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.id ?? ""}</td>
      <td>${p.name ?? ""}</td>
      <td>${p.unit ?? ""}</td>
      <td>${safeNum(p.price)}</td>
      <td>${safeNum(cost)}</td>
      <td>${safeNum(p.stock)}</td>
      <td>${safeNum(safety)}</td>
      <td>${p.category ?? ""}</td>
      <td class="row-actions">
        <button onclick="editProduct('${p.id}')">編輯</button>
        <button onclick="deleteProduct('${p.id}')">刪除</button>
        <button onclick="viewProductImage('${p.id}')">查看</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("pagination", totalPages, i => renderAdminProducts(products, i), productPage);
}

function renderPagination(containerId, totalPages, onPage, activePage) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  if (totalPages <= 1) return;

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = i === activePage ? "page-btn active" : "page-btn";
    btn.addEventListener("click", () => onPage(i));
    container.appendChild(btn);
  }
}

function addProduct() {
  const name = document.getElementById("new-name")?.value.trim();
  const price = safeNum(document.getElementById("new-price")?.value);
  const cost = safeNum(document.getElementById("new-cost")?.value);
  const stock = safeNum(document.getElementById("new-stock")?.value);
  const safety = safeNum(document.getElementById("new-safety")?.value);
  const unit = document.getElementById("new-unit")?.value.trim();
  const category = document.getElementById("new-category")?.value.trim();

  if (!name) return alert("請填寫商品名稱");

  gas({
    type: "manageProduct",
    action: "add",
    name,
    price,
    cost,
    stock,
    safety,
    unit,
    category
  }, res => {
    // 若後端不支援，使用 localStorage
    if (res?.status && res.status !== "ok") {
      const list = LS.get("products", []);
      const id = genId("P");
      list.unshift({ id, name, price, cost, stock, safety_stock: safety, unit, category });
      LS.set("products", list);
      adminProducts = list;
    } else {
      LS.del("products");
    }

    clearProductForm();
    loadAdminProducts(true);
    alert(res?.message || "新增完成");
  });
}

function clearProductForm() {
  ["new-name","new-price","new-cost","new-stock","new-safety","new-unit","new-category"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function editProduct(id) {
  const p = adminProducts.find(x => String(x.id) === String(id));
  if (!p) return alert("找不到商品");

  const newPrice = prompt("請輸入新售價", p?.price ?? "");
  if (newPrice === null) return;
  const newCost = prompt("請輸入新進價(成本)", p?.cost ?? p?.purchase_price ?? "");
  if (newCost === null) return;
  const newSafety = prompt("請輸入安全庫存", p?.safety_stock ?? p?.safety ?? "0");
  if (newSafety === null) return;

  // ✅ 庫存改用「調整庫存」方式，確保寫入庫存流水並記錄操作者
  const wantStock = prompt("若要調整庫存，請輸入『新庫存』；不調整請留空", "");
  if (wantStock === null) return;

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  // 先更新主檔（不含 stock）
  gas({
    type: "manageProduct",
    action: "update",
    id,
    price: safeNum(newPrice),
    cost: safeNum(newCost),
    safety_stock: safeNum(newSafety)
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "更新商品失敗（後端寫入未成功）");
      return;
    }

    // 若有輸入新庫存，改走 stockAdjust
    const trimmed = String(wantStock).trim();
    const desired = trimmed === "" ? null : Number(trimmed);
    if (desired === null || isNaN(desired)) {
      // 只更新主檔
      LS.del("products");
      loadAdminProducts(true);
      refreshDashboard();
      alert("更新完成");
      return;
    }

    const before = Number(p.stock || 0);
    const delta = desired - before;
    if (delta === 0) {
      LS.del("products");
      loadAdminProducts(true);
      refreshDashboard();
      alert("更新完成（庫存未變更）");
      return;
    }

    gas({
      type: "stockAdjust",
      product_id: id,
      delta: delta,
      reason: "admin:setStock",
      operator: operator
    }, r2 => {
      if (!r2 || r2.status !== "ok") {
        alert(r2?.message || "庫存調整失敗（後端寫入未成功）");
        return;
      }
      LS.del("products");
      LS.del("stockLedger");
      loadAdminProducts(true);
      loadLedger(true);
      refreshDashboard();
      alert("更新完成（已記錄庫存流水）");
    });
  });
}

function deleteProduct(id) {
  if (!confirm("確定要刪除此商品嗎？")) return;
  gas({ type: "manageProduct", action: "delete", id }, res => {
    if (res?.status && res.status !== "ok") {
      const list = LS.get("products", adminProducts).filter(x => String(x.id) !== String(id));
      LS.set("products", list);
      adminProducts = list;
    } else {
      LS.del("products");
    }

    loadAdminProducts(true);
    alert(res?.message || "刪除完成");
  });
}

// ------------------ 供應商 ------------------
function bindSupplierEvents() {
  document.getElementById("sup-add")?.addEventListener("click", addSupplier);
}

function loadSuppliers(force = false) {
  return new Promise(resolve => {
    // 只允許本地作為「快取」，不可在後端失敗時新增/修改資料
    gas({ type: "suppliers" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        // 若後端回傳空，最多僅顯示既有快取（不寫入任何新資料）
        suppliers = LS.get("suppliers", []);
        if (!suppliers.length) alert("供應商資料載入失敗（後端未回傳/尚未建立工作表 suppliers）");
      } else {
        suppliers = list;
        LS.set("suppliers", list); // cache only
      }

      renderSuppliers(suppliers, 1);
      fillSupplierSelect();
      resolve(suppliers);
    });
  });
}

function renderSuppliers(list, page = 1) {
  supplierPage = page;
  const tbody = document.querySelector("#supplier-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / suppliersPerPage));
  supplierPage = Math.min(supplierPage, totalPages);

  const start = (supplierPage - 1) * suppliersPerPage;
  const end = start + suppliersPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.id ?? ""}</td>
      <td>${s.name ?? ""}</td>
      <td>${s.phone ?? ""}</td>
      <td>${s.address ?? ""}</td>
      <td class="row-actions">
        <button onclick="editSupplier('${s.id}')">編輯</button>
        <button onclick="deleteSupplier('${s.id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("supplier-pagination", totalPages, i => renderSuppliers(list, i), supplierPage);
}

function fillSupplierSelect() {
  const sel = document.getElementById("po-supplier");
  if (!sel) return;
  sel.innerHTML = "";
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);

  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（尚無供應商，請先新增）";
    sel.appendChild(opt);
    return;
  }

  list.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

function addSupplier() {
  const name = document.getElementById("sup-name")?.value.trim();
  const phone = document.getElementById("sup-phone")?.value.trim();
  const address = document.getElementById("sup-address")?.value.trim();
  if (!name) return alert("請輸入供應商名稱");

  const payload = { id: genId("S"), name, phone, address };

  gas({ type: "manageSupplier", action: "add", supplier: encodeURIComponent(JSON.stringify(payload)) }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "新增供應商失敗（後端寫入未成功）");
      return;
    }

    // 後端 ok：清空輸入、刷新（允許快取清除）
    LS.del("suppliers");
    document.getElementById("sup-name").value = "";
    document.getElementById("sup-phone").value = "";
    document.getElementById("sup-address").value = "";

    loadSuppliers(true);
    alert(res?.message || "新增完成");
  });
}

function editSupplier(id) {
  const s = suppliers.find(x => String(x.id) === String(id)) || LS.get("suppliers", []).find(x => String(x.id) === String(id));
  const newName = prompt("供應商名稱", s?.name ?? "");
  if (newName === null) return;
  const newPhone = prompt("電話", s?.phone ?? "");
  if (newPhone === null) return;
  const newAddr = prompt("地址", s?.address ?? "");
  if (newAddr === null) return;

  gas({ type: "manageSupplier", action: "update", id, name: newName, phone: newPhone, address: newAddr }, res => {
    if (res?.status && res.status !== "ok") {
      const list = LS.get("suppliers", suppliers);
      const idx = list.findIndex(x => String(x.id) === String(id));
      if (idx >= 0) {
        list[idx].name = newName;
        list[idx].phone = newPhone;
        list[idx].address = newAddr;
      }
      LS.set("suppliers", list);
      suppliers = list;
    } else {
      LS.del("suppliers");
    }

    loadSuppliers(true);
    alert(res?.message || "更新完成");
  });
}

function deleteSupplier(id) {
  if (!confirm("確定刪除供應商？")) return;
  gas({ type: "manageSupplier", action: "delete", id }, res => {
    if (res?.status && res.status !== "ok") {
      const list = LS.get("suppliers", suppliers).filter(x => String(x.id) !== String(id));
      LS.set("suppliers", list);
      suppliers = list;
    } else {
      LS.del("suppliers");
    }

    loadSuppliers(true);
    alert(res?.message || "刪除完成");
  });
}

// ------------------ 進貨單 ------------------
function initPurchaseForm() {
  const dateEl = document.getElementById("po-date");
  if (dateEl && !dateEl.value) dateEl.value = todayISO();

  // 預設一列
  const tbody = document.querySelector("#po-items-table tbody");
  if (tbody && tbody.children.length === 0) addPurchaseRow();

  document.getElementById("po-add-row")?.addEventListener("click", addPurchaseRow);
  document.getElementById("po-submit")?.addEventListener("click", submitPurchase);

  document.getElementById("po-add-supplier")?.addEventListener("click", () => {
    // 切到供應商區塊
    document.querySelector('.sidebar a[data-target="supplier-section"]')?.click();
  });

  document.getElementById("po-search")?.addEventListener("input", searchPurchases);
  document.getElementById("po-reload")?.addEventListener("click", () => {
    LS.del("purchases");
    loadPurchases(true);
  });
}

function addPurchaseRow() {
  const tbody = document.querySelector("#po-items-table tbody");
  if (!tbody) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><select class="po-product admin-select"></select></td>
    <td><input type="number" class="po-qty admin-input" value="1" style="min-width:90px" /></td>
    <td><input type="number" class="po-cost admin-input" value="0" style="min-width:110px" /></td>
    <td class="po-subtotal">0</td>
    <td><button class="po-del">刪除</button></td>
  `;

  tbody.appendChild(tr);

  // 填商品選單
  const sel = tr.querySelector(".po-product");
  fillProductSelect(sel);

  const qtyEl = tr.querySelector(".po-qty");
  const costEl = tr.querySelector(".po-cost");

  const recalc = () => {
    const qty = safeNum(qtyEl.value);
    const cost = safeNum(costEl.value);
    tr.querySelector(".po-subtotal").textContent = money(qty * cost);
    calcPurchaseTotal();
  };

  qtyEl.addEventListener("input", recalc);
  costEl.addEventListener("input", recalc);
  sel.addEventListener("change", () => {
    // 若商品主檔有成本，帶入
    const pid = sel.value;
    const p = adminProducts.find(x => String(x.id) === String(pid));
    if (p) costEl.value = safeNum(p.cost ?? p.purchase_price ?? 0);
    recalc();
  });

  tr.querySelector(".po-del").addEventListener("click", () => {
    tr.remove();
    calcPurchaseTotal();
  });

  // 預設成本帶入
  const firstPid = sel.value;
  const p0 = adminProducts.find(x => String(x.id) === String(firstPid));
  if (p0) costEl.value = safeNum(p0.cost ?? p0.purchase_price ?? 0);

  recalc();
}

function fillProductSelect(selectEl, includeStock = false) {
  if (!selectEl) return;

  const isLikelySupplierList = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return false;
    const o = arr[0] || {};
    return (("phone" in o) || ("address" in o)) && !("stock" in o) && !("price" in o) && !("category" in o);
  };
  const isLikelyProductList = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return false;
    const o = arr[0] || {};
    return (("stock" in o) || ("price" in o) || ("category" in o) || ("unit" in o) || ("cost" in o));
  };

  // 盡量用已載入的商品主檔；若判斷錯誤資料（供應商誤寫入 products 快取），會自動修正
  let list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);

  // 若不小心拿到供應商清單，先嘗試用 products 快取修正；仍不對則向後端重新抓商品
  if (isLikelySupplierList(list) || !isLikelyProductList(list)) {
    const cached = LS.get("products", []);
    if (isLikelyProductList(cached)) {
      list = cached;
    } else {
      // 後端重抓（非同步），先給提示選項避免空白
      const prev = selectEl.value;
      selectEl.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（載入商品中…）";
      selectEl.appendChild(opt);

      gas({ type: "products" }, res => {
        const prod = normalizeList(res);
        if (isLikelyProductList(prod)) {
          adminProducts = prod;
          LS.set("products", prod);
        }
        // 重新填一次（保留原選擇）
        const keep = prev;
        fillProductSelect(selectEl, includeStock);
        if (keep) selectEl.value = keep;
      });
      return;
    }
  }

  const prev = selectEl.value;
  selectEl.innerHTML = "";

  if (!Array.isArray(list) || !list.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（尚無商品，請先到商品主檔新增）";
    selectEl.appendChild(opt);
    return;
  }

  list.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = includeStock ? `${p.name}（庫存:${safeNum(p.stock,0)}）` : (p.name ?? "");
    selectEl.appendChild(opt);
  });

  if (prev) selectEl.value = prev;
}

function calcPurchaseTotal() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  const total = rows.reduce((sum, tr) => {
    const qty = safeNum(tr.querySelector(".po-qty")?.value);
    const cost = safeNum(tr.querySelector(".po-cost")?.value);
    return sum + qty * cost;
  }, 0);

  const el = document.getElementById("po-total");
  if (el) el.textContent = money(total);
  return total;
}

function collectPurchaseItems() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  return rows
    .map(tr => {
      const pid = tr.querySelector(".po-product")?.value;
      const qty = safeNum(tr.querySelector(".po-qty")?.value);
      const cost = safeNum(tr.querySelector(".po-cost")?.value);
      const p = adminProducts.find(x => String(x.id) === String(pid)) || {};
      return {
        product_id: pid,
        product_name: p.name || "",
        qty,
        cost
      };
    })
    .filter(it => it.product_id && it.qty > 0);
}

function submitPurchase() {
  const date = document.getElementById("po-date")?.value || todayISO();
  const supplierId = document.getElementById("po-supplier")?.value || "";
  const supplierObj = (suppliers || []).find(s => String(s.id) === String(supplierId));
  if (!supplierId) return alert("請先選擇供應商");

  const items = collectPurchaseItems();
  if (!items.length) return alert("請至少新增一個品項");

  const total = calcPurchaseTotal();
  const poId = genId("PO");

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const payload = {
    po_id: poId,
    date,
    supplier_id: supplierId,
    supplier_name: supplierObj?.name || "",
    total,
    items,
    operator
  };

  gas({
    type: "managePurchase",
    action: "add",
    purchase: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "進貨失敗（後端寫入未成功）");
      return;
    }
    LS.del("purchases");
    LS.del("products");
    LS.del("stockLedger");

    // 清空表單（保留日期/供應商）
    const tbody = document.querySelector("#po-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addPurchaseRow();
    calcPurchaseTotal();

    loadAdminProducts(true);
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || `進貨完成：${poId}`);
  });
}

function applyPurchaseToLocalStock(purchase) {
  // 1) 產品庫存加回
  const plist = LS.get("products", adminProducts);

  purchase.items.forEach(it => {
    const idx = plist.findIndex(p => String(p.id) === String(it.product_id));
    if (idx >= 0) {
      plist[idx].stock = safeNum(plist[idx].stock) + safeNum(it.qty);
      // 同步成本
      if (safeNum(it.cost) > 0) plist[idx].cost = safeNum(it.cost);
    }
  });

  LS.set("products", plist);
  adminProducts = plist;

  // 2) 流水
  const led = LS.get("stockLedger", []);
  purchase.items.forEach(it => {
    led.unshift({
      ts: nowISO(),
      type: "IN",
      ref: purchase.po_id,
      product_id: it.product_id,
      product_name: it.product_name,
      qty: it.qty,
      cost: it.cost,
      note: `${purchase.supplier_name || ""} 進貨`
    });
  });
  LS.set("stockLedger", led);
}

function loadPurchases(force = false) {
  return new Promise(resolve => {
    gas({ type: "purchases" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        purchases = LS.get("purchases", []);
        if (!purchases.length) alert("進貨資料載入失敗（後端未回傳/尚未建立工作表 purchases）");
      } else {
        purchases = list;
        LS.set("purchases", list); // cache only
      }

      renderPurchases(purchases, 1);
      refreshDashboard();
      resolve(purchases);
    });
  });
}

function renderPurchases(list, page = 1) {
  purchasePage = page;
  const tbody = document.querySelector("#po-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / purchasesPerPage));
  purchasePage = Math.min(purchasePage, totalPages);

  const start = (purchasePage - 1) * purchasesPerPage;
  const end = start + purchasesPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(po => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${po.po_id ?? ""}</td>
      <td>${po.date ?? ""}</td>
      <td>${po.supplier_name ?? ""}</td>
      <td>$${money(po.total)}</td>
      <td class="row-actions">
        <button onclick="viewPurchase('${po.po_id}')">查看</button>
        <button onclick="deletePurchase('${po.po_id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("po-pagination", totalPages, i => renderPurchases(list, i), purchasePage);
}

function searchPurchases() {
  const keyword = (document.getElementById("po-search")?.value || "").trim().toLowerCase();
  const list = purchases || [];
  const filtered = list.filter(po =>
    String(po.po_id || "").toLowerCase().includes(keyword) ||
    String(po.supplier_name || "").toLowerCase().includes(keyword)
  );
  renderPurchases(filtered, 1);
}

function viewPurchase(poId) {
  const po = (purchases || []).find(p => String(p.po_id) === String(poId));
  if (!po) return alert("找不到進貨單");

  const lines = (po.items || []).map(it => `${it.product_name} x${it.qty} @${it.cost}`).join("\n");
  alert(`進貨單：${po.po_id}\n日期：${po.date}\n供應商：${po.supplier_name}\n\n${lines}\n\n合計：$${money(po.total)}`);
}

function deletePurchase(poId) {
  if (!confirm(`確定刪除進貨單 ${poId}？\n（注意：刪除僅移除單據，不回滾庫存；如需回沖請用「庫存調整」或做沖銷單）`)) return;

  gas({ type: "managePurchase", action: "delete", po_id: poId }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "刪除失敗（後端未成功）");
      return;
    }
    alert(res?.message || "刪除完成");
    LS.del("purchases");
    LS.del("stockLedger");
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();
  });
}

// ------------------ 銷貨（沿用訂單） ------------------
function bindOrderEvents() {
  document.getElementById("order-search")?.addEventListener("input", searchOrders);
  document.getElementById("status-filter")?.addEventListener("change", searchOrders);
  document.getElementById("reload-orders")?.addEventListener("click", () => {
    LS.del("orders");
    loadOrders(true);
  });

  // ---- 新增銷貨單（後台出庫）----
  document.getElementById("so-add-row")?.addEventListener("click", addSaleRow);
  document.getElementById("so-submit")?.addEventListener("click", submitSale);

}

function loadOrders(force = false) {
  const cached = LS.get("orders", null);
  if (!force && Array.isArray(cached) && cached.length) {
    ordersState = cached;
    renderOrders(cached, 1);
    refreshDashboard();
    return;
  }

  gas({ type: "orders" }, res => {
    const list = normalizeList(res);
    ordersState = list;
    if (list.length) LS.set("orders", list);
    renderOrders(list, 1);
    refreshDashboard();
  });
}

function renderOrders(orders, page = 1) {
  const tbody = document.querySelector("#admin-order-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((orders || []).length / ordersPerPage));
  orderPage = Math.min(page, totalPages);

  const start = (orderPage - 1) * ordersPerPage;
  const end = start + ordersPerPage;

  const pageOrders = (orders || []).slice(start, end);

  tbody.innerHTML = pageOrders.map(o => `
    <tr>
      <td>${o.order_id ?? ""}</td>
      <td>${o.date ?? ""}</td>
      <td>${o.name ?? ""}</td>
      <td>${o.phone ?? ""}</td>
      <td>$${money(o.total)}</td>
      <td><button onclick="showOrderItems(\'${o.order_id}\')">查看</button></td>
      <td class="row-actions">
        <button onclick="updateOrder('${o.order_id}', '已出貨')">出貨</button>
        <button onclick="updateOrder('${o.order_id}', '已完成')">完成</button>
        <button onclick="deleteOrder('${o.order_id}')">刪除</button>
      </td>
    </tr>
  `).join("");

  renderPagination("order-pagination", totalPages, i => {
    const list = LS.get("orders", orders);
    renderOrders(list, i);
  }, orderPage);
}

function showOrderItems(orderId) {
  const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
  const o = (orders || []).find(x => String(x.order_id) === String(orderId));
  if (!o) return alert("找不到該銷貨單");

  let items = o.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e) {}
  }
  if (!Array.isArray(items)) items = [];

  if (!items.length) {
    return alert("無商品資料");
  }

  const lines = items.map((it, idx) => {
    const name = it.product_name || it.name || it.ProductName || it.product || `品項${idx+1}`;
    const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity ?? 0, 0);
    const price = safeNum(it.price ?? it.UnitPrice ?? it.unit_price ?? 0, 0);
    const subtotal = (qty && price) ? qty * price : safeNum(it.subtotal ?? it.Subtotal ?? 0, 0);
    const parts = [];
    parts.push(name);
    parts.push(`x${qty}`);
    if (price) parts.push(`@$${money(price)}`);
    if (subtotal) parts.push(`= $${money(subtotal)}`);
    return parts.join(" ");
  });

  const header = `銷貨單 #${o.order_id}\n日期：${o.date || ""}\n客戶：${o.name || ""}\n\n`;
  alert(header + lines.join("\n"));
}

function searchOrders() {
  const keyword = (document.getElementById("order-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("status-filter")?.value || "";
  const orders = LS.get("orders", []);

  const filtered = orders.filter(o => {
    const okKeyword =
      String(o.order_id || "").toLowerCase().includes(keyword) ||
      String(o.name || "").toLowerCase().includes(keyword) ||
      String(o.phone || "").toLowerCase().includes(keyword);

    const okStatus = status ? String(o.status || "") === status : true;
    return okKeyword && okStatus;
  });

  renderOrders(filtered, 1);
}

function updateOrder(orderId, status) {
  if (!confirm(`確定將訂單 ${orderId} 設為「${status}」？`)) return;

  gas({ type: "manageOrder", action: "update", order_id: orderId, status }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "更新失敗（後端未成功）");
      return;
    }
    alert(res?.message || "更新成功");
    LS.del("orders");
    loadOrders(true);
  });
}

function deleteOrder(orderId) {
  if (!confirm(`確定刪除訂單 ${orderId}？`)) return;

  gas({ type: "manageOrder", action: "delete", order_id: orderId }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "刪除失敗（後端未成功）");
      return;
    }
    alert(res?.message || "刪除成功");
    LS.del("orders");
    loadOrders(true);
  });
}

// ------------------ 庫存流水 ------------------
function bindLedgerEvents() {
  document.getElementById("ledger-type")?.addEventListener("change", filterLedger);
  document.getElementById("ledger-search")?.addEventListener("input", filterLedger);
  document.getElementById("ledger-reload")?.addEventListener("click", () => {
    LS.del("stockLedger");
    loadLedger(true);
  });
}

function loadLedger(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("stockLedger", null);
    if (!force && Array.isArray(cached) && cached.length) {
      ledger = cached;
      renderLedger(ledger, 1);
      resolve(ledger);
      return;
    }

    gas({ type: "stockLedger" }, res => {
      const list = normalizeList(res);
      if (!list.length) ledger = LS.get("stockLedger", []);
      else {
        ledger = list;
        LS.set("stockLedger", list);
      }

      renderLedger(ledger, 1);
      resolve(ledger);
    });
  });
}

function filterLedger() {
  const type = document.getElementById("ledger-type")?.value || "";
  const keyword = (document.getElementById("ledger-search")?.value || "").trim().toLowerCase();

  const codeOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    if (code === "IN" || code === "OUT" || code === "ADJ") return code;
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase")) return "IN";
    if (r.includes("sale")) return "OUT";
    if (String(x.ref_id || x.ref || "") === "ADJ") return "ADJ";
    return "";
  };

  const filtered = (ledger || []).filter(l => {
    if (type && codeOf(l) !== type) return false;
    if (!keyword) return true;

    const hay = [
      l.product_name, l.product, l.name,
      l.doc_no, l.ref, l.ref_id,
      l.operator, l.user, l.member_id,
      l.target, l.counterparty, l.note
    ].map(v => String(v || "").toLowerCase()).join(" ");
    return hay.includes(keyword);
  });

  renderLedger(filtered, 1);
}

function renderLedger(list, page = 1) {
  ledgerPage = page;
  const tbody = document.querySelector("#ledger-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / ledgerPerPage));
  ledgerPage = Math.min(ledgerPage, totalPages);

  const start = (ledgerPage - 1) * ledgerPerPage;
  const end = start + ledgerPerPage;

  const labelOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    if (code === "IN") return "進貨";
    if (code === "OUT") return "出貨";
    if (code === "ADJ") return "調整";
    // fallback: reason
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase")) return "進貨";
    if (r.includes("sale")) return "出貨";
    return code || "—";
  };

  const codeOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    if (code === "IN" || code === "OUT" || code === "ADJ") return code;
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase")) return "IN";
    if (r.includes("sale")) return "OUT";
    if (String(x.ref_id || x.ref || "") === "ADJ") return "ADJ";
    return "";
  };

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(l => {
    const qty = (l.qty !== undefined) ? l.qty : (l.change !== undefined ? l.change : 0);
    const qtyNum = safeNum(qty, 0);
    const qtyText = (qtyNum > 0 ? `+${money(qtyNum)}` : `${money(qtyNum)}`);

    const tr = document.createElement("tr");
    tr.dataset.type = codeOf(l);
    tr.innerHTML = `
      <td>${l.ts ?? l.time ?? l.datetime ?? l.date ?? ""}</td>
      <td>${l.type_label ?? labelOf(l)}</td>
      <td>${l.doc_no ?? l.ref ?? l.ref_id ?? ""}</td>
      <td>${l.product_name ?? ""}</td>
      <td>${qtyText}</td>
      <td>${l.operator ?? l.user ?? l.member_id ?? ""}</td>
      <td>${l.target ?? l.counterparty ?? l.note ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("ledger-pagination", totalPages, i => renderLedger(list, i), ledgerPage);
}

// ------------------ 報表 ------------------
function bindReportEvents() {
  const fromEl = document.getElementById("report-from");
  const toEl = document.getElementById("report-to");
  if (fromEl && !fromEl.value) fromEl.value = todayISO();
  if (toEl && !toEl.value) toEl.value = todayISO();

  document.getElementById("report-run")?.addEventListener("click", runReport);
}

function runReport() {
  const from = document.getElementById("report-from")?.value || todayISO();
  const to = document.getElementById("report-to")?.value || todayISO();

  const compute = () => {
    const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
    const pos = (Array.isArray(purchases) && purchases.length) ? purchases : LS.get("purchases", []);
    const products = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", adminProducts);

    const inRange = (d) => {
      const dd = toISODateStr(d);
      return dd && dd >= from && dd <= to;
    };

    const salesOrders = (orders || []).filter(o => inRange(o.date ?? o.created_at ?? o.createdAt));
    const purchaseOrders = (pos || []).filter(p => inRange(p.date ?? p.created_at ?? p.createdAt));

    const sales = salesOrders.reduce((sum, o) => sum + getOrderTotal(o), 0);
    const purchase = purchaseOrders.reduce((sum, p) => sum + getPurchaseTotal(p), 0);

    // 毛利估算：以產品主檔 cost（成本）估算 COGS（若 items 有 cost 會優先使用）
    const costMap = getProductCostMap(products);
    let cogs = 0;
    salesOrders.forEach(o => {
      let items = o.items;
      if (typeof items === "string" && items.trim()) {
        try { items = JSON.parse(items); } catch(e){ items = []; }
      }
      if (!Array.isArray(items)) items = [];
      items.forEach(it => {
        const pid = String(it.product_id ?? it.ProductID ?? it.productId ?? it.id ?? "").trim();
        const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity, 0);
        const unitCost = safeNum(it.cost, NaN);
        const c = !isNaN(unitCost) ? unitCost : (costMap[pid] ?? 0);
        cogs += qty * c;
      });
    });

    const profit = sales - cogs;

    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    set("rep-sales", `$${money(sales)}`);
    set("rep-purchase", `$${money(purchase)}`);
    set("rep-profit", `$${money(profit)}`);

    // ✅ 庫存依分類（不是總庫存）
    const catMap = {};
    (products || []).forEach(p => {
      const cat = String(p.category || "未分類").trim() || "未分類";
      const stock = safeNum(p.stock, 0);
      const cost = safeNum(p.cost || p.purchase_price || 0, 0);
      const price = safeNum(p.price || 0, 0);
      if (!catMap[cat]) catMap[cat] = { cat, sku: 0, qty: 0, costValue: 0, saleValue: 0 };
      catMap[cat].sku += 1;
      catMap[cat].qty += stock;
      catMap[cat].costValue += stock * cost;
      catMap[cat].saleValue += stock * price;
    });
    const cats = Object.values(catMap).sort((a,b) => b.saleValue - a.saleValue);
    set("rep-cat-count", `${cats.length}`);

    const tbody = document.querySelector("#rep-stock-bycat-table tbody");
    if (tbody) {
      tbody.innerHTML = "";
      cats.forEach(x => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${x.cat}</td>
          <td>${x.sku}</td>
          <td>${money(x.qty)}</td>
          <td>$${money(x.costValue)}</td>
          <td>$${money(x.saleValue)}</td>
        `;
        tbody.appendChild(tr);
      });
      if (!cats.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="5" style="text-align:center;opacity:.7;">（沒有商品資料）</td>`;
        tbody.appendChild(tr);
      }
    }
  };

  const haveOrders = (Array.isArray(ordersState) && ordersState.length) || (LS.get("orders", []).length);
  const havePurchases = (Array.isArray(purchases) && purchases.length) || (LS.get("purchases", []).length);
  const haveProducts = (Array.isArray(adminProducts) && adminProducts.length) || (LS.get("products", []).length);

  if (!haveOrders) {
    gas({ type: "orders" }, r => {
      const list = normalizeList(r);
      ordersState = list;
      if (list.length) LS.set("orders", list);

      if (!havePurchases) {
        gas({ type: "purchases" }, r2 => {
          const list2 = normalizeList(r2);
          purchases = list2;
          if (list2.length) LS.set("purchases", list2);

          if (!haveProducts) {
            gas({ type: "products" }, r3 => {
              const list3 = normalizeList(r3);
              adminProducts = list3;
              if (list3.length) LS.set("products", list3);
              compute();
            });
          } else {
            compute();
          }
        });
      } else if (!haveProducts) {
        gas({ type: "products" }, r3 => {
          const list3 = normalizeList(r3);
          adminProducts = list3;
          if (list3.length) LS.set("products", list3);
          compute();
        });
      } else {
        compute();
      }
    });
    return;
  }

  if (!havePurchases) {
    gas({ type: "purchases" }, r2 => {
      const list2 = normalizeList(r2);
      purchases = list2;
      if (list2.length) LS.set("purchases", list2);

      if (!haveProducts) {
        gas({ type: "products" }, r3 => {
          const list3 = normalizeList(r3);
          adminProducts = list3;
          if (list3.length) LS.set("products", list3);
          compute();
        });
      } else {
        compute();
      }
    });
    return;
  }

  if (!haveProducts) {
    gas({ type: "products" }, r3 => {
      const list3 = normalizeList(r3);
      adminProducts = list3;
      if (list3.length) LS.set("products", list3);
      compute();
    });
    return;
  }

  compute();
}

// ------------------ 初始化 ------------------




function viewProductImage(productId){
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const p = (list || []).find(x => String(x.id) === String(productId));
  if (!p) return alert("找不到商品資料");
  const url = String(p.image || "").trim();
  if (!url) return alert("此商品未設定圖片（Products.image 為空）");
  openImageModal(url, p.name || "");
}

function openImageModal(url, title){
  const modal = document.getElementById("imgModal");
  const img = document.getElementById("imgModalImg");
  const ttl = document.getElementById("imgModalTitle");
  if (!modal || !img) return;

  ttl && (ttl.textContent = title ? `商品：${title}` : "商品圖片");
  img.src = url;
  img.alt = title ? `商品圖片：${title}` : "商品圖片";

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");

  // 若圖片載入失敗給提示
  img.onerror = () => {
    img.onerror = null;
    img.src = "";
    closeImageModal();
    alert("圖片載入失敗，請確認 Products.image 是可公開存取的圖片網址");
  };
}

function closeImageModal(){
  const modal = document.getElementById("imgModal");
  const img = document.getElementById("imgModalImg");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
  if (img) {
    img.onerror = null;
    img.src = "";
    img.alt = "";
  }
}

function initImageModal(){
  const modal = document.getElementById("imgModal");
  const btnClose = document.getElementById("imgModalClose");
  if (!modal) return;

  btnClose?.addEventListener("click", closeImageModal);

  // 點遮罩關閉（點內容不關）
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeImageModal();
  });

  // ESC 關閉
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeImageModal();
  });
}

function initMobileSidebar(){
  const btn = document.getElementById("sidebarToggleBtn");
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!btn || !sidebar) return;

  const close = () => {
    sidebar.classList.remove("open");
    overlay?.classList.remove("show");
    document.body.classList.remove("no-scroll");
    overlay?.setAttribute("aria-hidden","true");
  };

  const open = () => {
    sidebar.classList.add("open");
    overlay?.classList.add("show");
    document.body.classList.add("no-scroll");
    overlay?.setAttribute("aria-hidden","false");
  };

  btn.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) close();
    else open();
  });

  overlay?.addEventListener("click", close);

  // 點選側邊欄項目後自動收合（只在手機寬度）
  sidebar.querySelectorAll("a[data-target]").forEach(a => {
    a.addEventListener("click", () => {
      if (window.innerWidth <= 900) close();
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireAdmin()) return;

  initHeader();
  initSidebarNav();
  initMobileSidebar();
  initImageModal();

  bindProductEvents();
  bindOrderEvents();
  bindSupplierEvents();
  bindLedgerEvents();
  bindReportEvents();

  // 預設載入總覽所需
  loadAdminProducts();
  loadOrders();
  loadSuppliers();
  loadPurchases();
  loadLedger();
  refreshDashboard();
});

// ------------------ 掛到全域（供 onclick 使用） ------------------
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.showItems = showItems;
window.updateOrder = updateOrder;
window.deleteOrder = deleteOrder;
window.editSupplier = editSupplier;
window.deleteSupplier = deleteSupplier;
window.viewPurchase = viewPurchase;
window.deletePurchase = deletePurchase;


// ------------------ 後台銷貨（出庫） ------------------
function bindSaleUIBoot() {
  // 初始化銷貨明細表：至少一列
  const tbody = document.querySelector("#so-items-table tbody");
  if (tbody && !tbody.children.length) addSaleRow();
  const dateEl = document.getElementById("so-date");
  if (dateEl && !dateEl.value) dateEl.value = todayISO();
}

function addSaleRow() {
  const tbody = document.querySelector("#so-items-table tbody");
  if (!tbody) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><select class="so-product admin-select"></select></td>
    <td><input type="number" class="so-qty admin-input" value="1" style="min-width:90px" /></td>
    <td><input type="number" class="so-price admin-input" value="0" style="min-width:110px" /></td>
    <td class="so-subtotal">0</td>
    <td><button class="so-del">刪除</button></td>
  `;
  tbody.appendChild(tr);

  const sel = tr.querySelector(".so-product");
  fillProductSelect(sel, /*includeStock*/ true);

  // 當選商品時，預設帶出售價
  sel.addEventListener("change", () => {
    const pid = sel.value;
    const p = (adminProducts || []).find(x => String(x.id) === String(pid));
    const priceEl = tr.querySelector(".so-price");
    if (p && priceEl && (!priceEl.value || Number(priceEl.value) === 0)) {
      priceEl.value = safeNum(p.price);
    }
    recalcSaleRow(tr);
  });

  tr.querySelector(".so-qty")?.addEventListener("input", () => recalcSaleRow(tr));
  tr.querySelector(".so-price")?.addEventListener("input", () => recalcSaleRow(tr));
  tr.querySelector(".so-del")?.addEventListener("click", () => {
    tr.remove();
    calcSaleTotal();
  });

  // 初始帶一次 subtotal
  recalcSaleRow(tr);
}

function recalcSaleRow(tr) {
  const sel = tr.querySelector(".so-product");
  const qty = Number(tr.querySelector(".so-qty")?.value || 0);
  const price = Number(tr.querySelector(".so-price")?.value || 0);
  const subtotal = Math.max(0, qty) * Math.max(0, price);
  const subEl = tr.querySelector(".so-subtotal");
  if (subEl) subEl.textContent = money(subtotal);
  calcSaleTotal();
}

function collectSaleItems() {
  const rows = Array.from(document.querySelectorAll("#so-items-table tbody tr"));
  const items = [];
  rows.forEach(tr => {
    const pid = tr.querySelector(".so-product")?.value || "";
    const p = (adminProducts || []).find(x => String(x.id) === String(pid));
    const qty = Number(tr.querySelector(".so-qty")?.value || 0);
    const price = Number(tr.querySelector(".so-price")?.value || 0);
    if (!pid || !p || !qty || qty <= 0) return;
    items.push({
      product_id: pid,
      product_name: p.name || "",
      qty: qty,
      price: price
    });
  });
  return items;
}

function calcSaleTotal() {
  const items = collectSaleItems();
  const total = items.reduce((s, it) => s + (Number(it.qty) * Number(it.price)), 0);
  const el = document.getElementById("so-total");
  if (el) el.textContent = money(total);
  return total;
}

function submitSale() {
  const date = document.getElementById("so-date")?.value || todayISO();
  const customer = document.getElementById("so-customer")?.value.trim() || "";
  const phone = document.getElementById("so-phone")?.value.trim() || "";
  const note = document.getElementById("so-note")?.value.trim() || "";

  const items = collectSaleItems();
  if (!items.length) return alert("請至少新增一個品項");

  // 檢查庫存足夠
  for (const it of items) {
    const p = (adminProducts || []).find(x => String(x.id) === String(it.product_id));
    const stock = Number(p?.stock || 0);
    if (stock < Number(it.qty || 0)) {
      return alert(`庫存不足：${p?.name || it.product_name} 目前庫存 ${stock}，欲出庫 ${it.qty}`);
    }
  }

  const total = calcSaleTotal();
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const payload = {
    date,
    name: customer,
    phone,
    address: note,     // 沿用 Orders.address 作為備註
    total,
    items,
    operator
  };

  gas({
    type: "manageSale",
    action: "add",
    sale: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "銷貨失敗（後端寫入未成功）");
      return;
    }

    // 清空明細（保留日期）
    const tbody = document.querySelector("#so-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addSaleRow();
    calcSaleTotal();
    if (document.getElementById("so-customer")) document.getElementById("so-customer").value = "";
    if (document.getElementById("so-phone")) document.getElementById("so-phone").value = "";
    if (document.getElementById("so-note")) document.getElementById("so-note").value = "";

    // 清快取並刷新
    LS.del("orders");
    LS.del("products");
    LS.del("stockLedger");

    loadAdminProducts(true);
    loadOrders(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || "銷貨完成");
  });
}
