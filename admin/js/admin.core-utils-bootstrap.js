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
    // ISO datetime（含 Z / 時區）先轉本地日期，避免顯示少一天
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const dtIso = new Date(s);
      if (!isNaN(dtIso.getTime())) return dateOnly(dtIso);
      return s.slice(0,10);
    }
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
const GAS_CALL_TIMEOUT_MS = 20000;
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

function setActiveSection_(targetId){
  const links = Array.from(document.querySelectorAll(".sidebar a"));
  links.forEach(l => l.classList.toggle("active", l.dataset.target === targetId));
  document.querySelectorAll(".content-section").forEach(sec => {
    sec.classList.toggle("active", sec.id === targetId);
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
  const supList = (Array.isArray(suppliers) && suppliers.length) ? suppliers : LS.get("suppliers", []);

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
  // 在總覽直接顯示低庫存完整明細
  try { renderLowStockDetails_(products, supList); } catch(e) { console.error("renderLowStockDetails failed", e); }
}


function renderLowStockDetails_(products, suppliersList){
  const tbody = document.getElementById("low-stock-details");
  const meta  = document.getElementById("low-stock-meta");
  if (!tbody) return;

  const suppliers = Array.isArray(suppliersList) ? suppliersList : [];
  const byId = new Map(suppliers.map(s => [String(s.id || s.supplier_id || "").trim(), s]));

  const list = (products || [])
    .filter(p => safeNum(p.stock) <= safeNum(p.safety_stock || p.safety || 0))
    .map(p => {
      const sku = String(p.sku ?? p.part_no ?? p.code ?? "").trim();
      const sid = String(p.supplier_ids || "").split(",").map(x=>x.trim()).filter(Boolean)[0] || "";
      const sObj = sid ? byId.get(sid) : null;
      const sName = sObj ? String(sObj.name || sObj.supplier_name || "") : "";
      return {
        id: String(p.id || p.product_id || "").trim(),
        sku,
        name: String(p.name || p.product_name || "").trim(),
        category: String(p.category || "").trim(),
        stock: safeNum(p.stock),
        safety: safeNum(p.safety_stock || p.safety || 0),
        unit: String(p.unit || "").trim(),
        supplier: sName || sid
      };
    })
    .sort((a,b) => (a.stock - b.stock) || (a.safety - b.safety));

  if (meta){
    meta.textContent = list.length ? `共 ${list.length} 項（依庫存由少到多）` : "目前無低庫存項目";
  }

  // 清空
  tbody.innerHTML = "";

  if (!list.length){
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.style.textAlign = "center";
    td.style.color = "#666";
    td.style.padding = "14px";
    td.textContent = "目前沒有低庫存商品 ✅";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  list.forEach(it => {
    const tr = document.createElement("tr");
    tr.dataset.productId = it.id;

    const cells = [
      it.sku || it.id,
      it.name,
      it.category,
      String(it.stock),
      String(it.safety),
      it.unit,
      it.supplier
    ];

    cells.forEach((val, idx) => {
      const td = document.createElement("td");
      td.textContent = val ?? "";
      if (idx === 3) td.classList.add("low");
      tr.appendChild(td);
    });

    const tdAct = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn-mini";
    btn.type = "button";
    btn.textContent = "查看";
    btn.addEventListener("click", () => gotoProductFromDashboard(it.id));
    tdAct.appendChild(btn);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });
}

function gotoProductFromDashboard(productId){
  const id = String(productId || "").trim();
  if (!id) return;

  // 確保供應商/商品資料在記憶體中（優先用快取）
  const products = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const idx = (products || []).findIndex(p => String(p.id || p.product_id || "").trim() === id);
  const per = Number(productsPerPage || 20);
  const page = (idx >= 0 && per > 0) ? (Math.floor(idx / per) + 1) : 1;

  productPage = page;
  productFlashId = id;

  setActiveSection_("product-section");

  Promise.all([loadSuppliers(), loadAdminProducts(false, page)]).then(() => {
    // 若有搜尋/分類條件，維持使用者狀態；否則直接顯示包含目標的頁碼
    const kw = (document.getElementById("searchInput")?.value || "").trim();
    if (kw) searchProducts(page);
    else renderAdminProducts(adminProducts, page);
  });
}

// ------------------ 商品主檔 ------------------
function bindProductEvents() {
  document.getElementById("open-add-product")?.addEventListener("click", openProductAddModal_);  document.getElementById("searchInput")?.addEventListener("input", searchProducts);
  document.getElementById("reload-products")?.addEventListener("click", () => {
    LS.del("products");
    loadAdminProducts(true);
  });
}

function loadAdminProducts(force = false, keepPageNo = null, opts = {}) {
  return new Promise(resolve => {
    const cached = LS.get("products", null);
    let resolved = false;
    const skipProductRender = !!opts.skipProductRender;
    const skipCategoryRender = !!opts.skipCategoryRender;

    // 先用快取快速畫面（但不阻止後端抓最新），避免快取造成配對永遠卡舊資料
    if (!force && Array.isArray(cached) && cached.length) {
      adminProducts = cached;
      buildSupplierProductIndex_(true);
      if (!skipProductRender && isSectionActive_("product-section")) renderAdminProducts(adminProducts, (Number.isFinite(Number(keepPageNo)) && Number(keepPageNo) > 0) ? Number(keepPageNo) : 1);
      if (!skipCategoryRender && isSectionActive_("product-section")) renderCategoryFilter(adminProducts);
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

        if (!skipProductRender && isSectionActive_("product-section")) renderAdminProducts(list, (Number.isFinite(Number(keepPageNo)) && Number(keepPageNo) > 0) ? Number(keepPageNo) : 1);
        fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box"));
        if (!skipCategoryRender && isSectionActive_("product-section")) renderCategoryFilter(list);

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
