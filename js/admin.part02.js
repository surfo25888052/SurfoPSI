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


function renderCategoryFilter(products) {
  const container = document.getElementById("category-filter");
  if (!container) return;
  const categories = ["全部商品", ...new Set((products || []).map(p => p.category).filter(Boolean))];
  container.innerHTML = "";
  categories.forEach(c => {
    const btn = document.createElement("button");
    btn.textContent = c;
    btn.className = "category-btn";
    if (c === "全部商品") btn.classList.add("active");
    btn.addEventListener("click", () => {
      container.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const filtered = (c === "全部商品") ? adminProducts : adminProducts.filter(p => p.category === c);
      renderAdminProducts(filtered, 1);
    });
    container.appendChild(btn);
  });
}

function searchProducts(keepPageNo = null) {
  const _page = (Number.isFinite(Number(keepPageNo)) && Number(keepPageNo) > 0) ? Number(keepPageNo) : 1;
  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  if (!keyword) {
    renderAdminProducts(adminProducts, _page);
    return;
  }
  const filtered = (adminProducts || []).filter(p => {
    const name = String(p.name || "").toLowerCase();
    const sku = String(p.sku || p.part_no || p.code || p["料號"] || "").toLowerCase();
    const id = String(p.id || "").toLowerCase();
    const sup = String(p.supplier_names || p.supplier_name || "").toLowerCase();
        return name.includes(keyword) || sku.includes(keyword) || id.includes(keyword) || sup.includes(keyword);
  });
  renderAdminProducts(filtered, _page);
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

    const tr = document.createElement("tr");
    tr.dataset.productId = String(p.id || "");
    tr.innerHTML = `
      <td>${sku}</td>
      <td>${p.name ?? ""}</td>
      <td>${supplierPrimary}</td>
      <td>${p.unit ?? ""}</td>
      <td>${safeNum(p.price)}</td>
      <td>${safeNum(cost)}</td>
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
          <input id="add-category" class="admin-input" type="text" placeholder="例：冷凍 / 青菜 / 雜貨 / 乾貨">
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
  const price = safeNum(document.getElementById("add-price")?.value);
  const cost  = safeNum(document.getElementById("add-cost")?.value);
  const stock = safeNum(document.getElementById("add-stock")?.value);
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
          <input id="edit-price" class="admin-input" type="number" value="${escapeAttr_(price)}" placeholder="0">
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
          <label>調整庫存（輸入「新庫存」，留空=不調整）</label>
          <input id="edit-setstock" class="admin-input" type="number" placeholder="例：120">
        </div>

        <div class="field">
          <label>安全庫存</label>
          <input id="edit-safety" class="admin-input" type="number" value="${escapeAttr_(safety)}" placeholder="0">
        </div>

        <div class="field">
          <label>分類</label>
          <input id="edit-category" class="admin-input" type="text" value="${escapeAttr_(p.category ?? "")}">
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

