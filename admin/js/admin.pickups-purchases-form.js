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


function ensurePickupMobileList_() {
  let el = document.getElementById("pickup-mobile-list");
  if (el) return el;
  const table = document.querySelector("#pu-table");
  if (!table || !table.parentNode) return null;
  el = document.createElement("div");
  el.id = "pickup-mobile-list";
  el.className = "record-mobile-list";
  table.insertAdjacentElement("afterend", el);
  return el;
}

function renderPickupMobileCards_(pageList){
  const wrap = ensurePickupMobileList_();
  if (!wrap) return;
  const list = Array.isArray(pageList) ? pageList : [];
  if (!list.length) {
    wrap.innerHTML = '<div class="record-mobile-empty">目前沒有領貨單資料</div>';
    return;
  }
  wrap.innerHTML = list.map(pu => {
    const pickupId = String(pu?.pickup_id || '');
    const department = String(pu?.department || '').trim() || '未指定領用單位';
    const receiver = String(pu?.receiver || '').trim() || '—';
    return `
      <div class="record-mobile-card">
        <div class="record-mobile-head">
          <div class="record-mobile-main">
            <div class="record-mobile-id">${escapeHtml_(pickupId || '領貨單')}</div>
            <div class="record-mobile-title">${escapeHtml_(department)}</div>
            <div class="record-mobile-sub">日期：${escapeHtml_(dateOnly(pu?.date) || '—')}</div>
          </div>
        </div>
        <div class="record-mobile-grid">
          <div class="record-mobile-field">
            <div class="record-mobile-label">領貨人</div>
            <div class="record-mobile-value">${escapeHtml_(receiver)}</div>
          </div>
          <div class="record-mobile-field">
            <div class="record-mobile-label">成本</div>
            <div class="record-mobile-value money">$${money(pu?.total)}</div>
          </div>
        </div>
        <div class="record-mobile-actions">
          <button class="admin-btn" type="button" onclick="viewPickup('${pickupId}')">查看</button>
          <button class="admin-btn" type="button" onclick="deletePickup('${pickupId}')">刪除</button>
        </div>
      </div>`;
  }).join('');
}

