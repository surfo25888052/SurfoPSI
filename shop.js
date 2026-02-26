// shop.js - 電商前台商品列表（與後台共用同一個 GAS / Google Sheet）
let SHOP_PRODUCTS = [];
let SHOP_PAGE = 1;
const SHOP_PAGE_SIZE = 20;
let SHOP_CATEGORY = "全部商品";
let SHOP_KEYWORD = "";
let SHOP_SORT = "";

function safeNum(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function txt(v){ return String(v ?? "").trim(); }

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
  return list.map(p => ({
    id: txt(p.sku || p.id || p.product_id),
    raw_id: txt(p.id || p.product_id),
    sku: txt(p.sku || p.id || p.product_id),
    name: txt(p.name || p.product_name || "未命名商品"),
    category: txt(p.category || "未分類"),
    unit: txt(p.unit || ""),
    image: txt(p.image || ""),
    price: safeNum(p.price, 0),
    stock: safeNum(p.stock, 0),
    safety: safeNum(p.safety, 0)
  }));
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
  if (Array.isArray(cache) && cache.length) {
    SHOP_PRODUCTS = cache;
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

function renderCategoryOptions(){
  const sel = document.getElementById("categorySelect");
  if (!sel) return;
  const cats = ["全部商品", ...Array.from(new Set((SHOP_PRODUCTS||[]).map(p => p.category).filter(Boolean)))];
  if (!cats.includes(SHOP_CATEGORY)) SHOP_CATEGORY = "全部商品";
  sel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"${c===SHOP_CATEGORY?' selected':''}>${escapeHtml(c)}</option>`).join("");
}

function changeCategory(v){
  SHOP_CATEGORY = txt(v) || "全部商品";
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
  if (SHOP_CATEGORY && SHOP_CATEGORY !== "全部商品") list = list.filter(p => p.category === SHOP_CATEGORY);
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
    container.innerHTML = pageItems.map(p => {
      const stock = safeNum(p.stock, 0);
      const low = p.safety > 0 && stock <= p.safety;
      const canBuy = stock > 0;
      const unitText = p.unit ? ` / ${escapeHtml(p.unit)}` : "";
      return `
      <div class="card">
        ${p.image ? `<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" onerror="this.src='';this.alt='無圖片';this.style.height='60px';">` : `<div style="height:160px;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;margin-bottom:8px;color:#aaa;">無圖片</div>`}
        <div class="meta">${escapeHtml(p.sku || p.raw_id || "")}</div>
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.category || "未分類")}${unitText}</p>
        <p class="price">單價：$${safeNum(p.price,0)}</p>
        <p class="stock ${low ? 'low' : ''}">庫存：${stock}${low ? "（低庫存）" : ""}</p>
        <button type="button" ${canBuy ? "" : "disabled"} onclick='addToCartFromList(${JSON.stringify({id:p.raw_id||p.sku, sku:p.sku, name:p.name, price:safeNum(p.price,0)}).replace(/'/g,"&#39;")})'>${canBuy ? "加入購物車" : "暫無庫存"}</button>
      </div>`;
    }).join("");
  }

  pager.innerHTML = "";
  if (totalPages > 1) {
    for (let i=1; i<=totalPages; i++) {
      const btn = document.createElement("button");
      btn.className = "page-btn" + (i===SHOP_PAGE ? " active" : "");
      btn.textContent = String(i);
      btn.addEventListener("click", ()=>renderCurrent(i));
      pager.appendChild(btn);
    }
  }
}

function addToCartFromList(item){
  if (!item || !item.id) return;
  if (typeof addToCart === "function") addToCart(item);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

document.addEventListener("DOMContentLoaded", () => {
  updateHeaderBits();
  loadProducts();
});
