// ===== index 進銷存版（沿用原 index 介面/分類） =====

let sortState = { key: null, asc: true };
let currentPage = 1;
const productsPerPage = 20;

let allProducts = [];
let currentCategory = "全部商品";
let searchKeyword = "";

// ------------------ 會員 / 操作人 ------------------
function requireUserForInventory() {
  const member = (typeof getMember === "function") ? getMember() : null;
  if (!member) {
    alert("請先登入，才能進行庫存增減！");
    setTimeout(() => { window.location.href = "login.html"; }, 600);
    return null;
  }
  return member;
}

function operatorString(member) {
  const id = (member && member.id) ? String(member.id).trim() : "";
  const name = (member && member.name) ? String(member.name).trim() : "";
  if (id && name) return `${id}|${name}`;
  return name || id || "";
}

// ------------------ 商品載入 ------------------
function loadProducts(preferCache = true) {
  if (preferCache) {
    const cached = JSON.parse(localStorage.getItem("products") || "null");
    if (Array.isArray(cached)) {
      allProducts = cached;
      renderAllUI();
      return;
    }
  }
  fetchProductsFromServer();
}

function fetchProductsFromServer(after) {
  callGAS({ type: "products" }, data => {
    if (data && data.data) data = data.data;
    if (!Array.isArray(data)) data = [];
    allProducts = data;
    localStorage.setItem("products", JSON.stringify(allProducts));
    // 重新生成分類快取
    localStorage.removeItem("categories");
    renderAllUI();
    if (typeof after === "function") after();
  });
}

// ------------------ 分類 ------------------
function getCategories(products) {
  return ["全部商品", ...new Set((products || []).map(p => p.category).filter(Boolean))];
}

function renderCategories(categories) {
  const container = document.getElementById("category-filter");
  if (!container) return;
  container.innerHTML = "";

  categories.forEach(c => {
    const btn = document.createElement("button");
    btn.textContent = c;
    btn.className = "category-btn";
    btn.dataset.category = c;
    if (c === currentCategory) btn.classList.add("active");

    btn.addEventListener("click", () => {
      currentCategory = c;
      document.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderCurrent(1);
    });

    container.appendChild(btn);
  });
}

// ------------------ 搜尋 ------------------
function searchProducts() {
  const keyword = document.getElementById("searchInput")?.value.trim().toLowerCase() || "";
  searchKeyword = keyword;
  renderCurrent(1);
}

// ------------------ 排序 ------------------
function sortProducts(key) {
  if (sortState.key === key) sortState.asc = !sortState.asc;
  else { sortState.key = key; sortState.asc = true; }

  renderCurrent(1);
  updateArrow(key);
}

function updateArrow(key) {
  document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.classList.remove("asc", "desc");
    if (btn.getAttribute("onclick")?.includes(key)) {
      btn.classList.add(sortState.asc ? "asc" : "desc");
    }
  });
}

// ------------------ 清單計算 ------------------
function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function compareMixed(a, b) {
  const na = Number(a), nb = Number(b);
  const aNum = Number.isFinite(na), bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  return String(a).localeCompare(String(b), "zh-Hant");
}

function getFilteredSortedProducts() {
  let list = Array.isArray(allProducts) ? [...allProducts] : [];

  // category
  if (currentCategory && currentCategory !== "全部商品") {
    list = list.filter(p => p.category === currentCategory);
  }

  // search
  if (searchKeyword) {
    list = list.filter(p => String(p.name || "").toLowerCase().includes(searchKeyword));
  }

  // sort
  if (sortState.key === "price") {
    list.sort((a, b) => sortState.asc ? (safeNum(a.price) - safeNum(b.price)) : (safeNum(b.price) - safeNum(a.price)));
  } else if (sortState.key === "id") {
    list.sort((a, b) => sortState.asc ? compareMixed(a.id, b.id) : compareMixed(b.id, a.id));
  }

  return list;
}

// ------------------ 商品渲染 ------------------
function renderCurrent(page = 1) {
  const list = getFilteredSortedProducts();
  renderProducts(list, page);
  updateProductCount(list);
}