function renderPickups(list, page = 1){
  const sortedList = [...(list || [])].sort((a,b) => {
    const da = String(dateOnly(a?.date || a?.created_at || "") || "");
    const db = String(dateOnly(b?.date || b?.created_at || "") || "");
    if (da !== db) return db.localeCompare(da);
    const ia = String(a?.pickup_id || "");
    const ib = String(b?.pickup_id || "");
    return ib.localeCompare(ia);
  });
  pickupPage = page;
  const tbody = document.querySelector("#pu-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(sortedList.length / pickupsPerPage));
  pickupPage = Math.min(pickupPage, totalPages);

  const start = (pickupPage - 1) * pickupsPerPage;
  const end = start + pickupsPerPage;

  const pageList = sortedList.slice(start, end);

  tbody.innerHTML = "";
  pageList.forEach(pu => {
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

  renderPagination("pu-pagination", totalPages, i => renderPickups(sortedList, i), pickupPage);
  renderPickupMobileCards_(pageList);
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


const PURCHASE_FORM_OPTIONS_ = [
  { code: "F-02-B-01-1", name: "生鮮蔬果類" },
  { code: "F-02-B-01-2", name: "冷凍食品類" },
  { code: "F-02-B-01-3", name: "南北雜貨包材類" },
  { code: "F-02-B-01-4", name: "乾貨素料類" }
];

let purchaseEditingState_ = { po_id: "", stock_applied: 0, source_order_id: "", auto_generated: 0 };
let purchaseFormRevision_ = 0;
let purchaseSubmitLocked_ = false;

function bumpPurchaseFormRevision_(){
  purchaseFormRevision_ += 1;
  return purchaseFormRevision_;
}

function currentPurchaseFormRevision_(){
  return purchaseFormRevision_;
}

function setPurchaseSubmitLocked_(locked){
  purchaseSubmitLocked_ = !!locked;
  ["po-submit-draft","po-submit-complete","po-add-row","po-open-create-modal"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = purchaseSubmitLocked_;
  });
}

function withFreshPurchaseRows_(fn){
  const rev = bumpPurchaseFormRevision_();
  if (typeof fn === "function") fn(rev);
  return rev;
}

function removePurchaseLocalById_(poId){
  const target = String(poId || "").trim();
  if (!target) return;
  const base = Array.isArray(purchases) ? purchases : [];
  const list = (Array.isArray(base) ? base : []).filter(x => String(x?.po_id || "").trim() !== target);
  purchases = list;
}

function fetchPurchaseDetailDirect_(poId, done){
  const target = String(poId || "").trim();
  if (!target) {
    if (typeof done === "function") done(null, { status: "error", message: "缺少採購單編號" });
    return;
  }
  gas({ type: "purchases", po_id: target, detail: 1 }, res => {
    const list = normalizeList(res);
    const po = (Array.isArray(list) ? list : []).find(x => String(x?.po_id || "").trim() === target) || null;
    if (po && Array.isArray(po.items)) {
      po.items_loaded = 1;
      po.item_count = po.items.length;
      if (typeof upsertPurchaseLocal_ === "function") upsertPurchaseLocal_(po);
    }
    if (typeof done === "function") done(po, res);
  }, 45000);
}

function escapeHtml_(v){
  return String(v ?? "").replace(/[&<>"']/g, function(ch){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch] || ch;
  });
}

function getPurchaseFormName_(code){
  const hit = PURCHASE_FORM_OPTIONS_.find(x => x.code === String(code || "").trim());
  return hit ? hit.name : "";
}

function guessPurchaseFormNoByCategory_(category){
  const s = String(category || "").trim();
  if (/冷凍/.test(s)) return "F-02-B-01-2";
  if (/(乾貨|素料)/.test(s)) return "F-02-B-01-4";
  if (/(南北|雜貨|包材)/.test(s)) return "F-02-B-01-3";
  return "F-02-B-01-1";
}

function inferPurchaseFormNoByItems_(items){
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const pid = String(it.product_id || it.id || "").trim();
    const p = (adminProducts || []).find(x => String(x.id) === pid);
    if (p) return guessPurchaseFormNoByCategory_(p.category || "");
  }
  return document.getElementById("po-form-no")?.value || "F-02-B-01-1";
}

function getPurchaseReceiptDefaultDate_(){
  return "";
}

function formatQtyWithSuggested_(qty, suggested){
  const q = String(qty ?? "").trim();
  const s = String(suggested ?? "").trim();
  if (!q && !s) return "";
  if (!s) return q;
  return `${q}（${s}）`;
}

function formatQtyTextWithUnit_(value, unitText){
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const num = safeNum(raw, NaN);
  const text = Number.isFinite(num) ? num2TextSmart(num, raw) : raw;
  const unit = String(unitText || "").trim();
  return unit ? `${text} ${unit}` : text;
}

function syncPurchaseSuggestedDisplay_(rowOrTr, value, unitText){
  const tr = rowOrTr && rowOrTr.closest ? rowOrTr.closest("tr") : rowOrTr;
  if (!tr) return;
  const hiddenEl = tr.querySelector('.po-suggested-qty');
  const textEl = tr.querySelector('.po-suggested-text');
  const wrapEl = tr.querySelector('.po-suggested-hint');
  const normalized = String(value ?? "").trim();
  if (hiddenEl) hiddenEl.value = normalized;
  if (textEl) textEl.textContent = normalized ? formatQtyTextWithUnit_(normalized, unitText) : "";
  if (wrapEl) {
    wrapEl.style.display = normalized ? 'block' : 'none';
    wrapEl.setAttribute('aria-hidden', normalized ? 'false' : 'true');
  }
}

function syncPurchaseCustomerOrderDisplay_(rowOrTr, value, unitText){
  const tr = rowOrTr && rowOrTr.closest ? rowOrTr.closest("tr") : rowOrTr;
  if (!tr) return;
  const hiddenEl = tr.querySelector('.po-customer-order-qty');
  const textEl = tr.querySelector('.po-order-text');
  const wrapEl = tr.querySelector('.po-order-hint');
  const normalized = String(value ?? "").trim();
  if (hiddenEl) hiddenEl.value = normalized;
  if (textEl) textEl.textContent = normalized ? formatQtyTextWithUnit_(normalized, unitText) : "";
  if (wrapEl) {
    wrapEl.style.display = normalized ? 'block' : 'none';
    wrapEl.setAttribute('aria-hidden', normalized ? 'false' : 'true');
  }
}

function formatRocDateWithWeek_(v){
  const s = String(v || '').trim();
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const w = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()];
  return `${d.getFullYear() - 1911}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}

function checkboxText_(val){
  const s = String(val || '').trim();
  const pass = s === '合格' ? '☑' : '□';
  const fail = s === '退貨' ? '☑' : '□';
  return `${pass}合格 ${fail}退貨`;
}

function checkboxHtml_(val){
  const s = String(val || '').trim();
  const pass = s === '合格' ? '☑' : '□';
  const fail = s === '退貨' ? '☑' : '□';
  return `<span class="purchase-check-result"><span>${pass}合格</span><span>${fail}退貨</span></span>`;
}

function getPurchaseFormModalEls_(){
  return {
    modal: document.getElementById("purchaseFormModal"),
    title: document.getElementById("purchaseFormModalTitle"),
    closeBtn: document.getElementById("purchaseFormModalClose")
  };
}

function setPurchaseFormModalTitle_(title){
  const { title: titleEl } = getPurchaseFormModalEls_();
  if (titleEl) titleEl.textContent = title || "採購驗收單";
}

function ensurePurchaseFormModalWired_(){
  const { modal, closeBtn } = getPurchaseFormModalEls_();
  if (!modal || modal.dataset.wired === "1") return;
  closeBtn?.addEventListener("click", () => closePurchaseFormModal_());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closePurchaseFormModal_();
  });
  modal.dataset.wired = "1";
}

function openPurchaseFormModal_(mode = "create"){
  const { modal } = getPurchaseFormModalEls_();
  if (!modal) return;
  ensurePurchaseFormModalWired_();
  if (mode === "create") {
    resetPurchaseForm_(false);
    setPurchaseFormModalTitle_("新增採購驗收單");
  } else if (!isPurchaseEditing_()) {
    setPurchaseFormModalTitle_("編輯採購驗收單");
  }
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closePurchaseFormModal_(keepState = false){
  const { modal } = getPurchaseFormModalEls_();
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
  if (!keepState) resetPurchaseForm_(false);
}

function cancelPurchaseEditAndClose_(){
  closePurchaseFormModal_(false);
}


function updatePurchaseRowNumbers_(){
  Array.from(document.querySelectorAll("#po-items-table tbody tr")).forEach((tr, idx) => {
    const cell = tr.querySelector(".po-row-no");
    if (cell) cell.textContent = String(idx + 1);
  });
}

function syncPurchaseRowReceiveDates_(forceAll = false){
  return;
}

function setPurchaseEditingState_(po){
  purchaseEditingState_ = {
    po_id: String(po?.po_id || "").trim(),
    stock_applied: Number(po?.stock_applied || 0) ? 1 : 0,
    source_order_id: String(po?.source_order_id || "").trim(),
    auto_generated: Number(po?.auto_generated || 0) ? 1 : 0
  };
  const idEl = document.getElementById("po-current-id");
  const saEl = document.getElementById("po-current-stock-applied");
  const infoEl = document.getElementById("po-editing-info");
  const cancelEl = document.getElementById("po-cancel-edit");
  if (idEl) idEl.value = purchaseEditingState_.po_id;
  if (saEl) saEl.value = String(purchaseEditingState_.stock_applied);
  if (infoEl) {
    infoEl.style.display = purchaseEditingState_.po_id ? "inline-flex" : "none";
    infoEl.textContent = purchaseEditingState_.po_id ? `編輯中：${purchaseEditingState_.po_id}` : "";
  }
  if (cancelEl) cancelEl.style.display = purchaseEditingState_.po_id ? "inline-flex" : "none";
}

function clearPurchaseEditingState_(){
  setPurchaseEditingState_(null);
}

function isPurchaseEditing_(){
  return !!String(purchaseEditingState_.po_id || document.getElementById("po-current-id")?.value || "").trim();
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
  const rawMulti = String(p.supplier_ids || "").trim();
  const rawSingle = String(p.supplier_id || "").trim();
  const raw = rawMulti || rawSingle;
  if (!raw) return [];
  return raw.split(",").map(s => String(s).trim()).filter(Boolean);
}

function hasSupplier_(p, supplierId){
  const sid = String(supplierId || "").trim();
  if (!sid) return false;
  const ids = parseSupplierIds_(p);
  if (!ids.length) return false;
  return ids.includes(sid);
}

function getAllowedSupplierIdsForProduct_(productId){
  const pid = String(productId || "").trim();
  if (!pid) return [];
  const list = adminProducts.length ? adminProducts : LS.get("products", []);
  const p = (list || []).find(x => String(x?.id || "") === pid);
  return parseSupplierIds_(p);
}

function refillSupplierSelectForRow_(selectEl, allowedIds = null, preferredValue = ""){
  if (!selectEl) return;
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  const allowSet = Array.isArray(allowedIds) && allowedIds.length
    ? new Set((allowedIds || []).map(v => String(v || "").trim()).filter(Boolean))
    : null;
  const prev = String(preferredValue || selectEl.value || "").trim();

  selectEl.innerHTML = "";

  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = allowSet ? "請選擇對應供應商" : "請選擇供應商";
  selectEl.appendChild(ph);

  const usable = (list || [])
    .filter(s => String(s?.id || "").trim())
    .filter(s => !allowSet || allowSet.has(String(s.id).trim()));

  if (!usable.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = allowSet ? "（此商品尚無對應供應商）" : "（尚無供應商，請先新增）";
    selectEl.appendChild(opt);
    selectEl.value = "";
    return;
  }

  usable.forEach(s => {
    const sid = String(s.id).trim();
    const opt = document.createElement("option");
    opt.value = sid;
    opt.textContent = s.name || sid;
    selectEl.appendChild(opt);
  });

  if (prev && usable.some(s => String(s.id).trim() === prev)) {
    selectEl.value = prev;
  } else {
    selectEl.value = "";
  }
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

  if (!kw){
    return (base || []).slice(0, MAX_SHOW).map(p => {
      const sku = p.sku ?? p.part_no ?? p.code ?? "";
      const name = p.name ?? "";
      const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
      return { value: String(p.id), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
    });
  }

  return (base || [])
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

function decimalPlacesInput_(v){
  const s = String(v ?? "").replace(/,/g, "").trim();
  const m = s.match(/\.(\d+)$/);
  return m ? m[1].length : 0;
}

function cleanDecimalInput_(v, maxScale = 6){
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  const scale = Math.min(decimalPlacesInput_(s), maxScale);
  return Number(n.toFixed(scale));
}

function mulDecimalInput_(a, b, maxScale = 6){
  const na = Number(String(a ?? "").replace(/,/g, "").trim() || 0);
  const nb = Number(String(b ?? "").replace(/,/g, "").trim() || 0);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return 0;
  const scale = Math.min(decimalPlacesInput_(a) + decimalPlacesInput_(b), maxScale);
  return Number((na * nb).toFixed(scale));
}

function addDecimalInput_(a, b, maxScale = 6){
  const na = Number(a || 0);
  const nb = Number(b || 0);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return 0;
  const scale = Math.min(Math.max(decimalPlacesInput_(a), decimalPlacesInput_(b)), maxScale);
  return Number((na + nb).toFixed(scale));
}

function calcSuggestedQtyForProduct_(p, customerOrderQty){
  const stock = safeNum(p?.stock, 0);
  const safety = safeNum(p?.safety_stock, 0);
  const qty = safeNum(customerOrderQty, 0);
  const shortageToSafety = Math.max(0, safety - stock);
  return qty + shortageToSafety;
}

function resolvePurchaseCostInputValue_(item){
  const rawText = String(item?.cost_raw ?? "").trim();
  if (rawText) return rawText;
  const costText = String(item?.cost ?? "").trim();
  if (!costText || costText === "0" || costText === "0.0" || costText === "0.00") return "";
  return costText;
}

function addPurchaseRow(initData = {}, options = {}) {
  const tbody = document.querySelector("#po-items-table tbody");
  if (!tbody) return;
  const expectedRevision = Number(options?.revision ?? currentPurchaseFormRevision_());

  ensurePurchaseDataReady_().then(ok => {
    if (expectedRevision !== currentPurchaseFormRevision_()) return;
    if (!document.body.contains(tbody)) return;
    if (!ok) {
      alert("進貨管理載入失敗：供應商/商品資料未就緒");
      return;
    }

    const rowUid = `po-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="po-row-no"></td>
      <td>
        <div class="combo-wrap">
          <input type="text" id="${rowUid}-product-combo" name="purchase_product_combo" class="po-product-combo admin-input combo-input" placeholder="請先選擇廠商" autocomplete="off" disabled />
          <div class="combo-menu"></div>
        </div>
        <input type="hidden" id="${rowUid}-product-id" name="purchase_product_id" class="po-product-id" value="" />
      </td>
      <td class="po-spec">-</td>
      <td><select id="${rowUid}-supplier" name="purchase_supplier_id" class="po-supplier admin-select"></select></td>
      <td class="po-qty-cell">
        <div class="po-qty-main">
          <div class="po-qty-inline">
            <input type="number" id="${rowUid}-qty" name="purchase_qty" class="po-qty admin-input" value="${escapeAttr_(initData.qty ?? 1)}" min="0" step="0.01" />
            <span class="po-unit-inline"></span>
          </div>
          <div class="po-order-hint" aria-hidden="true">客戶訂單：<span class="po-order-text"></span></div>
        </div>
        <input type="hidden" id="${rowUid}-suggested-qty" name="purchase_suggested_qty" class="po-suggested-qty" value="${escapeAttr_(initData.suggested_qty ?? "")}" />
        <input type="hidden" id="${rowUid}-customer-order-qty" name="purchase_customer_order_qty" class="po-customer-order-qty" value="${escapeAttr_(((initData.customer_order_qty ?? '') !== '' && (initData.customer_order_qty ?? '') !== null) ? initData.customer_order_qty : (((initData.suggested_qty ?? '') !== '' && (initData.suggested_qty ?? '') !== null) ? (initData.qty ?? '') : ''))}" />
      </td>
      <td class="po-stock-cell"><div class="po-stock-main"><div class="po-stock-text">-</div><div class="po-suggested-hint" aria-hidden="true">建議訂購：<span class="po-suggested-text"></span></div></div></td>
      <td><input type="date" id="${rowUid}-receive-date" name="purchase_receive_date" class="po-receive-date admin-input" value="${escapeAttr_(initData.receive_date || "")}" /></td>
      <td><input type="text" id="${rowUid}-priority" name="purchase_inspection_priority" class="po-priority admin-input" value="${escapeAttr_(initData.inspection_priority || "")}" placeholder="例：1" /></td>
      <td><input type="text" id="${rowUid}-receipt-weight" name="purchase_receipt_weight" class="po-receipt-weight admin-input" value="${escapeAttr_(initData.receipt_weight || "")}" placeholder="例：12公斤" /></td>
      <td><input type="number" id="${rowUid}-cost" name="purchase_cost" class="po-cost admin-input" value="${escapeAttr_(resolvePurchaseCostInputValue_(initData))}" min="0" step="0.01" /></td>
      <td><input type="text" id="${rowUid}-accept-weight" name="purchase_accept_weight" class="po-accept-weight admin-input" value="${escapeAttr_(initData.accept_weight || "")}" placeholder="例：11.8公斤" /></td>
      <td>
        <div class="po-radio-group">
          <label for="${rowUid}-accept-pass"><input id="${rowUid}-accept-pass" type="radio" name="${rowUid}-accept" class="po-accept-result" value="合格">合格</label>
          <label for="${rowUid}-accept-return"><input id="${rowUid}-accept-return" type="radio" name="${rowUid}-accept" class="po-accept-result" value="退貨">退貨</label>
        </div>
      </td>
      <td>
        <div class="po-radio-group">
          <label for="${rowUid}-pesticide-pass"><input id="${rowUid}-pesticide-pass" type="radio" name="${rowUid}-pesticide" class="po-pesticide-result" value="合格">合格</label>
          <label for="${rowUid}-pesticide-return"><input id="${rowUid}-pesticide-return" type="radio" name="${rowUid}-pesticide" class="po-pesticide-result" value="退貨">退貨</label>
        </div>
      </td>
      <td><input type="text" id="${rowUid}-note" name="purchase_note" class="po-note admin-input" value="${escapeAttr_(initData.note || "")}" placeholder="備註" /></td>
      <td><button class="po-del" type="button">刪除</button></td>
    `;

    tbody.appendChild(tr);

    const supSel = tr.querySelector(".po-supplier");
    const inputEl = tr.querySelector(".po-product-combo");
    const menuEl = tr.querySelector(".combo-menu");
    const hiddenId = tr.querySelector(".po-product-id");
    const specCell = tr.querySelector(".po-spec");
    const receiveDateEl = tr.querySelector(".po-receive-date");
    const qtyEl = tr.querySelector(".po-qty");
    const suggestedEl = tr.querySelector(".po-suggested-qty");
    const customerOrderEl = tr.querySelector(".po-customer-order-qty");
    const costEl = tr.querySelector(".po-cost");
    const unitInlineEl = tr.querySelector(".po-unit-inline");
    const stockCellEl = tr.querySelector(".po-stock-cell");
    const stockTextEl = tr.querySelector(".po-stock-text");
    const receiptWeightEl = tr.querySelector(".po-receipt-weight");
    const acceptWeightEl = tr.querySelector(".po-accept-weight");
    const initialCostText = resolvePurchaseCostInputValue_(initData);

    const syncUnitInline = (unitText) => {
      if (!unitInlineEl) return;
      const text = String(unitText || "").trim();
      unitInlineEl.textContent = text || "";
      unitInlineEl.style.display = text ? "inline-block" : "none";
      if (receiptWeightEl) receiptWeightEl.placeholder = text ? `例：12 ${text}` : "例：12公斤";
      if (acceptWeightEl) acceptWeightEl.placeholder = text ? `例：11.8 ${text}` : "例：11.8公斤";
    };

    refillSupplierSelectForRow_(supSel);
    if (initData.supplier_id && Array.from(supSel.options).some(o => String(o.value) === String(initData.supplier_id))) {
      supSel.value = String(initData.supplier_id);
    }

    const clearProduct = () => {
      hiddenId.value = "";
      inputEl.value = "";
      if (specCell) specCell.textContent = "-";
      if (costEl) costEl.value = "";
      if (stockTextEl) stockTextEl.textContent = "-";
      refillSupplierSelectForRow_(supSel, null, supSel?.value || "");
      syncUnitInline("");
      syncPurchaseCustomerOrderDisplay_(tr, customerOrderEl?.value || "", "");
      syncPurchaseSuggestedDisplay_(tr, "", "");
    };

    const preserveStoredCostValue = () => {
      if (!costEl) return;
      if (initialCostText === "") {
        if (String(costEl.value || "").trim() === "0") costEl.value = "";
        return;
      }
      costEl.value = initialCostText;
    };

    const getCustomerOrderQtyBase = () => {
      const explicit = String(customerOrderEl?.value || "").trim();
      if (explicit) return explicit;
      return String(qtyEl?.value || "").trim();
    };

    const syncSuggested = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = (adminProducts || []).find(x => String(x.id) === pid);
      const unitText = p?.unit || initData.unit || "";
      if (!suggestedEl) return;
      syncPurchaseCustomerOrderDisplay_(tr, customerOrderEl?.value || "", unitText);
      if (!p) {
        syncPurchaseSuggestedDisplay_(tr, initData.suggested_qty ?? "", unitText);
        return;
      }
      const baseQty = getCustomerOrderQtyBase();
      const hasBase = String(baseQty || "").trim() !== "" && safeNum(baseQty, 0) > 0;
      syncPurchaseSuggestedDisplay_(tr, hasBase ? safeNum(calcSuggestedQtyForProduct_(p, baseQty), 0) : "", unitText);
    };

    const syncSubtotal = () => {
      syncSuggested();
      updatePurchaseTotal();
    };

    const applyProduct = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = (adminProducts || []).find(x => String(x.id) === pid);
      const unitText = p?.unit || initData.unit || "";
      const allowedSupplierIds = getAllowedSupplierIdsForProduct_(pid);
      if (allowedSupplierIds.length) {
        const preferredSupplierId = String(supSel.value || initData.supplier_id || "").trim();
        refillSupplierSelectForRow_(supSel, allowedSupplierIds, preferredSupplierId);
      } else {
        refillSupplierSelectForRow_(supSel, null, supSel?.value || initData.supplier_id || "");
      }
      if (specCell) specCell.textContent = p?.spec || initData.spec || "-";
      syncUnitInline(unitText);
      if (stockTextEl) {
        stockTextEl.textContent = p ? formatQtyTextWithUnit_(p.stock ?? 0, unitText) : "-";
      }
      normalizePurchaseWeightInput_(receiptWeightEl, unitText);
      normalizePurchaseWeightInput_(acceptWeightEl, unitText);
      syncSubtotal();
    };

    supSel.addEventListener("change", () => {
      const supplierId = String(supSel.value || "").trim();
      if (hiddenId.value && !hasSupplier_((adminProducts || []).find(x => String(x.id) === String(hiddenId.value)), supplierId)) {
        clearProduct();
      }
      if (!supplierId) {
        inputEl.disabled = true;
        inputEl.placeholder = "請先選擇廠商";
        return;
      }
      inputEl.disabled = false;
      inputEl.placeholder = "搜尋商品（料號/名稱）";
    });

    setupCombo_(inputEl, menuEl, (kw) => {
      const supplierId = String(supSel.value || "").trim();
      if (!supplierId) return { items: [], hint: "請先選擇廠商" };
      return getProductOptions_(kw, supplierId, false);
    }, (picked) => {
      hiddenId.value = String(picked.value || "");
      const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
      inputEl.value = String(p?.name || initData.product_name || "");
      applyProduct();
    }, {
      minChars: 0,
      maxShow: 40,
      portal: true,
      onInputClear: () => {
        hiddenId.value = "";
        if (specCell) specCell.textContent = "-";
        if (stockTextEl) stockTextEl.textContent = "-";
        refillSupplierSelectForRow_(supSel, null, supSel?.value || "");
        syncUnitInline("");
        syncPurchaseCustomerOrderDisplay_(tr, customerOrderEl?.value || "", "");
        syncPurchaseSuggestedDisplay_(tr, "", "");
      }
    });

    qtyEl.addEventListener("input", syncSubtotal);
    costEl.addEventListener("input", syncSubtotal);
    receiptWeightEl?.addEventListener("blur", () => normalizePurchaseWeightInput_(receiptWeightEl, purchaseItemUnitText_((adminProducts || []).find(x => String(x.id) === String(hiddenId.value || "")) || { unit: initData.unit || "" })));
    acceptWeightEl?.addEventListener("blur", () => normalizePurchaseWeightInput_(acceptWeightEl, purchaseItemUnitText_((adminProducts || []).find(x => String(x.id) === String(hiddenId.value || "")) || { unit: initData.unit || "" })));

    tr.querySelector(".po-del")?.addEventListener("click", () => {
      tr.remove();
      updatePurchaseRowNumbers_();
      updatePurchaseTotal();
    });

    if (initData.acceptance_result) {
      const el = tr.querySelector(`.po-accept-result[value="${initData.acceptance_result}"]`);
      if (el) el.checked = true;
    }
    if (initData.pesticide_result) {
      const el = tr.querySelector(`.po-pesticide-result[value="${initData.pesticide_result}"]`);
      if (el) el.checked = true;
    }

    if (String(supSel.value || "").trim()) {
      inputEl.disabled = false;
      inputEl.placeholder = "搜尋商品（料號/名稱）";
    }

    if (!initData.product_id && initData.unit) syncUnitInline(initData.unit);

    if (initData.product_id) {
      hiddenId.value = String(initData.product_id);
      const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
      inputEl.value = String(initData.product_name || p?.name || "");
      applyProduct();
      preserveStoredCostValue();
      syncSubtotal();
    } else {
      preserveStoredCostValue();
      syncSubtotal();
    }

    updatePurchaseRowNumbers_();
    syncPurchaseRowReceiveDates_();
  });
}

function calcPurchaseTotal() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  const total = rows.reduce((sum, tr) => {
    const qtyRaw = tr.querySelector(".po-qty")?.value || "";
    const costRaw = tr.querySelector(".po-cost")?.value || "";
    const subtotal = mulDecimalInput_(qtyRaw, costRaw);
    return addDecimalInput_(sum, subtotal);
  }, 0);

  const el = document.getElementById("po-total");
  if (el) el.textContent = money(total);
  return total;
}

function sumPurchaseItemsTotal_(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, it) => {
    const qtyRaw = (it?.qty_raw !== undefined && it?.qty_raw !== null) ? it.qty_raw : it?.qty;
    const costRaw = (it?.cost_raw !== undefined && it?.cost_raw !== null) ? it.cost_raw : it?.cost;
    const subtotal = mulDecimalInput_(qtyRaw, costRaw);
    return addDecimalInput_(sum, subtotal);
  }, 0);
}

function updatePurchaseTotal(){
  return calcPurchaseTotal();
}

function collectPurchaseItems() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  const supList = suppliers.length ? suppliers : LS.get("suppliers", []);
  return rows
    .map(tr => {
      const pid = tr.querySelector(".po-product-id")?.value || "";
      const p = (adminProducts || []).find(x => String(x.id) === String(pid)) || {};
      const qtyRaw = String(tr.querySelector(".po-qty")?.value || "").trim();
      const costRaw = String(tr.querySelector(".po-cost")?.value || "").trim();
      const qty = cleanDecimalInput_(qtyRaw);
      const hasCostInput = costRaw !== "";
      const cost = hasCostInput ? cleanDecimalInput_(costRaw) : "";
      const suggestedRaw = String(tr.querySelector(".po-suggested-qty")?.value || "").trim();
      const suggested_qty = cleanDecimalInput_(suggestedRaw);
      const customerOrderRaw = String(tr.querySelector(".po-customer-order-qty")?.value || "").trim();
      const customer_order_qty = customerOrderRaw === "" ? "" : cleanDecimalInput_(customerOrderRaw);
      const supId = tr.querySelector(".po-supplier")?.value || "";
      const supObj = supList.find(s => String(s.id) === String(supId));
      const acceptance_result = tr.querySelector(".po-accept-result:checked")?.value || "";
      const pesticide_result = tr.querySelector(".po-pesticide-result:checked")?.value || "";
      return {
        product_id: pid,
        product_name: p.name || String(tr.querySelector(".po-product-combo")?.value || "").trim(),
        qty_raw: qtyRaw,
        cost_raw: hasCostInput ? costRaw : "",
        qty,
        suggested_qty,
        customer_order_qty,
        cost,
        supplier_id: String(supId || "").trim(),
        supplier_name: supObj?.name || "",
        unit: p.unit || "",
        sku: p.sku || "",
        spec: String(p.spec || tr.querySelector(".po-spec")?.textContent || "").trim(),
        receive_date: String(tr.querySelector(".po-receive-date")?.value || "").trim(),
        inspection_priority: String(tr.querySelector(".po-priority")?.value || "").trim(),
        receipt_weight: appendUnitText_(String(tr.querySelector(".po-receipt-weight")?.value || "").trim(), p.unit || ""),
        accept_weight: appendUnitText_(String(tr.querySelector(".po-accept-weight")?.value || "").trim(), p.unit || ""),
        acceptance_result,
        pesticide_result,
        note: String(tr.querySelector(".po-note")?.value || "").trim()
      };
    })
    .filter(it => it.product_id && it.supplier_id && it.qty > 0);
}

function getPurchasePayload_(mode){
  const date = String(document.getElementById("po-date")?.value || "").trim();
  const arrival_date = String(document.getElementById("po-arrival-date")?.value || "").trim();
  const items = collectPurchaseItems();
  const form_no = document.getElementById("po-form-no")?.value || inferPurchaseFormNoByItems_(items);
  const form_name = getPurchaseFormName_(form_no) || "生鮮蔬果類";

  if (!items.length) {
    alert("請至少新增一個品項");
    return null;
  }

  const invalid = items.find(it => !it.product_id || !it.supplier_id || !(it.qty > 0));
  if (invalid) {
    alert("每個品項都必須選擇商品、供應商，且數量要大於 0");
    return null;
  }

  for (const it of items) {
    const p = (adminProducts || []).find(x => String(x.id) === String(it.product_id));
    if (!p) return alert(`找不到商品：${it.product_id}`), null;
    if (!hasSupplier_(p, it.supplier_id)) return alert(`供應商與商品不匹配：供應商=${it.supplier_id} / 商品=${it.product_name || it.product_id}`), null;
  }

  const total = sumPurchaseItemsTotal_(items);
  const totalEl = document.getElementById("po-total");
  if (totalEl) totalEl.textContent = money(total);
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const uniqSupIds = Array.from(new Set(items.map(it => String(it.supplier_id || "").trim()).filter(Boolean)));
  const uniqSupNames = Array.from(new Set(items.map(it => String(it.supplier_name || "").trim()).filter(Boolean)));
  const headerSupplierId = (uniqSupIds.length === 1) ? uniqSupIds[0] : "MULTI";
  const headerSupplierName = (uniqSupNames.length === 1) ? uniqSupNames[0] : "多供應商";

  return {
    po_id: String(purchaseEditingState_.po_id || "").trim(),
    source_order_id: String(purchaseEditingState_.source_order_id || "").trim(),
    auto_generated: Number(purchaseEditingState_.auto_generated || 0) ? 1 : 0,
    date,
    arrival_date,
    form_no,
    form_name,
    supplier_id: headerSupplierId,
    supplier_name: headerSupplierName,
    total,
    items,
    operator,
    status: mode === "complete" ? "已入庫" : (purchaseEditingState_.stock_applied ? "已入庫" : "待驗收"),
    apply_stock: mode === "complete"
  };
}


function buildCompactPurchasePayload_(payload){
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return {
    v: 1,
    po: String(payload?.po_id || "").trim(),
    so: String(payload?.source_order_id || "").trim(),
    ag: Number(payload?.auto_generated || 0) ? 1 : 0,
    d: String(payload?.date || "").trim(),
    ad: String(payload?.arrival_date || "").trim(),
    fn: String(payload?.form_no || "").trim(),
    fm: String(payload?.form_name || "").trim(),
    sid: String(payload?.supplier_id || "").trim(),
    sn: String(payload?.supplier_name || "").trim(),
    t: payload?.total || 0,
    op: String(payload?.operator || "").trim(),
    st: String(payload?.status || "").trim(),
    as: payload?.apply_stock ? 1 : 0,
    it: items.map(it => [
      String(it?.product_id || "").trim(),
      String(it?.qty_raw ?? it?.qty ?? "").trim(),
      String(it?.cost_raw ?? it?.cost ?? "").trim(),
      String(it?.supplier_id || "").trim(),
      String(it?.receive_date || "").trim(),
      String(it?.inspection_priority || "").trim(),
      String(it?.receipt_weight || "").trim(),
      String(it?.accept_weight || "").trim(),
      String(it?.acceptance_result || "").trim(),
      String(it?.pesticide_result || "").trim(),
      String(it?.note || "").trim(),
      String(it?.suggested_qty ?? "").trim(),
      String(it?.customer_order_qty ?? "").trim()
    ])
  };
}

function openPurchaseFormWithData_(po){
  if (!po) return alert("找不到採購驗收單");
  ensurePurchaseFormModalWired_();
  withFreshPurchaseRows_(rev => {
    const tbody = document.querySelector("#po-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    document.getElementById("po-date").value = dateOnly(po.date) || "";
    document.getElementById("po-arrival-date").value = dateOnly(po.arrival_date) || "";
    document.getElementById("po-form-no").value = po.form_no || inferPurchaseFormNoByItems_(po.items || []);
    setPurchaseEditingState_(po);
    const items = Array.isArray(po.items) ? po.items : [];
    if (!items.length) addPurchaseRow({}, { revision: rev });
    items.forEach(it => addPurchaseRow(it, { revision: rev }));
    calcPurchaseTotal();
  });
  setPurchaseFormModalTitle_("編輯採購驗收單：" + String(po.po_id || ""));
  const { modal } = getPurchaseFormModalEls_();
  if (modal) {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
}

function resetPurchaseForm_(keepDates = true){
  withFreshPurchaseRows_(rev => {
    const tbody = document.querySelector("#po-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    if (!keepDates) {
      const dateEl = document.getElementById("po-date");
      const arrivalEl = document.getElementById("po-arrival-date");
      if (dateEl) dateEl.value = "";
      if (arrivalEl) arrivalEl.value = "";
    }
    clearPurchaseEditingState_();
    addPurchaseRow({}, { revision: rev });
    syncPurchaseRowReceiveDates_(true);
    calcPurchaseTotal();
  });
}

function loadPurchaseIntoForm(poId){
  const cached = (purchases || []).find(x => String(x.po_id) === String(poId));
  if (typeof fetchPurchaseDetail_ === "function") {
    fetchPurchaseDetail_(poId, (po, res) => {
      if (!po) {
        if (cached) return openPurchaseFormWithData_(cached);
        return alert(res?.message || "找不到採購驗收單");
      }
      openPurchaseFormWithData_(po);
    }, { useCached: true, timeout: 25000 });
    return;
  }
  if (!cached) return alert("找不到採購驗收單");
  openPurchaseFormWithData_(cached);
}

function purchaseItemUnitText_(it){
  return String(
    it?.unit ||
    ((adminProducts || []).find(x => String(x.id) === String(it?.product_id))?.unit || "")
  ).trim();
}

function appendUnitText_(value, unitText){
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const unit = String(unitText || "").trim();
  if (!unit) return raw;
  if (raw.includes(unit)) return raw;
  return `${raw} ${unit}`.trim();
}

function normalizePurchaseWeightInput_(inputEl, unitText){
  if (!inputEl) return;
  const raw = String(inputEl.value || "").trim();
  if (!raw) return;
  const unit = String(unitText || "").trim();
  if (!unit || raw.includes(unit)) return;
  const numericLike = raw.match(/^[-+]?\d+(?:\.\d+)?$/);
  if (!numericLike) return;
  inputEl.value = `${raw} ${unit}`.trim();
}


function buildPurchaseDocHtml_(po){
  const items = Array.isArray(po?.items) ? po.items : [];
  const formNo = po?.form_no || inferPurchaseFormNoByItems_(items);
  const formName = getPurchaseFormName_(formNo) || String(po?.form_name || "").trim();
  const PRINT_ROW_COUNT = 16;
  const visibleRows = items.slice(0, PRINT_ROW_COUNT).map((it, idx) => {
    const unitText = purchaseItemUnitText_(it);
    const orderQtyText = `${money(it.qty)}${unitText ? " " + unitText : ""}`.trim();
    const receiptWeightText = appendUnitText_(it.receipt_weight ?? "", unitText);
    const acceptWeightText = appendUnitText_(it.accept_weight ?? "", unitText);
    return `
    <tr>
      <td class="purchase-col-no">${idx + 1}</td>
      <td class="purchase-col-name">${escapeHtml_(it.product_name ?? "")}</td>
      <td class="purchase-col-spec">${escapeHtml_(it.spec ?? "")}</td>
      <td class="purchase-col-supplier">${escapeHtml_(it.supplier_name ?? po.supplier_name ?? "")}</td>
      <td class="purchase-col-orderqty">${escapeHtml_(orderQtyText)}</td>
      <td class="purchase-col-receive-date">${escapeHtml_(dateOnly(it.receive_date || "") || "")}</td>
      <td class="purchase-col-priority">${escapeHtml_(it.inspection_priority ?? "")}</td>
      <td class="purchase-col-receipt-weight">${escapeHtml_(receiptWeightText)}</td>
      <td class="purchase-col-price">${escapeHtml_(it.cost ? money(it.cost) : "")}</td>
      <td class="purchase-col-accept-weight">${escapeHtml_(acceptWeightText)}</td>
      <td class="purchase-col-accept-result">${checkboxHtml_(it.acceptance_result)}</td>
      <td class="purchase-col-pesticide-result">${checkboxHtml_(it.pesticide_result)}</td>
      <td class="purchase-col-note">${escapeHtml_(it.note ?? "")}</td>
    </tr>
  `;
  });

  while (visibleRows.length < PRINT_ROW_COUNT) {
    visibleRows.push(`
      <tr>
        <td class="purchase-col-no">${visibleRows.length + 1}</td>
        <td class="purchase-col-name"></td>
        <td class="purchase-col-spec"></td>
        <td class="purchase-col-supplier"></td>
        <td class="purchase-col-orderqty"></td>
        <td class="purchase-col-receive-date"></td>
        <td class="purchase-col-priority"></td>
        <td class="purchase-col-receipt-weight"></td>
        <td class="purchase-col-price"></td>
        <td class="purchase-col-accept-weight"></td>
        <td class="purchase-col-accept-result"><span class="purchase-check-result"><span>□合格</span><span>□退貨</span></span></td>
        <td class="purchase-col-pesticide-result"><span class="purchase-check-result"><span>□合格</span><span>□退貨</span></span></td>
        <td class="purchase-col-note"></td>
      </tr>
    `);
  }

  return `
    <div class="purchase-print-wrap">
      <div class="purchase-print-title-row">
        <div class="purchase-print-title">社團法人屏東縣社會福利聯盟【採購驗收單】</div>
        <div class="purchase-print-formno">表格編號： ${escapeHtml_(formNo)} ${escapeHtml_(formName || "")}</div>
      </div>
      <div class="purchase-print-dates">
        <div class="purchase-print-date purchase-print-date-left">採購日期：${escapeHtml_(formatRocDateWithWeek_(dateOnly(po?.date) || ""))}</div>
        <div class="purchase-print-date purchase-print-date-right">到貨日期：${escapeHtml_(formatRocDateWithWeek_(dateOnly(po?.arrival_date) || ""))}</div>
      </div>
      <table class="purchase-print-table">
        <colgroup>
          <col style="width:2.5%;">
          <col style="width:13%;">
          <col style="width:14%;">
          <col style="width:8.5%;">
          <col style="width:6.8%;">
          <col style="width:5.3%;">
          <col style="width:6%;">
          <col style="width:7.5%;">
          <col style="width:6.8%;">
          <col style="width:7.5%;">
          <col style="width:5.2%;">
          <col style="width:5.2%;">
          <col style="width:11.7%;">
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>品　名</th>
            <th>規　格</th>
            <th>廠　商</th>
            <th>訂購<br>數量</th>
            <th>收　貨<br>日期</th>
            <th>優先檢驗<br>順序</th>
            <th>收　據<br>重量</th>
            <th>單　價</th>
            <th>驗收<br>重量</th>
            <th>驗收<br>結果</th>
            <th>農藥<br>檢驗</th>
            <th>備　註</th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.join("")}
        </tbody>
      </table>
      <div class="purchase-print-signs">
        <div>製表人：</div>
        <div>驗收：</div>
        <div>倉管：</div>
        <div>品管：</div>
        <div>採購：</div>
        <div>經理：</div>
        <div>會計：</div>
        <div>執行長：</div>
      </div>
    </div>
  `;
}

function submitPurchase(mode = "draft") {
  if (purchaseSubmitLocked_) return;
  const payload = getPurchasePayload_(mode);
  if (!payload) return;

  const action = isPurchaseEditing_() ? "update" : "add";
  const compactPayload = buildCompactPurchasePayload_(payload);
  const wasStockApplied = Number(purchaseEditingState_.stock_applied || 0) ? 1 : 0;
  const shouldApplyLocalStock = (mode === "complete" && !wasStockApplied && typeof applyPurchaseToLocalStock === "function");
  setPurchaseSubmitLocked_(true);

  gas({
    type: "managePurchase",
    action,
    po_id: payload.po_id || "",
    purchase_compact: JSON.stringify(compactPayload)
  }, res => {
    if (!res || res.status !== "ok") {
      setPurchaseSubmitLocked_(false);
      alert(res?.message || (mode === "complete" ? "完成驗收入庫失敗" : "儲存草稿失敗"));
      return;
    }

    const responseList = normalizeList(res);
    const savedPoId = String(res?.po_id || payload.po_id || "").trim();
    const serverPo = (Array.isArray(responseList) ? responseList : []).find(x => String(x?.po_id || "").trim() === savedPoId) || (res?.purchase && String(res.purchase.po_id || "").trim() === savedPoId ? res.purchase : null);
    const finalPo = serverPo && Array.isArray(serverPo.items) ? serverPo : {
      ...payload,
      po_id: savedPoId,
      items: Array.isArray(payload.items) ? payload.items : [],
      items_loaded: 1,
      item_count: Array.isArray(payload.items) ? payload.items.length : 0,
      stock_applied: (mode === "complete" || wasStockApplied) ? 1 : 0,
      completed_at: mode === "complete" ? todayISO() : ""
    };

    removePurchaseLocalById_(savedPoId);
    if (typeof upsertPurchaseLocal_ === "function") upsertPurchaseLocal_(finalPo);
    if (shouldApplyLocalStock) {
      try { applyPurchaseToLocalStock(finalPo); } catch (e) { console.error("applyPurchaseToLocalStock failed", e); }
    }

    closePurchaseFormModal_(false);
    setPurchaseSubmitLocked_(false);
    alert(res?.message || (mode === "complete" ? "採購驗收單已完成" : "採購驗收單已儲存"));

    loadPurchases(true);
    if (mode === "complete" || wasStockApplied) {
      loadAdminProducts(true);
      loadLedger(true);
    }
    scheduleDashboardRefresh_();
  }, 45000);
}

function openPurchaseTemplateLoadingWindow_(title, message){
  if (isLocalFileProtocol_()) return null;
  const w = window.open("", "_blank", "width=980,height=760");
  if (!w) {
    alert("請允許瀏覽器開啟新視窗");
    return null;
  }
  const safeTitle = escapeHtml_(title || "採購驗收單 Excel 套印");
  const safeMessage = escapeHtml_(message || "載入中…");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>
    body{font-family:Arial,"Microsoft JhengHei",sans-serif;background:#f7f8fb;margin:0;padding:32px;color:#223;}
    .shell{max-width:760px;margin:0 auto;background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:28px 28px 24px;box-shadow:0 12px 36px rgba(31,41,55,.10);}
    h1{margin:0 0 12px;font-size:24px;}
    p{margin:0 0 10px;line-height:1.7;font-size:15px;color:#455;}
    .hint{margin-top:14px;color:#6b7280;font-size:13px;}
    .error{color:#b42318;}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;}
    .btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:10px;border:1px solid #c9d3df;background:#fff;color:#234;text-decoration:none;font-weight:700;cursor:pointer;}
    .btn.primary{background:#2f7d32;border-color:#2f7d32;color:#fff;}
  </style></head><body><div class="shell" id="purchase-template-shell"><h1>${safeTitle}</h1><p id="purchase-template-message">${safeMessage}</p><p class="hint">系統會直接讀取前端專案內的 purchase_receipt_template.xlsx 作為唯一母版，保留模板原本的列印格式。你之後若要調整格式，只要修改這個檔案並重新部署即可。若你現在是在本機直接開啟 html 測試，系統會使用隨前端封裝的模板快照，不會再另外跳出選檔視窗。正式部署後則會直接讀取專案內同一路徑的 xlsx 模板檔。</p></div></body></html>`);
  w.document.close();
  return w;
}

