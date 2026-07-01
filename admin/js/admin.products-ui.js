function productCategoryOf_(p) {
  return String(p?.category ?? "未分類").trim() || "未分類";
}

function getProductCategoriesFromProducts_(products) {
  const set = new Set();
  (products || []).forEach(p => set.add(productCategoryOf_(p)));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function getProductCategoryOptions_() {
  return getProductCategoriesFromProducts_(adminProducts || []).filter(Boolean);
}

function buildProductCategorySelectHtml_(id, value = "") {
  const current = String(value || "").trim();
  const options = getProductCategoryOptions_().slice();
  if (current && !options.includes(current)) options.push(current);
  const ordered = [];
  const seen = new Set();
  options.forEach(cat => {
    const key = String(cat || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  });
  const optionHtml = ordered.map(cat => {
    const selected = cat === current ? ' selected' : '';
    return `<option value="${escapeAttr_(cat)}"${selected}>${escapeAttr_(cat)}</option>`;
  }).join("");
  return `
    <select id="${id}" class="admin-input">
      <option value="">請選擇分類</option>
      ${optionHtml}
    </select>
  `;
}



function normalizeProductSkuForCompare_(v) {
  return String(v == null ? "" : v).trim().toUpperCase();
}

function productSkuText_(p) {
  return String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "").trim();
}

function findDuplicateProductSku_(sku, excludeId = "") {
  const key = normalizeProductSkuForCompare_(sku);
  const exclude = String(excludeId == null ? "" : excludeId).trim();
  if (!key) return null;
  const list = Array.isArray(adminProducts) ? adminProducts : [];
  return list.find(p => {
    const rowSku = normalizeProductSkuForCompare_(productSkuText_(p));
    if (!rowSku || rowSku !== key) return false;
    const rowId = String(p?.id ?? "").trim();
    return !exclude || rowId !== exclude;
  }) || null;
}

function validateRequiredUniqueProductSku_(sku, excludeId = "") {
  const raw = String(sku == null ? "" : sku).trim();
  if (!raw) {
    alert("料號為必填，請輸入商品料號");
    return false;
  }
  const dup = findDuplicateProductSku_(raw, excludeId);
  if (dup) {
    const dupName = String(dup.name ?? "").trim();
    alert(`料號不可重複：${raw}${dupName ? `\n已存在商品：${dupName}` : ""}`);
    return false;
  }
  return true;
}

function attachProductSkuDuplicateWatcher_(inputId, hintId, excludeId = "", saveBtnId = "") {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  const saveBtn = saveBtnId ? document.getElementById(saveBtnId) : null;
  if (!input) return;
  const update = () => {
    const raw = String(input.value || "").trim();
    let ok = true;
    input.classList.remove("is-invalid", "is-valid");
    if (!raw) {
      ok = false;
      input.classList.add("is-invalid");
      if (hint) {
        hint.className = "hint product-sku-check product-sku-check-error";
        hint.textContent = "料號為必填，不可留空。";
      }
    } else {
      const dup = findDuplicateProductSku_(raw, excludeId);
      if (dup) {
        ok = false;
        input.classList.add("is-invalid");
        if (hint) {
          const dupName = String(dup.name ?? "").trim();
          hint.className = "hint product-sku-check product-sku-check-error";
          hint.textContent = `料號已重複${dupName ? `：${dupName}` : ""}`;
        }
      } else {
        input.classList.add("is-valid");
        if (hint) {
          hint.className = "hint product-sku-check product-sku-check-ok";
          hint.textContent = "料號可使用。";
        }
      }
    }
    if (saveBtn) saveBtn.disabled = !ok;
    return ok;
  };
  input.addEventListener("input", update);
  input.addEventListener("blur", () => { input.value = String(input.value || "").trim(); update(); });
  setTimeout(update, 0);
}

function normalizeShopEnabledFront_(v, defaultEnabled = true) {
  const raw = String(v == null ? "" : v).trim().toLowerCase();
  if (!raw) return defaultEnabled;
  return !(["0","false","no","off","n","hide","hidden"].includes(raw));
}

function isShopVisible_(p) {
  return normalizeShopEnabledFront_(p?.shop_enabled, true);
}

function shopVisibleText_(p) {
  return isShopVisible_(p) ? "顯示" : "隱藏";
}


function getSelectedProductCategories_() {
  const box = document.getElementById("product-cat-list");
  if (!box) return null;
  const checks = Array.from(box.querySelectorAll('input[type="checkbox"][data-cat]'));
  return checks.filter(x => x.checked).map(x => String(x.dataset.cat || ""));
}

function setAllProductCategories_(checked) {
  const box = document.getElementById("product-cat-list");
  if (!box) return;
  Array.from(box.querySelectorAll('input[type="checkbox"][data-cat]')).forEach(x => { x.checked = !!checked; });
  updateProductCatSummary_();
}

function updateProductCatSummary_() {
  const box = document.getElementById("product-cat-list");
  const summary = document.getElementById("product-cat-summary");
  if (!box || !summary) return;
  const all = Array.from(box.querySelectorAll('input[type="checkbox"][data-cat]'));
  const sel = all.filter(x => x.checked);
  if (!all.length) {
    summary.textContent = "（尚未載入商品分類）";
    return;
  }
  summary.textContent = `（已選 ${sel.length} / ${all.length}）`;
}

function filterProductsBySelectedProductCats_(products, selectedCats) {
  if (!selectedCats) return (products || []);
  const set = new Set(selectedCats);
  return (products || []).filter(p => set.has(productCategoryOf_(p)));
}

function getFilteredAdminProductsByUI_() {
  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const selectedCats = getSelectedProductCategories_();

  let filtered = filterProductsBySelectedProductCats_(adminProducts || [], selectedCats);

  if (keyword) {
    filtered = filtered.filter(p => {
      const name = String(p.name || "").toLowerCase();
      const sku = String(p.sku ?? p.part_no ?? p.code ?? p["料號"] ?? p.id ?? "").toLowerCase();
      const id = String(p.id || "").toLowerCase();
      const sup = String(p.supplier_names || p.supplier_name || "").toLowerCase();
      const spec = String(p.spec || "").toLowerCase();
      return name.includes(keyword) || sku.includes(keyword) || id.includes(keyword) || sup.includes(keyword) || spec.includes(keyword);
    });
  }

  return filtered;
}

function renderFilteredAdminProducts_(page = 1) {
  const _page = (Number.isFinite(Number(page)) && Number(page) > 0) ? Number(page) : 1;
  renderAdminProducts(getFilteredAdminProductsByUI_(), _page);
}

function renderCategoryFilter(products) {
  const container = document.getElementById("category-filter");
  if (!container) return;

  const categories = getProductCategoriesFromProducts_(products);
  const prevSel = new Set((getSelectedProductCategories_() || []));
  const hadPrev = prevSel.size > 0;

  container.innerHTML = `
    <div class="admin-toolbar" style="margin-top:4px;">
      <span class="pill">分類篩選</span>
      <button id="product-cat-all" class="admin-btn" type="button">全選</button>
      <button id="product-cat-none" class="admin-btn" type="button">全不選</button>
      <span class="muted" id="product-cat-summary">（尚未載入商品分類）</span>
    </div>
    <div id="product-cat-list" class="report-cat-list"></div>
    <p class="hint">提示：商品主檔會依勾選分類篩選，預設為全部勾選。</p>
  `;

  const box = document.getElementById("product-cat-list");
  if (!box) return;

  categories.forEach(cat => {
    const id = `product-cat-${cat.replace(/[^a-zA-Z0-9一-鿿]/g, "_")}`;
    const label = document.createElement("label");
    label.className = "report-cat-item";
    label.innerHTML = `
      <input type="checkbox" id="${id}" data-cat="${cat}">
      <span>${cat}</span>
    `;
    const input = label.querySelector("input");
    input.checked = hadPrev ? prevSel.has(cat) : true;
    box.appendChild(label);
  });

  updateProductCatSummary_();

  document.getElementById("product-cat-all")?.addEventListener("click", () => {
    setAllProductCategories_(true);
    renderFilteredAdminProducts_(1);
  });

  document.getElementById("product-cat-none")?.addEventListener("click", () => {
    setAllProductCategories_(false);
    renderFilteredAdminProducts_(1);
  });

  box.addEventListener("change", () => {
    updateProductCatSummary_();
    renderFilteredAdminProducts_(1);
  });
}

function searchProducts(keepPageNo = null) {
  const _page = (Number.isFinite(Number(keepPageNo)) && Number(keepPageNo) > 0) ? Number(keepPageNo) : 1;
  renderFilteredAdminProducts_(_page);
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

function roundedPriceNumber_(v){
  const n = parsePriceNumber_(v);
  return Number.isFinite(n) ? round2Num(n, NaN) : NaN;
}

function roundedPriceText_(v, d = ""){
  const n = roundedPriceNumber_(v);
  return Number.isFinite(n) ? num2TextSmart(n, d) : d;
}

function referencePriceText_(v){
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? roundedPriceText_(n) : s;
}

function parsePriceNumber_(v){
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function getCostReferenceSignal_(costValue, referenceValue){
  const cost = roundedPriceNumber_(costValue);
  const ref = roundedPriceNumber_(referenceValue);
  if (!Number.isFinite(cost) || !Number.isFinite(ref) || cost <= 0 || ref <= 0) {
    return { tone: "", valueClass: "", message: "", cost: cost, reference: ref };
  }
  if (cost > ref) {
    return { tone: "high", valueClass: "price-signal-high", message: `進價高於參考價格（進價 ${roundedPriceText_(cost)}，參考價格 ${roundedPriceText_(ref)}）`, cost, reference: ref };
  }
  if ((ref - cost) >= 10) {
    return { tone: "low", valueClass: "price-signal-low", message: `進價低於參考價格 10 元以上（進價 ${roundedPriceText_(cost)}，參考價格 ${roundedPriceText_(ref)}）`, cost, reference: ref };
  }
  return { tone: "", valueClass: "", message: "", cost, reference: ref };
}

function applyCostReferenceSignalToInput_(inputEl, noteEl, costValue, referenceValue){
  if (!inputEl) return;
  const signal = getCostReferenceSignal_(costValue, referenceValue);
  inputEl.classList.remove("price-signal-high", "price-signal-low");
  noteEl?.classList.remove("price-signal-high", "price-signal-low");
  if (signal.valueClass) {
    inputEl.classList.add(signal.valueClass);
    noteEl?.classList.add(signal.valueClass);
  }
  if (noteEl) noteEl.textContent = signal.tone && signal.tone !== "same" ? signal.message : "";
}

function shortTableDate_(value){
  const full = dateOnly(value || "");
  if (!full) return { short: "—", full: "" };
  const m = full.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { short: full, full };
  return { short: `${m[2]}/${m[3]}`, full };
}

function parseCategoryDisplay_(value){
  const raw = String(value || "").trim();
  if (!raw) return { main: "—", sub: "" };
  const m = raw.match(/^(\S+)\s+(.+)$/);
  if (m) return { main: m[1], sub: m[2] };
  return { main: raw, sub: "" };
}

function makeFittableProductCell_(td, value, cls){
  td.className = cls || "";
  td.textContent = "";
  const span = document.createElement("span");
  span.className = "product-cell-fit";
  span.textContent = String(value ?? "");
  td.appendChild(span);
}

function makeBadgeProductCell_(td, text, tone, cls){
  td.className = cls || "";
  td.textContent = "";
  const span = document.createElement("span");
  span.className = `product-badge ${tone || "muted"}`;
  span.textContent = String(text || "—");
  td.appendChild(span);
}

function makeMetaProductCell_(td, mainText, subText, cls){
  td.className = cls || "";
  td.textContent = "";
  const wrap = document.createElement('div');
  wrap.className = 'product-meta';
  const main = document.createElement('div');
  main.className = 'product-meta-main';
  main.textContent = String(mainText || '—');
  wrap.appendChild(main);
  if (String(subText || '').trim()) {
    const sub = document.createElement('div');
    sub.className = 'product-meta-sub';
    sub.textContent = String(subText || '');
    wrap.appendChild(sub);
  }
  td.appendChild(wrap);
}

function fitProductTableCells_(){
  const table = document.getElementById("admin-product-table");
  if (!table) return;
  const fitTargets = Array.from(table.querySelectorAll('tbody td .product-cell-fit'));
  fitTargets.forEach(span => {
    const td = span.parentElement;
    if (!td) return;
    const tdCls = String(td.className || "");
    span.style.fontSize = '';
    span.style.letterSpacing = '';
    span.style.transform = '';
    span.style.transformOrigin = '';
    if (/(product-cell-unit|product-cell-price|product-cell-cost|product-cell-ref|product-cell-stock|product-cell-safety|product-cell-shop)/.test(tdCls)) {
      span.style.whiteSpace = 'nowrap';
      span.style.overflowWrap = 'normal';
      span.style.wordBreak = 'keep-all';
    } else {
      span.style.whiteSpace = 'normal';
      span.style.overflowWrap = 'anywhere';
      span.style.wordBreak = 'break-word';
    }
  });
}

function latestReferencePriceDateFromProducts_(products){
  const list = Array.isArray(products) ? products : [];
  let latest = "";
  list.forEach(p => {
    const d = dateOnly(p?.reference_price_date ?? "");
    if (d && (!latest || d > latest)) latest = d;
  });
  return latest;
}

function updateProductTableLatestReferenceDate_(products){
  const el = document.getElementById("product-table-latest-ref-date");
  if (!el) return;
  const latest = latestReferencePriceDateFromProducts_(products);
  el.textContent = `最新參考價格日期：${latest || "—"}`;
}

let marketPriceBoardCache_ = null;
let marketPriceBoardLoadedAt_ = 0;
let marketPriceBoardLoading_ = null;
let marketPriceBoardRetryTimer_ = null;

function marketPriceBoardDefs_(){
  return [
    { key: "FirstMarket", tbodyId: "market-price-first-body", label: "台北第一果菜市場" },
    { key: "SecondMarket", tbodyId: "market-price-second-body", label: "台北第二果菜市場" },
    { key: "Pingtung", tbodyId: "market-price-pingtung-body", label: "屏東果菜市場" }
  ];
}

function escapeHtmlSimple_(v){
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function marketReferencePriceForSignal_(row){
  if (!row || typeof row !== "object") return "";
  return row.reference_price ?? row.ref_price ?? row.middle_price ?? row.upper_price ?? row.lower_price ?? "";
}

function renderMarketBoardTextCell_(value, tdClass, valueClass, title){
  const tdCls = String(tdClass || "").trim();
  const spanCls = ["product-cell-fit", valueClass || ""].filter(Boolean).join(" ");
  const safeTitle = title ? ` title="${escapeHtmlSimple_(title)}"` : "";
  return `<td${tdCls ? ` class="${escapeHtmlSimple_(tdCls)}"` : ""}${safeTitle}><span class="${escapeHtmlSimple_(spanCls)}">${escapeHtmlSimple_(value ?? "")}</span></td>`;
}

function fillMarketPriceBoardBody_(tbodyId, rows, emptyText){
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted center-cell">${escapeHtmlSimple_(emptyText || "目前沒有可顯示資料")}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(row => {
    const sku = row.sku || row.product_id || "";
    const name = row.product_name || "";
    const costText = roundedPriceText_(row.cost, "—");
    const refForSignal = marketReferencePriceForSignal_(row);
    const costSignal = getCostReferenceSignal_(row.cost, refForSignal);
    const suggestedPrice = roundedPriceText_(row.price, "—");
    const upper = roundedPriceText_(row.upper_price, "—");
    const middle = roundedPriceText_(row.middle_price, "—");
    const lower = roundedPriceText_(row.lower_price, "—");
    const marketDate = dateOnly(row.market_date || "") || "—";
    const lastPurchaseDate = dateOnly(row.last_purchase_date || "") || "—";
    return `
      <tr>
        ${renderMarketBoardTextCell_(sku)}
        ${renderMarketBoardTextCell_(name, "market-cell-name") }
        ${renderMarketBoardTextCell_(costText, "market-cell-cost", costSignal.valueClass, costSignal.message || "")}
        ${renderMarketBoardTextCell_(suggestedPrice)}
        ${renderMarketBoardTextCell_(upper)}
        ${renderMarketBoardTextCell_(middle)}
        ${renderMarketBoardTextCell_(lower)}
        ${renderMarketBoardTextCell_(marketDate)}
        ${renderMarketBoardTextCell_(lastPurchaseDate)}
      </tr>
    `;
  }).join("");
}

function renderMarketPriceBoard_(payload){
  const data = payload || {};
  const groups = data.groups || {};
  marketPriceBoardDefs_().forEach(def => {
    fillMarketPriceBoardBody_(def.tbodyId, groups[def.key] || [], `目前沒有可對應的 ${def.label} 行情資料`);
  });
  const meta = document.getElementById("market-price-meta");
  if (meta) {
    const latestDate = dateOnly(data.latest_market_date || "") || "—";
    const syncedAt = dateTimeText(data.synced_at || "") || "—";
    const matched = Number(data.matched_count || 0);
    const rawCount = Number(data.raw_count || 0);
    meta.textContent = `最新行情日：${latestDate}｜對應 ${matched} 筆｜原始資料 ${rawCount} 筆｜同步時間 ${syncedAt}`;
  }
}

function loadMarketPriceBoard_(force = false, retryCount = 0){
  const hasBoard = !!document.getElementById("market-price-meta");
  if (!hasBoard) return Promise.resolve(null);

  const freshMs = 60 * 1000;
  if (!force && marketPriceBoardCache_ && (Date.now() - marketPriceBoardLoadedAt_ < freshMs)) {
    renderMarketPriceBoard_(marketPriceBoardCache_);
    return Promise.resolve(marketPriceBoardCache_);
  }
  if (marketPriceBoardLoading_ && !force) return marketPriceBoardLoading_;

  const meta = document.getElementById("market-price-meta");
  if (meta) meta.textContent = marketPriceBoardCache_ ? "更新中…" : "載入中…";

  marketPriceBoardLoading_ = new Promise(resolve => {
    gas({ type: "marketPriceBoard" }, res => {
      marketPriceBoardLoading_ = null;
      const ok = !!(res && res.status === "ok");
      if (ok) {
        marketPriceBoardCache_ = res;
        marketPriceBoardLoadedAt_ = Date.now();
        if (marketPriceBoardRetryTimer_) {
          clearTimeout(marketPriceBoardRetryTimer_);
          marketPriceBoardRetryTimer_ = null;
        }
        renderMarketPriceBoard_(res);
        resolve(res);
        return;
      }

      const message = String(res?.message || "無法載入市場價目表");
      if ((res?.status === "timeout" || res?.status === "error") && retryCount < 1) {
        if (meta) meta.textContent = `${message}，正在重試…`;
        marketPriceBoardRetryTimer_ = setTimeout(() => {
          marketPriceBoardRetryTimer_ = null;
          loadMarketPriceBoard_(true, retryCount + 1).then(resolve);
        }, 1200);
        return;
      }

      renderMarketPriceBoard_({ groups: {}, latest_market_date: "", synced_at: "", matched_count: 0, raw_count: 0 });
      if (meta) meta.textContent = message;
      resolve(null);
    }, 60000);
  });
  return marketPriceBoardLoading_;
}

async function syncReferencePrices_(){
  const btn = document.getElementById("sync-reference-prices");
  if (btn) { btn.disabled = true; btn.dataset.oldText = btn.textContent; btn.textContent = "同步中..."; }
  try {
    gas({ type: "syncReferencePrices" }, async (res) => {
      if (!res || res.status !== "ok") {
        alert(res?.message || "同步參考行情失敗");
      } else {
        LS.del("products");
        await loadAdminProducts(true);
        await loadMarketPriceBoard_(true);
        alert(res.message || `同步完成：更新 ${res.updated_count || 0} 筆商品參考價格`);
      }
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || "同步最新參考行情"; }
    });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || "同步最新參考行情"; }
    alert("同步參考行情失敗");
  }
}


