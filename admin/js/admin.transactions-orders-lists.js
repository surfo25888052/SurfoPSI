let deliverySettingsState = LS.get("deliverySettings", { driver_name:"", driver_phone:"", sales_phone:"", sales_name:"" });
let currentOrderDocId = "";


function purchaseHasDetail_(po) {
  return !!(po && Number(po.items_loaded || 0) && Array.isArray(po.items));
}

function mergePurchaseSummariesWithCache_(list, cacheList) {
  const detailMap = {};
  (Array.isArray(cacheList) ? cacheList : []).forEach(po => {
    const poId = String(po?.po_id || "").trim();
    if (!poId) return;
    if (purchaseHasDetail_(po)) detailMap[poId] = po;
  });
  return (Array.isArray(list) ? list : []).map(po => {
    const poId = String(po?.po_id || "").trim();
    const hit = detailMap[poId];
    return hit ? { ...po, items: hit.items, items_loaded: 1, item_count: Array.isArray(hit.items) ? hit.items.length : Number(po.item_count || 0) } : po;
  });
}

function upsertPurchaseLocal_(po) {
  if (!po || !String(po.po_id || "").trim()) return null;
  const next = { ...po };
  if (Array.isArray(next.items)) {
    next.items_loaded = 1;
    next.item_count = next.items.length;
  }

  const list = Array.isArray(purchases) && purchases.length ? [...purchases] : [...LS.get("purchases", [])];
  const idx = list.findIndex(x => String(x?.po_id || "") === String(next.po_id || ""));
  if (idx >= 0) list[idx] = { ...list[idx], ...next };
  else list.unshift(next);

  purchases = list;
  LS.set("purchases", list);
  if (isSectionActive_("purchase-section")) renderPurchases(list, purchasePage || 1);
  scheduleDashboardRefresh_();
  return next;
}
window.upsertPurchaseLocal_ = upsertPurchaseLocal_;

function fetchPurchaseDetail_(poId, done) {
  const targetId = String(poId || "").trim();
  const cached = (purchases || []).find(p => String(p?.po_id || "") === targetId) || (LS.get("purchases", []).find(p => String(p?.po_id || "") === targetId));
  if (purchaseHasDetail_(cached)) {
    done(cached, { status: "ok", cached: 1 });
    return;
  }

  gas({ type: "purchases", po_id: targetId, detail: 1 }, res => {
    const list = normalizeList(res);
    const fetched = (Array.isArray(list) ? list : []).find(p => String(p?.po_id || "") === targetId) || null;
    const po = (fetched && Array.isArray(fetched.items)) ? fetched : (purchaseHasDetail_(cached) ? cached : null);
    if (po && Array.isArray(po.items)) {
      po.items_loaded = 1;
      po.item_count = po.items.length;
      upsertPurchaseLocal_(po);
    }
    done(po, res);
  }, 35000);
}
window.fetchPurchaseDetail_ = fetchPurchaseDetail_;

function applyPurchaseToLocalStock(purchase) {
  // 1) 產品庫存加回
  const plist = LS.get("products", adminProducts);

  purchase.items.forEach(it => {
    const idx = plist.findIndex(p => String(p.id) === String(it.product_id));
    if (idx >= 0) {
      plist[idx].stock = safeNum(plist[idx].stock) + safeNum(it.qty);
      // 同步成本
      if (safeNum(it.cost) > 0) plist[idx].cost = safeNum(it.cost);
      // 同步最近進貨日 / 有效日期（本地快取）
      const poDate = String(purchase.date || "").slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
        const oldD = String(plist[idx].last_purchase_date || "").slice(0,10);
        if (!oldD || oldD < poDate) plist[idx].last_purchase_date = poDate;
      }
      const expD = String(it.expiry_date || "").slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(expD)) plist[idx].expiry_date = expD;
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
    }, 35000);
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
        gas({ type: "purchases", summary: 1 }, res => {
          const list = normalizeList(res);
          if (Array.isArray(list) && list.length) {
            const merged = mergePurchaseSummariesWithCache_(list, Array.isArray(cached) ? cached : purchases);
            purchases = merged;
            LS.set("purchases", merged);
            if (isSectionActive_("purchase-section")) renderPurchases(merged, 1);
            scheduleDashboardRefresh_();
          }
        }, 35000);
      }, 0);
      return;
    }

    gas({ type: "purchases", summary: 1 }, res => {
      const list = normalizeList(res);
      const status = String(res?.status || "").toLowerCase();

      if (Array.isArray(list) && list.length) {
        const merged = mergePurchaseSummariesWithCache_(list, Array.isArray(cached) ? cached : purchases);
        purchases = merged;
        LS.set("purchases", merged); // cache only
      } else {
        purchases = Array.isArray(cached) ? cached : [];

        // 僅在明確 timeout/error 且沒有快取時提示；status=ok + 空陣列視為「目前無資料」
        if (!purchases.length && (status === "timeout" || status === "error")) {
          alert(`進貨資料載入失敗：${res?.message || "API 無回應"}`);
        }
      }

      if (isSectionActive_("purchase-section")) renderPurchases(purchases, 1);
      scheduleDashboardRefresh_();
      resolve(purchases);
    }, 35000);
  });
}