function renderProducts(products, page = 1) {
  const container = document.getElementById("product-list");
  if (!container) return;

  const totalProducts = products.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / productsPerPage));
  currentPage = Math.min(Math.max(1, page), totalPages);

  const start = (currentPage - 1) * productsPerPage;
  const end = start + productsPerPage;
  const pageProducts = products.slice(start, end);

  container.innerHTML = "";

  pageProducts.forEach(p => {
    const card = document.createElement("div");
    card.className = "card";

    const image = p.image || "";
    const name = p.name || "未命名商品";
    const price = safeNum(p.price, 0);
    const stock = safeNum(p.stock, 0);
    const unit = p.unit || "";

    card.innerHTML = `
      ${p.tag ? `<div class="tag">${p.tag}</div>` : ""}
      <img src="${image}" alt="${name}">
      <h3>${name}</h3>
      <p>${unit ? unit : "每公斤"}</p>
      <p><b>單價:</b> $${price} 元</p>
      <p class="stock-line"><b>庫存:</b> <span class="stock-val">${stock}</span></p>

      <div class="inv-controls" data-pid="${p.id}" data-pname="${encodeURIComponent(name)}">
        <input class="inv-qty" type="number" min="1" step="1" value="1" title="數量">
        <input class="inv-note" type="text" placeholder="備註(選填)" title="備註">
        <div class="inv-btn-row">
          <button class="inv-btn inv-in" type="button" data-action="IN">入庫 +</button>
          <button class="inv-btn inv-out" type="button" data-action="OUT">出庫 -</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  renderPagination(totalPages);
}

function updateProductCount(products) {
  const countEl = document.getElementById("product-count");
  if (countEl) countEl.textContent = `共 ${products.length} 項商品`;
}

// ------------------ 分頁 ------------------
function renderPagination(totalPages) {
  const container = document.getElementById("pagination");
  if (!container) return;

  container.innerHTML = "";
  if (totalPages <= 1) return;

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = i === currentPage ? "page-btn active" : "page-btn";
    btn.addEventListener("click", () => renderCurrent(i));
    container.appendChild(btn);
  }
}

// ------------------ 進銷存操作（index） ------------------
function adjustStockFromIndex(productId, productName, delta, note) {
  const member = requireUserForInventory();
  if (!member) return;

  const operator = operatorString(member);
  const reason = note ? `index:${delta >= 0 ? "IN" : "OUT"}:${note}` : `index:${delta >= 0 ? "IN" : "OUT"}`;

  callGAS({
    type: "stockAdjust",
    product_id: productId,
    product_name: productName,
    delta: delta,
    reason: reason,
    operator: operator
  }, res => {
    if (res?.status !== "ok") {
      alert(res?.message || "庫存調整失敗");
      return;
    }
    // 成功後從後端重新載入，確保庫存顯示「如實一致」
    const keepPage = currentPage;
    fetchProductsFromServer(() => {
      // 分類可能變動，重新渲染
      renderCurrent(keepPage);
    });
  });
}

function bindInventoryHandlers() {
  const list = document.getElementById("product-list");
  if (!list) return;

  list.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".inv-btn");
    if (!btn) return;

    const wrap = btn.closest(".inv-controls");
    if (!wrap) return;

    const pid = String(wrap.getAttribute("data-pid") || "").trim();
    const pname = decodeURIComponent(String(wrap.getAttribute("data-pname") || ""));
    const qtyEl = wrap.querySelector(".inv-qty");
    const noteEl = wrap.querySelector(".inv-note");

    const qty = safeNum(qtyEl?.value, 0);
    if (!qty || qty <= 0) { alert("數量必須大於 0"); return; }

    const action = String(btn.getAttribute("data-action") || "");
    const delta = action === "IN" ? qty : -qty;
    const note = (noteEl?.value || "").trim();

    // 出庫前提示（最終仍以後端檢查為準）
    if (delta < 0) {
      const p = (allProducts || []).find(x => String(x.id) === String(pid));
      const stock = safeNum(p?.stock, 0);
      if (stock < Math.abs(delta)) {
        alert(`庫存不足（目前 ${stock}，欲出庫 ${Math.abs(delta)}）`);
        return;
      }
    }

    adjustStockFromIndex(pid, pname, delta, note);

    if (noteEl) noteEl.value = "";
  });
}

// ------------------ 顯示最後更新日期 ------------------
function showLastUpdate(val) {
  const el = document.getElementById("last-update");
  if (el) el.textContent = `最後更新：${val}`;
}

function initLastUpdate() {
  const today = new Date().toISOString().split('T')[0];
  const cache = JSON.parse(localStorage.getItem('lastUpdateCache') || '{}');

  if (cache.date === today && cache.value) {
    showLastUpdate(cache.value);
  } else {
    callGAS({ type: "lastUpdate" }, res => {
      if (res?.lastUpdate) {
        showLastUpdate(res.lastUpdate);
        localStorage.setItem('lastUpdateCache', JSON.stringify({ date: today, value: res.lastUpdate }));
      }
    });
  }
}

// ------------------ 初始化 ------------------
function renderAllUI() {
  // 分類
  const categories = getCategories(allProducts);
  renderCategories(categories);

  // 預設啟用「全部商品」
  if (!categories.includes(currentCategory)) currentCategory = "全部商品";

  renderCurrent(1);
}

document.addEventListener("DOMContentLoaded", () => {
  updateMemberArea();
  bindInventoryHandlers();
  loadProducts(true);
  initLastUpdate();

  // 刷新商品（清快取後重新抓）
  const btn = document.getElementById('clear-cache-btn');
  btn?.addEventListener('click', () => {
    localStorage.removeItem('products');
    localStorage.removeItem('categories');
    fetchProductsFromServer();
  });
});