const PURCHASE_TEMPLATE_XLSX_URL_ = "templates/purchase_receipt_template.xlsx";
const PURCHASE_TEMPLATE_MAX_ROWS_ = 16;
const PURCHASE_TEMPLATE_START_ROW_ = 5;
const PURCHASE_TEMPLATE_LOCAL_HINT_ = "admin/templates/purchase_receipt_template.xlsx";
const PURCHASE_TEMPLATE_EMBEDDED_BASE64_ = "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";

function isLocalFileProtocol_(){
  return String(window.location.protocol || "").toLowerCase() === "file:";
}

function getPurchaseTemplateXlsxUrlCandidates_(){
  const stamp = `_ts=${Date.now()}`;
  const rels = [
    PURCHASE_TEMPLATE_XLSX_URL_,
    "./templates/purchase_receipt_template.xlsx",
    "admin/templates/purchase_receipt_template.xlsx",
    "./admin/templates/purchase_receipt_template.xlsx"
  ];
  const urls = [];
  const pushUrl = (raw) => {
    const s = String(raw || "").trim();
    if (!s || urls.includes(s)) return;
    urls.push(s);
  };

  rels.forEach(rel => {
    const glue = rel.includes("?") ? "&" : "?";
    pushUrl(`${rel}${glue}${stamp}`);
  });

  return urls;
}