function buildProductActionSelectHtml_(id){
  return `
    <select class="action-select" data-id="${id}">
      <option value="">操作</option>
      <option value="edit">編輯</option>
      <option value="spec">規格設定</option>
      <option value="image">查看圖片</option>
      <option value="history">歷史</option>
      <option value="delete">刪除</option>
    </select>
  `;
}

function createProductMobileField_(label, value, options = {}){
  const item = document.createElement('div');
  item.className = `product-mobile-field ${options.fieldClass || ''}`.trim();

  const labelEl = document.createElement('div');
  labelEl.className = 'product-mobile-label';
  labelEl.textContent = label;
  item.appendChild(labelEl);

  const valueEl = document.createElement('div');
  valueEl.className = `product-mobile-value ${options.valueClass || ''}`.trim();
  if (options.title) valueEl.title = options.title;

  if (options.kind === 'badge') {
    const badge = document.createElement('span');
    badge.className = `product-badge ${options.tone || 'muted'}`.trim();
    badge.textContent = value || '—';
    valueEl.appendChild(badge);
  } else if (options.kind === 'meta') {
    const meta = document.createElement('div');
    meta.className = 'product-meta';
    const main = document.createElement('div');
    main.className = 'product-meta-main';
    main.textContent = options.main || '—';
    const sub = document.createElement('div');
    sub.className = 'product-meta-sub';
    sub.textContent = options.sub || '';
    meta.appendChild(main);
    if (options.sub) meta.appendChild(sub);
    valueEl.appendChild(meta);
  } else {
    valueEl.textContent = value || '—';
  }

  item.appendChild(valueEl);
  return item;
}

