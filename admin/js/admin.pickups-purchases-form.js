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
    const rawPid = tr.querySelector(".pu-product-id")?.value || "";
    const p = findPurchaseProductBySkuOrId_(rawPid);
    const pid = p ? purchaseProductPrimaryKey_(p) : String(rawPid || "").trim();
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
    const p = findPurchaseProductBySkuOrId_(it);
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

let purchaseEditingState_ = { po_id: "", stock_applied: 0, source_order_id: "", auto_generated: 0, base_version: "", updated_at: "", updated_by: "", lock_token: "", lock_until: "", locked_by: "", locked_by_name: "" };
let purchaseFormRevision_ = 0;
let purchaseSubmitLocked_ = false;
let purchaseLockRenewTimer_ = null;
let purchaseLockWarningShown_ = false;
const PURCHASE_LOCK_RENEW_MS_ = 4 * 60 * 1000;

function purchaseVersionTextForState_(po){
  if (!po || !String(po?.po_id || "").trim()) return "";
  const raw = po?.version ?? po?.base_version ?? "";
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "0";
}

function purchaseLockOwner_(){
  const member = (typeof getMember === "function") ? getMember() : null;
  const id = String(member?.id || member?.username || "").trim();
  const name = String(member?.name || member?.username || id || "").trim();
  return {
    id: id || name || "unknown",
    name: name || id || "unknown",
    operator: id || name ? `${id || name}|${name || id}` : ""
  };
}

function purchaseLockRequest_(action, poId, lockToken, done){
  const owner = purchaseLockOwner_();
  gas({
    type: "managePurchase",
    action,
    po_id: String(poId || "").trim(),
    lock_token: String(lockToken || "").trim(),
    operator: owner.operator,
    locked_by: owner.id,
    locked_by_name: owner.name
  }, res => {
    if (typeof done === "function") done(res);
  }, 20000);
}

function stopPurchaseLockHeartbeat_(){
  if (purchaseLockRenewTimer_) {
    window.clearInterval(purchaseLockRenewTimer_);
    purchaseLockRenewTimer_ = null;
  }
}

function releasePurchaseEditLock_(options = {}){
  const poId = String(purchaseEditingState_.po_id || "").trim();
  const token = String(purchaseEditingState_.lock_token || "").trim();
  stopPurchaseLockHeartbeat_();
  if (!poId || !token) return;
  purchaseLockRequest_("releaseLock", poId, token, res => {
    if (!options.silent && res && res.status !== "ok") {
      console.warn("releasePurchaseEditLock_ failed", res);
    }
  });
}

function handlePurchaseLockLost_(res){
  stopPurchaseLockHeartbeat_();
  setPurchaseSubmitLocked_(true);
  if (purchaseLockWarningShown_) return;
  purchaseLockWarningShown_ = true;
  alert(res?.message || "採購驗收單編輯鎖已失效，請關閉後重新開啟編輯。");
}

function startPurchaseLockHeartbeat_(){
  stopPurchaseLockHeartbeat_();
  purchaseLockWarningShown_ = false;
  const poId = String(purchaseEditingState_.po_id || "").trim();
  const token = String(purchaseEditingState_.lock_token || "").trim();
  if (!poId || !token) return;
  purchaseLockRenewTimer_ = window.setInterval(() => {
    purchaseLockRequest_("renewLock", poId, token, res => {
      if (!res || res.status !== "ok") {
        handlePurchaseLockLost_(res);
        return;
      }
      purchaseEditingState_.lock_until = String(res.lock_until || purchaseEditingState_.lock_until || "").trim();
      const infoEl = document.getElementById("po-editing-info");
      if (infoEl && purchaseEditingState_.po_id) {
        const versionText = purchaseEditingState_.base_version !== "" ? `｜版本 ${purchaseEditingState_.base_version}` : "";
        const lockText = purchaseEditingState_.lock_until ? `｜鎖定至 ${purchaseEditingState_.lock_until}` : "";
        infoEl.textContent = `編輯中：${purchaseEditingState_.po_id}${versionText}${lockText}`;
      }
    });
  }, PURCHASE_LOCK_RENEW_MS_);
}

function isPurchaseLockBlockedResponse_(res){
  const status = String(res?.status || "").trim().toLowerCase();
  const code = String(res?.code || "").trim();
  return status === "locked" || code === "PURCHASE_LOCKED";
}

function isPurchaseLockConflictResponse_(res){
  const status = String(res?.status || "").trim().toLowerCase();
  const code = String(res?.code || "").trim();
  return status === "conflict" && /^PURCHASE_LOCK_/.test(code);
}

function purchaseLockMetaText_(res){
  const by = String(res?.locked_by_name || res?.locked_by || "").trim();
  const until = String(res?.lock_until || "").trim();
  return [by ? `編輯者：${by}` : "", until ? `鎖定至：${until}` : ""].filter(Boolean).join("\n");
}

function acquirePurchaseEditLock_(po, done){
  const poId = String(po?.po_id || "").trim();
  if (!poId) return alert("缺少採購驗收單編號");
  purchaseLockRequest_("acquireLock", poId, "", res => {
    if (res && res.status === "ok" && res.lock_token) {
      if (typeof done === "function") done({
        ...po,
        lock_token: res.lock_token,
        lock_until: res.lock_until || "",
        locked_by: res.locked_by || "",
        locked_by_name: res.locked_by_name || ""
      });
      return;
    }
    if (isPurchaseLockBlockedResponse_(res)) {
      const meta = purchaseLockMetaText_(res);
      const force = window.confirm(`${res?.message || "此採購驗收單目前有人編輯中。"}${meta ? `\n\n${meta}` : ""}\n\n要強制解鎖並接手編輯嗎？`);
      if (!force) return;
      purchaseLockRequest_("forceReleaseLock", poId, "", forceRes => {
        if (!forceRes || forceRes.status !== "ok") {
          alert(forceRes?.message || "強制解鎖失敗，請稍後再試");
          return;
        }
        acquirePurchaseEditLock_(po, done);
      });
      return;
    }
    alert(res?.message || "取得採購驗收單編輯鎖失敗，請稍後再試");
  });
}

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
  try {
    if (typeof deleteCachedPurchaseDetail_ === "function") deleteCachedPurchaseDetail_(target);
    if (typeof persistPurchasesSummaryCache_ === "function") persistPurchasesSummaryCache_(list);
  } catch (e) { console.error("removePurchaseLocalById_ cache cleanup failed", e); }
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
    const p = findPurchaseProductBySkuOrId_(it);
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