function getPurchaseTemplateXlsxUrl_(){
  return `${PURCHASE_TEMPLATE_XLSX_URL_}?_ts=${Date.now()}`;
}

let purchaseTemplateSessionBuffer_ = null;
let purchaseTemplateSessionName_ = "purchase_receipt_template.xlsx";

function decodeEmbeddedPurchaseTemplateArrayBuffer_(){
  const b64 = String(PURCHASE_TEMPLATE_EMBEDDED_BASE64_ || "").trim();
  if (!b64) throw new Error("缺少內嵌 Excel 模板資料");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function ensurePurchaseTemplateBufferReadyAsync_(){
  if (purchaseTemplateSessionBuffer_) return purchaseTemplateSessionBuffer_.slice(0);
  if (isLocalFileProtocol_()) {
    const buffer = decodeEmbeddedPurchaseTemplateArrayBuffer_();
    purchaseTemplateSessionBuffer_ = buffer.slice(0);
    purchaseTemplateSessionName_ = "purchase_receipt_template.xlsx";
    return purchaseTemplateSessionBuffer_.slice(0);
  }
  return null;
}

async function loadPurchaseTemplateArrayBufferAsync_(){
  if (purchaseTemplateSessionBuffer_) return purchaseTemplateSessionBuffer_.slice(0);

  if (isLocalFileProtocol_()) {
    const buffer = decodeEmbeddedPurchaseTemplateArrayBuffer_();
    purchaseTemplateSessionBuffer_ = buffer.slice(0);
    purchaseTemplateSessionName_ = "purchase_receipt_template.xlsx";
    return purchaseTemplateSessionBuffer_.slice(0);
  }

  const candidates = getPurchaseTemplateXlsxUrlCandidates_();
  let lastErr = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        lastErr = new Error(`無法載入 Excel 模板（HTTP ${resp.status}）`);
        continue;
      }
      const buffer = await resp.arrayBuffer();
      purchaseTemplateSessionBuffer_ = buffer.slice(0);
      purchaseTemplateSessionName_ = "purchase_receipt_template.xlsx";
      return purchaseTemplateSessionBuffer_.slice(0);
    } catch (err) {
      lastErr = err;
    }
  }
  return lastErr ? Promise.reject(lastErr) : Promise.reject(new Error("無法載入 Excel 模板"));
}