function renderProductMobileCards_(items){
  const wrap = document.getElementById('product-mobile-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'product-mobile-empty';
    empty.textContent = '目前沒有商品資料';
    wrap.appendChild(empty);
    return;
  }

  items.forEach(p => {
    const safety = p.safety_stock ?? p.safety ?? '';
    const cost = p.cost ?? p.purchase_price ?? '';
    const sku = (p.sku ?? p.part_no ?? p.code ?? p['料號'] ?? p.id) ?? '';
    const supplierPrimary = primarySupplierName_(p);
    const refPrice = referencePriceText_(p.reference_price ?? p.ref_price ?? '');
    const category = parseCategoryDisplay_(p.category ?? '');
    const expiryDate = shortTableDate_(p.expiry_date ?? '');
    const lastPurchaseDate = shortTableDate_(p.last_purchase_date ?? '');

    const card = document.createElement('article');
    card.className = 'product-mobile-card';
    card.dataset.productId = String(p.id || '');

    const header = document.createElement('div');
    header.className = 'product-mobile-header';

    const lead = document.createElement('div');
    lead.className = 'product-mobile-lead';

    const skuEl = document.createElement('div');
    skuEl.className = 'product-mobile-sku';
    skuEl.textContent = sku || '—';
    lead.appendChild(skuEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'product-mobile-title';
    titleEl.textContent = p.name ?? '—';
    lead.appendChild(titleEl);

    const specEl = document.createElement('div');
    specEl.className = 'product-mobile-spec';
    specEl.textContent = p.spec ?? '—';
    lead.appendChild(specEl);

    header.appendChild(lead);

    const actionWrap = document.createElement('div');
    actionWrap.className = 'product-mobile-action';
    actionWrap.innerHTML = buildProductActionSelectHtml_(p.id);
    header.appendChild(actionWrap);

    card.appendChild(header);

    const metaGrid = document.createElement('div');
    metaGrid.className = 'product-mobile-meta-grid';
    metaGrid.appendChild(createProductMobileField_('供應商', supplierPrimary || '—'));
    metaGrid.appendChild(createProductMobileField_('單位', p.unit ?? '—'));
    metaGrid.appendChild(createProductMobileField_('分類', '', { kind:'meta', main: category.main, sub: category.sub, title: p.category ?? '' }));
    metaGrid.appendChild(createProductMobileField_('電商顯示', shopVisibleText_(p), { kind:'badge', tone: isShopVisible_(p) ? 'success' : 'muted' }));
    metaGrid.appendChild(createProductMobileField_('有效期限', expiryDate.short || '—', { title: expiryDate.full || '' }));
    metaGrid.appendChild(createProductMobileField_('最後進貨日', lastPurchaseDate.short || '—', { title: lastPurchaseDate.full || '' }));
    card.appendChild(metaGrid);

    const costSignal = getCostReferenceSignal_(cost, p.reference_price ?? p.ref_price ?? '');

    const statsGrid = document.createElement('div');
    statsGrid.className = 'product-mobile-stats-grid';
    statsGrid.appendChild(createProductMobileField_('進價', roundedPriceText_(cost, '—'), { fieldClass:'metric', valueClass: costSignal.valueClass, title: costSignal.message || '' }));
    statsGrid.appendChild(createProductMobileField_('售價', num2TextSmart(p.price), { fieldClass:'metric' }));
    statsGrid.appendChild(createProductMobileField_('參考價格', refPrice || '—', { fieldClass:'metric' }));
    statsGrid.appendChild(createProductMobileField_('庫存', num2TextSmart(p.stock), { fieldClass:'metric' }));
    statsGrid.appendChild(createProductMobileField_('安全庫存', num2TextSmart(safety), { fieldClass:'metric' }));
    card.appendChild(statsGrid);

    wrap.appendChild(card);
  });
}

function bindProductActionSelects_(){
  document.querySelectorAll('#admin-product-table .action-select, #product-mobile-list .action-select').forEach(sel => {
    if (sel.dataset.bound === '1') return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const act = e.target.value;
      if (!act) return;
      onProductAction_(id, act);
      e.target.value = '';
    });
  });
}