function syncPurchaseSuggestedDisplay_(rowOrTr, value, unitText, options = {}){
  const tr = rowOrTr && rowOrTr.closest ? rowOrTr.closest("tr") : rowOrTr;
  if (!tr) return;
  const hiddenEl = tr.querySelector('.po-suggested-qty');
  const textEl = tr.querySelector('.po-suggested-text');
  const wrapEl = tr.querySelector('.po-suggested-hint');
  const normalized = formatPurchaseQtyText_(value, true);
  if (hiddenEl) hiddenEl.value = normalized;
  const isZeroNotice = !!options.zeroNotice && normalized !== "" && safeNum(normalized, 0) <= 0;
  if (textEl) {
    textEl.textContent = normalized
      ? (isZeroNotice ? `目前還有庫存（建議訂購：${appendUnitText_(normalized, unitText)}）` : appendUnitText_(normalized, unitText))
      : "";
  }
  if (wrapEl) {
    wrapEl.style.display = normalized ? 'block' : 'none';
    wrapEl.setAttribute('aria-hidden', normalized ? 'false' : 'true');
    wrapEl.classList.toggle('is-stock-enough', isZeroNotice);
  }
}

function syncPurchaseCustomerOrderDisplay_(rowOrTr, value, unitText){
  const tr = rowOrTr && rowOrTr.closest ? rowOrTr.closest("tr") : rowOrTr;
  if (!tr) return;
  const hiddenEl = tr.querySelector('.po-customer-order-qty');
  const textEl = tr.querySelector('.po-order-text');
  const wrapEl = tr.querySelector('.po-order-hint');
  const normalized = formatPurchaseQtyText_(value, true);
  if (hiddenEl) hiddenEl.value = normalized;
  if (textEl) textEl.textContent = normalized ? appendUnitText_(normalized, unitText) : "";
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
  if (!keepState) releasePurchaseEditLock_({ silent: true });
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
    auto_generated: Number(po?.auto_generated || 0) ? 1 : 0,
    base_version: purchaseVersionTextForState_(po),
    updated_at: String(po?.updated_at || "").trim(),
    updated_by: String(po?.updated_by || "").trim(),
    lock_token: String(po?.lock_token || "").trim(),
    lock_until: String(po?.lock_until || "").trim(),
    locked_by: String(po?.locked_by || "").trim(),
    locked_by_name: String(po?.locked_by_name || "").trim()
  };
  const idEl = document.getElementById("po-current-id");
  const saEl = document.getElementById("po-current-stock-applied");
  const infoEl = document.getElementById("po-editing-info");
  const cancelEl = document.getElementById("po-cancel-edit");
  if (idEl) idEl.value = purchaseEditingState_.po_id;
  if (saEl) saEl.value = String(purchaseEditingState_.stock_applied);
  if (infoEl) {
    infoEl.style.display = purchaseEditingState_.po_id ? "inline-flex" : "none";
    const versionText = purchaseEditingState_.base_version !== "" ? `｜版本 ${purchaseEditingState_.base_version}` : "";
    const lockText = purchaseEditingState_.lock_until ? `｜鎖定至 ${purchaseEditingState_.lock_until}` : "";
    infoEl.textContent = purchaseEditingState_.po_id ? `編輯中：${purchaseEditingState_.po_id}${versionText}${lockText}` : "";
  }
  if (cancelEl) cancelEl.style.display = purchaseEditingState_.po_id ? "inline-flex" : "none";
}

function clearPurchaseEditingState_(){
  stopPurchaseLockHeartbeat_();
  setPurchaseEditingState_(null);
  setPurchaseSubmitLocked_(false);
}

function isPurchaseEditing_(){
  return !!String(purchaseEditingState_.po_id || document.getElementById("po-current-id")?.value || "").trim();
}

function supplierIdText_(supplier){
  return String(supplier?.id || supplier?.supplier_id || "").trim();
}

function supplierDisplayName_(supplier){
  const sid = supplierIdText_(supplier);
  return String(supplier?.name || supplier?.supplier_name || sid).trim();
}

function supplierNameById_(sid){
  const id = String(sid || "").trim();
  if (!id) return "";
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  const s = (list || []).find(x => supplierIdText_(x) === id);
  return s ? supplierDisplayName_(s) : "";
}

function findSupplierByIdOrName_(value){
  const text = String(value || "").trim();
  if (!text) return null;
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  return (list || []).find(s => {
    const sid = supplierIdText_(s);
    const name = supplierDisplayName_(s);
    return sid === text || name === text;
  }) || null;
}

function resolvePurchaseSupplierIdForItem_(item){
  const id = String(item?.supplier_id ?? item?.supplierId ?? item?.sid ?? "").trim();
  if (id) {
    const byId = findSupplierByIdOrName_(id);
    return String(byId?.id || byId?.supplier_id || id).trim();
  }
  const name = String(item?.supplier_name ?? item?.supplierName ?? item?.supplier ?? "").trim();
  if (!name) return "";
  const byName = findSupplierByIdOrName_(name);
  return String(byName?.id || byName?.supplier_id || "").trim();
}

function primarySupplierName_(p){
  const ids = parseSupplierIds_(p);
  return supplierNameById_(ids[0] || "");
}


function purchaseProductSkuText_(p){
  return String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "").trim();
}

function purchaseProductIdText_(p){
  return String(p?.id ?? p?.product_id ?? p?.raw_id ?? "").trim();
}

function purchaseProductPrimaryKey_(p){
  return purchaseProductSkuText_(p) || purchaseProductIdText_(p);
}

