function saveProductEdit_(orig){
  const id = _editingProductId_;
  if (!id) return;
  const _activePageBtn = document.querySelector('#pagination .page-btn.active');
  const _keepProductPage = Number((_activePageBtn?.textContent || productPage || 1));

  const name = document.getElementById("edit-name")?.value.trim();
  const sku  = document.getElementById("edit-sku")?.value.trim();
  const unit = document.getElementById("edit-unit")?.value.trim();
  const price = safeNum(document.getElementById("edit-price")?.value);
  const safety_stock = safeNum(document.getElementById("edit-safety")?.value);
  const category = document.getElementById("edit-category")?.value.trim();
  const expiry_date = document.getElementById("edit-expiry")?.value.trim() || "";

  const supBox = document.getElementById("edit-suppliers-box");
  const selectedIds = supBox ? Array.from(supBox.querySelectorAll('input[name="edit-product-supplier"]:checked')).map(i => String(i.value).trim()).filter(Boolean) : [];
  const supplier_ids = selectedIds.join(",");

  if (!name) return alert("請填寫商品名稱");
  if (!supplier_ids) return alert("請至少勾選 1 個供應商（代碼）");

  const wantStockRaw = document.getElementById("edit-setstock")?.value;
  const wantStockTrim = String(wantStockRaw ?? "").trim();
  const desired = wantStockTrim === "" ? null : Number(wantStockTrim);
  if (desired !== null && isNaN(desired)) return alert("調整庫存請輸入數字或留空");

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const _applyEditedProductLocal_ = (finalStock) => {
    try {
      const idx = (adminProducts || []).findIndex(x => String(x?.id || "") === String(id));
      if (idx >= 0) {
        const prev = adminProducts[idx] || {};
        const next = { ...prev };
        next.sku = sku;
        next.supplier_ids = supplier_ids;
        next.name = name;
        next.category = category;
        next.unit = unit;
        next.price = price;
        next.safety_stock = safety_stock;
        next.expiry_date = expiry_date;
        if (finalStock !== undefined && finalStock !== null && !isNaN(Number(finalStock))) {
          next.stock = Number(finalStock);
        }
        // 盡量同步供應商名稱（若 suppliers 已載入）
        try {
          const ids = String(supplier_ids || "").split(",").map(x => x.trim()).filter(Boolean);
          const names = ids.map(sid => {
            const hit = (suppliers || []).find(s => String(s.id || s.supplier_id || "") === sid);
            return hit ? String(hit.name || hit.supplier_name || "") : "";
          }).filter(Boolean);
          if (names.length) {
            next.supplier_names = names.join(",");
            next.supplier_name = names[0];
          }
        } catch(e) {}
        adminProducts[idx] = next;
        try { LS.set("products", adminProducts); } catch(e) {}
      }

      // 立即重繪目前頁，讓使用者不用等後端重新讀取才看到變更
      productFlashId = String(_editingProductId_ || "");
      if (isSectionActive_("product-section")) {
        const kw = (document.getElementById("searchInput")?.value || "").trim();
        if (kw) searchProducts(_keepProductPage);
        else renderAdminProducts(adminProducts, _keepProductPage);
      }

      // 若進貨頁正在使用商品/供應商配對，也同步更新前端索引
      try { buildSupplierProductIndex_(true); } catch(e) {}
      if (isSectionActive_("purchase-section")) {
        try { refreshAllPurchaseRows_(); } catch(e) {}
      }
    } catch (e) {
      console.error("apply edited product local failed", e);
    }
  };


  const _finishProductEdit_ = (message, opts = {}) => {
    const reloadLedger = !!opts.reloadLedger;
    const hasFinalStock = Object.prototype.hasOwnProperty.call(opts, "finalStock");
    const finalStock = hasFinalStock ? opts.finalStock : undefined;

    closeProductEditModal_();
    alert(message || "更新完成");

    // 先本地立即更新 + 高亮（體感快）
    _applyEditedProductLocal_(finalStock);

    // 後端資料再背景同步，避免等待造成卡頓
    setTimeout(() => {
      try { loadAdminProducts(true, _keepProductPage, { skipProductRender: true, skipCategoryRender: true }); } catch(e) { console.error("reload products after edit failed", e); }
      if (reloadLedger) {
        try { loadLedger(true); } catch(e) { console.error("reload ledger after edit failed", e); }
      }
      // loadAdminProducts 內部已會 scheduleDashboardRefresh_，這裡不重複 refreshDashboard()
    }, 30);
  };

  // 先更新主檔（不含 stock/cost）
  gas({
    type: "manageProduct",
    action: "update",
    id,
    sku,
    supplier_ids,
    name,
    category,
    unit,
    price,
    safety_stock,
    expiry_date
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "更新商品失敗（後端寫入未成功）");
      return;
    }

    // 沒有調整庫存：直接完成
    if (desired === null) {
      LS.del("products");
      _finishProductEdit_("更新完成");
      return;
    }

    const before = Number(orig.stock || 0);
    const delta = desired - before;
    if (delta === 0) {
      LS.del("products");
      _finishProductEdit_("更新完成（庫存未變更）", { finalStock: before });
      return;
    }

    gas({
      type: "stockAdjust",
      product_id: id,
      delta: delta,
      reason: "admin:setStock",
      operator: operator
    }, r2 => {
      if (!r2 || r2.status !== "ok") {
        alert(r2?.message || "庫存調整失敗（後端寫入未成功）");
        return;
      }
      LS.del("products");
      LS.del("stockLedger");
      _finishProductEdit_("更新完成（已記錄操作紀錄）", { reloadLedger: true, finalStock: desired });
    });
  });
}