function renderAdminProducts(products, page = 1) {
  productPage = page;
  updateProductTableLatestReferenceDate_(products);
  const tbody = document.querySelector("#admin-product-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((products || []).length / productsPerPage));
  productPage = Math.min(productPage, totalPages);

  const start = (productPage - 1) * productsPerPage;
  const end = start + productsPerPage;
  const currentPageItems = (products || []).slice(start, end);

  tbody.innerHTML = "";
  currentPageItems.forEach(p => {
    const safety = p.safety_stock ?? p.safety ?? "";
    const cost = p.cost ?? p.purchase_price ?? "";
    const sku = (p.sku ?? p.part_no ?? p.code ?? p["料號"] ?? p.id) ?? "";
    const supplierPrimary = primarySupplierName_(p);
    const refPrice = referencePriceText_(p.reference_price ?? p.ref_price ?? "");
    const costSignal = getCostReferenceSignal_(cost, p.reference_price ?? p.ref_price ?? "");
    const category = parseCategoryDisplay_(p.category ?? "");
    const expiryDate = shortTableDate_(p.expiry_date ?? "");
    const lastPurchaseDate = shortTableDate_(p.last_purchase_date ?? "");

    const tr = document.createElement("tr");
    tr.dataset.productId = String(p.id || "");

    const cells = [
      { label: "料號", cls: "product-cell-sku", kind: "text", value: sku },
      { label: "商品名稱", cls: "product-cell-product", kind: "text", value: p.name ?? "" },
      { label: "規格", cls: "product-cell-spec", kind: "text", value: p.spec ?? "—" },
      { label: "供應商", cls: "product-cell-supplier", kind: "text", value: supplierPrimary || "—" },
      { label: "單位", cls: "product-cell-unit", kind: "text", value: p.unit ?? "—" },
      { label: "進價", cls: "product-cell-cost", kind: "text", value: roundedPriceText_(cost, "—"), valueClass: costSignal.valueClass, title: costSignal.message || "" },
      { label: "售價", cls: "product-cell-price", kind: "text", value: num2TextSmart(p.price) },
      { label: "參考價格", cls: "product-cell-ref", kind: "text", value: refPrice || "—" },
      { label: "庫存", cls: "product-cell-stock", kind: "text", value: num2TextSmart(p.stock) },
      { label: "安全庫存", cls: "product-cell-safety", kind: "text", value: num2TextSmart(safety) },
      { label: "分類", cls: "product-cell-category", kind: "meta", main: category.main, sub: category.sub, title: p.category ?? "" },
      { label: "電商顯示", cls: "product-cell-shop", kind: "badge", value: shopVisibleText_(p), tone: isShopVisible_(p) ? "success" : "muted" },
      { label: "有效期限", cls: "product-cell-expiry", kind: "text", value: expiryDate.short, title: expiryDate.full || "" },
      { label: "最近進貨日", cls: "product-cell-lastpurchase", kind: "text", value: lastPurchaseDate.short, title: lastPurchaseDate.full || "" }
    ];

    cells.forEach(col => {
      const td = document.createElement("td");
      td.dataset.label = col.label;
      if (col.title) td.title = col.title;
      if (col.kind === 'badge') {
        makeBadgeProductCell_(td, col.value, col.tone, col.cls || "");
      } else if (col.kind === 'meta') {
        makeMetaProductCell_(td, col.main, col.sub, col.cls || "");
      } else {
        makeFittableProductCell_(td, col.value, col.cls || "");
        const span = td.querySelector('.product-cell-fit');
        if (span && col.valueClass) span.classList.add(col.valueClass);
      }
      tr.appendChild(td);
    });

    const actionTd = document.createElement("td");
    actionTd.dataset.label = "操作";
    actionTd.className = "row-actions product-cell-actions";
    actionTd.innerHTML = buildProductActionSelectHtml_(p.id);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });

  if (productFlashId) {
    const _flashId = String(productFlashId || "");
    productFlashId = "";
    setTimeout(() => flashProductRow_(_flashId), 40);
  }

  renderProductMobileCards_(currentPageItems);
  bindProductActionSelects_();

  requestAnimationFrame(() => fitProductTableCells_());
  renderPagination("pagination", totalPages, (p) => renderAdminProducts(products, p), productPage);
}

window.addEventListener("resize", (() => {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.getElementById("product-section")?.classList.contains("active")) fitProductTableCells_();
    }, 80);
  };
})());

function renderPagination(containerId, totalPages, onPage, activePage) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";
  container.classList.add("pagination-bar");
  if (totalPages <= 1) return;

  const current = Math.max(1, Math.min(Number(activePage) || 1, Number(totalPages) || 1));

  function makeBtn(label, targetPage, options = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className = `page-btn ${options.kind || "number"}`.trim();
    if (options.active) btn.classList.add("active");
    if (options.disabled) {
      btn.disabled = true;
      btn.classList.add("disabled");
    } else {
      btn.addEventListener("click", () => onPage(targetPage));
    }
    return btn;
  }

  function makeDots() {
    const span = document.createElement("span");
    span.className = "page-dots";
    span.textContent = "…";
    return span;
  }

  function getVisiblePages(total, now) {
    if (total <= 7) return Array.from({ length: total }, (_, idx) => idx + 1);
    const set = new Set([1, total, now - 1, now, now + 1]);
    if (now <= 3) [2, 3, 4, 5].forEach(n => set.add(n));
    if (now >= total - 2) [total - 4, total - 3, total - 2, total - 1].forEach(n => set.add(n));
    return Array.from(set).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  }

  const prevBtn = makeBtn("上一頁", current - 1, { kind: "nav prev", disabled: current === 1 });
  container.appendChild(prevBtn);

  const visiblePages = getVisiblePages(totalPages, current);
  let last = 0;
  visiblePages.forEach(pageNo => {
    if (last && pageNo - last > 1) container.appendChild(makeDots());
    container.appendChild(makeBtn(String(pageNo), pageNo, { active: pageNo === current }));
    last = pageNo;
  });

  const nextBtn = makeBtn("下一頁", current + 1, { kind: "nav next", disabled: current === totalPages });
  container.appendChild(nextBtn);
  container.appendChild(makeBtn("回到首頁", 1, { kind: "home", disabled: current === 1 }));

  const summary = document.createElement("span");
  summary.className = "page-summary";
  summary.textContent = `第 ${current} / ${totalPages} 頁`;
  container.appendChild(summary);
}

