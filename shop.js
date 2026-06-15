// shop.js - 電商前台商品列表（與後台共用同一個 GAS / Google Sheet）
let SHOP_PRODUCTS = [];
let SHOP_PAGE = 1;
const SHOP_PAGE_SIZE = 20; // 每頁 20 項：每列 5 項 × 4 列
let SHOP_CATEGORY_FILTERS = new Set();
let SHOP_KEYWORD = "";
let SHOP_SORT = "";

function safeNum(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function txt(v){ return String(v ?? "").trim(); }

function isShopVisibleFlag(v){
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0","false","no","off","n","hide","hidden"].includes(raw);
}

function dateOnly(v){
  if (!v) return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,"0"), d=String(v.getDate()).padStart(2,"0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dateOnly(dt);
    return s.slice(0,10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
    const [y,m,d] = s.split(/[^\d]/).filter(Boolean);
    return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dateOnly(dt);
  return s;
}

function updateHeaderBits(){
  if (typeof updateMemberArea === "function") updateMemberArea();
  if (typeof updateCartCount === "function") updateCartCount();
}

function setLastUpdateText(text){
  const el = document.getElementById("last-update");
  if (el) el.textContent = text ? `最後更新：${text}` : "";
}

function loadLastUpdate(){
  callGAS({ type: "lastUpdate" }, res => {
    if (res && res.lastUpdate) setLastUpdateText(res.lastUpdate);
  });
}

function normalizeProducts(res){
  let list = res;
  if (list && Array.isArray(list.data)) list = list.data;
  if (!Array.isArray(list)) return [];
  return list.map(p => {
    // 電商購物車與送單改以 SKU 為主鍵；Products.id 保留在 product_id/raw_id 供後端回查。
    // 兼容舊快取：舊版可能只存 id，若沒有 sku 才退回 Products.id。
    const productId = txt(p.product_id || p.raw_id || p.id);
    const sku = txt(p.sku || p.part_no || p.code || "");
    const cartKey = sku || productId;
    return {
      id: cartKey,
      product_id: productId,
      raw_id: productId,
      sku: cartKey,
      name: txt(p.name || p.product_name || "未命名商品"),
      category: txt(p.category || "未分類"),
      unit: txt(p.unit || ""),
      image: txt(p.image || ""),
      price: safeNum(p.price, 0),
      stock: safeNum(p.stock, 0),
      safety: safeNum(p.safety, 0),
      shop_enabled: isShopVisibleFlag(p.shop_enabled ?? p.show_in_shop ?? p.visible_in_shop)
    };
  }).filter(p => p.id && p.name);
}

function fetchProducts(){
  const btn = document.querySelector('.toolbar button');
  if (btn) btn.disabled = true;
  callGAS({ type: "products" }, res => {
    SHOP_PRODUCTS = normalizeProducts(res);
    localStorage.setItem("shop_products_cache", JSON.stringify(SHOP_PRODUCTS));
    renderCategoryOptions();
    renderCurrent(1);
    loadLastUpdate();
    if (btn) btn.disabled = false;
  });
}

function loadProducts(){
  const cache = JSON.parse(localStorage.getItem("shop_products_cache") || "null");
  const normalizedCache = normalizeProducts(cache);
  if (normalizedCache.length) {
    SHOP_PRODUCTS = normalizedCache;
    try { localStorage.setItem("shop_products_cache", JSON.stringify(SHOP_PRODUCTS)); } catch (e) {}
    renderCategoryOptions();
    renderCurrent(1);
    setTimeout(fetchProducts, 0); // 背景刷新
  } else {
    fetchProducts();
  }
}

function reloadProducts(){
  localStorage.removeItem("shop_products_cache");
  fetchProducts();
}

function getShopCategories(){
  return Array.from(new Set((SHOP_PRODUCTS || []).map(p => p.category).filter(Boolean)));
}

function renderCategoryOptions(){
  const wrap = document.getElementById("shop-category-bar");
  if (!wrap) return;
  const cats = getShopCategories();
  const validSet = new Set(cats);
  SHOP_CATEGORY_FILTERS = new Set(Array.from(SHOP_CATEGORY_FILTERS).filter(c => validSet.has(c)));
  const isAll = SHOP_CATEGORY_FILTERS.size === 0;
  wrap.innerHTML = [
    `<button type="button" class="shop-filter-chip shop-filter-chip--all${isAll ? ' is-active' : ''}" data-category="__all__">全部商品</button>`,
    ...cats.map(c => `<button type="button" class="shop-filter-chip${SHOP_CATEGORY_FILTERS.has(c) ? ' is-active' : ''}" data-category="${escapeAttr(c)}">${escapeHtml(c)}</button>`)
  ].join("");
  wrap.querySelectorAll('.shop-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => changeCategory(btn.getAttribute('data-category') || ''));
  });
}

function changeCategory(v){
  const value = txt(v);
  if (!value || value === '__all__' || value === '全部商品') {
    SHOP_CATEGORY_FILTERS.clear();
    renderCategoryOptions();
    renderCurrent(1);
    return;
  }
  if (SHOP_CATEGORY_FILTERS.has(value)) SHOP_CATEGORY_FILTERS.delete(value);
  else SHOP_CATEGORY_FILTERS.add(value);
  renderCategoryOptions();
  renderCurrent(1);
}
function searchProducts(){
  SHOP_KEYWORD = txt(document.getElementById("searchInput")?.value).toLowerCase();
  renderCurrent(1);
}
function changeSort(v){
  SHOP_SORT = txt(v);
  renderCurrent(1);
}

function compareMixed(a,b){
  const na = Number(a), nb = Number(b);
  const aNum = Number.isFinite(na), bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  return String(a).localeCompare(String(b), "zh-Hant");
}

function filteredProducts(){
  let list = Array.isArray(SHOP_PRODUCTS) ? [...SHOP_PRODUCTS] : [];
  list = list.filter(p => p.shop_enabled !== false);
  if (SHOP_CATEGORY_FILTERS.size) list = list.filter(p => SHOP_CATEGORY_FILTERS.has(p.category));
  if (SHOP_KEYWORD) list = list.filter(p => `${p.name} ${p.sku}`.toLowerCase().includes(SHOP_KEYWORD));

  switch (SHOP_SORT) {
    case "id_asc": list.sort((a,b)=>compareMixed(a.sku||a.raw_id, b.sku||b.raw_id)); break;
    case "id_desc": list.sort((a,b)=>compareMixed(b.sku||b.raw_id, a.sku||a.raw_id)); break;
    case "price_asc": list.sort((a,b)=>a.price - b.price); break;
    case "price_desc": list.sort((a,b)=>b.price - a.price); break;
    case "name_asc": list.sort((a,b)=>a.name.localeCompare(b.name, "zh-Hant")); break;
    case "name_desc": list.sort((a,b)=>b.name.localeCompare(a.name, "zh-Hant")); break;
  }
  return list;
}

function renderCurrent(page=1){
  const list = filteredProducts();
  renderProducts(list, page);
  const countEl = document.getElementById("product-count");
  if (countEl) countEl.textContent = `共 ${list.length} 項商品`;
}

function renderProducts(list, page=1){
  const container = document.getElementById("product-list");
  const pager = document.getElementById("pagination");
  if (!container || !pager) return;

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / SHOP_PAGE_SIZE));
  SHOP_PAGE = Math.min(Math.max(1, page), totalPages);

  const start = (SHOP_PAGE - 1) * SHOP_PAGE_SIZE;
  const pageItems = list.slice(start, start + SHOP_PAGE_SIZE);

  if (!pageItems.length) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#666;padding:24px;">沒有符合條件的商品</div>`;
  } else {
    container.innerHTML = pageItems.map((p, idx) => {
      const unitText = p.unit ? ` / ${escapeHtml(p.unit)}` : "";
      const inputId = `qty-${SHOP_PAGE}-${idx}`;
      const itemJson = JSON.stringify({id:p.sku||p.raw_id, sku:p.sku||p.raw_id, product_id:p.raw_id||p.product_id||"", name:p.name, price:safeNum(p.price,0)}).replace(/'/g,"&#39;");
      return `
      <div class="card">
        ${p.image ? `<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" onerror="this.src='';this.alt='無圖片';this.style.height='60px';">` : `<div style="height:160px;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;margin-bottom:8px;color:#aaa;">無圖片</div>`}
        <div class="meta">${escapeHtml(p.sku || p.raw_id || "")}</div>
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.category || "未分類")}${unitText}</p>
        <p class="price">單價：$${typeof formatCartMoney === "function" ? formatCartMoney(p.price) : safeNum(p.price,0)}</p>
        <div class="qty-box">
          <label class="qty-label" for="${inputId}">購買數量</label>
          <input id="${inputId}" class="qty-input" type="number" min="1" step="0.01" value="1">
        </div>
        <button type="button" onclick='addToCartFromList(${itemJson}, "${inputId}")'>加入購物車</button>
      </div>`;
    }).join("");
  }

  renderShopPagination(pager, totalPages, SHOP_PAGE);
}

function renderShopPagination(container, totalPages, currentPage){
  if (!container) return;
  container.innerHTML = "";
  container.className = "pagination-bar shop-pagination-bar";
  if (totalPages <= 1) return;

  const current = Math.max(1, Math.min(Number(currentPage) || 1, Number(totalPages) || 1));

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
      btn.addEventListener("click", () => renderCurrent(targetPage));
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

  container.appendChild(makeBtn("首頁", 1, { kind: "home", disabled: current === 1 }));
  container.appendChild(makeBtn("上一頁", current - 1, { kind: "nav prev", disabled: current === 1 }));

  const visiblePages = getVisiblePages(totalPages, current);
  let last = 0;
  visiblePages.forEach(pageNo => {
    if (last && pageNo - last > 1) container.appendChild(makeDots());
    container.appendChild(makeBtn(String(pageNo), pageNo, { active: pageNo === current }));
    last = pageNo;
  });

  container.appendChild(makeBtn("下一頁", current + 1, { kind: "nav next", disabled: current === totalPages }));
  container.appendChild(makeBtn("末頁", totalPages, { kind: "home", disabled: current === totalPages }));

  const summary = document.createElement("span");
  summary.className = "page-summary";
  summary.textContent = `第 ${current} / ${totalPages} 頁`;
  container.appendChild(summary);
}

function addToCartFromList(item, qtyInputId){
  if (!item || !item.id) return;
  const qtyEl = qtyInputId ? document.getElementById(qtyInputId) : null;
  const qty = qtyEl ? Number(qtyEl.value) : 1;
  if (typeof addToCart === "function") addToCart(item, qty);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

document.addEventListener("DOMContentLoaded", () => {
  updateHeaderBits();
  loadProducts();
});
