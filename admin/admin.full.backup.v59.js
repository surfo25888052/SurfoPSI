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


function userNameOnly(v){
  if (!v) return "";
  const s = String(v);
  const parts = s.split("|");
  if (parts.length >= 2) return parts.slice(1).join("|");
  return s;
}

function dateTimeText(v){
  if (!v) return "";
  if (v instanceof Date){
    const y=v.getFullYear();
    const m=String(v.getMonth()+1).padStart(2,"0");
    const d=String(v.getDate()).padStart(2,"0");
    const hh=String(v.getHours()).padStart(2,"0");
    const mm=String(v.getMinutes()).padStart(2,"0");
    const ss=String(v.getSeconds()).padStart(2,"0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
  if (typeof v === "number") return dateTimeText(new Date(v));
  const s=String(v).trim();
  if (!s) return "";
  // If like YYYY-MM-DD HH:mm:ss or YYYY-MM-DDTHH:mm:ss, normalize
  const m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m){
    const y=Number(m[1]), mo=Number(m[2])-1, d=Number(m[3]);
    const hh=Number(m[4]||0), mm=Number(m[5]||0), ss=Number(m[6]||0);
    return dateTimeText(new Date(y,mo,d,hh,mm,ss));
  }
  const dt=new Date(s);
  if (!isNaN(dt.getTime())) return dateTimeText(dt);
  return s;
}

function dateOnly(v){
  if (!v) return "";
  // Accept Date, number (ms), or string
  try{
    if (v instanceof Date){
      const y=v.getFullYear();
      const m=String(v.getMonth()+1).padStart(2,"0");
      const d=String(v.getDate()).padStart(2,"0");
      return `${y}-${m}-${d}`;
    }
    if (typeof v === "number"){
      return dateOnly(new Date(v));
    }
    const s=String(v).trim();
        // ROC date like 114.02.11 or 114/02/11
        const roc = s.match(/^([0-9]{1,3})[\.\/\-]([0-9]{1,2})[\.\/\-]([0-9]{1,2})$/);
        if (roc){
          const y = Number(roc[1]) + 1911;
          const m = String(roc[2]).padStart(2,"0");
          const d = String(roc[3]).padStart(2,"0");
          return `${y}-${m}-${d}`;
        }
    if (!s) return "";
    // If already like YYYY-MM-DD..., keep first 10
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    // If like YYYY/MM/DD...
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)){
      const parts=s.split(/[\/\s:]/);
      const y=parts[0];
      const m=String(parts[1]).padStart(2,"0");
      const d=String(parts[2]).padStart(2,"0");
      return `${y}-${m}-${d}`;
    }
    // Try parse
    const dt=new Date(s);
    if (!isNaN(dt.getTime())) return dateOnly(dt);
  }catch(e){}
  return String(v).slice(0,10);
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
function debounce_(fn, ms){
  let t=null;
  return function(...args){
    if (t) clearTimeout(t);
    t=setTimeout(()=>fn.apply(this,args), ms);
  };
}

function setupCombo_(inputEl, menuEl, getOptions, onPick, opts){
  if (!inputEl || !menuEl) return;
  opts = opts || {};
  const maxShow = opts.maxShow || 30;
  const minChars = opts.minChars || 0;
  const onInputClear = opts.onInputClear || null;

  let lastRenderKey = "";

  const close = () => {
    menuEl.classList.remove("show");
  };

  const render = (items, hintText) => {
    menuEl.innerHTML = "";
    if (hintText){
      const div = document.createElement("div");
      div.className = "combo-empty";
      div.textContent = hintText;
      menuEl.appendChild(div);
      menuEl.classList.add("show");
      return;
    }
    if (!items || !items.length){
      const div = document.createElement("div");
      div.className = "combo-empty";
      div.textContent = "（沒有符合的項目）";
      menuEl.appendChild(div);
      menuEl.classList.add("show");
      return;
    }
    items.slice(0, maxShow).forEach(it => {
      const div = document.createElement("div");
      div.className = "combo-item";
      div.textContent = it.label || "";
      div.dataset.value = it.value;
      menuEl.appendChild(div);
    });
    menuEl.classList.add("show");
  };

  const update = () => {
    const kw = String(inputEl.value || "").trim();
    if (kw.length < minChars){
      close();
      return;
    }
    const key = kw.toLowerCase();
    // 防止過度重繪
    if (key === lastRenderKey && menuEl.classList.contains("show")) return;
    lastRenderKey = key;

    const result = getOptions(kw) || [];
    // 若 getOptions 回傳 {items, hint}
    if (result && result.items){
      render(result.items, result.hint || "");
      return;
    }
    render(result, "");
  };

  const debouncedUpdate = debounce_(update, 120);

  inputEl.addEventListener("input", () => {
    lastRenderKey = "";
    if (typeof onInputClear === "function") onInputClear();
    debouncedUpdate();
  });

  inputEl.addEventListener("focus", () => {
    lastRenderKey = "";
    update();
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(close, 160);
  });

  // 點選（用 mousedown 避免 blur 先觸發）
  menuEl.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (!(target && target.classList.contains("combo-item"))) return;
    e.preventDefault();
    const value = target.dataset.value;
    const label = target.textContent;
    close();
    onPick({ value, label });
  });
}

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
let supplierProductIndex_ = {}; // { supplierId: [product,...] }
let supplierIndexSig_ = ""; // 索引簽章（避免僅用 length 造成舊索引不更新）

function buildSupplierProductIndex_(force=false){
  const list = adminProducts.length ? adminProducts : LS.get("products", []);
  const arr = Array.isArray(list) ? list : [];

  // 用內容做輕量簽章：避免「只用 length」導致索引不更新（會造成永遠只看到第一個供應商商品）
  let h = 0;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i] || {};
    const sidStr = String(p.supplier_ids ?? p.supplier_id ?? "");
    const idStr  = String(p.id ?? "");
    for (let j = 0; j < idStr.length; j++)  h = (h * 17 + idStr.charCodeAt(j)) >>> 0;
    for (let j = 0; j < sidStr.length; j++) h = (h * 31 + sidStr.charCodeAt(j)) >>> 0;
  }
  const sig = `${arr.length}-${h}`;

  if (!force && supplierProductIndex_ && Object.keys(supplierProductIndex_).length && supplierIndexSig_ === sig) return;

  supplierIndexSig_ = sig;
  supplierProductIndex_ = {};

  (arr || []).forEach(p => {
    const ids = parseSupplierIds_(p);
    ids.forEach(sid => {
      if (!sid) return;
      if (!supplierProductIndex_[sid]) supplierProductIndex_[sid] = [];
      supplierProductIndex_[sid].push(p);
    });
  });
}function refreshPurchaseRowProducts_(tr){
  if (!tr) return;
  const sel = tr.querySelector(".po-product");
  const supSel = tr.querySelector(".po-supplier");
  const unitCell = tr.querySelector(".po-unit");
  const qty = tr.querySelector(".po-qty");
  const cost = tr.querySelector(".po-cost");
  const sub = tr.querySelector(".po-subtotal");
  if (!sel || !supSel) return;

  const supplierId = String(supSel.value || "").trim();
  const prev = String(sel.value || "").trim();
  const kw = String(tr.querySelector(".po-product-search")?.value || "").trim();

  if (!supplierId) {
    sel.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（請先選擇供應商）";
    sel.appendChild(opt);
    sel.disabled = true;
    if (unitCell) unitCell.textContent = "-";
    if (cost) cost.value = 0;
    if (sub) sub.textContent = "0";
    return;
  }

  sel.disabled = false;
  // 確保索引已就緒（避免切換時重建造成卡頓）
  buildSupplierProductIndex_();
  fillProductSelect(sel, supplierId || null, false, kw);

  // 保留原選擇（若仍存在），否則選第一個
  const stillOk = Array.from(sel.options).some(o => String(o.value) === String(prev));
  sel.value = stillOk ? prev : (sel.options[0]?.value || "");

  // 同步單位/小計
  const pid = String(sel.value || "").trim();
  const p = (adminProducts || []).find(x => String(x.id) === String(pid));
  if (unitCell) unitCell.textContent = p?.unit || "-";
  if (p && cost && Number(cost.value || 0) === 0) cost.value = Number(p.cost || 0);
  const subtotal = (Number(qty?.value || 0) * Number(cost?.value || 0));
  if (sub) sub.textContent = fmtMoney_(subtotal);
}

function refreshAllPurchaseRows_(){
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  rows.forEach(tr => refreshPurchaseRowProducts_(tr));
  updatePurchaseTotal();
}

let adminProducts = [];
let customers = [];
let customerPage = 1;
const customersPerPage = 10;

let suppliers = [];
let pickups = [];
let pickupPage = 1;
const pickupsPerPage = 10;

let purchases = [];
let ordersState = [];
let ledger = [];

let productPage = 1;
let productFlashId = ""; // 商品主檔：更新後要高亮的商品 id
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

function isSectionActive_(id){
  const el = document.getElementById(id);
  return !!(el && el.classList.contains("active"));
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
      if (targetId === "product-section") Promise.all([loadSuppliers(), loadAdminProducts()]);
      if (targetId === "order-section") {
        Promise.all([loadAdminProducts(), loadCustomers()]).then(() => {
          initCustomerCombo_();
          loadOrders();
        });
      }
      if (targetId === "supplier-section") loadSuppliers(true);
      if (targetId === "customer-section") loadCustomers();
      if (targetId === "purchase-section") {
        ensurePurchaseDataReady_().then(ok => {
          if (!ok) return alert("進貨管理載入失敗：供應商/商品資料未就緒，請稍後重試");
          initPurchaseForm();
          loadPurchases();
        });
      }
      if (targetId === "pickup-section") {
        Promise.all([loadAdminProducts()]).then(() => {
          initPickupForm();
          loadPickups();
        });
      }
      if (targetId === "ledger-section") loadLedger();
    });
  });
}

