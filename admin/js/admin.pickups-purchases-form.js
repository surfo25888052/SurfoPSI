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

  tbody.innerHTML = "";
  sortedList.slice(start, end).forEach(pu => {
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

let purchaseEditingState_ = { po_id: "", stock_applied: 0 };

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
  return document.getElementById("po-arrival-date")?.value || "";
}

function formatQtyWithSuggested_(qty, suggested){
  const q = String(qty ?? "").trim();
  const s = String(suggested ?? "").trim();
  if (!q && !s) return "";
  if (!s) return q;
  return `${q}（${s}）`;
}

function syncPurchaseSuggestedDisplay_(rowOrTr, value){
  const tr = rowOrTr && rowOrTr.closest ? rowOrTr.closest("tr") : rowOrTr;
  if (!tr) return;
  const hiddenEl = tr.querySelector('.po-suggested-qty');
  const textEl = tr.querySelector('.po-suggested-text');
  const wrapEl = tr.querySelector('.po-suggested-inline');
  const normalized = String(value ?? "").trim();
  if (hiddenEl) hiddenEl.value = normalized;
  if (textEl) textEl.textContent = normalized || "";
  if (wrapEl) {
    wrapEl.style.visibility = normalized ? 'visible' : 'hidden';
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
  const val = getPurchaseReceiptDefaultDate_();
  Array.from(document.querySelectorAll("#po-items-table tbody .po-receive-date")).forEach(el => {
    if (!el) return;
    if (forceAll || !String(el.value || "").trim()) el.value = val;
  });
}

function setPurchaseEditingState_(po){
  purchaseEditingState_ = {
    po_id: String(po?.po_id || "").trim(),
    stock_applied: Number(po?.stock_applied || 0) ? 1 : 0
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

function calcSuggestedQtyForProduct_(p, orderQty){
  const stock = safeNum(p?.stock, 0);
  const safety = safeNum(p?.safety_stock, 0);
  const qty = safeNum(orderQty, 0);
  const shortageToSafety = Math.max(0, safety - stock);
  return qty + shortageToSafety;
}

function addPurchaseRow(initData = {}) {
  const tbody = document.querySelector("#po-items-table tbody");
  if (!tbody) return;

  ensurePurchaseDataReady_().then(ok => {
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
          <input type="text" class="po-product-combo admin-input combo-input" placeholder="請先選擇廠商" autocomplete="off" disabled />
          <div class="combo-menu"></div>
        </div>
        <input type="hidden" class="po-product-id" value="" />
      </td>
      <td class="po-spec">-</td>
      <td><select class="po-supplier admin-select"></select></td>
      <td class="po-qty-cell">
        <div class="po-qty-inline">
          <input type="number" class="po-qty admin-input" value="${escapeAttr_(initData.qty ?? 1)}" min="0" step="0.01" />
          <span class="po-unit-inline"></span>
          <span class="po-suggested-inline" aria-hidden="true">（<span class="po-suggested-text"></span>）</span>
        </div>
        <input type="hidden" class="po-suggested-qty" value="${escapeAttr_(initData.suggested_qty ?? "")}" />
      </td>
      <td><input type="date" class="po-receive-date admin-input" value="${escapeAttr_(initData.receive_date || getPurchaseReceiptDefaultDate_())}" /></td>
      <td><input type="text" class="po-priority admin-input" value="${escapeAttr_(initData.inspection_priority || "")}" placeholder="例：1" /></td>
      <td><input type="text" class="po-receipt-weight admin-input" value="${escapeAttr_(initData.receipt_weight || "")}" placeholder="例：12公斤" /></td>
      <td><input type="number" class="po-cost admin-input" value="${escapeAttr_(initData.cost ?? "")}" min="0" step="0.01" /></td>
      <td><input type="text" class="po-accept-weight admin-input" value="${escapeAttr_(initData.accept_weight || "")}" placeholder="例：11.8公斤" /></td>
      <td>
        <div class="po-radio-group">
          <label><input type="radio" name="${rowUid}-accept" class="po-accept-result" value="合格">合格</label>
          <label><input type="radio" name="${rowUid}-accept" class="po-accept-result" value="退貨">退貨</label>
        </div>
      </td>
      <td>
        <div class="po-radio-group">
          <label><input type="radio" name="${rowUid}-pesticide" class="po-pesticide-result" value="合格">合格</label>
          <label><input type="radio" name="${rowUid}-pesticide" class="po-pesticide-result" value="退貨">退貨</label>
        </div>
      </td>
      <td><input type="text" class="po-note admin-input" value="${escapeAttr_(initData.note || "")}" placeholder="備註" /></td>
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
    const costEl = tr.querySelector(".po-cost");
    const unitInlineEl = tr.querySelector(".po-unit-inline");

    const syncUnitInline = (unitText) => {
      if (!unitInlineEl) return;
      const text = String(unitText || "").trim();
      unitInlineEl.textContent = text || "";
      unitInlineEl.style.display = text ? "inline-block" : "none";
    };

    fillSupplierSelect(supSel);
    if (initData.supplier_id && Array.from(supSel.options).some(o => String(o.value) === String(initData.supplier_id))) {
      supSel.value = String(initData.supplier_id);
    }

    const clearProduct = () => {
      hiddenId.value = "";
      inputEl.value = "";
      if (specCell) specCell.textContent = "-";
      if (costEl) costEl.value = "";
      syncUnitInline("");
      syncPurchaseSuggestedDisplay_(tr, "");
    };

    const syncSuggested = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = (adminProducts || []).find(x => String(x.id) === pid);
      if (!suggestedEl) return;
      if (!p) {
        syncPurchaseSuggestedDisplay_(tr, initData.suggested_qty ?? "");
        return;
      }
      syncPurchaseSuggestedDisplay_(tr, safeNum(calcSuggestedQtyForProduct_(p, qtyEl?.value || 0), 0));
    };

    const syncSubtotal = () => {
      syncSuggested();
      updatePurchaseTotal();
    };

    const applyProduct = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = (adminProducts || []).find(x => String(x.id) === pid);
      if (specCell) specCell.textContent = p?.spec || initData.spec || "-";
      syncUnitInline(p?.unit || initData.unit || "");
      if (receiveDateEl && !String(receiveDateEl.value || "").trim()) {
        receiveDateEl.value = getPurchaseReceiptDefaultDate_();
      }
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
      onInputClear: () => { hiddenId.value = ""; if (specCell) specCell.textContent = "-"; syncUnitInline(""); syncPurchaseSuggestedDisplay_(tr, ""); }
    });

    qtyEl.addEventListener("input", syncSubtotal);
    costEl.addEventListener("input", syncSubtotal);

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
    } else {
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
      const cost = cleanDecimalInput_(costRaw);
      const suggestedRaw = String(tr.querySelector(".po-suggested-qty")?.value || "").trim();
      const suggested_qty = cleanDecimalInput_(suggestedRaw);
      const supId = tr.querySelector(".po-supplier")?.value || "";
      const supObj = supList.find(s => String(s.id) === String(supId));
      const acceptance_result = tr.querySelector(".po-accept-result:checked")?.value || "";
      const pesticide_result = tr.querySelector(".po-pesticide-result:checked")?.value || "";
      return {
        product_id: pid,
        product_name: p.name || String(tr.querySelector(".po-product-combo")?.value || "").trim(),
        qty_raw: qtyRaw,
        cost_raw: costRaw,
        qty,
        suggested_qty,
        cost,
        supplier_id: String(supId || "").trim(),
        supplier_name: supObj?.name || "",
        unit: p.unit || "",
        sku: p.sku || "",
        spec: String(p.spec || tr.querySelector(".po-spec")?.textContent || "").trim(),
        receive_date: String(tr.querySelector(".po-receive-date")?.value || "").trim(),
        inspection_priority: String(tr.querySelector(".po-priority")?.value || "").trim(),
        receipt_weight: String(tr.querySelector(".po-receipt-weight")?.value || "").trim(),
        accept_weight: String(tr.querySelector(".po-accept-weight")?.value || "").trim(),
        acceptance_result,
        pesticide_result,
        note: String(tr.querySelector(".po-note")?.value || "").trim()
      };
    })
    .filter(it => it.product_id && it.supplier_id && it.qty > 0);
}

function getPurchasePayload_(mode){
  const date = document.getElementById("po-date")?.value || todayISO();
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

  const total = calcPurchaseTotal();
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const uniqSupIds = Array.from(new Set(items.map(it => String(it.supplier_id || "").trim()).filter(Boolean)));
  const uniqSupNames = Array.from(new Set(items.map(it => String(it.supplier_name || "").trim()).filter(Boolean)));
  const headerSupplierId = (uniqSupIds.length === 1) ? uniqSupIds[0] : "MULTI";
  const headerSupplierName = (uniqSupNames.length === 1) ? uniqSupNames[0] : "多供應商";

  return {
    po_id: String(purchaseEditingState_.po_id || "").trim(),
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

function resetPurchaseForm_(keepDates = true){
  const tbody = document.querySelector("#po-items-table tbody");
  if (tbody) tbody.innerHTML = "";
  if (!keepDates) {
    const dateEl = document.getElementById("po-date");
    const arrivalEl = document.getElementById("po-arrival-date");
    if (dateEl) dateEl.value = todayISO();
    if (arrivalEl) arrivalEl.value = "";
  }
  clearPurchaseEditingState_();
  addPurchaseRow();
  syncPurchaseRowReceiveDates_(true);
  calcPurchaseTotal();
}

function loadPurchaseIntoForm(poId){
  const po = (purchases || []).find(x => String(x.po_id) === String(poId));
  if (!po) return alert("找不到採購驗收單");
  ensurePurchaseFormModalWired_();
  const tbody = document.querySelector("#po-items-table tbody");
  if (tbody) tbody.innerHTML = "";
  document.getElementById("po-date").value = dateOnly(po.date) || todayISO();
  document.getElementById("po-arrival-date").value = dateOnly(po.arrival_date) || "";
  document.getElementById("po-form-no").value = po.form_no || inferPurchaseFormNoByItems_(po.items || []);
  setPurchaseEditingState_(po);
  const items = Array.isArray(po.items) ? po.items : [];
  if (!items.length) addPurchaseRow();
  items.forEach(it => addPurchaseRow(it));
  calcPurchaseTotal();
  setPurchaseFormModalTitle_("編輯採購驗收單：" + String(po.po_id || ""));
  const { modal } = getPurchaseFormModalEls_();
  if (modal) {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
}

function buildPurchaseDocHtml_(po){
  const items = Array.isArray(po?.items) ? po.items : [];
  const formNo = po?.form_no || inferPurchaseFormNoByItems_(items);
  const formName = po?.form_name || getPurchaseFormName_(formNo);
  const resolveUnit_ = (it) => String(it.unit || ((adminProducts || []).find(x => String(x.id) === String(it.product_id))?.unit || "")).trim();
  const qtyText_ = (it) => {
    const unit = resolveUnit_(it);
    const base = money(it.qty);
    return unit ? `${base} ${unit}` : base;
  };
  const rows = items.slice(0, 16).map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml_(it.product_name ?? "")}</td>
      <td>${escapeHtml_(it.spec ?? "")}</td>
      <td>${escapeHtml_(it.supplier_name ?? po.supplier_name ?? "")}</td>
      <td>${escapeHtml_(qtyText_(it))}</td>
      <td>${escapeHtml_(dateOnly(it.receive_date || it.arrival_date || po.arrival_date || "") || "")}</td>
      <td>${escapeHtml_(it.inspection_priority ?? "")}</td>
      <td>${escapeHtml_(it.receipt_weight ?? "")}</td>
      <td>${escapeHtml_(it.cost ? money(it.cost) : "")}</td>
      <td>${escapeHtml_(it.accept_weight ?? "")}</td>
      <td>${escapeHtml_(checkboxText_(it.acceptance_result))}</td>
      <td>${escapeHtml_(checkboxText_(it.pesticide_result))}</td>
      <td>${escapeHtml_(it.note ?? "")}</td>
    </tr>
  `);
  while (rows.length < 16) {
    rows.push(`
      <tr>
        <td>${rows.length + 1}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td>□合格 □退貨</td>
        <td>□合格 □退貨</td>
        <td></td>
      </tr>
    `);
  }

  const styles = `
    <style>
      html,body{margin:0;padding:0;background:#fff;color:#111;overflow:hidden;}
      *,*::before,*::after{box-sizing:border-box;}
      .purchase-sheet-wrap,.purchase-sheet-card,.purchase-sheet-table{background:#fff;box-shadow:none;outline:none;}
      .purchase-sheet-wrap::before,.purchase-sheet-wrap::after,.purchase-sheet-card::before,.purchase-sheet-card::after{content:none !important;display:none !important;}
      .purchase-sheet-wrap{width:100%;max-width:1380px;margin:0 auto;background:#fff;color:#111;font-family:'PMingLiU','MingLiU','Noto Serif TC',serif;overflow:hidden;}
      .purchase-sheet-card{border:2px solid #000;background:#fff;padding:10px 12px 12px;}
      .purchase-sheet-title-row{position:relative;min-height:38px;text-align:center;margin-bottom:8px;}
      .purchase-sheet-title{font-size:26px;font-weight:700;letter-spacing:1px;line-height:1.2;}
      .purchase-sheet-formno{position:absolute;right:0;top:50%;transform:translateY(-50%);font-size:14px;font-weight:700;white-space:nowrap;}
      .purchase-sheet-dates{display:flex;justify-content:space-between;gap:16px;font-size:14px;font-weight:700;margin:2px 0 10px;}
      .purchase-sheet-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;border:2px solid #000;}
      .purchase-sheet-table th,.purchase-sheet-table td{border:1px solid #000;padding:4px 3px;height:28px;text-align:center;vertical-align:middle;word-break:break-word;line-height:1.25;}
      .purchase-sheet-table thead th{font-weight:700;border-top:2px solid #000;border-bottom:2px solid #000;}
      .purchase-sheet-table th:first-child,.purchase-sheet-table td:first-child{border-left:2px solid #000;}
      .purchase-sheet-table th:last-child,.purchase-sheet-table td:last-child{border-right:2px solid #000 !important;}
      .purchase-sheet-table tbody tr:last-child td{border-bottom:2px solid #000;}
      .purchase-sheet-signs{display:grid;grid-template-columns:repeat(7,1fr);gap:18px;margin-top:16px;font-size:14px;font-weight:700;}
      .purchase-sheet-signs div{white-space:nowrap;}
      @media (max-width: 1200px){
        .purchase-sheet-wrap{min-width:1280px;}
      }
    </style>
  `;

  return `
    ${styles}
    <div class="purchase-sheet-wrap">
      <div class="purchase-sheet-card">
        <div class="purchase-sheet-title-row">
          <div class="purchase-sheet-title">社團法人屏東縣社會福利聯盟【採購驗收單】</div>
          <div class="purchase-sheet-formno">表格編號： ${escapeHtml_(formNo)} ${escapeHtml_(formName || "")}</div>
        </div>
        <div class="purchase-sheet-dates">
          <div>採購日期：${escapeHtml_(formatRocDateWithWeek_(dateOnly(po?.date) || ""))}</div>
          <div>到貨日期：${escapeHtml_(formatRocDateWithWeek_(dateOnly(po?.arrival_date) || po?.date || ""))}</div>
        </div>
        <table class="purchase-sheet-table">
          <thead>
            <tr>
              <th style="width:4%;"></th>
              <th style="width:13%;">品　名</th>
              <th style="width:14%;">規　格</th>
              <th style="width:9%;">廠　商</th>
              <th style="width:8%;">訂購<br>數量</th>
              <th style="width:6%;">收貨<br>日期</th>
              <th style="width:6%;">優先檢驗<br>順序</th>
              <th style="width:7%;">收據<br>重量</th>
              <th style="width:7%;">單　價</th>
              <th style="width:7%;">驗收<br>重量</th>
              <th style="width:5%;">驗收<br>結果</th>
              <th style="width:5%;">農藥<br>檢驗</th>
              <th style="width:9%;">備　註</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join("")}
          </tbody>
        </table>
        <div class="purchase-sheet-signs">
          <div>製表人：</div>
          <div>驗收：</div>
          <div>倉管：</div>
          <div>採購：</div>
          <div>經理：</div>
          <div>會計：</div>
          <div>執行長：</div>
        </div>
      </div>
    </div>
  `;
}

function printPurchaseById(poId){
  let po = null;
  if (poId) {
    po = (purchases || []).find(x => String(x.po_id) === String(poId));
  }
  if (!po) {
    const payload = getPurchasePayload_(purchaseEditingState_.stock_applied ? "complete" : "draft");
    if (!payload) return;
    po = payload;
  }
  const html = buildPurchaseDocHtml_(po);
  const styles = `
    <style>
      @page { size: A4 landscape; margin: 8mm; }
      html, body { margin:0; padding:0; background:#fff; }
      body { color:#111; }
      .purchase-sheet-wrap { max-width:none; }
      .purchase-sheet-card { border:none; padding:0; }
      .purchase-sheet-table th:last-child,
      .purchase-sheet-table td:last-child { border-right:2px solid #000 !important; }
      .purchase-sheet-table { border-right:2px solid #000 !important; }
    </style>
  `;
  const w = window.open("", "_blank", "width=1400,height=900");
  if (!w) return alert("請允許瀏覽器開啟列印視窗");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>採購驗收單</title>${styles}</head><body>${html}<script>window.onload=function(){window.print();};<\/script></body></html>`);
  w.document.close();
}

function submitPurchase(mode = "draft") {
  const payload = getPurchasePayload_(mode);
  if (!payload) return;

  const action = isPurchaseEditing_() ? "update" : "add";
  gas({
    type: "managePurchase",
    action,
    po_id: payload.po_id || "",
    purchase: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || (mode === "complete" ? "完成驗收入庫失敗" : "儲存草稿失敗"));
      return;
    }

    LS.del("purchases");
    LS.del("products");
    LS.del("stockLedger");
    loadAdminProducts(true);
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();

    closePurchaseFormModal_(false);
    alert(res?.message || (mode === "complete" ? "採購驗收單已完成" : "採購驗收單已儲存"));
  });
}

window.openPurchaseFormModal_ = openPurchaseFormModal_;
window.closePurchaseFormModal_ = closePurchaseFormModal_;
window.editPurchase = loadPurchaseIntoForm;
window.printPurchase = printPurchaseById;
window.submitPurchase = submitPurchase;
window.resetPurchaseForm_ = resetPurchaseForm_;