function editProduct(id) {
  openProductEditModal_(id);
}


function onProductAction_(id, action){
  if (!id) return;
  if (action === "edit") return editProduct(id);
  if (action === "delete") return deleteProduct(id);
  if (action === "image") return viewProductImage(id);
  if (action === "history") return viewProductHistory(id);
}

function deleteProduct(id) {
  if (!confirm("確定要刪除此商品嗎？")) return;
  gas({ type: "manageProduct", action: "delete", id }, res => {
    if (res?.status && res.status !== "ok") {
      const list = LS.get("products", adminProducts).filter(x => String(x.id) !== String(id));
      LS.set("products", list);
      adminProducts = list;
    } else {
      LS.del("products");
    }

    loadAdminProducts(true, _keepProductPage);
    alert(res?.message || "刪除完成");
  });
}

// ------------------ 供應商 ------------------
function bindCustomerEvents(){
  document.getElementById("cus-add")?.addEventListener("click", addCustomer);
}

function bindSupplierEvents() {
  document.getElementById("sup-add")?.addEventListener("click", addSupplier);
}

function loadCustomers(force=false){
  return new Promise(resolve => {
    const cached = LS.get("customers", null);
    if (!force && Array.isArray(cached) && cached.length) {
      customers = cached;
      if (isSectionActive_("customer-section")) renderCustomers(customers, 1);
      resolve(customers);
      return;
    }
    gas({ type: "customers" }, res => {
      const list = normalizeList(res);
      customers = list;
      if (list.length) LS.set("customers", list);
      if (isSectionActive_("customer-section")) renderCustomers(list, 1);
      resolve(customers);
    });
  });
}

function renderCustomers(list, page=1){
  customerPage = page;
  const tbody = document.querySelector("#customer-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / customersPerPage));
  customerPage = Math.min(customerPage, totalPages);

  const start = (customerPage - 1) * customersPerPage;
  const end = start + customersPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id ?? ""}</td>
      <td>${c.name ?? ""}</td>
      <td>${c.phone ?? ""}</td>
      <td>${c.address ?? ""}</td>
      <td class="row-actions">
        <button onclick="deleteCustomer('${c.id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("customer-pagination", totalPages, i => renderCustomers(list, i), customerPage);
}

function addCustomer(){
  const name = document.getElementById("cus-name")?.value.trim();
  const phone = document.getElementById("cus-phone")?.value.trim() || "";
  const address = document.getElementById("cus-address")?.value.trim() || "";
  if (!name) return alert("請輸入客戶名稱");

  gas({
    type: "manageCustomer",
    action: "add",
    name,
    phone,
    address
  }, res => {
    if (!res || res.status !== "ok") return alert(res?.message || "新增客戶失敗");
    LS.del("customers");
    loadCustomers(true);
    // 清空
    document.getElementById("cus-name").value = "";
    if (document.getElementById("cus-phone")) document.getElementById("cus-phone").value = "";
    if (document.getElementById("cus-address")) document.getElementById("cus-address").value = "";
    alert("新增客戶成功");
  });
}

function deleteCustomer(id){
  if (!confirm("確定要刪除此客戶？")) return;
  gas({ type: "manageCustomer", action: "delete", id }, res => {
    if (!res || res.status !== "ok") return alert(res?.message || "刪除失敗");
    LS.del("customers");
    loadCustomers(true);
  });
}

window.deleteCustomer = deleteCustomer;