// ------------------ Dashboard KPI ------------------
let _dashTimer_ = null;
function scheduleDashboardRefresh_(){
  if (_dashTimer_) clearTimeout(_dashTimer_);
  _dashTimer_ = setTimeout(() => {
    try { refreshDashboard(); } catch(e) {}
  }, 80);
}

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
  document.getElementById("open-add-product")?.addEventListener("click", openProductAddModal_);  document.getElementById("searchInput")?.addEventListener("input", searchProducts);
  document.getElementById("reload-products")?.addEventListener("click", () => {
    LS.del("products");
    loadAdminProducts(true);
  });
}

function loadAdminProducts(force = false, keepPageNo = null) {
  return new Promise(resolve => {
    const cached = LS.get("products", null);
    let resolved = false;

    // 先用快取快速畫面（但不阻止後端抓最新），避免快取造成配對永遠卡舊資料
    if (!force && Array.isArray(cached) && cached.length) {
      adminProducts = cached;
      buildSupplierProductIndex_(true);
      if (isSectionActive_("product-section")) renderAdminProducts(adminProducts, (Number.isFinite(Number(keepPageNo)) && Number(keepPageNo) > 0) ? Number(keepPageNo) : 1);
      if (isSectionActive_("product-section")) renderCategoryFilter(adminProducts);
      if (isSectionActive_("purchase-section")) {
        try { refreshAllPurchaseRows_(); } catch(e) {}
      }
      scheduleDashboardRefresh_();
      resolve(adminProducts);
      resolved = true;
      // 繼續往下抓後端最新版
    }

    gas({ type: "products" }, res => {
      const list = normalizeList(res);

      if (Array.isArray(list) && list.length) {
        adminProducts = list;
        LS.set("products", list);
        buildSupplierProductIndex_(true);

        if (isSectionActive_("product-section")) renderAdminProducts(list, (Number.isFinite(Number(keepPageNo)) && Number(keepPageNo) > 0) ? Number(keepPageNo) : 1);
        fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box"));
        if (isSectionActive_("product-section")) renderCategoryFilter(list);

        if (isSectionActive_("purchase-section")) {
          try { refreshAllPurchaseRows_(); } catch(e) {}
        }
        scheduleDashboardRefresh_();
      } else {
        // 後端沒回傳：保留既有快取
        if (!resolved && Array.isArray(cached)) adminProducts = cached;
      }

      if (!resolved) resolve(adminProducts || []);
    });
  });
}
let __purchaseDataPromise__ = null;
function ensurePurchaseDataReady_(force=false){
  if (__purchaseDataPromise__ && !force) return __purchaseDataPromise__;
  __purchaseDataPromise__ = Promise.all([
    loadSuppliers(force),
    loadAdminProducts(force)
  ]).then(() => {
    buildSupplierProductIndex_(true);
    return true;
  }).catch(err => {
    console.error(err);
    __purchaseDataPromise__ = null;
    return false;
  });
  return __purchaseDataPromise__;
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
  if (!keyword) {
    renderAdminProducts(adminProducts, 1);
    return;
  }
  const filtered = (adminProducts || []).filter(p => {
    const name = String(p.name || "").toLowerCase();
    const sku = String(p.sku || p.part_no || p.code || p["料號"] || "").toLowerCase();
    const id = String(p.id || "").toLowerCase();
    const sup = String(p.supplier_names || p.supplier_name || "").toLowerCase();
        return name.includes(keyword) || sku.includes(keyword) || id.includes(keyword) || sup.includes(keyword);
  });
  renderAdminProducts(filtered, 1);
}


function flashProductRow_(productId){
  const id = String(productId || "").trim();
  if (!id) return;
  const table = document.getElementById("admin-product-table");
  if (!table) return;

  let row = null;
  try {
    if (window.CSS && CSS.escape) {
      row = table.querySelector(`tbody tr[data-product-id="${CSS.escape(id)}"]`);
    }
  } catch (e) {}
  if (!row) {
    row = Array.from(table.querySelectorAll("tbody tr")).find(tr => String(tr.dataset.productId || "") === id);
  }
  if (!row) return;

  try { row.scrollIntoView({ behavior: "smooth", block: "center" }); }
  catch (e) { try { row.scrollIntoView(); } catch (_) {} }

  row.classList.remove("flash-highlight");
  void row.offsetWidth;
  row.classList.add("flash-highlight");
  setTimeout(() => row.classList.remove("flash-highlight"), 2200);
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
    const sku = (p.sku ?? p.part_no ?? p.code ?? p["料號"] ?? p.id) ?? "";
    const supplierPrimary = primarySupplierName_(p);

    const tr = document.createElement("tr");
    tr.dataset.productId = String(p.id || "");
    tr.innerHTML = `
      <td>${sku}</td>
      <td>${p.name ?? ""}</td>
      <td>${supplierPrimary}</td>
      <td>${p.unit ?? ""}</td>
      <td>${safeNum(p.price)}</td>
      <td>${safeNum(cost)}</td>
      <td>${safeNum(p.stock)}</td>
      <td>${safeNum(safety)}</td>
      <td>${p.category ?? ""}</td>
      <td>${dateOnly(p.expiry_date ?? "")}</td>
      <td>${dateOnly(p.last_purchase_date ?? "")}</td>
      <td class="row-actions">
        <select class="action-select" data-id="${p.id}">
          <option value="">操作</option>
          <option value="edit">編輯</option>
          <option value="image">查看圖片</option>
          <option value="history">歷史</option>
          <option value="delete">刪除</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 編輯/新增後：高亮剛更新的那列
  if (productFlashId) {
    const _flashId = String(productFlashId || "");
    productFlashId = "";
    setTimeout(() => flashProductRow_(_flashId), 40);
  }

  // 綁定操作下拉
  tbody.querySelectorAll(".action-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      const act = e.target.value;
      if (!act) return;
      onProductAction_(id, act);
      e.target.value = ""; // reset
    });
  });

  renderPagination("pagination", totalPages, (p) => renderAdminProducts(products, p), productPage);
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
  const supBox = document.getElementById("new-product-suppliers-box");
  const selectedIds = supBox ? Array.from(supBox.querySelectorAll("input[name=\"new-product-supplier\"]:checked")).map(i => String(i.value).trim()).filter(Boolean) : [];
  const supplier_ids = selectedIds.join(",");


  const sku = document.getElementById("new-sku")?.value.trim();
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
    sku,
    supplier_ids,
    price,
    cost,
    stock,
    safety,
    unit,
    category,
    expiry_date
  }, res => {
    // 若後端不支援，使用 localStorage
    if (res?.status && res.status !== "ok") {
      const list = LS.get("products", adminProducts);
      const maxId = list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
      const id = maxId + 1;
      list.push({ id, name, sku, supplier_ids, price, cost, stock, safety_stock: safety, unit, category });
      LS.set("products", list);
      adminProducts = list;
    } else {
      LS.del("products");
    }

    clearProductForm();
    loadAdminProducts(true);
    refreshDashboard();
    alert(res?.message || "新增完成");
  });
}

function clearProductForm() {
  ["new-name","new-sku","new-price","new-cost","new-stock","new-safety","new-unit","new-category"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const supBox = document.getElementById("new-product-suppliers-box");
  if (supBox) supBox.querySelectorAll('input[name="new-product-supplier"]').forEach(chk => chk.checked = false);
}

// ------------------ 新增商品 Modal ------------------
function closeProductAddModal_(){
  const modal = document.getElementById("productAddModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
}

function ensureProductAddModalWired_(){
  const modal = document.getElementById("productAddModal");
  const closeBtn = document.getElementById("productAddModalClose");
  if (!modal || !closeBtn) return;
  if (modal.dataset.wired === "1") return;

  closeBtn.addEventListener("click", closeProductAddModal_);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeProductAddModal_();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeProductAddModal_();
  });

  modal.dataset.wired = "1";
}

function openProductAddModal_(){
  const modal = document.getElementById("productAddModal");
  const body  = document.getElementById("productAddModalBody");
  if (!modal || !body) return;

  const ready = suppliers?.length ? Promise.resolve() : loadSuppliers(true);
  ready.then(() => {
    body.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>料號</label>
          <input id="add-sku" class="admin-input" type="text" placeholder="例：A001（可留空）">
        </div>

        <div class="field">
          <label>商品名稱</label>
          <input id="add-name" class="admin-input" type="text" placeholder="例：冷凍雞腿">
        </div>

        <div class="field span-2">
          <label>供應商（可多選）</label>
          <div id="add-suppliers-box" class="checkbox-list"></div>
        </div>

        <div class="field">
          <label>單位</label>
          <input id="add-unit" class="admin-input" type="text" placeholder="例：kg / 盒 / 包">
        </div>

        <div class="field">
          <label>售價</label>
          <input id="add-price" class="admin-input" type="number" placeholder="0">
        </div>

        <div class="field">
          <label>進價（成本）</label>
          <input id="add-cost" class="admin-input" type="number" placeholder="0">
        </div>

        <div class="field">
          <label>庫存</label>
          <input id="add-stock" class="admin-input" type="number" placeholder="0">
        </div>

        <div class="field">
          <label>安全庫存</label>
          <input id="add-safety" class="admin-input" type="number" placeholder="0">
        </div>

        <div class="field">
          <label>分類</label>
          <input id="add-category" class="admin-input" type="text" placeholder="例：冷凍 / 青菜 / 雜貨 / 乾貨">
        </div>

        <div class="field">
          <label>有效期限</label>
          <input id="add-expiry" class="admin-input" type="date">
        </div>
      </div>

      <div class="modal-actions">
        <button id="add-cancel" class="admin-btn" type="button">取消</button>
        <button id="add-save" class="admin-btn primary" type="button">新增</button>
      </div>
    `;

    // 供應商 checkbox
    fillSupplierCheckboxesForAdd_(document.getElementById("add-suppliers-box"));

    document.getElementById("add-cancel")?.addEventListener("click", closeProductAddModal_);
    document.getElementById("add-save")?.addEventListener("click", saveProductAdd_);

    ensureProductAddModalWired_();

    modal.classList.add("show");
    modal.setAttribute("aria-hidden","false");
  });
}