function renderPurchases(list, page = 1) {
  const sortedList = [...(list || [])].sort((a,b) => {
    const da = String(dateOnly(a?.date || a?.created_at || "") || "");
    const db = String(dateOnly(b?.date || b?.created_at || "") || "");
    if (da !== db) return db.localeCompare(da);
    const ia = String(a?.po_id || a?.purchase_id || "");
    const ib = String(b?.po_id || b?.purchase_id || "");
    return ib.localeCompare(ia);
  });
  purchasePage = page;
  const tbody = document.querySelector("#po-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(sortedList.length / purchasesPerPage));
  purchasePage = Math.min(purchasePage, totalPages);

  const start = (purchasePage - 1) * purchasesPerPage;
  const end = start + purchasesPerPage;

  const pageList = sortedList.slice(start, end);

  tbody.innerHTML = "";
  pageList.forEach(po => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${po.po_id ?? ""}</td>
      <td>${dateOnly(po.date)}</td>
      <td>${po.form_no ? `${po.form_no} ${po.form_name || ""}` : ""}</td>
      <td>${po.status ?? "待驗收"}</td>
      <td>${po.source_order_id ?? ""}</td>
      <td>$${money(po.total)}</td>
      <td class="row-actions">
        <button onclick="viewPurchase('${po.po_id}')">查看</button>
        <button onclick="editPurchase('${po.po_id}')">編輯</button>
        <button onclick="printPurchase('${po.po_id}')">列印</button>
        <button onclick="deletePurchase('${po.po_id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("po-pagination", totalPages, i => renderPurchases(sortedList, i), purchasePage);
}

function searchPurchases() {
  const keyword = (document.getElementById("po-search")?.value || "").trim().toLowerCase();
  const list = purchases || [];
  const filtered = list.filter(po =>
    String(po.po_id || "").toLowerCase().includes(keyword) ||
    String(po.source_order_id || "").toLowerCase().includes(keyword) ||
    String(po.status || "").toLowerCase().includes(keyword)
  );
  renderPurchases(filtered, 1);
}

function viewPurchase(poId) {
  fetchPurchaseDetail_(poId, (po, res) => {
    if (!po) return alert(res?.message || "找不到進貨單");

    const body = (typeof buildPurchaseDocHtml_ === "function")
      ? buildPurchaseDocHtml_(po)
      : `<pre>${JSON.stringify(po, null, 2)}</pre>`;
    openPoModal(`採購驗收單查看`, body);
  });
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
  initOrderDocModal_();

  document.getElementById("so-add-row")?.addEventListener("click", addSaleRow);
  document.getElementById("so-submit")?.addEventListener("click", submitSale);

}

function bindSettingEvents(){
  document.getElementById("setting-save-delivery")?.addEventListener("click", saveSystemSettings_);
  document.getElementById("setting-reload-delivery")?.addEventListener("click", () => loadSystemSettings_(true));
  loadSystemSettings_();
}

function getSettingInputValue_(id){
  return String(document.getElementById(id)?.value || "").trim();
}

function fillSystemSettingsForm_(map){
  const driverName = document.getElementById("setting-driver-name");
  const driverPhone = document.getElementById("setting-driver-phone");
  const salesPhone = document.getElementById("setting-sales-phone");
  const salesName = document.getElementById("setting-sales-name");
  if (driverName) driverName.value = String(map?.driver_name || "");
  if (driverPhone) driverPhone.value = String(map?.driver_phone || "");
  if (salesPhone) salesPhone.value = String(map?.sales_phone || "");
  if (salesName) salesName.value = String(map?.sales_name || "");
}

function loadSystemSettings_(force = false){
  const cached = LS.get("deliverySettings", null);
  if (!force && cached && typeof cached === "object") {
    deliverySettingsState = { ...deliverySettingsState, ...cached };
    fillSystemSettingsForm_(deliverySettingsState);
  }
  gas({ type: "systemSettings" }, res => {
    if (res?.status && String(res.status).toLowerCase() === "error") {
      if (!cached) fillSystemSettingsForm_(deliverySettingsState || {});
      return;
    }
    const data = (res && (res.settings || res.data || res.map)) || {};
    deliverySettingsState = {
      driver_name: String(data.driver_name || ""),
      driver_phone: String(data.driver_phone || ""),
      sales_phone: String(data.sales_phone || ""),
      sales_name: String(data.sales_name || "")
    };
    LS.set("deliverySettings", deliverySettingsState);
    fillSystemSettingsForm_(deliverySettingsState);
    if (currentOrderDocId) {
      const preview = document.getElementById("orderDocPreview");
      const order = findOrderById_(currentOrderDocId);
      if (preview && order) preview.innerHTML = buildOrderDocHtml_(order, deliverySettingsState);
    }
  });
}

function saveSystemSettings_(){
  const payload = {
    driver_name: getSettingInputValue_("setting-driver-name"),
    driver_phone: getSettingInputValue_("setting-driver-phone"),
    sales_phone: getSettingInputValue_("setting-sales-phone"),
    sales_name: getSettingInputValue_("setting-sales-name")
  };
  gas({ type: "manageSystemSettings", action: "save", settings: JSON.stringify(payload) }, res => {
    if (res?.status && String(res.status).toLowerCase() === "error") {
      alert(res?.message || "儲存設定失敗");
      return;
    }
    deliverySettingsState = { ...payload };
    LS.set("deliverySettings", deliverySettingsState);
    fillSystemSettingsForm_(deliverySettingsState);
    alert(res?.message || "系統設定已儲存");
  });
}

function initOrderDocModal_(){
  const modal = document.getElementById("orderDocModal");
  if (!modal || modal.dataset.bound === "1") return;
  modal.dataset.bound = "1";
  const close = () => closeOrderDocModal_();
  document.getElementById("orderDocModalClose")?.addEventListener("click", close);
  document.getElementById("orderDocCloseBtn")?.addEventListener("click", close);
  document.getElementById("orderDocPrintBtn")?.addEventListener("click", () => {
    if (currentOrderDocId) printOrderDoc(currentOrderDocId);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) close();
  });
}

function openOrderDocModal_(){
  const modal = document.getElementById("orderDocModal");
  if (!modal) return;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeOrderDocModal_(){
  const modal = document.getElementById("orderDocModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
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
  const sortedOrders = [...(orders || [])].sort((a,b) => {
    const da = String(dateOnly(a?.date || a?.created_at || "") || "");
    const db = String(dateOnly(b?.date || b?.created_at || "") || "");
    if (da !== db) return db.localeCompare(da);
    const ia = String(a?.order_id || "");
    const ib = String(b?.order_id || "");
    return ib.localeCompare(ia);
  });
  const tbody = document.querySelector("#admin-order-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / ordersPerPage));
  orderPage = Math.min(page, totalPages);

  const start = (orderPage - 1) * ordersPerPage;
  const end = start + ordersPerPage;

  const pageOrders = sortedOrders.slice(start, end);

  tbody.innerHTML = pageOrders.map(o => `
    <tr>
      <td>${o.order_id ?? ""}</td>
      <td>${dateOnly(o.date)}</td>
      <td>${o.name ?? ""}</td>
      <td>${o.phone ?? ""}</td>
      <td>$${money(o.total)}</td>
      <td class="row-actions">
        <button onclick="showOrderDoc('${o.order_id}')">查看</button>
        <button onclick="printOrderDoc('${o.order_id}')">列印</button>
      </td>
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

function findOrderById_(orderId){
  const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
  return (orders || []).find(x => String(x.order_id) === String(orderId)) || null;
}

function parseOrderItems_(order){
  let items = order?.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e) {}
  }
  if (!Array.isArray(items)) items = [];
  return items;
}

function formatDeliveryDate_(v){
  const s = dateOnly(v || "");
  if (!s) return "";
  return s.replace(/-/g, ".");
}

function getDeliverySettings_(){
  return deliverySettingsState || LS.get("deliverySettings", {}) || {};
}

function deliveryDocPrintStyles_(){
  return `
  <style>
    body{ margin:0; padding:16px; background:#fff; color:#2d2a55; font-family:"Microsoft JhengHei","PingFang TC",sans-serif; }
    .delivery-doc-sheet{ border:2px solid #7a73b4; padding:16px 18px 18px; }
    .delivery-doc-head{ text-align:center; margin-bottom:10px; }
    .delivery-doc-org{ font-size:24px; font-weight:700; letter-spacing:.18em; margin-bottom:6px; }
    .delivery-doc-title{ font-size:34px; font-weight:800; letter-spacing:.22em; }
    .delivery-doc-top{ display:grid; grid-template-columns:1.1fr .9fr .7fr; gap:18px; align-items:start; margin-bottom:10px; }
    .delivery-doc-lines,.delivery-doc-side{ display:grid; gap:6px; font-size:15px; line-height:1.5; }
    .delivery-doc-line{ display:flex; gap:8px; }
    .delivery-doc-label{ white-space:nowrap; font-weight:700; }
    .delivery-doc-value{ flex:1; min-width:0; word-break:break-word; }
    .delivery-doc-table{ width:100%; border-collapse:collapse; table-layout:fixed; border:2px solid #7a73b4; margin-top:8px; }
    .delivery-doc-table th,.delivery-doc-table td{ border:2px solid #7a73b4; padding:8px 8px; font-size:15px; line-height:1.35; vertical-align:top; }
    .delivery-doc-table th{ text-align:center; font-weight:700; }
    .delivery-doc-table td.num{ text-align:right; white-space:nowrap; }
    .delivery-doc-table td.center{ text-align:center; }
    .delivery-doc-table .col-sku{ width:12%; }
    .delivery-doc-table .col-name{ width:32%; }
    .delivery-doc-table .col-qty{ width:10%; }
    .delivery-doc-table .col-unit{ width:6%; }
    .delivery-doc-table .col-price{ width:12%; }
    .delivery-doc-table .col-subtotal{ width:12%; }
    .delivery-doc-table .col-note{ width:16%; }
    .delivery-doc-foot{ display:grid; grid-template-columns:1.25fr .75fr; border-left:2px solid #7a73b4; border-right:2px solid #7a73b4; border-bottom:2px solid #7a73b4; }
    .delivery-doc-remark,.delivery-doc-totalbox{ min-height:138px; padding:12px 12px 10px; }
    .delivery-doc-remark{ border-right:2px solid #7a73b4; font-size:14px; line-height:1.6; }
    .delivery-doc-totalbox{ display:flex; flex-direction:column; gap:10px; justify-content:flex-end; }
    .delivery-doc-sumline{ display:flex; justify-content:flex-end; gap:16px; font-size:15px; }
    .delivery-doc-sumline.total{ font-size:28px; font-weight:800; letter-spacing:.08em; }
    .delivery-doc-sign{ display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:18px; margin-top:18px; font-size:15px; }
    .delivery-doc-empty td{ height:34px; }
    @page{ size:A4 landscape; margin:8mm; }
    html,body{ background:#fff; }
    @media print{ body{ padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  </style>`;
}

function buildOrderDocHtml_(order, settings = {}, printMode = false){
  if (!order) return '<div class="muted">查無出貨單資料</div>';
  const items = parseOrderItems_(order);
  const rows = items.map((it, idx) => {
    const name = String(it.product_name || it.name || it.ProductName || it.product || `品項${idx + 1}`);
    const sku = String(it.sku || it.SKU || it.item_no || "");
    const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity ?? 0, 0);
    const unit = String(it.unit || it.Unit || "");
    const price = safeNum(it.price ?? it.UnitPrice ?? it.unit_price ?? 0, 0);
    const subtotal = safeNum(it.subtotal ?? it.Subtotal ?? (qty * price), 0);
    const note = String(it.note || it.memo || "");
    return `
      <tr>
        <td class="center">${escapeHtml_(sku)}</td>
        <td>${escapeHtml_(name)}</td>
        <td class="num">${qty ? money(qty) : ""}</td>
        <td class="center">${escapeHtml_(unit)}</td>
        <td class="num">${price ? money(price) : ""}</td>
        <td class="num">${subtotal ? money(subtotal) : ""}</td>
        <td>${escapeHtml_(note)}</td>
      </tr>`;
  });
  const minRows = 9;
  while (rows.length < minRows) {
    rows.push('<tr class="delivery-doc-empty"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  }
  const total = getOrderTotal(order);
  return `
    <div class="delivery-doc-sheet">
      <div class="delivery-doc-head">
        <div class="delivery-doc-org">社團法人屏東縣社會福利聯盟</div>
        <div class="delivery-doc-title">出貨單</div>
      </div>
      <div class="delivery-doc-top">
        <div class="delivery-doc-lines">
          <div class="delivery-doc-line"><span class="delivery-doc-label">客戶名稱：</span><span class="delivery-doc-value">${escapeHtml_(order.name || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">公司電話：</span><span class="delivery-doc-value">${escapeHtml_(order.phone || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">送貨地址：</span><span class="delivery-doc-value">${escapeHtml_(order.address || "")}</span></div>
        </div>
        <div class="delivery-doc-side">
          <div class="delivery-doc-line"><span class="delivery-doc-label">司機姓名：</span><span class="delivery-doc-value">${escapeHtml_(settings.driver_name || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">司機電話：</span><span class="delivery-doc-value">${escapeHtml_(settings.driver_phone || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">業務手機：</span><span class="delivery-doc-value">${escapeHtml_(settings.sales_phone || "")}</span></div>
        </div>
        <div class="delivery-doc-side right">
          <div class="delivery-doc-line"><span class="delivery-doc-label">出貨日期：</span><span class="delivery-doc-value">${escapeHtml_(formatDeliveryDate_(order.date))}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">出貨單號：</span><span class="delivery-doc-value">${escapeHtml_(order.order_id || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">業務姓名：</span><span class="delivery-doc-value">${escapeHtml_(settings.sales_name || "")}</span></div>
        </div>
      </div>
      <table class="delivery-doc-table">
        <thead>
          <tr>
            <th class="col-sku">物品編號</th>
            <th class="col-name">物品名稱</th>
            <th class="col-qty">數量</th>
            <th class="col-unit">單位</th>
            <th class="col-price">單價</th>
            <th class="col-subtotal">小計</th>
            <th class="col-note">備註</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <div class="delivery-doc-foot">
        <div class="delivery-doc-remark">
          備註：<br>
          1. 本單資料供出貨與對帳確認使用。<br>
          2. 收貨後如有數量或品項疑問，請盡速與本單位聯繫。<br>
          3. 簽收後請妥善留存，以維護雙方權益。
        </div>
        <div class="delivery-doc-totalbox">
          <div class="delivery-doc-sumline"><span>合計：</span><span>${money(total)}</span></div>
          <div class="delivery-doc-sumline total"><span>總金額：</span><span>${money(total)}</span></div>
        </div>
      </div>
      <div class="delivery-doc-sign">
        <div><b>主管：</b></div>
        <div><b>會計：</b></div>
        <div><b>庫管：</b></div>
        <div><b>配送：</b>${escapeHtml_(settings.driver_name || "")}</div>
        <div><b>客戶：</b></div>
      </div>
    </div>`;
}

function showOrderDoc(orderId){
  const order = findOrderById_(orderId);
  if (!order) return alert("找不到該銷貨單");
  currentOrderDocId = String(orderId || "");
  const preview = document.getElementById("orderDocPreview");
  if (!preview) return;
  preview.innerHTML = buildOrderDocHtml_(order, getDeliverySettings_());
  openOrderDocModal_();
}

function printOrderDoc(orderId){
  const order = findOrderById_(orderId);
  if (!order) return alert("找不到該銷貨單");
  const html = buildOrderDocHtml_(order, getDeliverySettings_(), true);
  const w = window.open("about:blank", "_blank", "width=1180,height=860");
  if (!w || w.closed) return alert("請允許瀏覽器開啟列印視窗");
  const docHtml = `<!doctype html><html><head><meta charset="utf-8"><title>出貨單 ${escapeHtml_(order.order_id || "")}</title>${deliveryDocPrintStyles_()}</head><body>${html}<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},250);});<\/script></body></html>`;
  try {
    w.document.open();
    w.document.write(docHtml);
    w.document.close();
  } catch (err) {
    try { w.close(); } catch(e) {}
    alert("請允許瀏覽器開啟列印視窗");
  }
}

function showOrderItems(orderId) {
  return showOrderDoc(orderId);
}

window.showOrderDoc = showOrderDoc;
window.printOrderDoc = printOrderDoc;
window.showOrderItems = showOrderItems;

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
  document.getElementById("report-export-csv")?.addEventListener("click", exportInventoryCSV);
  document.getElementById("report-print-inventory")?.addEventListener("click", printInventoryReport);

  // 先用快取商品主檔渲染分類勾選（若稍後載入到最新商品，runReport 也會再更新一次）
  try {
    const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
    if (typeof ensureReportCategoryUI_ === "function") ensureReportCategoryUI_(list);
  } catch(e) {}
}