function fillCustomerSelect_(keyword=""){
  const sel = document.getElementById("so-customer-select");
  if (!sel) return;

  const list = customers.length ? customers : LS.get("customers", []);
  const kw = String(keyword || "").trim().toLowerCase();

  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "__manual__";
  opt0.textContent = "（自訂輸入）";
  sel.appendChild(opt0);

  (list || [])
    .filter(c => {
      if (!kw) return true;
      return String(c.name || "").toLowerCase().includes(kw) || String(c.id || "").toLowerCase().includes(kw);
    })
    .slice(0, 80)
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.id} - ${c.name}`;
      sel.appendChild(opt);
    });
}

function loadSuppliers(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("suppliers", null);

    // 快速路徑：先用快取（避免每次進入進貨/銷貨都要等後端）
    if (!force && Array.isArray(cached) && cached.length) {
      suppliers = cached;
      // 不論在哪個頁面，都要刷新下拉/checkbox（這些很輕量）
      fillSupplierSelect();
      fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box"));
      // 只有在「供應商管理」頁才渲染表格（避免大量 DOM 操作拖慢載入）
      if (isSectionActive_("supplier-section")) renderSuppliers(suppliers, 1);
      resolve(suppliers);
      // 不直接 return：繼續背景抓最新，避免供應商快取過期造成前端顯示舊資料/空白
    }

    // 後端抓最新
    gas({ type: "suppliers" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        suppliers = Array.isArray(cached) ? cached : [];
        if (!suppliers.length) alert("供應商資料載入失敗（後端未回傳/尚未建立工作表 suppliers）");
      } else {
        suppliers = list;
        LS.set("suppliers", list); // cache only
      }

      if (isSectionActive_("supplier-section")) renderSuppliers(suppliers, supplierPage || 1);
      fillSupplierSelect();
      fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box"));

      // 若商品編輯彈窗已開啟，刷新供應商勾選清單（保留目前已勾選）
      const __editSupBox = document.getElementById("edit-suppliers-box");
      if (__editSupBox) {
        const __checked = Array.from(__editSupBox.querySelectorAll('input[name="edit-product-supplier"]:checked'))
          .map(el => String(el.value || "").trim())
          .filter(Boolean);
        try { fillSupplierCheckboxesForEdit_(__editSupBox, __checked); } catch(e) {}
      }

      // 更新供應商後，同步刷新進貨頁供應商→商品配對索引
      try { buildSupplierProductIndex_(true); } catch(e) {}
      if (isSectionActive_("purchase-section")) {
        try { refreshAllPurchaseRows_(); } catch(e) {}
      }

      // 商品主檔供應商名稱顯示依賴 suppliers；刷新後重繪避免顯示空白
      if (isSectionActive_("product-section")) {
        try {
          const __kw = (document.getElementById("searchInput")?.value || "").trim();
          if (__kw) searchProducts(productPage || 1);
          else renderAdminProducts(adminProducts, productPage || 1);
        } catch(e) {}
      }

      resolve(suppliers);
    });
  });
}

function renderSuppliers(list, page = 1) {
  supplierPage = page;
  const tbody = document.querySelector("#supplier-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / suppliersPerPage));
  supplierPage = Math.min(supplierPage, totalPages);

  const start = (supplierPage - 1) * suppliersPerPage;
  const end = start + suppliersPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.id ?? ""}</td>
      <td>${s.name ?? ""}</td>
      <td>${s.phone ?? ""}</td>
      <td>${s.address ?? ""}</td>
      <td class="row-actions">
        <button onclick="editSupplier('${s.id}')">編輯</button>
        <button onclick="deleteSupplier('${s.id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("supplier-pagination", totalPages, i => renderSuppliers(list, i), supplierPage);
}

function fillProductSupplierCheckboxes(boxEl){
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
  list.forEach(s => {
    const id = String(s.id);
    const label = document.createElement("label");
    label.className = "chk";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "new-product-supplier";
    input.value = id;

    const span = document.createElement("span");
    span.textContent = String(s.name || "");

    label.appendChild(input);
    label.appendChild(span);
    boxEl.appendChild(label);
  });
}

function fillSupplierSelect(selectEl) {
  // 兼容：不帶參數時，填入所有需要的供應商下拉（舊版只有 #po-supplier；新版進貨行用 .po-supplier）
  const targets = [];
  if (selectEl) {
    targets.push(selectEl);
  } else {
    const legacy = document.getElementById("po-supplier");
    if (legacy) targets.push(legacy);
    document.querySelectorAll("select.po-supplier").forEach(s => targets.push(s));
  }

  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  targets.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = "";
    if (sel.classList && sel.classList.contains("po-supplier")) {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "請選擇供應商";
      sel.appendChild(ph);
    }
    const usable = (list || []).filter(s => String(s?.id || "").trim());
    if (!usable.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（尚無供應商，請先新增）";
      sel.appendChild(opt);
      return;
    }
    usable.forEach(s => {
      const sid = String(s.id).trim();
      const opt = document.createElement("option");
      opt.value = sid;
      opt.textContent = s.name || sid;
      sel.appendChild(opt);
    });
  });
}

function addSupplier() {
  const name = document.getElementById("sup-name")?.value.trim();
  const phone = document.getElementById("sup-phone")?.value.trim();
  const address = document.getElementById("sup-address")?.value.trim();
  if (!name) return alert("請輸入供應商名稱");

  const payload = { id: genId("S"), name, phone, address };

  gas({ type: "manageSupplier", action: "add", supplier: encodeURIComponent(JSON.stringify(payload)) }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "新增供應商失敗（後端寫入未成功）");
      return;
    }

    // 後端 ok：清空輸入、刷新（允許快取清除）
    LS.del("suppliers");
    document.getElementById("sup-name").value = "";
    document.getElementById("sup-phone").value = "";
    document.getElementById("sup-address").value = "";

    loadSuppliers(true);
    alert(res?.message || "新增完成");
  });
}

function editSupplier(id) {
  const s = suppliers.find(x => String(x.id) === String(id)) || LS.get("suppliers", []).find(x => String(x.id) === String(id));
  const newName = prompt("供應商名稱", s?.name ?? "");
  if (newName === null) return;
  const newPhone = prompt("電話", s?.phone ?? "");
  if (newPhone === null) return;
  const newAddr = prompt("地址", s?.address ?? "");
  if (newAddr === null) return;

  gas({ type: "manageSupplier", action: "update", id, name: newName, phone: newPhone, address: newAddr }, res => {
    if (res?.status && res.status !== "ok") {
      const list = LS.get("suppliers", suppliers);
      const idx = list.findIndex(x => String(x.id) === String(id));
      if (idx >= 0) {
        list[idx].name = newName;
        list[idx].phone = newPhone;
        list[idx].address = newAddr;
      }
      LS.set("suppliers", list);
      suppliers = list;
    } else {
      LS.del("suppliers");
    }

    loadSuppliers(true);
    alert(res?.message || "更新完成");
  });
}

function deleteSupplier(id) {
  if (!confirm("確定刪除供應商？")) return;
  gas({ type: "manageSupplier", action: "delete", id }, res => {
    if (res?.status && res.status !== "ok") {
      const list = LS.get("suppliers", suppliers).filter(x => String(x.id) !== String(id));
      LS.set("suppliers", list);
      suppliers = list;
    } else {
      LS.del("suppliers");
    }

    loadSuppliers(true);
    alert(res?.message || "刪除完成");
  });
}

// ------------------ 進貨單 ------------------
function initPurchaseForm() {
  const dateEl = document.getElementById("po-date");
  if (dateEl && !dateEl.value) dateEl.value = todayISO();

  const tbody = document.querySelector("#po-items-table tbody");
  if (tbody && tbody.children.length === 0) addPurchaseRow();

  try { refreshAllPurchaseRows_(); } catch(e) { console.error(e); }

  if (!window.__purchaseFormBound__) {
    window.__purchaseFormBound__ = true;

    document.getElementById("po-add-row")?.addEventListener("click", addPurchaseRow);
    document.getElementById("po-submit")?.addEventListener("click", submitPurchase);

    document.getElementById("po-add-supplier")?.addEventListener("click", () => {
      document.querySelector('.sidebar a[data-target="supplier-section"]')?.click();
    });

    document.getElementById("po-search")?.addEventListener("input", searchPurchases);
    document.getElementById("po-reload")?.addEventListener("click", () => {
      LS.del("purchases");
      loadPurchases(true);
    });

    // 委派監聽：供應商切換時刷新該列商品（保底）
    if (!window.__purchaseDelegatedBound__) {
      window.__purchaseDelegatedBound__ = true;
      document.addEventListener("change", (ev) => {
        const t = ev.target;
        if (t && t.classList && t.classList.contains("po-supplier")) {
          const tr = t.closest("tr");
          try { buildSupplierProductIndex_(true); } catch(e) {}
          refreshPurchaseRowProducts_(tr);
        }
      }, true);
    }
  }
}
function initPickupForm(){
  const dateEl = document.getElementById("pu-date");
  if (dateEl && !dateEl.value) dateEl.value = todayISO();

  const tbody = document.querySelector("#pu-items-table tbody");
  if (tbody && tbody.children.length === 0) addPickupRow();

  document.getElementById("pu-add-row")?.addEventListener("click", addPickupRow);
  document.getElementById("pu-submit")?.addEventListener("click", submitPickup);

  document.getElementById("pu-search")?.addEventListener("input", searchPickups);
  document.getElementById("pu-reload")?.addEventListener("click", () => {
    LS.del("pickups");
    loadPickups(true);
  });
}