function fillSupplierCheckboxesForAdd_(boxEl){
  if (!boxEl) return;
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  boxEl.innerHTML = "";
  if (!list.length){
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "（尚無供應商，請先新增）";
    boxEl.appendChild(div);
    return;
  }
  list
    .filter(s => String(s.id || "").trim() !== "")
    .forEach(s => {
      const id = String(s.id).trim();
      const label = document.createElement("label");
      label.className = "chk";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "add-product-supplier";
      input.value = id;

      const span = document.createElement("span");
      span.textContent = String(s.name || "");

      label.appendChild(input);
      label.appendChild(span);
      boxEl.appendChild(label);
    });
}

function saveProductAdd_(){
  const name = document.getElementById("add-name")?.value.trim();
  const sku  = document.getElementById("add-sku")?.value.trim();
  const unit = document.getElementById("add-unit")?.value.trim();
  const price = safeNum(document.getElementById("add-price")?.value);
  const cost  = safeNum(document.getElementById("add-cost")?.value);
  const stock = safeNum(document.getElementById("add-stock")?.value);
  const safety = safeNum(document.getElementById("add-safety")?.value);
  const category = document.getElementById("add-category")?.value.trim();
  const expiry_date = document.getElementById("add-expiry")?.value.trim() || "";

  const supBox = document.getElementById("add-suppliers-box");
  const selectedIds = supBox ? Array.from(supBox.querySelectorAll('input[name="add-product-supplier"]:checked')).map(i => String(i.value).trim()).filter(Boolean) : [];
  const supplier_ids = selectedIds.join(",");

  if (!name) return alert("請填寫商品名稱");
  if (!supplier_ids) return alert("請至少勾選 1 個供應商（代碼）");

  gas({
    type: "manageProduct",
    action: "add",
    name,
    sku,
    supplier_ids,
    price,
    cost,
    stock,
    safety,
    unit,
    category,
    expiry_date
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "新增商品失敗（後端寫入未成功）");
      return;
    }
    LS.del("products");
    productFlashId = String(res?.id || res?.product_id || res?.data?.id || "");
    loadAdminProducts(true);
    refreshDashboard();
    closeProductAddModal_();
    alert(res?.message || "新增完成");
  });
}

// ------------------ 商品編輯 Modal ------------------
let _editingProductId_ = null;