function findPurchaseProductBySkuOrId_(valueOrItem){
  const list = adminProducts.length ? adminProducts : LS.get("products", []);
  const item = (valueOrItem && typeof valueOrItem === "object") ? valueOrItem : null;
  const candidates = item
    ? [item.sku, item.SKU, item.product_sku, item.item_sku, item.part_no, item.code, item["料號"], item.product_id, item.product_internal_id, item.raw_id, item.id]
    : [valueOrItem];
  const keys = candidates.map(v => String(v ?? "").trim()).filter(Boolean);
  for (const key of keys) {
    const bySku = (list || []).find(x => purchaseProductSkuText_(x) === key);
    if (bySku) return bySku;
  }
  for (const key of keys) {
    const byId = (list || []).find(x => purchaseProductIdText_(x) === key);
    if (byId) return byId;
  }
  return null;
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
  const p = findPurchaseProductBySkuOrId_(pid);
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

  let usable = (list || [])
    .filter(s => supplierIdText_(s))
    .filter(s => !allowSet || allowSet.has(supplierIdText_(s)));

  if (prev && !usable.some(s => supplierIdText_(s) === prev)) {
    const preferred = findSupplierByIdOrName_(prev);
    usable = usable.concat(preferred || { id: prev, name: supplierNameById_(prev) || prev });
  }

  if (!usable.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = allowSet ? "（此商品尚無對應供應商）" : "（尚無供應商，請先新增）";
    selectEl.appendChild(opt);
    selectEl.value = "";
    return;
  }

  usable.forEach(s => {
    const sid = supplierIdText_(s);
    const opt = document.createElement("option");
    opt.value = sid;
    opt.textContent = supplierDisplayName_(s);
    selectEl.appendChild(opt);
  });

  if (prev && usable.some(s => supplierIdText_(s) === prev)) {
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
      return { value: purchaseProductPrimaryKey_(p), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
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
      return { value: purchaseProductPrimaryKey_(p), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
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
  return truncateDecimalNumber_(n, scale, 0);
}

function roundPurchaseQtyNumber_(v){
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return truncateDecimalNumber_(n, 2, 0);
}

function formatPurchaseQtyText_(v, keepTrailingZero = false){
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return String(v ?? "").trim();
  // 採購公斤數最多保留 1 位小數；整數不顯示 .0，例如 130.0 -> 130、130.4 -> 130.4
  const truncated = truncateDecimalNumber_(n, 2, 0);
  if (keepTrailingZero && !Number.isInteger(truncated)) return truncated.toFixed(2);
  return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizePurchaseQtyInput_(inputEl){
  if (!inputEl) return;
  const txt = formatPurchaseQtyText_(inputEl.value, true);
  if (txt) inputEl.value = txt;
}

function escapeRegexText_(text){
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePurchaseMeasurementText_(value, unitText, keepTrailingZero = true){
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const unit = String(unitText || "").trim();
  const unitPattern = unit ? escapeRegexText_(unit) : "";
  const re = unitPattern
    ? new RegExp("^\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*" + unitPattern + "\\s*$", "i")
    : /^\s*([-+]?\d+(?:\.\d+)?)\s*$/i;
  const hit = raw.match(re) || raw.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*(公斤|kg|KG|斤|臺斤|台斤)?\s*$/);
  if (!hit) return unit ? appendUnitText_(raw, unit) : raw;
  const rounded = formatPurchaseQtyText_(hit[1], keepTrailingZero);
  const finalUnit = unit || String(hit[2] || "").trim();
  return finalUnit ? `${rounded} ${finalUnit}`.trim() : rounded;
}

function mulDecimalInput_(a, b, maxScale = 6){
  const na = Number(String(a ?? "").replace(/,/g, "").trim() || 0);
  const nb = Number(String(b ?? "").replace(/,/g, "").trim() || 0);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return 0;
  const scale = Math.min(decimalPlacesInput_(a) + decimalPlacesInput_(b), maxScale);
  return truncateDecimalNumber_(na * nb, scale, 0);
}

function addDecimalInput_(a, b, maxScale = 6){
  const na = Number(a || 0);
  const nb = Number(b || 0);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return 0;
  const scale = Math.min(Math.max(decimalPlacesInput_(a), decimalPlacesInput_(b)), maxScale);
  return truncateDecimalNumber_(na + nb, scale, 0);
}

function calcSuggestedQtyForProduct_(p, customerOrderQty){
  const stock = safeNum(p?.stock, 0);
  const safety = safeNum(p?.safety_stock, 0);
  const qty = safeNum(customerOrderQty, 0);
  return roundPurchaseQtyNumber_(Math.max(0, qty + safety - stock));
}

function resolvePurchaseCostInputValue_(item){
  const rawText = String(item?.cost_raw ?? "").trim();
  if (rawText) return rawText;
  const costText = String(item?.cost ?? "").trim();
  if (!costText || costText === "0" || costText === "0.0" || costText === "0.00") return "";
  return costText;
}

function purchaseProductDefaultCostText_(p){
  const raw = p?.cost ?? p?.purchase_price ?? p?.in_price ?? "";
  const text = String(raw ?? "").replace(/,/g, "").trim();
  if (!text) return "";
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(cleanDecimalInput_(text, 6));
}

function resolvePurchaseCostWithProductDefault_(item){
  const storedText = resolvePurchaseCostInputValue_(item);
  if (storedText) return storedText;
  return purchaseProductDefaultCostText_(findPurchaseProductBySkuOrId_(item));
}

function applyPurchaseDefaultCost_(costEl, p){
  if (!costEl) return false;
  const current = String(costEl.value || "").trim();
  if (current && costEl.dataset.autoCost !== "1") return false;
  const defaultCost = purchaseProductDefaultCostText_(p);
  if (!defaultCost) return false;
  costEl.value = defaultCost;
  costEl.dataset.autoCost = "1";
  return true;
}

function clearPurchaseCostInput_(costEl){
  if (!costEl) return;
  costEl.value = "";
  delete costEl.dataset.autoCost;
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
            <input type="number" id="${rowUid}-qty" name="purchase_qty" class="po-qty admin-input" value="${escapeAttr_(formatPurchaseQtyText_(initData.qty_raw ?? initData.qty ?? 1, true) || '1')}" min="0" step="0.01" />
            <span class="po-unit-inline"></span>
          </div>
          <div class="po-order-hint" aria-hidden="true">客戶訂單：<span class="po-order-text"></span></div>
        </div>
        <input type="hidden" id="${rowUid}-suggested-qty" name="purchase_suggested_qty" class="po-suggested-qty" value="${escapeAttr_(initData.suggested_qty ?? "")}" />
        <input type="hidden" id="${rowUid}-customer-order-qty" name="purchase_customer_order_qty" class="po-customer-order-qty" value="${escapeAttr_(((initData.customer_order_qty ?? '') !== '' && (initData.customer_order_qty ?? '') !== null) ? initData.customer_order_qty : (((initData.suggested_qty ?? '') !== '' && (initData.suggested_qty ?? '') !== null) ? (initData.qty ?? '') : ''))}" />
      </td>
      <td class="po-stock-cell"><div class="po-stock-main"><div class="po-stock-text">-</div><div class="po-suggested-hint" aria-hidden="true">建議訂購：<span class="po-suggested-text"></span></div></div></td>
      <td><input type="number" id="${rowUid}-cost" name="purchase_cost" class="po-cost admin-input" value="${escapeAttr_(resolvePurchaseCostInputValue_(initData))}" min="0" step="0.01" /></td>
      <td><input type="date" id="${rowUid}-receive-date" name="purchase_receive_date" class="po-receive-date admin-input" value="${escapeAttr_(initData.receive_date || "")}" /></td>
      <td><input type="text" id="${rowUid}-priority" name="purchase_inspection_priority" class="po-priority admin-input" value="${escapeAttr_(initData.inspection_priority || "")}" placeholder="例：1" /></td>
      <td><input type="text" id="${rowUid}-receipt-weight" name="purchase_receipt_weight" class="po-receipt-weight admin-input" value="${escapeAttr_(initData.receipt_weight || "")}" placeholder="例：12公斤" /></td>
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
      <td class="po-quality-check">合格</td>
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
    const initialSupplierId = resolvePurchaseSupplierIdForItem_(initData);

    const syncUnitInline = (unitText) => {
      if (!unitInlineEl) return;
      const text = String(unitText || "").trim();
      unitInlineEl.textContent = text || "";
      unitInlineEl.style.display = text ? "inline-block" : "none";
      if (receiptWeightEl) receiptWeightEl.placeholder = "例：12";
      if (acceptWeightEl) acceptWeightEl.placeholder = "例：11.8";
    };

    refillSupplierSelectForRow_(supSel, null, initialSupplierId);
    if (initialSupplierId && Array.from(supSel.options).some(o => String(o.value) === initialSupplierId)) {
      supSel.value = initialSupplierId;
    }

    const clearProduct = () => {
      hiddenId.value = "";
      inputEl.value = "";
      if (specCell) specCell.textContent = "-";
      clearPurchaseCostInput_(costEl);
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
      delete costEl.dataset.autoCost;
    };

    const getCustomerOrderQtyBase = () => {
      const explicit = String(customerOrderEl?.value || "").trim();
      if (explicit) return explicit;
      return String(qtyEl?.value || "").trim();
    };

    const syncSuggested = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = findPurchaseProductBySkuOrId_(pid);
      const unitText = p?.unit || initData.unit || "";
      if (!suggestedEl) return;
      syncPurchaseCustomerOrderDisplay_(tr, customerOrderEl?.value || "", unitText);
      if (!p) {
        const initialSuggested = initData.suggested_qty ?? "";
        syncPurchaseSuggestedDisplay_(tr, initialSuggested, unitText, {
          zeroNotice: String(initialSuggested ?? "").trim() !== "" && safeNum(initialSuggested, 0) <= 0
        });
        return;
      }
      const baseQty = getCustomerOrderQtyBase();
      const hasBase = String(baseQty || "").trim() !== "" && safeNum(baseQty, 0) > 0;
      const suggestedQty = hasBase ? calcSuggestedQtyForProduct_(p, baseQty) : "";
      syncPurchaseSuggestedDisplay_(tr, hasBase ? formatPurchaseQtyText_(suggestedQty, true) : "", unitText, {
        zeroNotice: hasBase && safeNum(suggestedQty, 0) <= 0
      });
    };

    const syncSubtotal = () => {
      syncSuggested();
      updatePurchaseTotal();
    };

    const applyProduct = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = findPurchaseProductBySkuOrId_(pid);
      const unitText = p?.unit || initData.unit || "";
      const allowedSupplierIds = getAllowedSupplierIdsForProduct_(pid);
      if (allowedSupplierIds.length) {
        const preferredSupplierId = String(supSel.value || initialSupplierId || "").trim();
        refillSupplierSelectForRow_(supSel, allowedSupplierIds, preferredSupplierId);
      } else {
        refillSupplierSelectForRow_(supSel, null, supSel?.value || initialSupplierId || "");
      }
      if (specCell) specCell.textContent = p?.spec || initData.spec || "-";
      syncUnitInline(unitText);
      if (stockTextEl) {
        stockTextEl.textContent = p ? formatQtyTextWithUnit_(p.stock ?? 0, unitText) : "-";
      }
      normalizePurchaseWeightInput_(receiptWeightEl, unitText);
      normalizePurchaseWeightInput_(acceptWeightEl, unitText);
      applyPurchaseDefaultCost_(costEl, p);
      syncSubtotal();
    };

    supSel.addEventListener("change", () => {
      const supplierId = String(supSel.value || "").trim();
      if (hiddenId.value && !hasSupplier_(findPurchaseProductBySkuOrId_(hiddenId.value), supplierId)) {
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
      const p = findPurchaseProductBySkuOrId_(hiddenId.value);
      if (p) hiddenId.value = purchaseProductPrimaryKey_(p);
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
        clearPurchaseCostInput_(costEl);
        refillSupplierSelectForRow_(supSel, null, supSel?.value || "");
        syncUnitInline("");
        syncPurchaseCustomerOrderDisplay_(tr, customerOrderEl?.value || "", "");
        syncPurchaseSuggestedDisplay_(tr, "", "");
      }
    });

    qtyEl.addEventListener("input", syncSubtotal);
    qtyEl.addEventListener("blur", () => { normalizePurchaseQtyInput_(qtyEl); syncSubtotal(); });
    costEl.addEventListener("input", () => {
      delete costEl.dataset.autoCost;
      syncSubtotal();
    });
    costEl.addEventListener("blur", () => {
      if (!String(costEl.value || "").trim()) {
        applyPurchaseDefaultCost_(costEl, findPurchaseProductBySkuOrId_(hiddenId.value || ""));
      }
      syncSubtotal();
    });
    receiptWeightEl?.addEventListener("blur", () => normalizePurchaseWeightInput_(receiptWeightEl, purchaseItemUnitText_(findPurchaseProductBySkuOrId_(hiddenId.value || "") || { unit: initData.unit || "" })));
    acceptWeightEl?.addEventListener("blur", () => normalizePurchaseWeightInput_(acceptWeightEl, purchaseItemUnitText_(findPurchaseProductBySkuOrId_(hiddenId.value || "") || { unit: initData.unit || "" })));

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

    if (initData.product_id || initData.sku) {
      const initKey = String(initData.sku || initData.product_id || "").trim();
      const p = findPurchaseProductBySkuOrId_(initData);
      hiddenId.value = p ? purchaseProductPrimaryKey_(p) : initKey;
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
    const qtyRaw = formatPurchaseQtyText_(tr.querySelector(".po-qty")?.value || "", true);
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
    const qtyRaw = formatPurchaseQtyText_((it?.qty_raw !== undefined && it?.qty_raw !== null) ? it.qty_raw : it?.qty, true);
    const costRaw = resolvePurchaseCostWithProductDefault_(it);
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
      const rawPid = tr.querySelector(".po-product-id")?.value || "";
      const p = findPurchaseProductBySkuOrId_(rawPid) || {};
      const pid = p && (p.id || p.sku || p.part_no || p.code) ? purchaseProductPrimaryKey_(p) : String(rawPid || "").trim();
      const qtyInputEl = tr.querySelector(".po-qty");
      const qtyRaw = formatPurchaseQtyText_(qtyInputEl?.value || "", true);
      if (qtyInputEl && qtyRaw) qtyInputEl.value = qtyRaw;
      const costInputEl = tr.querySelector(".po-cost");
      let costRaw = String(costInputEl?.value || "").trim();
      if (!costRaw) {
        const defaultCost = purchaseProductDefaultCostText_(p);
        if (defaultCost) {
          costRaw = defaultCost;
          if (costInputEl) {
            costInputEl.value = defaultCost;
            costInputEl.dataset.autoCost = "1";
          }
        }
      }
      const qty = roundPurchaseQtyNumber_(qtyRaw);
      const hasCostInput = costRaw !== "";
      const cost = hasCostInput ? cleanDecimalInput_(costRaw) : "";
      const suggestedRaw = String(tr.querySelector(".po-suggested-qty")?.value || "").trim();
      const suggested_qty = suggestedRaw === "" ? "" : roundPurchaseQtyNumber_(suggestedRaw);
      const customerOrderRaw = String(tr.querySelector(".po-customer-order-qty")?.value || "").trim();
      const customer_order_qty = customerOrderRaw === "" ? "" : roundPurchaseQtyNumber_(customerOrderRaw);
      const supId = tr.querySelector(".po-supplier")?.value || "";
      const supObj = findSupplierByIdOrName_(supId) || supList.find(s => supplierIdText_(s) === String(supId).trim());
      const supText = String(tr.querySelector(".po-supplier option:checked")?.textContent || "").trim();
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
        supplier_name: supplierDisplayName_(supObj) || supText || "",
        unit: p.unit || "",
        sku: purchaseProductSkuText_(p) || pid,
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
    .filter(it => {
      const hasCustomerOrder = safeNum(it.customer_order_qty, 0) > 0;
      const hasSuggestedValue = String(it.suggested_qty ?? "").trim() !== "";
      return it.product_id && it.supplier_id && (it.qty > 0 || hasCustomerOrder || hasSuggestedValue);
    });
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

  const invalid = items.find(it => {
    const hasCustomerOrder = safeNum(it.customer_order_qty, 0) > 0;
    const hasSuggestedValue = String(it.suggested_qty ?? "").trim() !== "";
    return !it.product_id || !it.supplier_id || it.qty < 0 || !(it.qty > 0 || hasCustomerOrder || hasSuggestedValue);
  });
  if (invalid) {
    alert("每個品項都必須選擇商品、供應商，且數量要大於 0");
    return null;
  }

  for (const it of items) {
    const p = findPurchaseProductBySkuOrId_(it);
    if (!p) return alert(`找不到商品 SKU/ID：${it.sku || it.product_id}`), null;
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
    base_version: String(purchaseEditingState_.base_version || "").trim(),
    lock_token: String(purchaseEditingState_.lock_token || "").trim(),
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
    bv: String(payload?.base_version ?? "").trim(),
    lt: String(payload?.lock_token ?? "").trim(),
    it: items.map(it => [
      String(it?.product_id || "").trim(),
      formatPurchaseQtyText_(it?.qty_raw ?? it?.qty ?? "", true),
      String(it?.cost_raw ?? it?.cost ?? "").trim(),
      String(it?.supplier_id || "").trim(),
      String(it?.receive_date || "").trim(),
      String(it?.inspection_priority || "").trim(),
      String(it?.receipt_weight || "").trim(),
      String(it?.accept_weight || "").trim(),
      String(it?.acceptance_result || "").trim(),
      String(it?.pesticide_result || "").trim(),
      String(it?.note || "").trim(),
      formatPurchaseQtyText_(it?.suggested_qty ?? "", true),
      formatPurchaseQtyText_(it?.customer_order_qty ?? "", true)
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
    const items = sortPurchaseItemsBySupplier_(Array.isArray(po.items) ? po.items : []);
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
  startPurchaseLockHeartbeat_();
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
    setPurchaseSubmitLocked_(false);
    addPurchaseRow({}, { revision: rev });
    syncPurchaseRowReceiveDates_(true);
    calcPurchaseTotal();
  });
}

function loadPurchaseIntoForm(poId){
  if (typeof fetchPurchaseDetail_ === "function") {
    fetchPurchaseDetail_(poId, (po, res) => {
      if (!po) {
        return alert((res?.message || "找不到採購驗收單") + "。為避免覆蓋別人的修改，編輯模式不使用本機快取。");
      }
      acquirePurchaseEditLock_(po, lockedPo => openPurchaseFormWithData_(lockedPo));
    }, { useCached: false, timeout: 45000 });
    return;
  }
  return alert("缺少採購驗收單明細讀取函式，無法取得編輯鎖");
}

function isPurchaseVersionConflictResponse_(res){
  const status = String(res?.status || "").trim().toLowerCase();
  const code = String(res?.code || "").trim();
  return status === "conflict" || code === "VERSION_CONFLICT" || code === "VERSION_REQUIRED";
}

function handlePurchaseVersionConflict_(poId, res){
  const target = String(poId || res?.po_id || purchaseEditingState_.po_id || "").trim();
  const by = String(res?.current_updated_by || "").trim();
  const at = String(res?.current_updated_at || "").trim();
  const currentVersion = String(res?.current_version ?? "").trim();
  const meta = [by ? `修改者：${by}` : "", at ? `時間：${at}` : "", currentVersion ? `目前版本：${currentVersion}` : ""].filter(Boolean).join("\n");
  const message = `${res?.message || "此採購驗收單已有新版資料，已停止覆蓋。"}${meta ? `\n\n${meta}` : ""}\n\n要重新載入最新資料嗎？\n（會覆蓋目前編輯畫面，請先確認目前畫面是否有需要保留的內容）`;
  if (!window.confirm(message)) return;
  if (!target || typeof fetchPurchaseDetail_ !== "function") return;
  if (typeof deleteCachedPurchaseDetail_ === "function") {
    try { deleteCachedPurchaseDetail_(target); } catch(e) {}
  }
  fetchPurchaseDetail_(target, (freshPo, freshRes) => {
    if (!freshPo) {
      alert(freshRes?.message || "重新載入最新資料失敗，請手動更新後再試");
      return;
    }
    openPurchaseFormWithData_(freshPo);
  }, { useCached: false, timeout: 45000 });
  if (typeof loadPurchases === "function") loadPurchases(true, { keepPage: true, forceRender: true });
}

function purchaseItemUnitText_(it){
  const p = findPurchaseProductBySkuOrId_(it);
  return String(
    it?.unit ||
    p?.unit ||
    ""
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
  inputEl.value = raw;
}


function buildPurchaseDocHtml_(po, options = {}){
  const allItems = sortPurchaseItemsBySupplier_(Array.isArray(po?.items) ? po.items : []);
  const PRINT_ROW_COUNT = Number(options?.rowCount || PURCHASE_TEMPLATE_MAX_ROWS_ || 16) || 16;
  const pageIndex = Math.max(1, Number(options?.pageIndex || 1));
  const pageCount = Math.max(1, Number(options?.pageCount || Math.ceil(allItems.length / PRINT_ROW_COUNT) || 1));
  const pageItems = Array.isArray(options?.items)
    ? sortPurchaseItemsBySupplier_(options.items)
    : allItems.slice((pageIndex - 1) * PRINT_ROW_COUNT, pageIndex * PRINT_ROW_COUNT);
  const formNo = po?.form_no || inferPurchaseFormNoByItems_(allItems);
  const formName = getPurchaseFormName_(formNo) || String(po?.form_name || "").trim();
  const visibleRows = pageItems.slice(0, PRINT_ROW_COUNT).map((it, idx) => {
    const unitText = purchaseItemUnitText_(it);
    const orderQtyText = appendUnitText_(formatPurchaseQtyText_(it.qty_raw ?? it.qty, true), unitText);
    const receiptWeightText = String(it.receipt_weight ?? "").trim();
    const acceptWeightText = String(it.accept_weight ?? "").trim();
    const costText = resolvePurchaseCostWithProductDefault_(it);
    return `
    <tr>
      <td class="purchase-col-no">${idx + 1}</td>
      <td class="purchase-col-name">${escapeHtml_(it.product_name ?? "")}</td>
      <td class="purchase-col-spec">${escapeHtml_(it.spec ?? "")}</td>
      <td class="purchase-col-supplier">${escapeHtml_(it.supplier_name ?? po.supplier_name ?? "")}</td>
      <td class="purchase-col-orderqty">${escapeHtml_(orderQtyText)}</td>
      <td class="purchase-col-price">${escapeHtml_(costText ? money(cleanDecimalInput_(costText)) : "")}</td>
      <td class="purchase-col-receive-date">${escapeHtml_(dateOnly(it.receive_date || "") || "")}</td>
      <td class="purchase-col-priority">${escapeHtml_(it.inspection_priority ?? "")}</td>
      <td class="purchase-col-receipt-weight">${escapeHtml_(receiptWeightText)}</td>
      <td class="purchase-col-accept-weight">${escapeHtml_(acceptWeightText)}</td>
      <td class="purchase-col-accept-result">${checkboxHtml_(it.acceptance_result)}</td>
      <td class="purchase-col-pesticide-result">${checkboxHtml_(it.pesticide_result)}</td>
      <td class="purchase-col-quality-check"><span class="purchase-check-result"><span>□合格</span></span></td>
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
        <td class="purchase-col-price"></td>
        <td class="purchase-col-receive-date"></td>
        <td class="purchase-col-priority"></td>
        <td class="purchase-col-receipt-weight"></td>
        <td class="purchase-col-accept-weight"></td>
        <td class="purchase-col-accept-result"><span class="purchase-check-result"><span>□合格</span><span>□退貨</span></span></td>
        <td class="purchase-col-pesticide-result"><span class="purchase-check-result"><span>□合格</span><span>□退貨</span></span></td>
        <td class="purchase-col-quality-check"><span class="purchase-check-result"><span>□合格</span></span></td>
        <td class="purchase-col-note"></td>
      </tr>
    `);
  }

  const pageHint = pageCount > 1
    ? `<div class="purchase-print-pagehint purchase-print-pagehint-alert"><span class="purchase-print-pagehint-badge">分頁單據</span><span>第 ${pageIndex} 張／共 ${pageCount} 張，請逐張核對。</span></div>`
    : "";

  return `
    <div class="purchase-print-wrap">
      <div class="purchase-print-title-row">
        <div class="purchase-print-title">社團法人屏東縣社會福利聯盟【採購驗收單】</div>
        <div class="purchase-print-formno">表格編號： ${escapeHtml_(formNo)} ${escapeHtml_(formName || "")}</div>
      </div>
      ${pageHint}
      <div class="purchase-print-dates">
        <div class="purchase-print-date purchase-print-date-left">採購日期：${escapeHtml_(formatRocDateWithWeek_(dateOnly(po?.date) || ""))}</div>
        <div class="purchase-print-date purchase-print-date-right">到貨日期：${escapeHtml_(formatRocDateWithWeek_(dateOnly(po?.arrival_date) || ""))}</div>
      </div>
      <table class="purchase-print-table">
        <colgroup>
          <col style="width:2.5%;">
          <col style="width:12.1%;">
          <col style="width:12.9%;">
          <col style="width:7.9%;">
          <col style="width:6.2%;">
          <col style="width:5.9%;">
          <col style="width:6%;">
          <col style="width:5.3%;">
          <col style="width:6.9%;">
          <col style="width:7.5%;">
          <col style="width:4.8%;">
          <col style="width:5%;">
          <col style="width:4.8%;">
          <col style="width:12.2%;">
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>品　名</th>
            <th>規　格</th>
            <th>廠　商</th>
            <th>訂購<br>數量</th>
            <th>單　價</th>
            <th>收　貨<br>日期</th>
            <th>優先檢驗<br>順序</th>
            <th>收　據<br>重量</th>
            <th>驗收<br>重量</th>
            <th>驗收<br>結果</th>
            <th>農藥<br>檢驗</th>
            <th>品管<br>抽查</th>
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

  const currentEditingPoId = String(purchaseEditingState_.po_id || document.getElementById("po-current-id")?.value || "").trim();
  const action = currentEditingPoId ? "update" : "add";
  if (action === "update" && !String(payload.po_id || "").trim()) {
    alert("編輯中的採購驗收單編號遺失，請重新開啟後再試一次");
    return;
  }

  const compactPayload = buildCompactPurchasePayload_(payload);
  const wasStockApplied = Number(purchaseEditingState_.stock_applied || 0) ? 1 : 0;
  const shouldApplyLocalStock = (mode === "complete" && !wasStockApplied && typeof applyPurchaseToLocalStock === "function");
  setPurchaseSubmitLocked_(true);

  gas({
    type: "managePurchase",
    action,
    po_id: payload.po_id || currentEditingPoId || "",
    purchase_compact: JSON.stringify(compactPayload)
  }, res => {
    if (!res || res.status !== "ok") {
      setPurchaseSubmitLocked_(false);
      if (isPurchaseLockConflictResponse_(res)) {
        handlePurchaseLockLost_(res);
        return;
      }
      if (isPurchaseVersionConflictResponse_(res)) {
        handlePurchaseVersionConflict_(payload.po_id || currentEditingPoId, res);
        return;
      }
      alert(res?.message || (mode === "complete" ? "完成驗收入庫失敗" : "儲存草稿失敗"));
      return;
    }

    const responseList = normalizeList(res);
    const savedPoId = String(res?.po_id || payload.po_id || currentEditingPoId || "").trim();
    if (action === "update" && currentEditingPoId && savedPoId && currentEditingPoId !== savedPoId) {
      setPurchaseSubmitLocked_(false);
      alert("系統回傳的採購單編號與原編輯單號不一致，已停止本次入庫，請重新整理後再試");
      return;
    }

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

    const finalizeSuccess_ = (verifiedPo) => {
      const confirmedPo = verifiedPo && Array.isArray(verifiedPo.items) ? verifiedPo : finalPo;
      removePurchaseLocalById_(savedPoId);
      if (typeof upsertPurchaseLocal_ === "function") upsertPurchaseLocal_(confirmedPo);
      if (shouldApplyLocalStock) {
        try { applyPurchaseToLocalStock(confirmedPo); } catch (e) { console.error("applyPurchaseToLocalStock failed", e); }
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
    };

    const expectedItemCount = Array.isArray(payload.items) ? payload.items.length : 0;
    fetchPurchaseDetail_(savedPoId, (verifiedPo, verifyRes) => {
      const verifiedItems = Array.isArray(verifiedPo?.items) ? verifiedPo.items.length : 0;
      const verifiedApplied = Number(verifiedPo?.stock_applied || 0) ? 1 : 0;
      const verifyOk = !!verifiedPo && verifiedItems >= expectedItemCount && (mode !== "complete" || verifiedApplied);
      if (!verifyOk) {
        setPurchaseSubmitLocked_(false);
        alert((mode === "complete" ? "入庫後驗收單未完整寫入，已中止前端成功狀態。請重新整理後確認此單是否仍為空單。" : "儲存後驗收單未完整寫入，請重新整理後再試。") + (verifyRes?.message ? `

系統訊息：${verifyRes.message}` : ""));
        return;
      }
      finalizeSuccess_(verifiedPo);
    }, { useCached: false, timeout: 45000 });
  }, 45000);
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


let purchaseDownloadNoticeEl_ = null;
function ensurePurchaseDownloadNotice_(){
  if (purchaseDownloadNoticeEl_ && document.body.contains(purchaseDownloadNoticeEl_)) return purchaseDownloadNoticeEl_;
  const el = document.createElement('div');
  el.id = 'purchase-download-notice';
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <div class="purchase-download-notice__backdrop"></div>
    <div class="purchase-download-notice__dialog" role="status" aria-modal="true">
      <div class="purchase-download-notice__spinner" aria-hidden="true"></div>
      <div class="purchase-download-notice__title">正在下載中</div>
      <div class="purchase-download-notice__text">系統正在背景產生驗收單 Excel，完成後會自動開始下載。</div>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #purchase-download-notice{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;}
    #purchase-download-notice.is-visible{display:flex;}
    #purchase-download-notice .purchase-download-notice__backdrop{position:absolute;inset:0;background:rgba(15,23,42,.36);}
    #purchase-download-notice .purchase-download-notice__dialog{position:relative;min-width:280px;max-width:min(92vw,420px);padding:22px 20px 18px;border-radius:18px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.22);display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;}
    #purchase-download-notice .purchase-download-notice__spinner{width:38px;height:38px;border-radius:999px;border:4px solid rgba(46,125,50,.16);border-top-color:#2E7D32;animation:purchase-download-spin 1s linear infinite;}
    #purchase-download-notice .purchase-download-notice__title{font-size:20px;font-weight:800;color:#1f2937;}
    #purchase-download-notice .purchase-download-notice__text{font-size:14px;line-height:1.7;color:#475569;}
    @keyframes purchase-download-spin{to{transform:rotate(360deg);}}
  `;
  el.appendChild(style);
  document.body.appendChild(el);
  purchaseDownloadNoticeEl_ = el;
  return el;
}
function showPurchaseDownloadNotice_(){
  const el = ensurePurchaseDownloadNotice_();
  el.classList.add('is-visible');
}
function hidePurchaseDownloadNotice_(){
  if (purchaseDownloadNoticeEl_) purchaseDownloadNoticeEl_.classList.remove('is-visible');
}

function buildPurchaseTemplateDownloadName_(poId, partIndex, partCount){
  const safeId = String(poId || "purchase").trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  const total = Number(partCount || 0);
  const index = Number(partIndex || 0);
  if (!(total > 1)) return `purchase_receipt_${safeId}.xlsx`;
  const suffixIndex = String(Math.max(1, index)).padStart(2, "0");
  const suffixTotal = String(Math.max(1, total)).padStart(2, "0");
  return `purchase_receipt_${safeId}_part${suffixIndex}_of${suffixTotal}.xlsx`;
}

function triggerDownloadByUrl_(url, filename){
  const raw = String(url || "").trim();
  if (!raw) return false;
  const a = document.createElement("a");
  a.href = raw;
  if (filename) a.download = filename;
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
  if (raw) return appendUnitText_(formatPurchaseQtyText_(raw, true), unit);
  const qty = purchaseTemplateDisplayText_(item?.qty);
  return appendUnitText_(formatPurchaseQtyText_(qty, true), unit);
}

function purchaseTemplateWeightText_(value){
  const raw = purchaseTemplateDisplayText_(value);
  if (!raw) return "";
  return raw;
}

function purchaseTemplatePriceValue_(value){
  const raw = purchaseTemplateDisplayText_(value);
  if (!raw) return "";
  const numeric = Number(raw.replace(/[$,\s]/g, ""));
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
    const rowRange = sheet.range(`A${row}:N${row}`);
    rowRange.style("horizontalAlignment", "center");
    rowRange.style("verticalAlignment", "center");
    const dateCell = sheet.cell(`G${row}`);
    dateCell.style("horizontalAlignment", "center");
    dateCell.style("verticalAlignment", "center");
    dateCell.style("numberFormat", "mm/dd");
    const priceCell = sheet.cell(`F${row}`);
    priceCell.style("horizontalAlignment", "center");
    priceCell.style("verticalAlignment", "center");
    priceCell.style("numberFormat", "0.00");
  }

  const items = Array.isArray(purchase?.items) ? purchase.items.slice(0, PURCHASE_TEMPLATE_MAX_ROWS_) : [];
  items.forEach((item, index) => {
    const row = PURCHASE_TEMPLATE_START_ROW_ + index;
    const unitText = purchaseItemUnitText_(item);
    sheet.cell(`B${row}`).value(purchaseTemplateDisplayText_(item?.product_name || item?.name));
    sheet.cell(`C${row}`).value(purchaseTemplateDisplayText_(item?.spec));
    sheet.cell(`D${row}`).value(purchaseTemplateDisplayText_(item?.supplier_name));
    sheet.cell(`E${row}`).value(purchaseTemplateQtyText_(item));
    const priceCell = sheet.cell(`F${row}`);
    priceCell.value(purchaseTemplatePriceValue_(resolvePurchaseCostWithProductDefault_(item)));
    priceCell.style("numberFormat", "0.00");
    const receiveDateCell = sheet.cell(`G${row}`);
    const receiveDate = purchaseTemplateMonthDayDateObject_(item?.receive_date || purchase?.arrival_date || "");
    receiveDateCell.value(receiveDate || purchaseTemplateMonthDayText_(item?.receive_date || purchase?.arrival_date || ""));
    receiveDateCell.style("numberFormat", "mm/dd");
    sheet.cell(`H${row}`).value(purchaseTemplateDisplayText_(item?.inspection_priority));
    sheet.cell(`I${row}`).value(purchaseTemplateWeightText_(item?.receipt_weight, unitText));
    sheet.cell(`J${row}`).value(purchaseTemplateWeightText_(item?.accept_weight, unitText));
    const acceptanceText = purchaseTemplateStatusText_(item?.acceptance_result);
    const pesticideText = purchaseTemplateStatusText_(item?.pesticide_result);
    if (acceptanceText !== null) sheet.cell(`K${row}`).value(acceptanceText);
    if (pesticideText !== null) sheet.cell(`L${row}`).value(pesticideText);
    sheet.cell(`N${row}`).value(purchaseTemplateDisplayText_(item?.note));
  });
}

function splitPurchaseTemplateItems_(purchase){
  const items = sortPurchaseItemsBySupplier_(Array.isArray(purchase?.items) ? purchase.items : []);
  if (!items.length) return [[]];
  const out = [];
  for (let i = 0; i < items.length; i += PURCHASE_TEMPLATE_MAX_ROWS_) {
    out.push(items.slice(i, i + PURCHASE_TEMPLATE_MAX_ROWS_));
  }
  return out;
}

async function buildPurchaseTemplateDownloadsAsync_(purchase){
  if (!window.XlsxPopulate || typeof window.XlsxPopulate.fromDataAsync !== "function") {
    throw new Error("Excel 模板函式庫尚未載入，請確認網路後重整頁面再試");
  }
  const buffer = await loadPurchaseTemplateArrayBufferAsync_();
  const itemChunks = splitPurchaseTemplateItems_(purchase);
  const totalParts = itemChunks.length;
  const outputs = [];

  for (let i = 0; i < itemChunks.length; i += 1) {
    const workbook = await window.XlsxPopulate.fromDataAsync(buffer.slice(0));
    const chunkPurchase = Object.assign({}, purchase, {
      items: itemChunks[i],
      __template_part_index: i + 1,
      __template_part_count: totalParts
    });
    fillPurchaseTemplateWorkbook_(workbook.sheet(0), chunkPurchase);
    const blob = await workbook.outputAsync();
    outputs.push({
      blob,
      filename: buildPurchaseTemplateDownloadName_(purchase?.po_id || "purchase", i + 1, totalParts)
    });
  }

  return outputs;
}

function openPurchasePrintTemplateEditor_(){
  if (isLocalFileProtocol_()) {
    alert(`你目前是在本機直接開啟 html 測試。請直接編輯專案內的 ${PURCHASE_TEMPLATE_LOCAL_HINT_}，重新打包後即可同步最新模板格式。`);
    return;
  }
  triggerDownloadByUrl_(getPurchaseTemplateXlsxUrl_(), 'purchase_receipt_template.xlsx');
}

async function printPurchaseById(poId){
  const targetPoId = String(poId || purchaseEditingState_.po_id || document.getElementById("po-current-id")?.value || "").trim();
  if (!targetPoId) {
    alert("驗收單下載只支援已儲存的採購驗收單，請先儲存草稿後再下載。");
    return;
  }

  try {
    showPurchaseDownloadNotice_();
    await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
    const templateReadyPromise = ensurePurchaseTemplateBufferReadyAsync_();
    const purchase = await fetchPurchaseDetailAsync_(targetPoId);
    await templateReadyPromise;
    const downloads = await buildPurchaseTemplateDownloadsAsync_(purchase);
    const revokeQueue = [];
    downloads.forEach((entry, index) => {
      const objectUrl = URL.createObjectURL(entry.blob);
      revokeQueue.push(objectUrl);
      window.setTimeout(() => {
        triggerDownloadByUrl_(objectUrl, entry.filename);
      }, index * 240);
    });
    window.setTimeout(() => {
      hidePurchaseDownloadNotice_();
      revokeQueue.forEach(url => {
        try { URL.revokeObjectURL(url); } catch (e) {}
      });
    }, Math.max(900, downloads.length * 320));
  } catch (err) {
    hidePurchaseDownloadNotice_();
    console.error('printPurchaseById failed', err);
    alert(err?.message || "驗收單下載失敗");
  }
}

window.openPurchaseFormModal_ = openPurchaseFormModal_;
window.closePurchaseFormModal_ = closePurchaseFormModal_;
window.editPurchase = loadPurchaseIntoForm;
window.printPurchase = printPurchaseById;
window.openPurchasePrintTemplateEditor_ = openPurchasePrintTemplateEditor_;
window.submitPurchase = submitPurchase;
window.resetPurchaseForm_ = resetPurchaseForm_;
window.addEventListener("beforeunload", () => releasePurchaseEditLock_({ silent: true }));