function buildPurchaseTemplateDownloadName_(poId){
  const safeId = String(poId || "purchase").trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  return `purchase_receipt_${safeId}.xlsx`;
}

function triggerDownloadByUrl_(url, filename){
  const raw = String(url || "").trim();
  if (!raw) return false;
  const a = document.createElement("a");
  a.href = raw;
  if (filename) a.download = filename;
  if (!/^blob:/i.test(raw) && !isLocalFileProtocol_()) { a.target = "_blank"; a.rel = "noopener"; }
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

function fetchPurchaseDetailAsync_(poId){
  return new Promise((resolve, reject) => {
    if (typeof fetchPurchaseDetail_ !== "function") {
      reject(new Error("缺少採購驗收單明細讀取函式"));
      return;
    }
    fetchPurchaseDetail_(poId, (po, res) => {
      if (!po) return reject(new Error(res?.message || "找不到採購驗收單明細"));
      resolve(po);
    }, { useCached: true, timeout: 45000 });
  });
}

function purchaseTemplateDateObject_(raw){
  const iso = dateOnly(raw || "");
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function purchaseTemplateMonthDayDateObject_(raw){
  const iso = dateOnly(raw || "");
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function purchaseTemplateMonthDayText_(raw){
  const iso = dateOnly(raw || "");
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(raw || "").trim();
  return `${m[2]}/${m[3]}`;
}

function purchaseTemplateDisplayText_(value){
  if (value == null) return "";
  return String(value).trim();
}

function purchaseTemplateQtyText_(item){
  const raw = purchaseTemplateDisplayText_(item?.qty_raw);
  const unit = purchaseItemUnitText_(item);
  if (raw) return appendUnitText_(raw, unit);
  const qty = purchaseTemplateDisplayText_(item?.qty);
  return appendUnitText_(qty, unit);
}

function purchaseTemplateWeightText_(value, unitText){
  const raw = purchaseTemplateDisplayText_(value);
  if (!raw) return "";
  const unit = purchaseTemplateDisplayText_(unitText);
  if (!unit) return raw;
  if (raw.includes(unit)) return raw;
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(raw)) return raw;
  return `${raw} ${unit}`.trim();
}

function purchaseTemplatePriceValue_(value){
  const raw = purchaseTemplateDisplayText_(value);
  if (!raw) return "";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function purchaseTemplateStatusText_(value){
  const raw = purchaseTemplateDisplayText_(value);
  if (!raw) return null;
  if (raw.includes("□") || raw.includes("☑")) return raw;
  if (raw === "合格") return "☑合格\n□退貨";
  if (raw === "退貨") return "□合格\n☑退貨";
  return raw;
}

function fillPurchaseTemplateWorkbook_(sheet, purchase){
  if (!sheet) throw new Error("Excel 模板工作表不存在");
  const formNo = purchaseTemplateDisplayText_(purchase?.form_no);
  const formName = purchaseTemplateDisplayText_(purchase?.form_name);
  const title = [formNo, formName].filter(Boolean).join(" ").trim();
  if (title) sheet.cell("L2").value(title);
  const poDate = purchaseTemplateDateObject_(purchase?.date);
  sheet.cell("A3").value(poDate || "");
  const arrivalDate = purchaseTemplateDateObject_(purchase?.arrival_date);
  sheet.cell("I3").value(arrivalDate || "");

  for (let i = 0; i < PURCHASE_TEMPLATE_MAX_ROWS_; i += 1) {
    const row = PURCHASE_TEMPLATE_START_ROW_ + i;
    const rowRange = sheet.range(`A${row}:M${row}`);
    rowRange.style("horizontalAlignment", "center");
    rowRange.style("verticalAlignment", "center");
    const dateCell = sheet.cell(`F${row}`);
    dateCell.style("horizontalAlignment", "center");
    dateCell.style("verticalAlignment", "center");
    dateCell.style("numberFormat", "mm/dd");
    const priceCell = sheet.cell(`I${row}`);
    priceCell.style("horizontalAlignment", "center");
    priceCell.style("verticalAlignment", "center");
    priceCell.style("numberFormat", '[$$-zh-TW]#,##0.00');
  }

  const items = Array.isArray(purchase?.items) ? purchase.items.slice(0, PURCHASE_TEMPLATE_MAX_ROWS_) : [];
  items.forEach((item, index) => {
    const row = PURCHASE_TEMPLATE_START_ROW_ + index;
    const unitText = purchaseItemUnitText_(item);
    sheet.cell(`B${row}`).value(purchaseTemplateDisplayText_(item?.product_name || item?.name));
    sheet.cell(`C${row}`).value(purchaseTemplateDisplayText_(item?.spec));
    sheet.cell(`D${row}`).value(purchaseTemplateDisplayText_(item?.supplier_name));
    sheet.cell(`E${row}`).value(purchaseTemplateQtyText_(item));
    const receiveDateCell = sheet.cell(`F${row}`);
    const receiveDate = purchaseTemplateMonthDayDateObject_(item?.receive_date || purchase?.arrival_date || "");
    receiveDateCell.value(receiveDate || purchaseTemplateMonthDayText_(item?.receive_date || purchase?.arrival_date || ""));
    receiveDateCell.style("numberFormat", "mm/dd");
    sheet.cell(`G${row}`).value(purchaseTemplateDisplayText_(item?.inspection_priority));
    sheet.cell(`H${row}`).value(purchaseTemplateWeightText_(item?.receipt_weight, unitText));
    const priceCell = sheet.cell(`I${row}`);
    priceCell.value(purchaseTemplatePriceValue_(item?.cost_raw || item?.cost));
    priceCell.style("numberFormat", '[$$-zh-TW]#,##0.00');
    sheet.cell(`J${row}`).value(purchaseTemplateWeightText_(item?.accept_weight, unitText));
    const acceptanceText = purchaseTemplateStatusText_(item?.acceptance_result);
    const pesticideText = purchaseTemplateStatusText_(item?.pesticide_result);
    if (acceptanceText !== null) sheet.cell(`K${row}`).value(acceptanceText);
    if (pesticideText !== null) sheet.cell(`L${row}`).value(pesticideText);
    sheet.cell(`M${row}`).value(purchaseTemplateDisplayText_(item?.note));
  });
}

async function buildPurchaseTemplateBlobAsync_(purchase){
  if (!window.XlsxPopulate || typeof window.XlsxPopulate.fromDataAsync !== "function") {
    throw new Error("Excel 模板函式庫尚未載入，請確認網路後重整頁面再試");
  }
  const buffer = await loadPurchaseTemplateArrayBufferAsync_();
  const workbook = await window.XlsxPopulate.fromDataAsync(buffer);
  fillPurchaseTemplateWorkbook_(workbook.sheet(0), purchase);
  return workbook.outputAsync();
}

function renderPurchaseTemplateWindow_(w, title, message, options = {}){
  if (!w || w.closed) return;
  const safeTitle = escapeHtml_(title || "採購驗收單 Excel 套印");
  const safeMessage = escapeHtml_(message || "");
  const xlsxUrl = String(options.xlsxUrl || "").trim();
  const templateUrl = String(options.templateUrl || getPurchaseTemplateXlsxUrl_()).trim();
  const cssClass = options.isError ? 'error' : '';
  const links = [];
  if (xlsxUrl) links.push(`<a class="btn primary" href="${escapeHtml_(xlsxUrl)}" download="${escapeHtml_(options.filename || 'purchase_receipt.xlsx')}">重新下載 Excel 檔</a>`);
  if (templateUrl) links.push(`<a class="btn" href="${escapeHtml_(templateUrl)}" download="purchase_receipt_template.xlsx">下載 Excel 模板</a>`);
  w.document.title = title || "採購驗收單 Excel 套印";
  const shell = w.document.getElementById('purchase-template-shell');
  if (!shell) return;
  shell.innerHTML = `<h1>${safeTitle}</h1><p id="purchase-template-message" class="${cssClass}">${safeMessage}</p>${links.length ? `<div class="actions">${links.join('')}</div>` : ''}<p class="hint">這次下載的是以前端專案內的 purchase_receipt_template.xlsx 直接填值後產生的新檔，請用本機 Excel 開啟列印。本機直接開啟 html 測試時，系統會直接使用封裝在前端裡的模板快照；正式部署在 http/https 後，則會直接讀取前端專案內的模板檔。</p>`;
}

function openPurchasePrintTemplateEditor_(){
  if (isLocalFileProtocol_()) {
    alert(`你目前是在本機直接開啟 html 測試。請直接編輯專案內的 ${PURCHASE_TEMPLATE_LOCAL_HINT_}，重新打包後即可讓本機快照與正式模板同步。`);
    return;
  }
  triggerDownloadByUrl_(getPurchaseTemplateXlsxUrl_(), 'purchase_receipt_template.xlsx');
}

async function printPurchaseById(poId){
  const targetPoId = String(poId || purchaseEditingState_.po_id || document.getElementById("po-current-id")?.value || "").trim();
  if (!targetPoId) {
    alert("Excel 套印只支援已儲存的採購驗收單，請先儲存草稿後再列印。");
    return;
  }

  const w = openPurchaseTemplateLoadingWindow_("採購驗收單 Excel 套印", `正在載入 Excel 模板並套印資料：${escapeHtml_(targetPoId)}…`);
  let templateReadyPromise = null;
  try {
    templateReadyPromise = ensurePurchaseTemplateBufferReadyAsync_();
    const purchase = await fetchPurchaseDetailAsync_(targetPoId);
    if (templateReadyPromise) await templateReadyPromise;
    const blob = await buildPurchaseTemplateBlobAsync_(purchase);
    const filename = buildPurchaseTemplateDownloadName_(targetPoId);
    const objectUrl = URL.createObjectURL(blob);
    renderPurchaseTemplateWindow_(w, "採購驗收單 Excel 套印", "已依 Excel 模板完成套印，檔案將自動開始下載；若瀏覽器沒有下載，請點下方按鈕重新下載。", {
      xlsxUrl: objectUrl,
      filename,
      templateUrl: isLocalFileProtocol_() ? "" : getPurchaseTemplateXlsxUrl_()
    });
    triggerDownloadByUrl_(objectUrl, filename);
    window.setTimeout(() => {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
    }, 120000);
  } catch (err) {
    console.error('printPurchaseById failed', err);
    renderPurchaseTemplateWindow_(w, "採購驗收單 Excel 套印", err?.message || "Excel 套印失敗", {
      isError: true,
      templateUrl: isLocalFileProtocol_() ? "" : getPurchaseTemplateXlsxUrl_()
    });
    alert(err?.message || "Excel 套印失敗");
  }
}

window.openPurchaseFormModal_ = openPurchaseFormModal_;
window.closePurchaseFormModal_ = closePurchaseFormModal_;
window.editPurchase = loadPurchaseIntoForm;
window.printPurchase = printPurchaseById;
window.openPurchasePrintTemplateEditor_ = openPurchasePrintTemplateEditor_;
window.submitPurchase = submitPurchase;
window.resetPurchaseForm_ = resetPurchaseForm_;
