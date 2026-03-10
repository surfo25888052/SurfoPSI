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

function referencePriceText_(v){
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : s;
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
        alert(res.message || `同步完成：更新 ${res.updated_count || 0} 筆商品參考價格`);
      }
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || "同步最新參考行情"; }
    });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || "同步最新參考行情"; }
    alert("同步參考行情失敗");
  }
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
    const refPrice = referencePriceText_(p.reference_price ?? p.ref_price ?? "");

    const tr = document.createElement("tr");
    tr.dataset.productId = String(p.id || "");
    tr.innerHTML = `
      <td>${sku}</td>
      <td>${p.name ?? ""}</td>
      <td>${p.spec ?? ""}</td>
      <td>${supplierPrimary}</td>
      <td>${p.unit ?? ""}</td>
      <td>${safeNum(p.price)}</td>
      <td>${safeNum(cost)}</td>
      <td>${refPrice}</td>
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
    spec,
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

        <div class="field">
          <label>規格</label>
          <input id="add-spec" class="admin-input" type="text" placeholder="例：12公斤/袋">
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
          ${buildProductCategorySelectHtml_("add-category")}
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
const cost  = safeNum(costRaw);
const stock = safeNum(stockRaw);
let price = safeNum(priceRaw);

// 售價預設帶入成本（避免被誤帶成庫存數量）
if ((!priceRaw || priceRaw === "0" || price === 0) && cost > 0) price = cost;
if (priceRaw && stockRaw && price === stock && cost > 0 && price !== cost) price = cost;
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
    spec,
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
          <label>料號</label>
          <input id="edit-sku" class="admin-input" type="text" value="${escapeAttr_(sku)}" placeholder="可留空">
        </div>

        <div class="field">
          <label>商品名稱</label>
          <input id="edit-name" class="admin-input" type="text" value="${escapeAttr_(p.name ?? "")}">
        </div>

        <div class="field">
          <label>規格</label>
          <input id="edit-spec" class="admin-input" type="text" value="${escapeAttr_(p.spec ?? "")}">
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
          <div class="inline-row">
            <input id="edit-price" class="admin-input readonly" type="number" value="${escapeAttr_(price)}" placeholder="0" readonly>
            <button id="edit-price-calc" class="admin-btn" type="button">計算/設定</button>
          </div>
          <div class="hint">用成本計算加價% 或輸入售價，立即看到利潤%</div>
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
          <label>參考價格</label>
          <input id="edit-reference-price" class="admin-input readonly" type="number" value="${escapeAttr_(referencePrice)}" readonly>
          <div class="hint">最新參考行情以上價為主${referencePriceDate ? `（${referencePriceDate}）` : ""}</div>
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
          ${buildProductCategorySelectHtml_("edit-category", p.category ?? "")}
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
    document.getElementById("edit-price-calc")?.addEventListener("click", () => openPriceCalcModal_());

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

  const round2_ = (n) => {
    const num = Number(n);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
  };
  const fmt_ = (n) => {
    const num = round2_(n);
    return Number.isFinite(num) ? String(num) : "0";
  };

  const cost = safeNum(costEl.value, 0);
  const currentPrice = safeNum(priceEl.value, 0);
  const initPct = cost > 0 ? round2_(((currentPrice / cost) - 1) * 100) : 0;

  body.innerHTML = `
    <div class="form-grid">
      <div class="field">
        <label>目前成本</label>
        <input id="priceCalcCost" class="admin-input readonly" type="number" value="${escapeAttr_(fmt_(cost))}" readonly>
      </div>

      <div class="field">
        <label>目前售價</label>
        <input id="priceCalcCurrentPrice" class="admin-input readonly" type="number" value="${escapeAttr_(fmt_(currentPrice))}" readonly>
      </div>

      <div class="field span-2">
        <div class="hint">算法 1：新售價 = 成本 × (1 + 百分比 / 100)</div>
      </div>

      <div class="field">
        <label>百分比（加價%）</label>
        <input id="priceCalcPercent" class="admin-input" type="number" step="0.01" value="${escapeAttr_(fmt_(initPct))}" placeholder="例如：30">
      </div>

      <div class="field">
        <label>新售價</label>
        <input id="priceCalcManualPrice" class="admin-input" type="number" step="0.01" value="${escapeAttr_(fmt_(currentPrice))}" placeholder="請輸入售價">
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
    const newPrice = round2_(cost * (1 + pct / 100));
    syncing = true;
    manualPriceInput.value = fmt_(newPrice);
    syncing = false;
    if (eq1) eq1.textContent = `成本 ${fmt_(cost)} × (1 + ${fmt_(pct)}%) = 新售價 ${fmt_(newPrice)}`;
    if (eq2) eq2.textContent = `新售價 ${fmt_(newPrice)} 相對成本 ${fmt_(cost)} 的利潤為 ${fmt_(pct)}%`;
  }

  function renderByPrice_(){
    if (!percentInput || !manualPriceInput) return;
    const newPrice = safeNum(manualPriceInput.value, 0);
    const pct = cost > 0 ? round2_(((newPrice / cost) - 1) * 100) : 0;
    syncing = true;
    percentInput.value = fmt_(pct);
    syncing = false;
    if (eq1) eq1.textContent = `成本 ${fmt_(cost)} × (1 + ${fmt_(pct)}%) = 新售價 ${fmt_(newPrice)}`;
    if (eq2) eq2.textContent = `新售價 ${fmt_(newPrice)} 相對成本 ${fmt_(cost)} 的利潤為 ${fmt_(pct)}%`;
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
    const finalPrice = safeNum(manualPriceInput?.value, 0);
    priceEl.value = fmt_(finalPrice);
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