let batchCostProducts_ = [];
let batchCostDraftCosts_ = new Map();
let batchCostSaving_ = false;

function batchCostProductId_(p){
  return String(p?.id ?? p?.product_id ?? p?.raw_id ?? "").trim();
}

function batchCostProductName_(p){
  return String(p?.name ?? p?.product_name ?? "").trim();
}

function batchCostCurrentNumber_(p){
  return round2Num(p?.cost ?? p?.purchase_price ?? p?.in_price ?? 0, 0);
}

function batchCostNumberText_(v, fallback = "0"){
  return num2TextSmart(v, fallback);
}

function batchCostDraftValue_(p){
  const id = batchCostProductId_(p);
  if (!id) return batchCostNumberText_(batchCostCurrentNumber_(p), "0");
  if (!batchCostDraftCosts_.has(id)) {
    batchCostDraftCosts_.set(id, batchCostNumberText_(batchCostCurrentNumber_(p), "0"));
  }
  return batchCostDraftCosts_.get(id);
}

function batchCostSourceProducts_(){
  const source = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  return (Array.isArray(source) ? source : [])
    .slice()
    .sort((a, b) => {
      const catCmp = productCategoryOf_(a).localeCompare(productCategoryOf_(b), "zh-Hant", { numeric: true, sensitivity: "base" });
      if (catCmp !== 0) return catCmp;
      return batchCostProductName_(a).localeCompare(batchCostProductName_(b), "zh-Hant", { numeric: true, sensitivity: "base" });
    });
}

function filteredBatchCostProducts_(){
  const kw = String(document.getElementById("batch-cost-search")?.value || "").trim().toLowerCase();
  const cat = String(document.getElementById("batch-cost-category")?.value || "").trim();
  return (batchCostProducts_ || []).filter(p => {
    if (cat && productCategoryOf_(p) !== cat) return false;
    if (!kw) return true;
    const blob = [
      batchCostProductId_(p),
      productSkuText_(p),
      batchCostProductName_(p),
      productCategoryOf_(p),
      p?.spec,
      p?.supplier_names,
      p?.supplier_name
    ].map(x => String(x ?? "").toLowerCase()).join(" ");
    return blob.includes(kw);
  });
}

function batchCostChangeSet_(){
  const changes = [];
  const invalid = [];

  (batchCostProducts_ || []).forEach(p => {
    const id = batchCostProductId_(p);
    if (!id) return;

    const raw = String(batchCostDraftCosts_.get(id) ?? batchCostNumberText_(batchCostCurrentNumber_(p), "0")).trim();
    const parsed = safeNum(raw, NaN);
    if (!raw || !Number.isFinite(parsed) || parsed < 0) {
      invalid.push(p);
      return;
    }

    const before = batchCostCurrentNumber_(p);
    const next = round2Num(parsed, 0);
    if (next !== before) {
      changes.push({ product: p, id, before, cost: next });
    }
  });

  return { changes, invalid };
}

function updateBatchCostSummary_(){
  const summary = document.getElementById("batch-cost-summary");
  const saveBtn = document.getElementById("batch-cost-save");
  const visibleCount = filteredBatchCostProducts_().length;
  const totalCount = (batchCostProducts_ || []).length;
  const { changes, invalid } = batchCostChangeSet_();

  if (summary) {
    const invalidText = invalid.length ? `，${invalid.length} 筆成本格式錯誤` : "";
    summary.textContent = `顯示 ${visibleCount} / ${totalCount} 筆，已修改 ${changes.length} 筆${invalidText}`;
  }

  if (saveBtn) saveBtn.disabled = batchCostSaving_ || invalid.length > 0 || changes.length === 0;
}

function markBatchCostInputState_(input, p, tr){
  if (!input || !p || !tr) return;
  const raw = String(input.value || "").trim();
  const n = safeNum(raw, NaN);
  const before = batchCostCurrentNumber_(p);
  const isInvalid = !raw || !Number.isFinite(n) || n < 0;
  const isChanged = !isInvalid && round2Num(n, 0) !== before;

  input.classList.toggle("is-invalid", isInvalid);
  tr.classList.toggle("batch-cost-row-changed", isChanged);
  tr.classList.toggle("batch-cost-row-invalid", isInvalid);
}

function renderBatchCostRows_(){
  const tbody = document.getElementById("batch-cost-tbody");
  if (!tbody) return;

  const rows = filteredBatchCostProducts_();
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "muted batch-cost-empty";
    td.textContent = "沒有符合條件的商品";
    tr.appendChild(td);
    tbody.appendChild(tr);
    updateBatchCostSummary_();
    return;
  }

  rows.forEach(p => {
    const id = batchCostProductId_(p);
    const tr = document.createElement("tr");
    tr.dataset.productId = id;

    const skuTd = document.createElement("td");
    skuTd.textContent = productSkuText_(p) || id;
    tr.appendChild(skuTd);

    const nameTd = document.createElement("td");
    nameTd.textContent = batchCostProductName_(p) || "未命名商品";
    tr.appendChild(nameTd);

    const categoryTd = document.createElement("td");
    categoryTd.textContent = productCategoryOf_(p);
    tr.appendChild(categoryTd);

    const currentTd = document.createElement("td");
    currentTd.className = "batch-cost-number";
    currentTd.textContent = batchCostNumberText_(batchCostCurrentNumber_(p), "0");
    tr.appendChild(currentTd);

    const inputTd = document.createElement("td");
    const input = document.createElement("input");
    input.className = "admin-input batch-cost-input";
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.value = batchCostDraftValue_(p);
    input.disabled = !id || batchCostSaving_;
    input.setAttribute("aria-label", `${batchCostProductName_(p) || id} 新成本`);
    input.addEventListener("input", () => {
      if (id) batchCostDraftCosts_.set(id, input.value);
      markBatchCostInputState_(input, p, tr);
      updateBatchCostSummary_();
    });
    input.addEventListener("blur", () => {
      const n = safeNum(input.value, NaN);
      if (Number.isFinite(n) && n >= 0) {
        input.value = batchCostNumberText_(round2Num(n, 0), "0");
        if (id) batchCostDraftCosts_.set(id, input.value);
      }
      markBatchCostInputState_(input, p, tr);
      updateBatchCostSummary_();
    });
    inputTd.appendChild(input);
    tr.appendChild(inputTd);

    const noteTd = document.createElement("td");
    noteTd.className = "batch-cost-note";
    noteTd.textContent = id ? "" : "缺少商品 ID，無法更新";
    tr.appendChild(noteTd);

    markBatchCostInputState_(input, p, tr);
    tbody.appendChild(tr);
  });

  updateBatchCostSummary_();
}

function renderBatchCostModalShell_(){
  const body = document.getElementById("productBatchCostModalBody");
  if (!body) return;

  const categories = getProductCategoriesFromProducts_(batchCostProducts_ || []);
  const categoryOptions = categories.map(cat => `<option value="${escapeAttr_(cat)}">${escapeHtmlSimple_(cat)}</option>`).join("");

  body.innerHTML = `
    <div class="batch-cost-body">
      <div class="admin-toolbar batch-cost-toolbar">
        <input class="admin-input" id="batch-cost-search" type="text" placeholder="搜尋料號 / 商品 / 分類">
        <select class="admin-select" id="batch-cost-category">
          <option value="">全部分類</option>
          ${categoryOptions}
        </select>
        <button class="admin-btn" id="batch-cost-reset" type="button">還原變更</button>
        <span class="muted batch-cost-summary" id="batch-cost-summary"></span>
      </div>

      <div class="batch-cost-table-wrap">
        <table class="admin-table batch-cost-table">
          <thead>
            <tr>
              <th>料號</th>
              <th>商品</th>
              <th>分類</th>
              <th>目前成本</th>
              <th>新成本</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody id="batch-cost-tbody"></tbody>
        </table>
      </div>

      <div class="hint batch-cost-status" id="batch-cost-status">只會更新成本有變更的商品。</div>

      <div class="modal-actions">
        <button id="batch-cost-cancel" class="admin-btn" type="button">取消</button>
        <button id="batch-cost-save" class="admin-btn primary" type="button">儲存變更</button>
      </div>
    </div>
  `;

  document.getElementById("batch-cost-search")?.addEventListener("input", renderBatchCostRows_);
  document.getElementById("batch-cost-category")?.addEventListener("change", renderBatchCostRows_);
  document.getElementById("batch-cost-reset")?.addEventListener("click", () => {
    batchCostDraftCosts_ = new Map();
    renderBatchCostRows_();
  });
  document.getElementById("batch-cost-cancel")?.addEventListener("click", closeBatchCostModal_);
  document.getElementById("batch-cost-save")?.addEventListener("click", saveBatchCostChanges_);
}