function closeProductEditModal_(){
  const modal = document.getElementById("productEditModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
  _editingProductId_ = null;
}

function openProductEditModal_(productId){
  const p = adminProducts.find(x => String(x.id) === String(productId));
  if (!p) return alert("找不到商品");

  _editingProductId_ = String(productId);

  const modal = document.getElementById("productEditModal");
  const title = document.getElementById("productEditModalTitle");
  const body  = document.getElementById("productEditModalBody");
  if (!modal || !title || !body) return;

  // 確保供應商已載入（用代碼比對）
  const ready = suppliers?.length ? Promise.resolve() : loadSuppliers(true);
  ready.then(() => {
    const sku = (p.sku ?? p.part_no ?? p.code ?? p["料號"] ?? "").toString();
    const supplier_ids_raw = String(p.supplier_ids ?? "");
    const supplierIds = supplier_ids_raw.split(",").map(s => s.trim()).filter(Boolean);

    const safety = p.safety_stock ?? p.safety ?? "";
    const cost   = p.cost ?? p.purchase_price ?? "";
    const price  = p.price ?? "";
    const stock  = p.stock ?? "";

    title.textContent = `編輯商品：${p.name ?? ""}`;

    // 表單（排版與新增商品一致）
    body.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>料號</label>
          <input id="edit-sku" class="admin-input" type="text" value="${escapeAttr_(sku)}" placeholder="可留空">
        </div>

        <div class="field">
          <label>商品名稱</label>
          <input id="edit-name" class="admin-input" type="text" value="${escapeAttr_(p.name ?? "")}">
        </div>

        <div class="field span-2">
          <label>供應商（可多選）</label>
          <div id="edit-suppliers-box" class="checkbox-list"></div>
        </div>

        <div class="field">
          <label>單位</label>
          <input id="edit-unit" class="admin-input" type="text" value="${escapeAttr_(p.unit ?? "")}">
        </div>

        <div class="field">
          <label>售價</label>
          <input id="edit-price" class="admin-input" type="number" value="${escapeAttr_(price)}" placeholder="0">
        </div>

        <div class="field">
          <label>進價（成本）</label>
          <input id="edit-cost" class="admin-input readonly" type="number" value="${escapeAttr_(cost)}" readonly>
        </div>

        <div class="field">
          <label>庫存</label>
          <input id="edit-stock" class="admin-input readonly" type="number" value="${escapeAttr_(stock)}" readonly>
        </div>

        <div class="field">
          <label>調整庫存（輸入「新庫存」，留空=不調整）</label>
          <input id="edit-setstock" class="admin-input" type="number" placeholder="例：120">
        </div>

        <div class="field">
          <label>安全庫存</label>
          <input id="edit-safety" class="admin-input" type="number" value="${escapeAttr_(safety)}" placeholder="0">
        </div>

        <div class="field">
          <label>分類</label>
          <input id="edit-category" class="admin-input" type="text" value="${escapeAttr_(p.category ?? "")}">
        </div>

        <div class="field">
          <label>有效期限</label>
          <input id="edit-expiry" class="admin-input" type="date" value="${escapeAttr_(dateOnly(p.expiry_date ?? ""))}">
        </div>

        <div class="field">
          <label>最近進貨日</label>
          <input id="edit-lastpo" class="admin-input readonly" type="date" value="${escapeAttr_(dateOnly(p.last_purchase_date ?? ""))}" readonly>
        </div>
      </div>

      <div class="modal-actions">
        <button id="edit-cancel" class="admin-btn" type="button">取消</button>
        <button id="edit-save" class="admin-btn primary" type="button">儲存</button>
      </div>
    `;

    // 建立供應商勾選（只用代碼）
    const box = document.getElementById("edit-suppliers-box");
    fillSupplierCheckboxesForEdit_(box, supplierIds);

    // 綁定事件
    document.getElementById("edit-cancel")?.addEventListener("click", closeProductEditModal_);
    document.getElementById("edit-save")?.addEventListener("click", () => saveProductEdit_(p));

    modal.classList.add("show");
    modal.setAttribute("aria-hidden","false");
  });
}

function fillSupplierCheckboxesForEdit_(boxEl, selectedIds){
  if (!boxEl) return;
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  boxEl.innerHTML = "";
  list
    .filter(s => String(s.id || "").trim() !== "")
    .forEach(s => {
      const id = String(s.id).trim();
      const label = document.createElement("label");
      label.className = "chk";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "edit-product-supplier";
      input.value = id;
      if (selectedIds.includes(id)) input.checked = true;

      const span = document.createElement("span");
      span.textContent = String(s.name || "");

      label.appendChild(input);
      label.appendChild(span);
      boxEl.appendChild(label);
    });
}

// escape for attribute
function escapeAttr_(v){
  return String(v ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function saveProductEdit_(orig){
  const id = _editingProductId_;
  if (!id) return;
  const _keepProductPage = Number(productPage || 1);

  const name = document.getElementById("edit-name")?.value.trim();
  const sku  = document.getElementById("edit-sku")?.value.trim();
  const unit = document.getElementById("edit-unit")?.value.trim();
  const price = safeNum(document.getElementById("edit-price")?.value);
  const safety_stock = safeNum(document.getElementById("edit-safety")?.value);
  const category = document.getElementById("edit-category")?.value.trim();
  const expiry_date = document.getElementById("edit-expiry")?.value.trim() || "";

  const supBox = document.getElementById("edit-suppliers-box");
  const selectedIds = supBox ? Array.from(supBox.querySelectorAll('input[name="edit-product-supplier"]:checked')).map(i => String(i.value).trim()).filter(Boolean) : [];
  const supplier_ids = selectedIds.join(",");

  if (!name) return alert("請填寫商品名稱");
  if (!supplier_ids) return alert("請至少勾選 1 個供應商（代碼）");

  const wantStockRaw = document.getElementById("edit-setstock")?.value;
  const wantStockTrim = String(wantStockRaw ?? "").trim();
  const desired = wantStockTrim === "" ? null : Number(wantStockTrim);
  if (desired !== null && isNaN(desired)) return alert("調整庫存請輸入數字或留空");

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const _applyEditedProductLocal_ = (finalStock) => {
    try {
      const idx = (adminProducts || []).findIndex(x => String(x?.id || "") === String(id));
      if (idx >= 0) {
        const prev = adminProducts[idx] || {};
        const next = { ...prev };
        next.sku = sku;
        next.supplier_ids = supplier_ids;
        next.name = name;
        next.category = category;
        next.unit = unit;
        next.price = price;
        next.safety_stock = safety_stock;
        next.expiry_date = expiry_date;
        if (finalStock !== undefined && finalStock !== null && !isNaN(Number(finalStock))) {
          next.stock = Number(finalStock);
        }
        // 盡量同步供應商名稱（若 suppliers 已載入）
        try {
          const ids = String(supplier_ids || "").split(",").map(x => x.trim()).filter(Boolean);
          const names = ids.map(sid => {
            const hit = (suppliers || []).find(s => String(s.id || s.supplier_id || "") === sid);
            return hit ? String(hit.name || hit.supplier_name || "") : "";
          }).filter(Boolean);
          if (names.length) {
            next.supplier_names = names.join(",");
            next.supplier_name = names[0];
          }
        } catch(e) {}
        adminProducts[idx] = next;
        try { LS.set("products", adminProducts); } catch(e) {}
      }

      // 立即重繪目前頁，讓使用者不用等後端重新讀取才看到變更
      productFlashId = String(_editingProductId_ || "");
      if (isSectionActive_("product-section")) {
        const kw = (document.getElementById("searchInput")?.value || "").trim();
        if (kw) searchProducts();
        else renderAdminProducts(adminProducts, _keepProductPage);
      }

      // 若進貨頁正在使用商品/供應商配對，也同步更新前端索引
      try { buildSupplierProductIndex_(true); } catch(e) {}
      if (isSectionActive_("purchase-section")) {
        try { refreshAllPurchaseRows_(); } catch(e) {}
      }
    } catch (e) {
      console.error("apply edited product local failed", e);
    }
  };


  const _finishProductEdit_ = (message, opts = {}) => {
    const reloadLedger = !!opts.reloadLedger;
    const hasFinalStock = Object.prototype.hasOwnProperty.call(opts, "finalStock");
    const finalStock = hasFinalStock ? opts.finalStock : undefined;

    closeProductEditModal_();
    alert(message || "更新完成");

    // 先本地立即更新 + 高亮（體感快）
    _applyEditedProductLocal_(finalStock);

    // 後端資料再背景同步，避免等待造成卡頓
    setTimeout(() => {
      try { loadAdminProducts(true, _keepProductPage); } catch(e) { console.error("reload products after edit failed", e); }
      if (reloadLedger) {
        try { loadLedger(true); } catch(e) { console.error("reload ledger after edit failed", e); }
      }
      // loadAdminProducts 內部已會 scheduleDashboardRefresh_，這裡不重複 refreshDashboard()
    }, 30);
  };

  // 先更新主檔（不含 stock/cost）
  gas({
    type: "manageProduct",
    action: "update",
    id,
    sku,
    supplier_ids,
    name,
    category,
    unit,
    price,
    safety_stock,
    expiry_date
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "更新商品失敗（後端寫入未成功）");
      return;
    }

    // 沒有調整庫存：直接完成
    if (desired === null) {
      LS.del("products");
      _finishProductEdit_("更新完成");
      return;
    }

    const before = Number(orig.stock || 0);
    const delta = desired - before;
    if (delta === 0) {
      LS.del("products");
      _finishProductEdit_("更新完成（庫存未變更）", { finalStock: before });
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
      _finishProductEdit_("更新完成（已記錄操作紀錄）", { reloadLedger: true, finalStock: desired });
    });
  });
}

function editProduct(id) {
  openProductEditModal_(id);
}


function onProductAction_(id, action){
  if (!id) return;
  if (action === "edit") return editProduct(id);
  if (action === "delete") return deleteProduct(id);
  if (action === "image") return viewProductImage(id);
  if (action === "history") return viewProductHistory(id);
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

    loadAdminProducts(true, _keepProductPage);
    alert(res?.message || "刪除完成");
  });
}

// ------------------ 供應商 ------------------
function bindCustomerEvents(){
  document.getElementById("cus-add")?.addEventListener("click", addCustomer);
}

function bindSupplierEvents() {
  document.getElementById("sup-add")?.addEventListener("click", addSupplier);
}

function loadCustomers(force=false){
  return new Promise(resolve => {
    const cached = LS.get("customers", null);
    if (!force && Array.isArray(cached) && cached.length) {
      customers = cached;
      if (isSectionActive_("customer-section")) renderCustomers(customers, 1);
      resolve(customers);
      return;
    }
    gas({ type: "customers" }, res => {
      const list = normalizeList(res);
      customers = list;
      if (list.length) LS.set("customers", list);
      if (isSectionActive_("customer-section")) renderCustomers(list, 1);
      resolve(customers);
    });
  });
}

function renderCustomers(list, page=1){
  customerPage = page;
  const tbody = document.querySelector("#customer-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / customersPerPage));
  customerPage = Math.min(customerPage, totalPages);

  const start = (customerPage - 1) * customersPerPage;
  const end = start + customersPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id ?? ""}</td>
      <td>${c.name ?? ""}</td>
      <td>${c.phone ?? ""}</td>
      <td>${c.address ?? ""}</td>
      <td class="row-actions">
        <button onclick="deleteCustomer('${c.id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("customer-pagination", totalPages, i => renderCustomers(list, i), customerPage);
}

function addCustomer(){
  const name = document.getElementById("cus-name")?.value.trim();
  const phone = document.getElementById("cus-phone")?.value.trim() || "";
  const address = document.getElementById("cus-address")?.value.trim() || "";
  if (!name) return alert("請輸入客戶名稱");

  gas({
    type: "manageCustomer",
    action: "add",
    name,
    phone,
    address
  }, res => {
    if (!res || res.status !== "ok") return alert(res?.message || "新增客戶失敗");
    LS.del("customers");
    loadCustomers(true);
    // 清空
    document.getElementById("cus-name").value = "";
    if (document.getElementById("cus-phone")) document.getElementById("cus-phone").value = "";
    if (document.getElementById("cus-address")) document.getElementById("cus-address").value = "";
    alert("新增客戶成功");
  });
}

function deleteCustomer(id){
  if (!confirm("確定要刪除此客戶？")) return;
  gas({ type: "manageCustomer", action: "delete", id }, res => {
    if (!res || res.status !== "ok") return alert(res?.message || "刪除失敗");
    LS.del("customers");
    loadCustomers(true);
  });
}

window.deleteCustomer = deleteCustomer;

function fillCustomerSelect_(keyword=""){
  const sel = document.getElementById("so-customer-select");
  if (!sel) return;

  const list = customers.length ? customers : LS.get("customers", []);
  const kw = String(keyword || "").trim().toLowerCase();

  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "__manual__";
  opt0.textContent = "（自訂輸入）";
  sel.appendChild(opt0);

  (list || [])
    .filter(c => {
      if (!kw) return true;
      return String(c.name || "").toLowerCase().includes(kw) || String(c.id || "").toLowerCase().includes(kw);
    })
    .slice(0, 80)
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.id} - ${c.name}`;
      sel.appendChild(opt);
    });
}

function loadSuppliers(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("suppliers", null);

    // 快速路徑：先用快取（避免每次進入進貨/銷貨都要等後端）
    if (!force && Array.isArray(cached) && cached.length) {
      suppliers = cached;
      // 不論在哪個頁面，都要刷新下拉/checkbox（這些很輕量）
      fillSupplierSelect();
      fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box"));
      // 只有在「供應商管理」頁才渲染表格（避免大量 DOM 操作拖慢載入）
      if (isSectionActive_("supplier-section")) renderSuppliers(suppliers, 1);
      resolve(suppliers);
      // 不直接 return：繼續背景抓最新，避免供應商快取過期造成前端顯示舊資料/空白
    }

    // 後端抓最新
    gas({ type: "suppliers" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        suppliers = Array.isArray(cached) ? cached : [];
        if (!suppliers.length) alert("供應商資料載入失敗（後端未回傳/尚未建立工作表 suppliers）");
      } else {
        suppliers = list;
        LS.set("suppliers", list); // cache only
      }

      if (isSectionActive_("supplier-section")) renderSuppliers(suppliers, supplierPage || 1);
      fillSupplierSelect();
      fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box"));

      // 若商品編輯彈窗已開啟，刷新供應商勾選清單（保留目前已勾選）
      const __editSupBox = document.getElementById("edit-suppliers-box");
      if (__editSupBox) {
        const __checked = Array.from(__editSupBox.querySelectorAll('input[name="edit-product-supplier"]:checked'))
          .map(el => String(el.value || "").trim())
          .filter(Boolean);
        try { fillSupplierCheckboxesForEdit_(__editSupBox, __checked); } catch(e) {}
      }

      // 更新供應商後，同步刷新進貨頁供應商→商品配對索引
      try { buildSupplierProductIndex_(true); } catch(e) {}
      if (isSectionActive_("purchase-section")) {
        try { refreshAllPurchaseRows_(); } catch(e) {}
      }

      // 商品主檔供應商名稱顯示依賴 suppliers；刷新後重繪避免顯示空白
      if (isSectionActive_("product-section")) {
        try {
          const __kw = (document.getElementById("searchInput")?.value || "").trim();
          if (__kw) searchProducts();
          else renderAdminProducts(adminProducts, productPage || 1);
        } catch(e) {}
      }

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

function fillProductSupplierCheckboxes(boxEl){
  if (!boxEl) return;
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  boxEl.innerHTML = "";
  if (!list.length){
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "（尚無供應商，請先新增）";
    boxEl.appendChild(div);
    return;
  }
  list.forEach(s => {
    const id = String(s.id);
    const label = document.createElement("label");
    label.className = "chk";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "new-product-supplier";
    input.value = id;

    const span = document.createElement("span");
    span.textContent = String(s.name || "");

    label.appendChild(input);
    label.appendChild(span);
    boxEl.appendChild(label);
  });
}

function fillSupplierSelect(selectEl) {
  // 兼容：不帶參數時，填入所有需要的供應商下拉（舊版只有 #po-supplier；新版進貨行用 .po-supplier）
  const targets = [];
  if (selectEl) {
    targets.push(selectEl);
  } else {
    const legacy = document.getElementById("po-supplier");
    if (legacy) targets.push(legacy);
    document.querySelectorAll("select.po-supplier").forEach(s => targets.push(s));
  }

  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  targets.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = "";
    if (sel.classList && sel.classList.contains("po-supplier")) {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "請選擇供應商";
      sel.appendChild(ph);
    }
    const usable = (list || []).filter(s => String(s?.id || "").trim());
    if (!usable.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（尚無供應商，請先新增）";
      sel.appendChild(opt);
      return;
    }
    usable.forEach(s => {
      const sid = String(s.id).trim();
      const opt = document.createElement("option");
      opt.value = sid;
      opt.textContent = s.name || sid;
      sel.appendChild(opt);
    });
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

  const tbody = document.querySelector("#po-items-table tbody");
  if (tbody && tbody.children.length === 0) addPurchaseRow();

  try { refreshAllPurchaseRows_(); } catch(e) { console.error(e); }

  if (!window.__purchaseFormBound__) {
    window.__purchaseFormBound__ = true;

    document.getElementById("po-add-row")?.addEventListener("click", addPurchaseRow);
    document.getElementById("po-submit")?.addEventListener("click", submitPurchase);

    document.getElementById("po-add-supplier")?.addEventListener("click", () => {
      document.querySelector('.sidebar a[data-target="supplier-section"]')?.click();
    });

    document.getElementById("po-search")?.addEventListener("input", searchPurchases);
    document.getElementById("po-reload")?.addEventListener("click", () => {
      LS.del("purchases");
      loadPurchases(true);
    });

    // 委派監聽：供應商切換時刷新該列商品（保底）
    if (!window.__purchaseDelegatedBound__) {
      window.__purchaseDelegatedBound__ = true;
      document.addEventListener("change", (ev) => {
        const t = ev.target;
        if (t && t.classList && t.classList.contains("po-supplier")) {
          const tr = t.closest("tr");
          try { buildSupplierProductIndex_(true); } catch(e) {}
          refreshPurchaseRowProducts_(tr);
        }
      }, true);
    }
  }
}
function initPickupForm(){
  const dateEl = document.getElementById("pu-date");
  if (dateEl && !dateEl.value) dateEl.value = todayISO();

  const tbody = document.querySelector("#pu-items-table tbody");
  if (tbody && tbody.children.length === 0) addPickupRow();

  document.getElementById("pu-add-row")?.addEventListener("click", addPickupRow);
  document.getElementById("pu-submit")?.addEventListener("click", submitPickup);

  document.getElementById("pu-search")?.addEventListener("input", searchPickups);
  document.getElementById("pu-reload")?.addEventListener("click", () => {
    LS.del("pickups");
    loadPickups(true);
  });
}

function addPickupRow() {
  const tbody = document.querySelector("#pu-items-table tbody");
  if (!tbody) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <div class="combo-wrap">
        <input type="text" class="pu-product-combo admin-input combo-input" placeholder="搜尋商品（料號/名稱）" autocomplete="off" />
        <div class="combo-menu"></div>
      </div>
      <input type="hidden" class="pu-product-id" value="" />
    </td>
    <td><input type="number" class="pu-qty admin-input" value="1" style="min-width:90px" /></td>
    <td><input type="number" class="pu-cost admin-input" value="0" style="min-width:110px" readonly /></td>
    <td class="pu-subtotal">0</td>
    <td><button class="pu-del">刪除</button></td>
  `;

  tbody.appendChild(tr);

  const inputEl = tr.querySelector(".pu-product-combo");
  const menuEl = tr.querySelector(".combo-menu");
  const hiddenId = tr.querySelector(".pu-product-id");
  const costEl = tr.querySelector(".pu-cost");

  setupCombo_(inputEl, menuEl, (kw) => getProductOptions_(kw, "", true), (picked) => {
    hiddenId.value = String(picked.value || "");
    const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
    inputEl.value = String(p?.name || "");
    if (p && costEl) costEl.value = safeNum(p.cost ?? p.purchase_price ?? 0);
    recalcPickupRow(tr);
  }, {
    minChars: 0,
    maxShow: 40,
    onInputClear: () => { hiddenId.value = ""; if (costEl) costEl.value = 0; }
  });

  tr.querySelector(".pu-qty")?.addEventListener("input", () => recalcPickupRow(tr));
  tr.querySelector(".pu-del")?.addEventListener("click", () => {
    tr.remove();
    calcPickupTotal();
  });

  recalcPickupRow(tr);
}

function recalcPickupRow(tr){
  const pid = tr.querySelector(".pu-product-id")?.value || "";
  const qty = safeNum(tr.querySelector(".pu-qty")?.value, 0);
  const cost = safeNum(tr.querySelector(".pu-cost")?.value, 0);

  // 顯示庫存不足提醒（不阻擋；送出時後端會再驗）
  const p = (adminProducts || []).find(x => String(x.id) === String(pid));
  const stock = safeNum(p?.stock, 0);
  if (pid && qty > stock) {
    tr.style.outline = "2px solid rgba(220,38,38,.35)";
  } else {
    tr.style.outline = "";
  }

  const sub = qty * cost;
  tr.querySelector(".pu-subtotal").textContent = money(sub);
  calcPickupTotal();
}

function calcPickupTotal(){
  const rows = Array.from(document.querySelectorAll("#pu-items-table tbody tr"));
  let total = 0;
  rows.forEach(tr => {
    const qty = safeNum(tr.querySelector(".pu-qty")?.value, 0);
    const cost = safeNum(tr.querySelector(".pu-cost")?.value, 0);
    total += qty * cost;
  });
  const el = document.getElementById("pu-total");
  if (el) el.textContent = money(total);
  return total;
}

function collectPickupItems() {
  const rows = Array.from(document.querySelectorAll("#pu-items-table tbody tr"));
  const items = [];
  rows.forEach(tr => {
    const pid = tr.querySelector(".pu-product-id")?.value || "";
    const p = (adminProducts || []).find(x => String(x.id) === String(pid));
    const qty = Number(tr.querySelector(".pu-qty")?.value || 0);
    const cost = Number(tr.querySelector(".pu-cost")?.value || 0);
    if (!pid || !p || !qty || qty <= 0) return;
    items.push({
      product_id: pid,
      product_name: p.name || "",
      qty: qty,
      cost: cost
    });
  });
  return items;
}

function submitPickup(){
  const date = document.getElementById("pu-date")?.value || todayISO();
  const dept = document.getElementById("pu-dept")?.value.trim() || "";
  const receiver = document.getElementById("pu-receiver")?.value.trim() || "";
  const note = document.getElementById("pu-note")?.value.trim() || "";

  if (!dept) return alert("請填寫領用單位／門市");

  const items = collectPickupItems();
  if (!items.length) return alert("請至少新增一個品項");

  // 先在前端做一次庫存檢查（送出時後端也會再驗）
  for (const it of items) {
    const p = (adminProducts || []).find(x => String(x.id) === String(it.product_id));
    const stock = safeNum(p?.stock, 0);
    if (stock < safeNum(it.qty,0)) {
      return alert(`庫存不足：${p?.name || it.product_name} 目前庫存 ${stock}，欲領用 ${it.qty}`);
    }
  }

  const total = calcPickupTotal();
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const payload = {
    date,
    department: dept,
    receiver,
    note,
    total,
    items,
    operator
  };

  gas({
    type: "managePickup",
    action: "add",
    pickup: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "領貨失敗（後端寫入未成功）");
      return;
    }

    LS.del("pickups");
    LS.del("products");
    LS.del("stockLedger");

    // 清空表單（保留日期/單位）
    const tbody = document.querySelector("#pu-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addPickupRow();
    calcPickupTotal();
    if (document.getElementById("pu-receiver")) document.getElementById("pu-receiver").value = "";
    if (document.getElementById("pu-note")) document.getElementById("pu-note").value = "";

    loadAdminProducts(true);
    loadPickups(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || "領貨完成");
  });
}

function loadPickups(force = false){
  return new Promise(resolve => {
    gas({ type: "pickups" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        pickups = LS.get("pickups", []);
        if (!pickups.length) alert("領貨資料載入失敗（後端未回傳/尚未建立工作表 pickups）");
      } else {
        pickups = list;
        LS.set("pickups", list);
      }
      renderPickups(pickups, 1);
      resolve(pickups);
    });
  });
}

function renderPickups(list, page = 1){
  pickupPage = page;
  const tbody = document.querySelector("#pu-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / pickupsPerPage));
  pickupPage = Math.min(pickupPage, totalPages);

  const start = (pickupPage - 1) * pickupsPerPage;
  const end = start + pickupsPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(pu => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${pu.pickup_id ?? ""}</td>
      <td>${dateOnly(pu.date)}</td>
      <td>${pu.department ?? ""}</td>
      <td>${pu.receiver ?? ""}</td>
      <td>$${money(pu.total)}</td>
      <td class="row-actions">
        <button onclick="viewPickup('${pu.pickup_id}')">查看</button>
        <button onclick="deletePickup('${pu.pickup_id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("pu-pagination", totalPages, i => renderPickups(list, i), pickupPage);
}

function searchPickups(){
  const keyword = (document.getElementById("pu-search")?.value || "").trim().toLowerCase();
  const list = pickups || [];
  const filtered = list.filter(pu =>
    String(pu.pickup_id || "").toLowerCase().includes(keyword) ||
    String(pu.department || "").toLowerCase().includes(keyword) ||
    String(pu.receiver || "").toLowerCase().includes(keyword)
  );
  renderPickups(filtered, 1);
}

function viewPickup(pickupId){
  const pu = (pickups || []).find(x => String(x.pickup_id) === String(pickupId));
  if (!pu) return alert("找不到領貨單");
  const items = Array.isArray(pu.items) ? pu.items : (typeof pu.items === "string" ? (()=>{try{return JSON.parse(pu.items)}catch(e){return []}})() : []);
  const lines = (items || []).map(it => `${it.product_name || ""} × ${it.qty || 0}（成本 ${money(it.cost || 0)}）`).join("\n");
  alert(`領貨單：${pu.pickup_id}\n日期：${dateOnly(pu.date) || ""}\n單位：${pu.department || ""}\n領貨人：${pu.receiver || ""}\n備註：${pu.note || ""}\n\n品項：\n${lines || "（無）"}`);
}

function deletePickup(pickupId){
  if (!confirm("確定要刪除這張領貨單？（不回滾庫存，建議用沖銷/調整）")) return;
  gas({ type: "managePickup", action: "delete", pickup_id: pickupId }, res => {
    if (!res || res.status !== "ok") return alert(res?.message || "刪除失敗");
    LS.del("pickups");
    loadPickups(true);
    alert(res?.message || "已刪除");
  });
}

function addPurchaseRow() {
  const tbody = document.querySelector("#po-items-table tbody");
  if (!tbody) return;

  ensurePurchaseDataReady_().then(ok => {
    if (!ok) {
      alert("進貨管理載入失敗：供應商/商品資料未就緒");
      return;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="combo-wrap">
          <input type="text" class="po-product-combo admin-input combo-input" placeholder="請先選擇供應商" autocomplete="off" disabled />
          <div class="combo-menu"></div>
        </div>
        <input type="hidden" class="po-product-id" value="" />
      </td>
      <td class="po-unit">-</td>
      <td><select class="po-supplier admin-select"></select></td>
      <td><input type="number" class="po-qty admin-input" value="1" style="min-width:90px" /></td>
      <td><input type="number" class="po-cost admin-input" value="0" style="min-width:110px" /></td>
      <td class="po-subtotal">0</td>
      <td><button class="po-del">刪除</button></td>
    `;

    tbody.appendChild(tr);

    const supSel = tr.querySelector(".po-supplier");
    const inputEl = tr.querySelector(".po-product-combo");
    const menuEl = tr.querySelector(".combo-menu");
    const hiddenId = tr.querySelector(".po-product-id");
    const unitCell = tr.querySelector(".po-unit");
    const qty = tr.querySelector(".po-qty");
    const cost = tr.querySelector(".po-cost");
    const sub = tr.querySelector(".po-subtotal");

    fillSupplierSelect(supSel);

    const clearProduct = () => {
      hiddenId.value = "";
      inputEl.value = "";
      unitCell.textContent = "-";
      cost.value = 0;
      sub.textContent = "0";
    };

    const syncSubtotal = () => {
      const subtotal = (Number(qty.value || 0) * Number(cost.value || 0));
      sub.textContent = fmtMoney_(subtotal);
      updatePurchaseTotal();
    };

    const applyProduct = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = (adminProducts || []).find(x => String(x.id) === String(pid));
      unitCell.textContent = p?.unit || "-";
      if (p && Number(cost.value || 0) === 0) cost.value = Number(p.cost || 0);
      syncSubtotal();
    };

    supSel.addEventListener("change", () => {
      const supplierId = String(supSel.value || "").trim();
      clearProduct();
      if (!supplierId) {
        inputEl.disabled = true;
        inputEl.placeholder = "請先選擇供應商";
        return;
      }
      inputEl.disabled = false;
      inputEl.placeholder = "搜尋商品（料號/名稱）";
    });

    setupCombo_(inputEl, menuEl, (kw) => {
      const supplierId = String(supSel.value || "").trim();
      if (!supplierId) return { items: [], hint: "請先選擇供應商" };
      return getProductOptions_(kw, supplierId, false);
    }, (picked) => {
      hiddenId.value = String(picked.value || "");
      const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
      inputEl.value = String(p?.name || "");
      applyProduct();
    }, {
      minChars: 0,
      maxShow: 40,
      onInputClear: () => { hiddenId.value = ""; }
    });

    qty.addEventListener("input", syncSubtotal);
    cost.addEventListener("input", syncSubtotal);

    tr.querySelector(".po-del")?.addEventListener("click", () => {
      tr.remove();
      updatePurchaseTotal();
    });

    // 初始化狀態
    inputEl.disabled = !String(supSel.value || "").trim();
  });
}