function closeBatchCostModal_(){
  if (batchCostSaving_) return;
  const modal = document.getElementById("productBatchCostModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function ensureBatchCostModalWired_(){
  const modal = document.getElementById("productBatchCostModal");
  const closeBtn = document.getElementById("productBatchCostModalClose");
  if (!modal || !closeBtn || modal.dataset.wired === "1") return;

  closeBtn.addEventListener("click", closeBatchCostModal_);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeBatchCostModal_();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeBatchCostModal_();
  });

  modal.dataset.wired = "1";
}

function openBatchCostModal_(){
  const modal = document.getElementById("productBatchCostModal");
  const body = document.getElementById("productBatchCostModalBody");
  if (!modal || !body) return;

  ensureBatchCostModalWired_();
  batchCostSaving_ = false;
  batchCostDraftCosts_ = new Map();
  batchCostProducts_ = [];

  body.innerHTML = `<div class="batch-cost-loading">載入商品中...</div>`;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");

  const cached = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const ready = (Array.isArray(cached) && cached.length)
    ? Promise.resolve(cached)
    : loadAdminProducts(true, null, { skipProductRender: true });

  Promise.resolve(ready).then(() => {
    batchCostProducts_ = batchCostSourceProducts_();
    renderBatchCostModalShell_();
    renderBatchCostRows_();
  }).catch(err => {
    console.error(err);
    body.innerHTML = `<div class="batch-cost-loading danger">商品載入失敗，請重新載入後再試。</div>`;
  });
}

function batchCostUpdatePayload_(p, cost){
  return {
    type: "manageProduct",
    action: "update",
    id: batchCostProductId_(p),
    sku: productSkuText_(p),
    supplier_ids: String(p?.supplier_ids ?? p?.supplier_id ?? ""),
    name: batchCostProductName_(p),
    category: String(p?.category ?? ""),
    unit: String(p?.unit ?? ""),
    spec: String(p?.spec ?? ""),
    price: round2NonNegative(p?.price ?? 0),
    cost: round2NonNegative(cost),
    reference_price: round2NonNegative(p?.reference_price ?? p?.ref_price ?? 0),
    reference_price_date: dateOnly(p?.reference_price_date ?? ""),
    last_purchase_date: dateOnly(p?.last_purchase_date ?? ""),
    safety_stock: round2NonNegative(p?.safety_stock ?? p?.safety ?? 0),
    shop_enabled: isShopVisible_(p) ? "1" : "0",
    expiry_date: dateOnly(p?.expiry_date ?? "")
  };
}

function batchCostGas_(params){
  return new Promise(resolve => gas(params, resolve, 60000));
}

function applyBatchCostLocal_(successes){
  if (!successes || !successes.length) return;
  const byId = new Map(successes.map(row => [String(row.id), row.cost]));

  const applyToList = list => (Array.isArray(list) ? list : []).map(p => {
    const id = batchCostProductId_(p);
    if (!byId.has(id)) return p;
    return { ...p, cost: byId.get(id) };
  });

  const baseProducts = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  adminProducts = applyToList(baseProducts);
  batchCostProducts_ = applyToList(batchCostProducts_);
  try { LS.set("products", adminProducts); } catch(e) {}

  if (isSectionActive_("product-section")) {
    try { renderCategoryFilter(adminProducts); } catch(e) {}
    try { renderFilteredAdminProducts_(productPage || 1); } catch(e) {}
  }
  try { buildSupplierProductIndex_(true); } catch(e) {}
  if (isSectionActive_("purchase-section")) {
    try { refreshAllPurchaseRows_(); } catch(e) {}
  }
  try { scheduleDashboardRefresh_(); } catch(e) {}
}

async function saveBatchCostChanges_(){
  if (batchCostSaving_) return;
  const { changes, invalid } = batchCostChangeSet_();
  if (invalid.length) return alert(`有 ${invalid.length} 筆成本格式錯誤，請先修正。`);
  if (!changes.length) return alert("沒有成本變更。");
  if (!confirm(`確定更新 ${changes.length} 筆商品成本？`)) return;

  const saveBtn = document.getElementById("batch-cost-save");
  const cancelBtn = document.getElementById("batch-cost-cancel");
  const status = document.getElementById("batch-cost-status");
  batchCostSaving_ = true;
  if (saveBtn) saveBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  document.querySelectorAll("#batch-cost-tbody input").forEach(input => { input.disabled = true; });

  const successes = [];
  const failures = [];

  for (let i = 0; i < changes.length; i += 1) {
    const row = changes[i];
    if (status) status.textContent = `更新中 ${i + 1} / ${changes.length}：${batchCostProductName_(row.product) || row.id}`;
    const res = await batchCostGas_(batchCostUpdatePayload_(row.product, row.cost));
    if (res && res.status === "ok") {
      successes.push(row);
    } else {
      failures.push({
        row,
        message: res?.message || res?.status || "更新失敗"
      });
    }
  }

  batchCostSaving_ = false;
  if (cancelBtn) cancelBtn.disabled = false;

  applyBatchCostLocal_(successes);
  successes.forEach(row => {
    if (row.id) batchCostDraftCosts_.set(row.id, batchCostNumberText_(row.cost, "0"));
  });

  if (status) status.textContent = failures.length
    ? `完成 ${successes.length} 筆，失敗 ${failures.length} 筆。`
    : `完成 ${successes.length} 筆。`;

  if (successes.length) {
    setTimeout(() => {
      try { loadAdminProducts(true, productPage || 1); } catch(e) {}
    }, 30);
  }

  if (failures.length) {
    renderBatchCostRows_();
    const names = failures.slice(0, 5).map(x => `${batchCostProductName_(x.row.product) || x.row.id}：${x.message}`).join("\n");
    alert(`部分更新失敗：\n${names}${failures.length > 5 ? "\n..." : ""}`);
    return;
  }

  closeBatchCostModal_();
  alert(`成本更新完成，共 ${successes.length} 筆。`);
}

function addProduct() {
  // 舊入口保留相容，統一改走彈窗版儲存流程
  return saveProductAdd_();
}