function supplierNameById_(sid){
  const id = String(sid || "").trim();
  if (!id) return "";
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  const s = (list || []).find(x => String(x.id) === id);
  return s ? (s.name || "") : "";
}

function primarySupplierName_(p){
  const ids = parseSupplierIds_(p);
  return supplierNameById_(ids[0] || "");
}

function parseSupplierIds_(p){
  if (!p) return [];
  // 只解析「供應商代碼/ID」欄位；不使用中文名稱比對
  const rawMulti = String(p.supplier_ids || "").trim();
  const rawSingle = String(p.supplier_id || "").trim();

  const raw = rawMulti || rawSingle;
  if (!raw) return [];
  return raw.split(",").map(s => String(s).trim()).filter(Boolean);
}
function hasSupplier_(p, supplierId){
  // 嚴格：只用供應商代碼/ID 比對；空值一律視為不符合
  const sid = String(supplierId || "").trim();
  if (!sid) return false;
  const ids = parseSupplierIds_(p);
  if (!ids.length) return false;
  return ids.includes(sid);
}

function getProductOptions_(kw, supplierId, includeStock){
  kw = String(kw || "").trim().toLowerCase();
  supplierId = supplierId ? String(supplierId).trim() : "";
  const list = adminProducts.length ? adminProducts : LS.get("products", []);

  let base = list || [];
  if (supplierId){
    buildSupplierProductIndex_();
    base = (supplierProductIndex_ && supplierProductIndex_[supplierId]) ? supplierProductIndex_[supplierId] : base.filter(p => hasSupplier_(p, supplierId));
  }

  const MAX_SHOW = 80;

  // 點擊/聚焦時：若尚未輸入關鍵字，先顯示前 N 筆（可再輸入縮小範圍）
  if (!kw){
    return (base || []).slice(0, MAX_SHOW).map(p => {
      const sku = p.sku ?? p.part_no ?? p.code ?? "";
      const name = p.name ?? "";
      const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
      return { value: String(p.id), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
    });
  }

  const items = (base || [])
    .filter(p => {
      const sku = String(p.sku ?? p.part_no ?? p.code ?? "").toLowerCase();
      const name = String(p.name ?? "").toLowerCase();
      return sku.includes(kw) || name.includes(kw);
    })
    .slice(0, MAX_SHOW)
    .map(p => {
      const sku = p.sku ?? p.part_no ?? p.code ?? "";
      const name = p.name ?? "";
      const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
      return { value: String(p.id), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
    });

  return items;
}

function refillProductSelect_(selectEl, arg1=null, arg2=null, arg3=null){
  if (!selectEl) return;
  const prev = String(selectEl.value || "");
  fillProductSelect(selectEl, arg1, arg2, arg3);
  if (prev && Array.from(selectEl.options).some(o => String(o.value) === prev)) {
    selectEl.value = prev;
  }
}

function fillProductSelect(selectEl, arg1=null, arg2=null, arg3=null) {
  if (!selectEl) return;

  // 兼容舊呼叫：
  // - fillProductSelect(sel, true) => includeStock
  // - fillProductSelect(sel, true, keyword) => includeStock + keyword
  // - fillProductSelect(sel, supplierId, includeStock) => supplier filter
  // - fillProductSelect(sel, supplierId, includeStock, keyword) => supplier + keyword
  let supplierId = null;
  let includeStock = false;
  let keyword = "";

  if (typeof arg1 === "boolean") {
    includeStock = arg1;
    keyword = (typeof arg2 === "string") ? arg2 : "";
  } else {
    supplierId = (arg1 === undefined || arg1 === null) ? null : String(arg1).trim();
    includeStock = !!arg2;
    keyword = (typeof arg3 === "string") ? arg3 : "";
  }

  keyword = String(keyword || "").trim().toLowerCase();

  const list = adminProducts.length ? adminProducts : LS.get("products", []);
  selectEl.innerHTML = "";

  // 嚴格配對：若指定 supplierId，僅顯示該供應商代碼擁有的商品（以代碼核對）
  let filtered = [];
  if (supplierId) {
    if (supplierProductIndex_ && supplierProductIndex_[supplierId]) {
      filtered = supplierProductIndex_[supplierId];
    } else {
      filtered = (list || []).filter(p => hasSupplier_(p, supplierId));
    }
  } else {
    filtered = list || [];
  }

  // 關鍵字篩選（sku/name）
  if (keyword) {
    filtered = filtered.filter(p => {
      const sku = String(p.sku ?? p.part_no ?? p.code ?? "").toLowerCase();
      const name = String(p.name ?? "").toLowerCase();
      return sku.includes(keyword) || name.includes(keyword);
    });
  }

  if (!filtered.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = supplierId ? "（此供應商尚無商品）" : "（尚無商品，請先新增）";
    selectEl.appendChild(opt);
    return;
  }

  // 大量品項：未輸入關鍵字時限制顯示數量，避免下拉過長
  const MAX_SHOW = 80;
  let showList = filtered;
  if (!keyword && filtered.length > MAX_SHOW) {
    const hint = document.createElement("option");
    hint.value = "";
    hint.textContent = `（請輸入關鍵字搜尋，已顯示前 ${MAX_SHOW} 筆）`;
    selectEl.appendChild(hint);
    showList = filtered.slice(0, MAX_SHOW);
  }

  showList.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    const sku = p.sku ?? p.part_no ?? p.code ?? "";
    const name = p.name ?? "";
    const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
    opt.textContent = sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}`;
    selectEl.appendChild(opt);
  });
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

function updatePurchaseTotal(){
  // 兼容：舊版事件綁定使用 updatePurchaseTotal
  return calcPurchaseTotal();
}


function collectPurchaseItems() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  const supList = suppliers.length ? suppliers : LS.get("suppliers", []);
  return rows
    .map(tr => {
      const pid = tr.querySelector(".po-product-id")?.value || "";
      const p = (adminProducts || []).find(x => String(x.id) === String(pid)) || {};
      const qty = safeNum(tr.querySelector(".po-qty")?.value);
      const cost = safeNum(tr.querySelector(".po-cost")?.value);
      const supId = tr.querySelector(".po-supplier")?.value || "";
      const supObj = supList.find(s => String(s.id) === String(supId));
      return {
        product_id: pid,
        product_name: p.name || "",
        qty,
        cost,
        supplier_id: String(supId || "").trim(),
        supplier_name: supObj?.name || "",
        unit: p.unit || "",
        sku: p.sku || ""
      };
    })
    .filter(it => it.product_id && it.supplier_id && it.qty > 0);
}

function submitPurchase() {
  const date = document.getElementById("po-date")?.value || todayISO();

  const items = collectPurchaseItems();
  if (!items.length) return alert("請至少新增一個品項");

  const missingSup = items.find(it => !String(it.supplier_id || "").trim());
  if (missingSup) return alert("每個品項都必須選擇供應商");

// 嚴格驗證：每筆商品必須屬於該供應商（只用供應商代碼比對；不使用中文名稱）
for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const pid = String(it.product_id || "").trim();
  const sid = String(it.supplier_id || "").trim();
  if (!pid || !sid) return alert("每個品項都必須選擇供應商與商品（不可空白）");
  const p = adminProducts.find(x => String(x.id) === String(pid));
  if (!p) return alert(`找不到商品：${pid}`);
  if (!hasSupplier_(p, sid)) return alert(`供應商與商品不匹配：供應商=${sid} / 商品=${it.product_name || pid}`);
}

  const total = calcPurchaseTotal();

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  // 進貨單層級供應商：若多供應商則標記 MULTI（列表已不顯示供應商，但後端仍保留欄位）
  const uniqSupIds = Array.from(new Set(items.map(it => String(it.supplier_id || "").trim()).filter(Boolean)));
  const uniqSupNames = Array.from(new Set(items.map(it => String(it.supplier_name || "").trim()).filter(Boolean)));
  const headerSupplierId = (uniqSupIds.length === 1) ? uniqSupIds[0] : "MULTI";
  const headerSupplierName = (uniqSupNames.length === 1) ? uniqSupNames[0] : "多供應商";

  const payload = {
    date,
    supplier_id: headerSupplierId,
    supplier_name: headerSupplierName,
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

    // 清空表單（保留日期）
    const tbody = document.querySelector("#po-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addPurchaseRow();
    calcPurchaseTotal();

    loadAdminProducts(true);
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || `進貨完成：${res?.po_id || ""}`);
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
      sku: it.sku || "",
      unit: it.unit || "",
      qty: it.qty,
      cost: it.cost,
      note: `${it.supplier_name || purchase.supplier_name || ""} 進貨`
    });
  });
  LS.set("stockLedger", led);
}

function loadPurchases(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("purchases", null);

    if (!force && Array.isArray(cached) && cached.length) {
      purchases = cached;
      if (isSectionActive_("purchase-section")) renderPurchases(purchases, 1);
      scheduleDashboardRefresh_();
      resolve(purchases);
      // 背景抓最新，但不阻塞 UI
      setTimeout(() => {
        gas({ type: "purchases" }, res => {
          const list = normalizeList(res);
          if (Array.isArray(list) && list.length) {
            purchases = list;
            LS.set("purchases", list);
            if (isSectionActive_("purchase-section")) renderPurchases(list, 1);
            scheduleDashboardRefresh_();
          }
        });
      }, 0);
      return;
    }

    gas({ type: "purchases" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        purchases = Array.isArray(cached) ? cached : [];
        if (!purchases.length) alert("進貨資料載入失敗（後端未回傳/尚未建立工作表 purchases）");
      } else {
        purchases = list;
        LS.set("purchases", list); // cache only
      }

      if (isSectionActive_("purchase-section")) renderPurchases(purchases, 1);
      scheduleDashboardRefresh_();
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
      <td>${dateOnly(po.date)}</td>
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
    String(po.po_id || "").toLowerCase().includes(keyword)
  );
  renderPurchases(filtered, 1);
}

function viewPurchase(poId) {
  const po = (purchases || []).find(p => String(p.po_id) === String(poId));
  if (!po) return alert("找不到進貨單");

  const items = Array.isArray(po.items) ? po.items : [];
  const rows = items.map(it => `
    <tr>
      <td>${it.product_name ?? ""}</td>
      <td>${it.unit ?? ""}</td>
      <td>${it.supplier_name ?? po.supplier_name ?? ""}</td>
      <td>${money(it.qty)}</td>
      <td>${money(it.cost)}</td>
    </tr>
  `).join("");

  const body = `
    <table class="doc-kv">
      <tbody>
        <tr>
          <th>日期</th><td>${dateOnly(po.date)}</td>
          <th>單號</th><td>${po.po_id ?? ""}</td>
        </tr>
      </tbody>
    </table>

    <div style="overflow:auto; border:1px solid rgba(0,0,0,.08); border-radius:12px;">
      <table class="admin-table doc-items">
        <thead>
          <tr>
            <th>商品</th>
            <th>單位</th>
            <th>供應商</th>
            <th>數量</th>
            <th>成本</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5">（無品項）</td></tr>`}
        </tbody>
      </table>
    </div>

    <div style="display:flex; justify-content:flex-end; margin-top:10px; font-weight:800;">
      合計：$${money(po.total)}
    </div>
  `;
  openPoModal(`進貨單查看`, body);
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
function initCustomerCombo_(){
  const inputEl = document.getElementById("so-customer-combo");
  const menuEl = document.getElementById("so-customer-menu");
  const hiddenId = document.getElementById("so-customer-id");
  const phoneEl = document.getElementById("so-phone");
  const addressEl = document.getElementById("so-address");
  if (!inputEl || !menuEl || !hiddenId) return;

  const getOptions = (kw) => {
    const list = customers.length ? customers : LS.get("customers", []);
    const key = String(kw || "").trim().toLowerCase();
    if (!key) {
      // 不輸入就不展開，避免太長
      return { items: [], hint: "請輸入關鍵字搜尋" };
    }
    const items = (list || [])
      .filter(c => {
        const id = String(c.id || "").toLowerCase();
        const name = String(c.name || "").toLowerCase();
        return id.includes(key) || name.includes(key);
      })
      .slice(0, 40)
      .map(c => ({ value: String(c.id || ""), label: `${c.id} - ${c.name}` }));
    return items;
  };

  setupCombo_(inputEl, menuEl, getOptions, (picked) => {
    const list = customers.length ? customers : LS.get("customers", []);
    const c = (list || []).find(x => String(x.id) === String(picked.value));
    hiddenId.value = String(picked.value || "");
    inputEl.value = String(c?.name || "");
    if (phoneEl && c) phoneEl.value = c.phone || "";
    if (addressEl && c) addressEl.value = c.address || "";
  }, {
    minChars: 1,
    maxShow: 40,
    onInputClear: () => {
      hiddenId.value = "";
    }
  });
}

function bindOrderEvents() {
  document.getElementById("order-search")?.addEventListener("input", searchOrders);
  document.getElementById("status-filter")?.addEventListener("change", searchOrders);
  document.getElementById("reload-orders")?.addEventListener("click", () => {
    LS.del("orders");
    loadOrders(true);
  });

  // ---- 新增銷貨單（後台出庫）----
  initCustomerCombo_();

  document.getElementById("so-add-row")?.addEventListener("click", addSaleRow);
  document.getElementById("so-submit")?.addEventListener("click", submitSale);

}

function loadOrders(force = false) {
  const cached = LS.get("orders", null);
  if (!force && Array.isArray(cached) && cached.length) {
    ordersState = cached;
    if (isSectionActive_("order-section")) renderOrders(cached, 1);
    scheduleDashboardRefresh_();
    return;
  }

  gas({ type: "orders" }, res => {
    const list = normalizeList(res);
    ordersState = list;
    if (list.length) LS.set("orders", list);
    if (isSectionActive_("order-section")) renderOrders(list, 1);
    scheduleDashboardRefresh_();
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
      <td>${dateOnly(o.date)}</td>
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
      if (isSectionActive_("ledger-section")) renderLedger(ledger, 1);
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

      if (isSectionActive_("ledger-section")) renderLedger(ledger, 1);
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

const toTs = (v) => {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return 0;
  // yyyy-mm-dd or yyyy-mm-dd hh:mm:ss
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m){
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0);
    return new Date(y, mo, d, hh, mm, ss).getTime();
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? 0 : dt.getTime();
};

const sorted = [...(list || [])].sort((a,b) => {
  const at = toTs(a.ts ?? a.time ?? a.datetime ?? a.date ?? "");
  const bt = toTs(b.ts ?? b.time ?? b.datetime ?? b.date ?? "");
  return bt - at; // 新到舊
});

  const totalPages = Math.max(1, Math.ceil(sorted.length / ledgerPerPage));
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
    if (r.includes("pickup")) return "領貨";
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
  sorted.slice(start, end).forEach(l => {
    const qty = (l.qty !== undefined) ? l.qty : (l.change !== undefined ? l.change : 0);
    const qtyNum = safeNum(qty, 0);
    const qtyText = (qtyNum > 0 ? `+${money(qtyNum)}` : `${money(qtyNum)}`);
    const costRaw = (l.cost ?? l.unit_cost ?? l.cost_price ?? "");
    const costText = (costRaw === "" || costRaw === null || costRaw === undefined) ? "" : money(safeNum(costRaw, 0));

    const skuText = String(l.sku ?? l.product_sku ?? l.item_sku ?? l.part_no ?? l.code ?? "");
    const unitText = String(l.unit ?? l.unit_name ?? l.uom ?? "");

    const tr = document.createElement("tr");
    tr.dataset.type = codeOf(l);
    tr.innerHTML = `
      <td>${dateTimeText(l.ts ?? l.time ?? l.datetime ?? l.date ?? "")}</td>
      <td>${l.type_label ?? labelOf(l)}</td>
      <td>${skuText}</td>
      <td>${l.doc_no ?? l.ref ?? l.ref_id ?? ""}</td>
      <td>${l.product_name ?? ""}</td>
      <td>${qtyText}</td>
      <td>${unitText}</td>
      <td>${costText}</td>
      <td>${userNameOnly(l.operator ?? l.user ?? l.member_id ?? "")}</td>
      <td>${l.target ?? l.counterparty ?? l.note ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("ledger-pagination", totalPages, i => renderLedger(sorted, i), ledgerPage);
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



let historyProductId = "";
let historyProductSku = "";
let historyProductName = "";

/** 產品歷史：以 stock_ledger 為資料源，並嘗試優先走 productLedger API（若後端尚未更新則回退 stockLedger）。 */
function viewProductHistory(productId){
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const p = (list || []).find(x => String(x.id) === String(productId));
  historyProductId = String(productId);
  historyProductSku = String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "");
  historyProductName = p?.name ? String(p.name) : "";
  openHistoryModal(historyProductName || "商品");
  loadHistoryForCurrentProduct();
}

function ensurePoModalWired_(){
  const m = document.getElementById("poModal");
  const closeBtn = document.getElementById("poModalClose");
  if (!m || !closeBtn) return;
  if (m.dataset.wired === "1") return;

  closeBtn.addEventListener("click", closePoModal);
  m.addEventListener("click", (e) => {
    // 點背景關閉
    if (e.target === m) closePoModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && m.classList.contains("show")) closePoModal();
  });

  m.dataset.wired = "1";
}

function openPoModal(title, bodyHtml){
  const m = document.getElementById("poModal");
  const t = document.getElementById("poModalTitle");
  const b = document.getElementById("poModalBody");
  if (!m || !t || !b) return alert(bodyHtml?.replace(/<[^>]+>/g,"") || title || "");
  ensurePoModalWired_();
  t.textContent = title || "進貨單";
  b.innerHTML = bodyHtml || "";
  m.classList.add("show");
  m.setAttribute("aria-hidden","false");
}
function closePoModal(){
  const m = document.getElementById("poModal");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden","true");
}


function openHistoryModal(title){
  const modal = document.getElementById("historyModal");
  const ttl = document.getElementById("historyModalTitle");
  if (!modal) return;
  ttl && (ttl.textContent = `商品歷史庫存：${title}`);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("no-scroll");
}

function closeHistoryModal(){
  const modal = document.getElementById("historyModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("no-scroll");
}

function parseMaybeDateTime_(s){
  if (!s) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  // "yyyy-MM-dd HH:mm:ss" -> make it ISO-ish
  const isoLike = str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str;
  const t = Date.parse(isoLike);
  return isNaN(t) ? 0 : t;
}

function historyTypeLabel_(x){
  const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
  if (code === "IN") return "進貨";
  if (code === "OUT") return "出貨";
  if (code === "ADJ") return "調整";
  const r = String(x.reason || "").toLowerCase();
  if (r.includes("purchase")) return "進貨";
  if (r.includes("sale")) return "出貨";
    if (r.includes("pickup")) return "領貨";
  if (String(x.ref_id || x.ref || "") === "ADJ") return "調整";
  return x.type_label || code || "—";
}

function historyDocNo_(x){
  return x.doc_no ?? x.ref ?? x.ref_id ?? "";
}

function historyCostText_(x){
  if (!x) return "";
  const v = x.cost ?? x.unit_cost ?? x.unitCost ?? x.item_cost ?? x.itemCost ?? "";
  const n = Number(v);
  if (!isFinite(n) || v === "" || v === null || v === undefined) return "";
  return safeNum(n);
}

function historyQtyText_(x){
  const qty = (x.qty !== undefined) ? x.qty : (x.change !== undefined ? x.change : 0);
  const n = safeNum(qty, 0);
  return (n > 0 ? `+${money(n)}` : `${money(n)}`);
}

function loadHistoryForCurrentProduct(){
  const pid = historyProductId;
  const sku = (historyProductSku || "").trim();
  if (!pid && !sku) return;

  const from = document.getElementById("histFrom")?.value || "";
  const to = document.getElementById("histTo")?.value || "";

  const tbody = document.getElementById("histTbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8">載入中…</td></tr>`;
  }

  // 1) 優先呼叫新 API：productLedger（若後端未更新，會回傳 error）
  gas({ type: "productLedger", sku, product_id: pid, from, to, limit: 500 }, res => {
    if (res?.status === "ok" && Array.isArray(res.data)) {
      renderHistoryRows(res.data);
      return;
    }
    // 2) 回退：抓全量 stockLedger 後在前端過濾
    gas({ type: "stockLedger" }, res2 => {
      const all = normalizeList(res2);
      const filtered = (all || []).filter(x => {
        const xs = String(x.sku || x.product_sku || x.item_sku || "").trim();
        if (sku && xs && xs === sku) return true;
        // fallback for old records
        return String(x.product_id || x.id || "").trim() === String(pid).trim();
      });
      renderHistoryRows(filtered, from, to);
    });
  });
}

function renderHistoryRows(list, from="", to=""){
  const tbody = document.getElementById("histTbody");
  if (!tbody) return;

  let rows = Array.isArray(list) ? list.slice() : [];

  // 日期篩選（from/to 是 yyyy-MM-dd）
  if (from) {
    const ft = Date.parse(from + "T00:00:00");
    rows = rows.filter(x => parseMaybeDateTime_(x.ts || x.time || x.datetime || x.date) >= ft);
  }
  if (to) {
    const tt = Date.parse(to + "T23:59:59");
    rows = rows.filter(x => parseMaybeDateTime_(x.ts || x.time || x.datetime || x.date) <= tt);
  }

  // 依時間倒序
  rows.sort((a,b) => parseMaybeDateTime_(b.ts || b.time || b.datetime || b.date) - parseMaybeDateTime_(a.ts || a.time || a.datetime || a.date));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">查無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  rows.slice(0, 500).forEach(x => {
    const tr = document.createElement("tr");
    const unitText = String(x.unit ?? x.unit_name ?? x.uom ?? "");
    tr.innerHTML = `
      <td>${dateOnly(x.ts ?? x.time ?? x.datetime ?? x.date ?? "")}</td>
      <td>${x.type_label ?? historyTypeLabel_(x)}</td>
      <td>${historyDocNo_(x)}</td>
      <td>${historyQtyText_(x)}</td>
      <td>${unitText}</td>
      <td>${historyCostText_(x)}</td>
      <td>${userNameOnly(x.operator ?? x.user ?? x.member_id ?? "")}</td>
      <td>${x.target ?? x.counterparty ?? x.note ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function initHistoryModal(){
  const modal = document.getElementById("historyModal");
  const btnClose = document.getElementById("historyModalClose");
  const btnRefresh = document.getElementById("histRefresh");
  if (!modal) return;

  btnClose?.addEventListener("click", closeHistoryModal);
  btnRefresh?.addEventListener("click", loadHistoryForCurrentProduct);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeHistoryModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeHistoryModal();
  });
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
  initHistoryModal();

  bindProductEvents();
  bindOrderEvents();
  bindSupplierEvents();
  bindCustomerEvents();
  bindLedgerEvents();
  bindReportEvents();

  // 預設：先用快取快速顯示 KPI，再背景更新資料（避免首次載入很久）
try { refreshDashboard(); } catch(e) {}

// 背景更新資料：先供應商 → 再商品（確保進貨頁供應商帶入商品可比對）
Promise.all([loadSuppliers(), loadAdminProducts()]).then(() => {
  scheduleDashboardRefresh_();
// 商品編輯 Modal：關閉
document.getElementById("productEditModalClose")?.addEventListener("click", closeProductEditModal_);
document.getElementById("productEditModal")?.addEventListener("click", (e) => {
  if (e.target && e.target.id === "productEditModal") closeProductEditModal_();
// 新增商品 Modal：關閉
document.getElementById("productAddModalClose")?.addEventListener("click", closeProductAddModal_);
document.getElementById("productAddModal")?.addEventListener("click", (e) => {
  if (e.target && e.target.id === "productAddModal") closeProductAddModal_();
});
});
});

});

// ------------------ 掛到全域（供 onclick 使用） ------------------
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.showItems = showOrderItems;
window.updateOrder = updateOrder;
window.deleteOrder = deleteOrder;
window.editSupplier = editSupplier;
window.deleteSupplier = deleteSupplier;
window.viewPurchase = viewPurchase;
window.deletePurchase = deletePurchase;
window.viewPickup = viewPickup;
window.deletePickup = deletePickup;


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
    <td>
      <div class="combo-wrap">
        <input type="text" class="so-product-combo admin-input combo-input" placeholder="搜尋商品（料號/名稱）" autocomplete="off" />
        <div class="combo-menu"></div>
      </div>
      <input type="hidden" class="so-product-id" value="" />
    </td>
    <td><input type="number" class="so-qty admin-input" value="1" style="min-width:90px" /></td>
    <td><input type="number" class="so-price admin-input" value="0" style="min-width:110px" /></td>
    <td class="so-subtotal">0</td>
    <td><button class="so-del">刪除</button></td>
  `;
  tbody.appendChild(tr);

  const inputEl = tr.querySelector(".so-product-combo");
  const menuEl = tr.querySelector(".combo-menu");
  const hiddenId = tr.querySelector(".so-product-id");
  const priceEl = tr.querySelector(".so-price");

  setupCombo_(inputEl, menuEl, (kw) => getProductOptions_(kw, "", true), (picked) => {
    hiddenId.value = String(picked.value || "");
    // 顯示名稱（不塞 ID）
    const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
    inputEl.value = String(p?.name || "");
    // 初次帶出售價
    if (p && priceEl && (!priceEl.value || Number(priceEl.value) === 0)) {
      priceEl.value = safeNum(p.price);
    }
    recalcSaleRow(tr);
  }, {
    minChars: 0,
    maxShow: 40,
    onInputClear: () => { hiddenId.value = ""; }
  });

  tr.querySelector(".so-qty")?.addEventListener("input", () => recalcSaleRow(tr));
  tr.querySelector(".so-price")?.addEventListener("input", () => recalcSaleRow(tr));
  tr.querySelector(".so-del")?.addEventListener("click", () => {
    tr.remove();
    calcSaleTotal();
  });

  recalcSaleRow(tr);
}

function recalcSaleRow(tr) {
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
    const pid = tr.querySelector(".so-product-id")?.value || "";
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
  const phone = document.getElementById("so-phone")?.value.trim() || "";
  const address = document.getElementById("so-address")?.value.trim() || "";
  const customer = document.getElementById("so-customer-combo")?.value.trim() || "";
  const customer_id = document.getElementById("so-customer-id")?.value.trim() || "";
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
    customer_id: customer_id,
    phone,
    address,
    remark: note,
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
    const ci = document.getElementById("so-customer-combo");
    const cid = document.getElementById("so-customer-id");
    if (ci) ci.value = "";
    if (cid) cid.value = "";
    if (document.getElementById("so-phone")) document.getElementById("so-phone").value = "";
    if (document.getElementById("so-address")) document.getElementById("so-address").value = "";
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