function clearProductForm() {
  ["new-name","new-sku","new-price","new-cost","new-stock","new-safety","new-unit","new-category"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const supBox = document.getElementById("new-product-suppliers-box");
  if (supBox) supBox.querySelectorAll('input[name="new-product-supplier"]').forEach(chk => chk.checked = false);
  const shopEl = document.getElementById("add-shop-enabled");
  if (shopEl) shopEl.checked = true;
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
          <label for="add-sku">料號 <span class="required-mark">*</span></label>
          <input id="add-sku" name="product_add_sku" class="admin-input" type="text" placeholder="例：A-01-001（必填，不可重複）" required>
          <div id="add-sku-check" class="hint product-sku-check"></div>
        </div>

        <div class="field">
          <label for="add-name">商品名稱</label>
          <input id="add-name" name="product_add_name" class="admin-input" type="text" placeholder="例：冷凍雞腿">
        </div>

        <div class="field">
          <label for="add-spec">規格</label>
          <input id="add-spec" name="product_add_spec" class="admin-input" type="text" placeholder="例：12公斤/袋">
        </div>

        <div class="field span-2">
          <div class="field-label" id="add-suppliers-label">供應商（可多選）</div>
          <div id="add-suppliers-box" class="checkbox-list" role="group" aria-labelledby="add-suppliers-label"></div>
        </div>

        <div class="field">
          <label for="add-unit">單位</label>
          <input id="add-unit" name="product_add_unit" class="admin-input" type="text" placeholder="例：kg / 盒 / 包">
        </div>

        <div class="field">
          <label for="add-cost">進價（成本）</label>
          <input id="add-cost" name="product_add_cost" class="admin-input" type="number" step="0.01" placeholder="0.00">
        </div>

        <div class="field">
          <label for="add-price">售價</label>
          <input id="add-price" name="product_add_price" class="admin-input" type="number" step="0.01" placeholder="0.00">
        </div>

        <div class="field">
          <label for="add-stock">庫存</label>
          <input id="add-stock" name="product_add_stock" class="admin-input" type="number" step="0.01" placeholder="0.00">
        </div>

        <div class="field">
          <label for="add-safety">安全庫存</label>
          <input id="add-safety" name="product_add_safety" class="admin-input" type="number" step="0.01" placeholder="0.00">
        </div>

        <div class="field">
          <label for="add-category">分類</label>
          ${buildProductCategorySelectHtml_("add-category")}
        </div>

        <div class="field">
          <div class="field-label">電商平台顯示</div>
          <label class="chk" for="add-shop-enabled"><input id="add-shop-enabled" name="product_add_shop_enabled" type="checkbox" checked> <span>顯示在電商平台</span></label>
        </div>

        <div class="field">
          <label for="add-expiry">有效期限</label>
          <input id="add-expiry" name="product_add_expiry" class="admin-input" type="date">
        </div>
      </div>

      <div class="modal-actions">
        <button id="add-cancel" class="admin-btn" type="button">取消</button>
        <button id="add-save" class="admin-btn primary" type="button">新增</button>
      </div>
    `;

    // 供應商 checkbox
    fillSupplierCheckboxesForAdd_(document.getElementById("add-suppliers-box"));


const priceEl = document.getElementById("add-price");
const costEl  = document.getElementById("add-cost");
const syncPriceFromCost = () => {
  if (!priceEl || !costEl) return;
  const pv = String(priceEl.value || "").trim();
  const cv = String(costEl.value || "").trim();
  const auto = String(priceEl.dataset.autoSynced || "");
  if (!pv || pv === "0" || auto === "1") {
    priceEl.value = cv;
    priceEl.dataset.autoSynced = "1";
  }
};
costEl?.addEventListener("input", syncPriceFromCost);
priceEl?.addEventListener("input", () => {
  const cv = String(costEl?.value || "").trim();
  const pv = String(priceEl?.value || "").trim();
  priceEl.dataset.autoSynced = (pv === cv) ? "1" : "";
});

    attachProductSkuDuplicateWatcher_("add-sku", "add-sku-check", "", "add-save");

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
  const spec = document.getElementById("add-spec")?.value.trim();
  const priceRaw = String(document.getElementById("add-price")?.value || "").trim();
  const costRaw  = String(document.getElementById("add-cost")?.value || "").trim();
  const stockRaw = String(document.getElementById("add-stock")?.value || "").trim();
  if (priceRaw && safeNum(priceRaw, NaN) < 0) return alert("售價不可為負數");
  if (costRaw && safeNum(costRaw, NaN) < 0) return alert("成本不可為負數");
  if (stockRaw && safeNum(stockRaw, NaN) < 0) return alert("庫存不可為負數");
  const cost  = round2NonNegative(costRaw);
  const stock = round2NonNegative(stockRaw);
  let price = round2NonNegative(priceRaw);

  // 售價預設帶入成本（避免被誤帶成庫存數量）
  if ((!priceRaw || priceRaw === "0" || price === 0) && cost > 0) price = cost;
  if (priceRaw && stockRaw && price === stock && cost > 0 && price !== cost) price = cost;
  const safetyRaw = String(document.getElementById("add-safety")?.value || "").trim();
  if (safetyRaw && safeNum(safetyRaw, NaN) < 0) return alert("安全庫存不可為負數");
  const safety = round2NonNegative(safetyRaw);
  const category = document.getElementById("add-category")?.value.trim();
  const shop_enabled = document.getElementById("add-shop-enabled")?.checked ? "1" : "0";
  const expiry_date = document.getElementById("add-expiry")?.value.trim() || "";

  const supBox = document.getElementById("add-suppliers-box");
  const selectedIds = supBox ? Array.from(supBox.querySelectorAll('input[name="add-product-supplier"]:checked')).map(i => String(i.value).trim()).filter(Boolean) : [];
  const supplier_ids = selectedIds.join(",");

  if (!validateRequiredUniqueProductSku_(sku, "")) return;
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
    spec,
    category,
    shop_enabled,
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
let _editingProductPage_ = 1; // 開啟商品編輯時鎖定當前頁，避免送出後抓錯頁

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
  const __activePageBtn = document.querySelector("#pagination .page-btn.active");
  _editingProductPage_ = Number((__activePageBtn?.textContent || productPage || 1));
  if (!Number.isFinite(_editingProductPage_) || _editingProductPage_ < 1) _editingProductPage_ = 1;

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
    const referencePrice = p.reference_price ?? p.ref_price ?? "";
    const referencePriceDate = dateOnly(p.reference_price_date ?? "");

    title.textContent = `編輯商品：${p.name ?? ""}`;

    // 表單（排版與新增商品一致）
    body.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label for="edit-sku">料號 <span class="required-mark">*</span></label>
          <input id="edit-sku" name="product_edit_sku" class="admin-input" type="text" value="${escapeAttr_(sku)}" placeholder="必填，不可重複" required>
          <div id="edit-sku-check" class="hint product-sku-check"></div>
        </div>

        <div class="field">
          <label for="edit-name">商品名稱</label>
          <input id="edit-name" name="product_edit_name" class="admin-input" type="text" value="${escapeAttr_(p.name ?? "")}">
        </div>

        <div class="field">
          <label for="edit-spec">規格</label>
          <input id="edit-spec" name="product_edit_spec" class="admin-input" type="text" value="${escapeAttr_(p.spec ?? "")}">
        </div>

        <div class="field span-2">
          <div class="field-label" id="edit-suppliers-label">供應商（可多選）</div>
          <div id="edit-suppliers-box" class="checkbox-list" role="group" aria-labelledby="edit-suppliers-label"></div>
        </div>

        <div class="field">
          <label for="edit-unit">單位</label>
          <input id="edit-unit" name="product_edit_unit" class="admin-input" type="text" value="${escapeAttr_(p.unit ?? "")}">
        </div>

        <div class="field">
          <label for="edit-cost">進價（成本）</label>
          <input id="edit-cost" name="product_edit_cost" class="admin-input" type="number" value="${escapeAttr_(roundedPriceText_(cost, "0"))}" step="0.01">
          <div id="edit-cost-warning" class="hint price-signal-note"></div>
        </div>

        <div class="field">
          <label for="edit-price">售價</label>
          <div class="inline-row">
            <input id="edit-price" name="product_edit_price" class="admin-input" type="number" value="${escapeAttr_(num2TextSmart(price, "0"))}" placeholder="0.00" step="0.01">
            <button id="edit-price-calc" class="admin-btn" type="button">計算/設定</button>
          </div>
          <div class="hint">可直接修改售價，或用成本計算加價% 後套用。</div>
        </div>

        <div class="field">
          <label for="edit-stock">庫存</label>
          <input id="edit-stock" name="product_edit_stock" class="admin-input" type="number" value="${escapeAttr_(num2TextSmart(stock, "0"))}" step="0.01">
        </div>

        <div class="field">
          <label for="edit-reference-price">參考價格</label>
          <input id="edit-reference-price" name="product_edit_reference_price" class="admin-input" type="number" value="${escapeAttr_(roundedPriceText_(referencePrice, "0"))}" step="0.01">
          <div class="hint">可直接手動修改參考價格。</div>
        </div>

        <div class="field">
          <label for="edit-reference-price-date">參考價格日期</label>
          <input id="edit-reference-price-date" name="product_edit_reference_price_date" class="admin-input" type="date" value="${escapeAttr_(referencePriceDate || "")}" >
        </div>

        <div class="field">
          <label for="edit-safety">安全庫存</label>
          <input id="edit-safety" name="product_edit_safety" class="admin-input" type="number" value="${escapeAttr_(num2TextSmart(safety, "0"))}" step="0.01" placeholder="0.00">
        </div>

        <div class="field">
          <label for="edit-category">分類</label>
          ${buildProductCategorySelectHtml_("edit-category", p.category ?? "")}
        </div>

        <div class="field">
          <div class="field-label">電商平台顯示</div>
          <label class="chk" for="edit-shop-enabled"><input id="edit-shop-enabled" name="product_edit_shop_enabled" type="checkbox" ${isShopVisible_(p) ? "checked" : ""}> <span>顯示在電商平台</span></label>
        </div>

        <div class="field">
          <label for="edit-expiry">有效期限</label>
          <input id="edit-expiry" name="product_edit_expiry" class="admin-input" type="date" value="${escapeAttr_(dateOnly(p.expiry_date ?? ""))}">
        </div>

        <div class="field">
          <label for="edit-lastpo">最近進貨日</label>
          <input id="edit-lastpo" name="product_edit_last_purchase_date" class="admin-input" type="date" value="${escapeAttr_(dateOnly(p.last_purchase_date ?? ""))}">
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
    document.getElementById("edit-price-calc")?.addEventListener("click", () => openPriceCalcModal_());
    attachProductSkuDuplicateWatcher_("edit-sku", "edit-sku-check", String(p.id ?? ""), "edit-save");

    ["edit-safety", "edit-cost", "edit-price", "edit-stock", "edit-reference-price"].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener("blur", () => {
        const raw = String(el.value ?? "").trim();
        if (!raw) return;
        el.value = num2TextSmart(raw, "");
      });
    });

    const refreshEditCostSignal_ = () => applyCostReferenceSignalToInput_(
      document.getElementById("edit-cost"),
      document.getElementById("edit-cost-warning"),
      document.getElementById("edit-cost")?.value,
      document.getElementById("edit-reference-price")?.value
    );
    document.getElementById("edit-cost")?.addEventListener("input", refreshEditCostSignal_);
    document.getElementById("edit-reference-price")?.addEventListener("input", refreshEditCostSignal_);
    refreshEditCostSignal_();

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


function closePriceCalcModal_(){
  const modal = document.getElementById("priceCalcModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function openPriceCalcModal_(){
  const modal = document.getElementById("priceCalcModal");
  const body = document.getElementById("priceCalcModalBody");
  const costEl = document.getElementById("edit-cost");
  const priceEl = document.getElementById("edit-price");
  if (!modal || !body || !costEl || !priceEl) return;

  const round2_ = (n) => round2Num(n, 0);
  const calcPrice_ = (n) => {
    const v = safeNum(n, NaN);
    if (!Number.isFinite(v)) return 0;
    return round2NonNegative(v, 0);
  };
  const fmt_ = (n, fallback = "0") => num2TextSmart(n, fallback);
  const fmtPrice_ = (n, fallback = "0") => {
    const v = safeNum(n, NaN);
    if (!Number.isFinite(v)) return fallback;
    return fmt_(calcPrice_(v), fallback);
  };

  const cost = safeNum(costEl.value, 0);
  const currentPrice = safeNum(priceEl.value, 0);
  const initPct = cost > 0 ? round2_(((currentPrice / cost) - 1) * 100) : 0;

  body.innerHTML = `
    <div class="form-grid">
      <div class="field">
        <label for="priceCalcCost">目前成本</label>
        <input id="priceCalcCost" class="admin-input readonly" type="number" value="${escapeAttr_(fmt_(cost))}" readonly>
      </div>

      <div class="field">
        <label for="priceCalcCurrentPrice">目前售價</label>
        <input id="priceCalcCurrentPrice" class="admin-input readonly" type="number" step="0.01" value="${escapeAttr_(fmtPrice_(currentPrice))}" readonly>
      </div>

      <div class="field span-2">
        <div class="hint">算法 1：新售價 = 成本 × (1 + 百分比 / 100)</div>
      </div>

      <div class="field">
        <label for="priceCalcPercent">百分比（加價%）</label>
        <input id="priceCalcPercent" name="product_pricecalc_percent" class="admin-input" type="number" step="0.01" value="${escapeAttr_(fmt_(initPct))}" placeholder="例如：30">
      </div>

      <div class="field">
        <label for="priceCalcManualPrice">新售價</label>
        <input id="priceCalcManualPrice" name="product_pricecalc_new_price" class="admin-input" type="number" step="0.01" value="${escapeAttr_(fmtPrice_(currentPrice))}" placeholder="請輸入售價">
      </div>

      <div class="field span-2">
        <div id="priceCalcEquation1" class="hint"></div>
      </div>

      <div class="field span-2">
        <div class="hint">算法 2：利潤% = ((新售價 ÷ 成本) - 1) × 100</div>
      </div>

      <div class="field span-2">
        <div id="priceCalcEquation2" class="hint"></div>
      </div>
    </div>

    <div class="modal-actions">
      <button id="priceCalcCancel" class="admin-btn" type="button">取消</button>
      <button id="priceCalcApply" class="admin-btn primary" type="button">套用到售價</button>
    </div>
  `;

  const percentInput = document.getElementById("priceCalcPercent");
  const manualPriceInput = document.getElementById("priceCalcManualPrice");
  const eq1 = document.getElementById("priceCalcEquation1");
  const eq2 = document.getElementById("priceCalcEquation2");
  let syncing = false;

  function renderByPercent_(){
    if (!percentInput || !manualPriceInput) return;
    const pct = safeNum(percentInput.value, 0);
    const rawPrice = cost * (1 + pct / 100);
    const newPrice = calcPrice_(rawPrice);
    syncing = true;
    manualPriceInput.value = fmtPrice_(newPrice);
    syncing = false;
    if (eq1) eq1.textContent = `成本 ${fmt_(cost)} × (1 + ${fmt_(pct)}%) = 新售價 ${fmtPrice_(newPrice)}`;
    if (eq2) eq2.textContent = `新售價 ${fmtPrice_(newPrice)} 相對成本 ${fmt_(cost)} 的利潤為 ${fmt_(pct)}%`;
  }

  function renderByPrice_(){
    if (!percentInput || !manualPriceInput) return;
    const newPrice = calcPrice_(manualPriceInput.value);
    syncing = true;
    manualPriceInput.value = fmtPrice_(newPrice);
    const pct = cost > 0 ? round2_(((newPrice / cost) - 1) * 100) : 0;
    percentInput.value = fmt_(pct);
    syncing = false;
    if (eq1) eq1.textContent = `成本 ${fmt_(cost)} × (1 + ${fmt_(pct)}%) = 新售價 ${fmtPrice_(newPrice)}`;
    if (eq2) eq2.textContent = `新售價 ${fmtPrice_(newPrice)} 相對成本 ${fmt_(cost)} 的利潤為 ${fmt_(pct)}%`;
  }

  percentInput?.addEventListener("input", () => {
    if (syncing) return;
    renderByPercent_();
  });

  manualPriceInput?.addEventListener("input", () => {
    if (syncing) return;
    renderByPrice_();
  });

  document.getElementById("priceCalcCancel")?.addEventListener("click", closePriceCalcModal_);
  document.getElementById("priceCalcApply")?.addEventListener("click", () => {
    const finalPrice = calcPrice_(manualPriceInput?.value);
    priceEl.value = fmtPrice_(finalPrice);
    closePriceCalcModal_();
  });

  renderByPrice_();
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}


// 初始化：售價計算器（關閉按鈕/點背景關閉）
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("priceCalcModalClose")?.addEventListener("click", closePriceCalcModal_);
  // 依需求保留明確關閉操作，避免使用者誤觸背景就把視窗關掉。
  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("priceCalcModal");
    if (e.key === "Escape" && modal?.classList.contains("show")) closePriceCalcModal_();
  });
});
