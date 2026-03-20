// ================== 報表：分類篩選（影響庫存/存貨總表/CSV/列印）==================

let reportCatUIWired_ = false;
let reportSupplierPurchaseCache_ = null;
let reportSupplierPurchaseDetailRows_ = [];
let reportCustomerSalesDetailRows_ = [];

function parsePurchaseItemsForReport_(po) {
  let items = po?.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  return Array.isArray(items) ? items : [];
}

function setSupplierAmountHint_(text) {
  const el = document.getElementById("rep-supplier-amount-hint");
  if (el) el.textContent = text || "";
}

function getPurchaseDocIdForReport_(po) {
  return String(po?.po_id || po?.purchase_id || po?.id || "").trim();
}

function getPurchaseDocDateForReport_(po) {
  return toISODateStr(po?.date || po?.arrival_date || po?.created_at || po?.createdAt || "");
}

function renderSupplierPurchaseAmountTable_(rows, hintText) {
  const tbody = document.querySelector("#rep-supplier-amount-table tbody");
  const totalEl = document.getElementById("rep-supplier-amount-total");
  if (!tbody) return;

  const list = Array.isArray(rows) ? rows.slice() : [];
  reportSupplierPurchaseDetailRows_ = list;
  let total = 0;
  tbody.innerHTML = "";

  list.forEach((row, idx) => {
    total += safeNum(row?.amount, 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(row?.supplier_name || row?.supplier_id || "未指定供應商")}</td>
      <td>${safeNum(row?.order_count, 0)}</td>
      <td>${safeNum(row?.item_count, 0)}</td>
      <td>$${money(safeNum(row?.amount, 0))}</td>
      <td></td>
    `;
    const actionTd = tr.lastElementChild;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-btn";
    btn.textContent = "查看";
    btn.style.padding = "6px 12px";
    btn.style.minWidth = "72px";
    btn.addEventListener("click", () => openSupplierPurchaseAmountDetail_(idx));
    actionTd.appendChild(btn);
    tbody.appendChild(tr);
  });

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align:center;opacity:.7;">（此期間沒有供應商進貨資料）</td>`;
    tbody.appendChild(tr);
  }

  if (totalEl) totalEl.textContent = `$${money(total)}`;
  setSupplierAmountHint_(hintText || "依進貨單供應商統計期間金額；多供應商單據會依明細供應商分攤。可點查看完整揭露期間單據日期、編號與金額。");
}

function aggregateSupplierPurchaseAmount_(purchaseOrders) {
  const map = new Map();
  const list = Array.isArray(purchaseOrders) ? purchaseOrders : [];

  const ensureRow = (supplierId, supplierName) => {
    const name = String(supplierName || supplierId || "未指定供應商").trim() || "未指定供應商";
    const sid = String(supplierId || "").trim();
    const key = sid || `name:${name}`;
    if (!map.has(key)) map.set(key, {
      supplier_id: sid,
      supplier_name: name,
      order_count: 0,
      item_count: 0,
      amount: 0,
      detail_rows: [],
      _detail_map: new Map()
    });
    return map.get(key);
  };

  const ensureDetail = (row, po) => {
    const poId = getPurchaseDocIdForReport_(po) || "（未編號）";
    const detailKey = `${poId}@@${getPurchaseDocDateForReport_(po) || ""}`;
    if (!row._detail_map.has(detailKey)) {
      row._detail_map.set(detailKey, {
        date: getPurchaseDocDateForReport_(po),
        po_id: poId,
        amount: 0,
        item_count: 0
      });
    }
    return row._detail_map.get(detailKey);
  };

  list.forEach(po => {
    const items = parsePurchaseItemsForReport_(po);

    if (items.length) {
      items.forEach(it => {
        const supplierId = String(it?.supplier_id || "").trim();
        const supplierName = String(it?.supplier_name || supplierId || po?.supplier_name || po?.supplier_id || "未指定供應商").trim() || "未指定供應商";
        const amount = safeNum(it?.subtotal, NaN);
        const resolvedAmount = Number.isFinite(amount) ? amount : (safeNum(it?.qty ?? it?.quantity, 0) * safeNum(it?.cost ?? it?.price ?? it?.unit_cost, 0));

        const row = ensureRow(supplierId, supplierName);
        row.item_count += 1;
        row.amount += safeNum(resolvedAmount, 0);

        const detail = ensureDetail(row, po);
        detail.amount += safeNum(resolvedAmount, 0);
        detail.item_count += 1;
      });
      return;
    }

    const supplierId = String(po?.supplier_id || "").trim();
    const supplierName = String(po?.supplier_name || supplierId || "未指定供應商").trim() || "未指定供應商";
    const row = ensureRow(supplierId, supplierName);
    row.amount += getPurchaseTotal(po);

    const detail = ensureDetail(row, po);
    detail.amount += getPurchaseTotal(po);
  });

  return Array.from(map.values()).map(row => {
    const detailRows = Array.from(row._detail_map.values()).sort((a, b) => {
      const da = String(a?.date || "");
      const db = String(b?.date || "");
      if (da !== db) return db.localeCompare(da, "zh-Hant");
      return String(b?.po_id || "").localeCompare(String(a?.po_id || ""), "zh-Hant");
    });
    row.detail_rows = detailRows;
    row.order_count = detailRows.length;
    delete row._detail_map;
    return row;
  }).sort((a, b) => {
    const diff = safeNum(b?.amount, 0) - safeNum(a?.amount, 0);
    if (diff !== 0) return diff;
    return String(a?.supplier_name || "").localeCompare(String(b?.supplier_name || ""), "zh-Hant");
  });
}

function fetchDetailedPurchasesForReport_(done) {
  if (Array.isArray(reportSupplierPurchaseCache_)) {
    done(reportSupplierPurchaseCache_, null);
    return;
  }

  gas({ type: "purchases", include_items: 1 }, r => {
    if (String(r?.status || "").toLowerCase() !== "ok") {
      done(null, r?.message || "API timeout");
      return;
    }
    const list = normalizeList(r);
    reportSupplierPurchaseCache_ = list.map(po => ({ ...po, items: parsePurchaseItemsForReport_(po) }));
    done(reportSupplierPurchaseCache_, null);
  }, 30000);
}

function wireSupplierPurchaseDetailModal_() {
  const modal = document.getElementById("supplierAmountDetailModal");
  const closeIds = ["supplierAmountDetailModalClose", "supplierAmountDetailCloseBtn"];
  if (!modal || modal.dataset.wired === "1") return;
  modal.dataset.wired = "1";

  closeIds.forEach(id => {
    document.getElementById(id)?.addEventListener("click", closeSupplierPurchaseAmountDetail_);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeSupplierPurchaseAmountDetail_();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeSupplierPurchaseAmountDetail_();
  });
}

function closeSupplierPurchaseAmountDetail_() {
  const modal = document.getElementById("supplierAmountDetailModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function openSupplierPurchaseAmountDetail_(index) {
  wireSupplierPurchaseDetailModal_();
  const modal = document.getElementById("supplierAmountDetailModal");
  const titleEl = document.getElementById("supplierAmountDetailTitle");
  const bodyEl = document.getElementById("supplierAmountDetailBody");
  if (!modal || !titleEl || !bodyEl) return;

  const row = Array.isArray(reportSupplierPurchaseDetailRows_) ? reportSupplierPurchaseDetailRows_[Number(index)] : null;
  if (!row) return;

  const docs = Array.isArray(row.detail_rows) ? row.detail_rows : [];
  const total = docs.reduce((sum, it) => sum + safeNum(it?.amount, 0), 0);
  titleEl.textContent = `${row?.supplier_name || row?.supplier_id || "未指定供應商"}｜期間單據明細`;

  const rowsHtml = docs.length
    ? docs.map(it => `
        <tr>
          <td>${escapeHtml_(it?.date || "—")}</td>
          <td>${escapeHtml_(it?.po_id || "—")}</td>
          <td>${safeNum(it?.item_count, 0)}</td>
          <td>$${money(safeNum(it?.amount, 0))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" style="text-align:center;opacity:.7;">（此期間沒有單據資料）</td></tr>`;

  bodyEl.innerHTML = `
    <div class="hint" style="margin-bottom:10px;">完整揭露此供應商在所選期間內的單據日期、編號與金額。</div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>單據日期</th>
          <th>編號</th>
          <th>明細數</th>
          <th>金額</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <th colspan="3" style="text-align:right;">合計</th>
          <th>$${money(total)}</th>
        </tr>
      </tfoot>
    </table>
  `;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function renderSupplierPurchaseAmountReport_(purchaseOrders) {
  const sourceList = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  renderSupplierPurchaseAmountTable_([], "供應商期間金額讀取中…");

  fetchDetailedPurchasesForReport_((detailList, errMsg) => {
    if (Array.isArray(detailList) && detailList.length) {
      const detailMap = new Map(detailList.map(po => [String(po?.po_id || po?.purchase_id || po?.id || "").trim(), po]));
      const detailedOrders = sourceList.map(po => detailMap.get(String(po?.po_id || po?.purchase_id || po?.id || "").trim()) || po);
      renderSupplierPurchaseAmountTable_(
        aggregateSupplierPurchaseAmount_(detailedOrders),
        "依進貨單明細供應商統計期間金額；多供應商單據會依明細供應商分攤。"
      );
      return;
    }

    renderSupplierPurchaseAmountTable_(
      aggregateSupplierPurchaseAmount_(sourceList),
      `目前改用進貨單單頭供應商估算期間金額（${errMsg || "detail load failed"}）；多供應商單據可能會被合併。`
    );
  });
}


function setCustomerSalesHint_(text) {
  const el = document.getElementById("rep-customer-sales-hint");
  if (el) el.textContent = text || "";
}

function getOrderDocIdForReport_(order) {
  return String(order?.order_id || order?.id || "").trim();
}

function getOrderDocDateForReport_(order) {
  return toISODateStr(order?.date || order?.created_at || order?.createdAt || "");
}

function getOrderStatusForReport_(order) {
  return String(order?.status || "待出貨").trim() || "待出貨";
}

function getOrderCustomerIdForReport_(order) {
  return String(order?.customer_id || order?.customerId || "").trim();
}

function getOrderCustomerNameForReport_(order) {
  return String(order?.name || order?.customer_name || order?.customerName || "").trim() || "未指定客戶";
}

function renderCustomerSalesAmountTable_(rows, hintText) {
  const tbody = document.querySelector("#rep-customer-sales-table tbody");
  const totalEl = document.getElementById("rep-customer-sales-total");
  if (!tbody) return;

  const list = Array.isArray(rows) ? rows.slice() : [];
  let total = 0;
  tbody.innerHTML = "";
  reportCustomerSalesDetailRows_ = list;

  list.forEach((row, idx) => {
    total += safeNum(row?.amount, 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(row?.customer_name || "未指定客戶")}</td>
      <td>${escapeHtml_(row?.customer_id || "—")}</td>
      <td>${safeNum(row?.order_count, 0)}</td>
      <td>$${money(safeNum(row?.amount, 0))}</td>
      <td></td>
    `;
    const actionTd = tr.lastElementChild;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-btn";
    btn.textContent = "查看";
    btn.style.padding = "6px 12px";
    btn.style.minWidth = "72px";
    btn.addEventListener("click", () => openCustomerSalesAmountDetail_(idx));
    actionTd.appendChild(btn);
    tbody.appendChild(tr);
  });

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align:center;opacity:.7;">（此期間沒有客戶銷貨資料）</td>`;
    tbody.appendChild(tr);
  }

  if (totalEl) totalEl.textContent = `$${money(total)}`;
  setCustomerSalesHint_(hintText || "依銷貨單客戶統計期間金額，可點查看完整揭露日期、單號、狀態與金額，方便對帳。");
}

function aggregateCustomerSalesAmount_(salesOrders) {
  const map = new Map();
  const list = Array.isArray(salesOrders) ? salesOrders : [];

  const ensureRow = (customerId, customerName) => {
    const cid = String(customerId || "").trim();
    const name = String(customerName || cid || "未指定客戶").trim() || "未指定客戶";
    const key = cid || `name:${name}`;
    if (!map.has(key)) {
      map.set(key, {
        customer_id: cid,
        customer_name: name,
        order_count: 0,
        amount: 0,
        detail_rows: []
      });
    }
    return map.get(key);
  };

  list.forEach(order => {
    const row = ensureRow(getOrderCustomerIdForReport_(order), getOrderCustomerNameForReport_(order));
    row.order_count += 1;
    row.amount += getOrderTotal(order);
    row.detail_rows.push({
      date: getOrderDocDateForReport_(order),
      order_id: getOrderDocIdForReport_(order) || "（未編號）",
      status: getOrderStatusForReport_(order),
      phone: String(order?.phone || "").trim(),
      address: String(order?.address || "").trim(),
      amount: getOrderTotal(order)
    });
  });

  return Array.from(map.values()).map(row => {
    row.detail_rows = (row.detail_rows || []).sort((a, b) => {
      const da = String(a?.date || "");
      const db = String(b?.date || "");
      if (da !== db) return db.localeCompare(da, "zh-Hant");
      return String(b?.order_id || "").localeCompare(String(a?.order_id || ""), "zh-Hant");
    });
    return row;
  }).sort((a, b) => {
    const diff = safeNum(b?.amount, 0) - safeNum(a?.amount, 0);
    if (diff !== 0) return diff;
    return String(a?.customer_name || "").localeCompare(String(b?.customer_name || ""), "zh-Hant");
  });
}

function wireCustomerSalesDetailModal_() {
  const modal = document.getElementById("customerSalesDetailModal");
  const closeIds = ["customerSalesDetailModalClose", "customerSalesDetailCloseBtn"];
  if (!modal || modal.dataset.wired === "1") return;
  modal.dataset.wired = "1";

  closeIds.forEach(id => {
    document.getElementById(id)?.addEventListener("click", closeCustomerSalesAmountDetail_);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeCustomerSalesAmountDetail_();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeCustomerSalesAmountDetail_();
  });
}

function closeCustomerSalesAmountDetail_() {
  const modal = document.getElementById("customerSalesDetailModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function openCustomerSalesAmountDetail_(index) {
  wireCustomerSalesDetailModal_();
  const modal = document.getElementById("customerSalesDetailModal");
  const titleEl = document.getElementById("customerSalesDetailTitle");
  const bodyEl = document.getElementById("customerSalesDetailBody");
  if (!modal || !titleEl || !bodyEl) return;

  const rows = Array.isArray(reportCustomerSalesDetailRows_) ? reportCustomerSalesDetailRows_ : [];
  const row = rows[Number(index)];
  if (!row) return;

  const docs = Array.isArray(row.detail_rows) ? row.detail_rows : [];
  const total = docs.reduce((sum, it) => sum + safeNum(it?.amount, 0), 0);
  titleEl.textContent = `${row?.customer_name || row?.customer_id || "未指定客戶"}｜期間銷貨明細`;

  const rowsHtml = docs.length
    ? docs.map(it => `
        <tr>
          <td>${escapeHtml_(it?.date || "—")}</td>
          <td>${escapeHtml_(it?.order_id || "—")}</td>
          <td>${escapeHtml_(it?.status || "—")}</td>
          <td>${escapeHtml_(it?.phone || "—")}</td>
          <td title="${escapeHtml_(it?.address || "")}">${escapeHtml_(it?.address || "—")}</td>
          <td>$${money(safeNum(it?.amount, 0))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6" style="text-align:center;opacity:.7;">（此期間沒有銷貨單資料）</td></tr>`;

  bodyEl.innerHTML = `
    <div class="hint" style="margin-bottom:10px;">完整揭露此客戶在所選期間內的銷貨單日期、單號、狀態與金額，方便對帳。</div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>單據日期</th>
          <th>單號</th>
          <th>狀態</th>
          <th>電話</th>
          <th>地址</th>
          <th>金額</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <th colspan="5" style="text-align:right;">合計</th>
          <th>$${money(total)}</th>
        </tr>
      </tfoot>
    </table>
  `;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function categoryOfProduct_(p) {
  return String(p?.category ?? "未分類").trim() || "未分類";
}

function getCategoriesFromProducts_(products) {
  const set = new Set();
  (products || []).forEach(p => set.add(categoryOfProduct_(p)));
  return Array.from(set).sort((a,b) => a.localeCompare(b, "zh-Hant"));
}

function getSelectedReportCategories_() {
  const box = document.getElementById("rep-cat-list");
  if (!box) return null; // 沒有 UI：視為不篩選
  const checks = Array.from(box.querySelectorAll('input[type="checkbox"][data-cat]'));
  const selected = checks.filter(x => x.checked).map(x => String(x.dataset.cat || ""));
  return selected;
}

function setAllReportCategories_(checked) {
  const box = document.getElementById("rep-cat-list");
  if (!box) return;
  const checks = Array.from(box.querySelectorAll('input[type="checkbox"][data-cat]'));
  checks.forEach(x => { x.checked = !!checked; });
  updateReportCatSummary_();
}

function updateReportCatSummary_() {
  const box = document.getElementById("rep-cat-list");
  const summary = document.getElementById("rep-cat-summary");
  if (!box || !summary) return;

  const all = Array.from(box.querySelectorAll('input[type="checkbox"][data-cat]'));
  const sel = all.filter(x => x.checked);
  if (!all.length) {
    summary.textContent = "（尚未載入商品分類）";
    return;
  }
  summary.textContent = `（已選 ${sel.length} / ${all.length}）`;
}

function ensureReportCategoryUI_(products) {
  const box = document.getElementById("rep-cat-list");
  if (!box) return;

  const cats = getCategoriesFromProducts_(products);
  const prevSel = new Set((getSelectedReportCategories_() || []));
  const hadPrev = prevSel.size > 0;

  box.innerHTML = "";
  cats.forEach(cat => {
    const id = `rep-cat-${cat.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}`;
    const label = document.createElement("label");
    label.className = "report-cat-item";
    label.innerHTML = `
      <input type="checkbox" id="${id}" data-cat="${cat}">
      <span>${cat}</span>
    `;
    const input = label.querySelector("input");
    // 預設全選；若之前有選過，就保留選擇狀態
    input.checked = hadPrev ? prevSel.has(cat) : true;
    box.appendChild(label);
  });

  updateReportCatSummary_();

  // 一次性綁定事件
  if (!reportCatUIWired_) {
    reportCatUIWired_ = true;

    document.getElementById("rep-cat-all")?.addEventListener("click", () => {
      setAllReportCategories_(true);
      try { runReport(); } catch(e) {}
    });

    document.getElementById("rep-cat-none")?.addEventListener("click", () => {
      setAllReportCategories_(false);
      updateReportCatSummary_();
      // 不自動跑報表，避免誤以為全不選=全選；使用者需自行勾選後再產生
    });

    box.addEventListener("change", () => {
      updateReportCatSummary_();
    });
  }
}

function filterProductsBySelectedCats_(products, selectedCats) {
  if (!selectedCats) return (products || []);
  const set = new Set(selectedCats);
  return (products || []).filter(p => set.has(categoryOfProduct_(p)));
}

function runReport() {
  const from = document.getElementById("report-from")?.value || todayISO();
  const to = document.getElementById("report-to")?.value || todayISO();

  const compute = () => {
    const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
    const pos = (Array.isArray(purchases) && purchases.length) ? purchases : LS.get("purchases", []);
    const products = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", adminProducts);

    const inRange = (d) => {
      const dd = toISODateStr(d);
      return dd && dd >= from && dd <= to;
    };

    const salesOrders = (orders || []).filter(o => inRange(o.date ?? o.created_at ?? o.createdAt));
    const purchaseOrders = (pos || []).filter(p => inRange(p.date ?? p.created_at ?? p.createdAt));

    const sales = salesOrders.reduce((sum, o) => sum + getOrderTotal(o), 0);
    const purchase = purchaseOrders.reduce((sum, p) => sum + getPurchaseTotal(p), 0);

    // 毛利估算：以產品主檔 cost（成本）估算 COGS（若 items 有 cost 會優先使用）
    const costMap = getProductCostMap(products);
    let cogs = 0;
    salesOrders.forEach(o => {
      let items = o.items;
      if (typeof items === "string" && items.trim()) {
        try { items = JSON.parse(items); } catch(e){ items = []; }
      }
      if (!Array.isArray(items)) items = [];
      items.forEach(it => {
        const pid = String(it.product_id ?? it.ProductID ?? it.productId ?? it.id ?? "").trim();
        const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity, 0);
        const unitCost = safeNum(it.cost, NaN);
        const c = !isNaN(unitCost) ? unitCost : (costMap[pid] ?? 0);
        cogs += qty * c;
      });
    });

    const profit = sales - cogs;

    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    set("rep-sales", `$${money(sales)}`);
    set("rep-purchase", `$${money(purchase)}`);
    set("rep-profit", `$${money(profit)}`);

    // ✅ 分類篩選（影響庫存/存貨總表/CSV/列印）
    try { ensureReportCategoryUI_(products); } catch(e) {}
    const selectedCats = getSelectedReportCategories_();
    if (Array.isArray(selectedCats) && selectedCats.length === 0) {
      alert("請至少勾選一個分類再產生報表");
      return;
    }
    const productsForReport = filterProductsBySelectedCats_(products, selectedCats);

    // ✅ 庫存依分類（不是總庫存）
    const catMap = {};
    (productsForReport || []).forEach(p => {
      const cat = String(p.category || "未分類").trim() || "未分類";
      const stock = safeNum(p.stock, 0);
      const cost = safeNum(p.cost || p.purchase_price || 0, 0);
      const price = safeNum(p.price || 0, 0);
      if (!catMap[cat]) catMap[cat] = { cat, sku: 0, qty: 0, costValue: 0, saleValue: 0 };
      catMap[cat].sku += 1;
      catMap[cat].qty += stock;
      catMap[cat].costValue += stock * cost;
      catMap[cat].saleValue += stock * price;
    });
    const cats = Object.values(catMap).sort((a,b) => b.saleValue - a.saleValue);
    set("rep-cat-count", `${cats.length}`);

    const tbody = document.querySelector("#rep-stock-bycat-table tbody");
    if (tbody) {
      tbody.innerHTML = "";
      cats.forEach(x => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${x.cat}</td>
          <td>${x.sku}</td>
          <td>${money(x.qty)}</td>
          <td>$${money(x.costValue)}</td>
          <td>$${money(x.saleValue)}</td>
        `;
        tbody.appendChild(tr);
      });
      if (!cats.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="5" style="text-align:center;opacity:.7;">（沒有商品資料）</td>`;
        tbody.appendChild(tr);
      }
    }

    // ✅ 供應商期間金額（以進貨明細供應商彙總）
    try { renderSupplierPurchaseAmountReport_(purchaseOrders); } catch(e) {}

    // ✅ 客戶期間銷貨金額（依客戶彙總）
    try { renderCustomerSalesAmountTable_(aggregateCustomerSalesAmount_(salesOrders)); } catch(e) {}

    // ✅ 存貨總表（明細）
    try { renderInventoryDetail_(productsForReport); } catch(e) {}
  };

  const haveOrders = (Array.isArray(ordersState) && ordersState.length) || (LS.get("orders", []).length);
  const havePurchases = (Array.isArray(purchases) && purchases.length) || (LS.get("purchases", []).length);
  const haveProducts = (Array.isArray(adminProducts) && adminProducts.length) || (LS.get("products", []).length);

  if (!haveOrders) {
    gas({ type: "orders" }, r => {
      const list = normalizeList(r);
      ordersState = list;
      if (list.length) LS.set("orders", list);

      if (!havePurchases) {
        gas({ type: "purchases" }, r2 => {
          const list2 = normalizeList(r2);
          purchases = list2;
          if (list2.length) LS.set("purchases", list2);

          if (!haveProducts) {
            gas({ type: "products" }, r3 => {
              const list3 = normalizeList(r3);
              adminProducts = list3;
              if (list3.length) LS.set("products", list3);
              compute();
            });
          } else {
            compute();
          }
        });
      } else if (!haveProducts) {
        gas({ type: "products" }, r3 => {
          const list3 = normalizeList(r3);
          adminProducts = list3;
          if (list3.length) LS.set("products", list3);
          compute();
        });
      } else {
        compute();
      }
    });
    return;
  }

  if (!havePurchases) {
    gas({ type: "purchases" }, r2 => {
      const list2 = normalizeList(r2);
      purchases = list2;
      if (list2.length) LS.set("purchases", list2);

      if (!haveProducts) {
        gas({ type: "products" }, r3 => {
          const list3 = normalizeList(r3);
          adminProducts = list3;
          if (list3.length) LS.set("products", list3);
          compute();
        });
      } else {
        compute();
      }
    });
    return;
  }

  if (!haveProducts) {
    gas({ type: "products" }, r3 => {
      const list3 = normalizeList(r3);
      adminProducts = list3;
      if (list3.length) LS.set("products", list3);
      compute();
    });
    return;
  }

  compute();
}


// ================== 存貨總表（庫存明細 / CSV 匯出 / 列印）==================

let lastInventoryProductsForReport_ = [];

function normalizeProductForInventory_(p) {
  const id = String(p?.id ?? "").trim();
  const sku = String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "").trim();
  const name = String(p?.name ?? "").trim();
  const category = String(p?.category ?? "未分類").trim() || "未分類";
  const unit = String(p?.unit ?? "").trim();

  const stock = safeNum(p?.stock, 0);
  const safety = safeNum(p?.safety_stock ?? p?.safetyStock, 0);

  // 成本/售價（避免誤把庫存帶進售價）
  const cost = safeNum(p?.cost ?? p?.purchase_price ?? 0, 0);
  let price = safeNum(p?.price ?? 0, 0);
  if (price === stock && cost > 0 && cost !== stock) price = cost;

  const costValue = stock * cost;
  const saleValue = stock * price;

  return { id, sku, name, category, unit, stock, safety, cost, price, costValue, saleValue };
}

function renderInventoryDetail_(products) {
  const table = document.getElementById("rep-inventory-table");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;

  const list = Array.isArray(products) ? products : [];
  const rows = list.map(normalizeProductForInventory_)
    .sort((a,b) => (a.category.localeCompare(b.category, "zh-Hant")) || (a.name.localeCompare(b.name, "zh-Hant")));

  lastInventoryProductsForReport_ = rows;

  tbody.innerHTML = "";
  let totalCost = 0;
  let totalSale = 0;

  rows.forEach(r => {
    totalCost += r.costValue;
    totalSale += r.saleValue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.sku || r.id}</td>
      <td>${r.name}</td>
      <td>${r.category}</td>
      <td>${r.unit || ""}</td>
      <td>${money(r.stock)}</td>
      <td>${money(r.safety)}</td>
      <td>$${money(r.cost)}</td>
      <td>$${money(r.price)}</td>
      <td>$${money(r.costValue)}</td>
      <td>$${money(r.saleValue)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="10" style="text-align:center;opacity:.7;">（沒有商品資料）</td>`;
    tbody.appendChild(tr);
  }

  const tc = document.getElementById("rep-inv-total-cost");
  const ts = document.getElementById("rep-inv-total-sale");
  if (tc) tc.textContent = `$${money(totalCost)}`;
  if (ts) ts.textContent = `$${money(totalSale)}`;
}

function csvEscape_(v) {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildInventoryCSV_(rows) {
  const headers = [
    "id", "sku", "name", "category", "unit",
    "stock", "safety_stock", "cost", "price",
    "stock_cost_value", "stock_sale_value"
  ];

  let totalCost = 0;
  let totalSale = 0;

  const lines = [headers.join(",")];
  (rows || []).forEach(r0 => {
    const r = (r0 && r0.id !== undefined) ? r0 : normalizeProductForInventory_(r0);
    totalCost += Number(r.costValue || 0);
    totalSale += Number(r.saleValue || 0);
    lines.push([
      r.id,
      r.sku,
      r.name,
      r.category,
      r.unit,
      r.stock,
      r.safety,
      r.cost,
      r.price,
      r.costValue,
      r.saleValue
    ].map(csvEscape_).join(","));
  });

  // 合計列（讓 Excel 好看）
  lines.push([
    "", "", "合計", "", "",
    "", "", "", "",
    totalCost, totalSale
  ].map(csvEscape_).join(","));

  // BOM：避免 Excel 亂碼
  return "\ufeff" + lines.join("\r\n");
}

function downloadTextFile_(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function ensureInventoryRows_(cb) {
  // 取最新 products（不強制重繪商品主檔）
  loadAdminProducts(true, null, { skipProductRender: true, skipCategoryRender: true })
    .then(() => {
      const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
      const sel = getSelectedReportCategories_();
      if (Array.isArray(sel) && sel.length === 0) {
        alert("請至少勾選一個分類再匯出/列印");
        return;
      }
      const allRows = (list || []).map(normalizeProductForInventory_);
      const set = sel ? new Set(sel) : null;
      const rows = set ? allRows.filter(r => set.has(r.category)) : allRows;
      cb(rows);
    })
    .catch(() => {
      const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
      const sel = getSelectedReportCategories_();
      if (Array.isArray(sel) && sel.length === 0) {
        alert("請至少勾選一個分類再匯出/列印");
        return;
      }
      const allRows = (list || []).map(normalizeProductForInventory_);
      const set = sel ? new Set(sel) : null;
      const rows = set ? allRows.filter(r => set.has(r.category)) : allRows;
      cb(rows);
    });
}

function exportInventoryCSV() {
  ensureInventoryRows_(rows => {
    const d = todayISO().replace(/-/g, "");
    const csv = buildInventoryCSV_(rows);
    downloadTextFile_(`存貨總表_${d}.csv`, csv, "text/csv;charset=utf-8");
  });
}

function printInventoryReport() {
  ensureInventoryRows_(rows => {
    // 排序：分類 → 品名
    rows.sort((a,b) => (a.category.localeCompare(b.category, "zh-Hant")) || (a.name.localeCompare(b.name, "zh-Hant")));

    const d = todayISO();
    let totalCost = 0;
    let totalSale = 0;

    const bodyRows = rows.map(r => {
      totalCost += r.costValue;
      totalSale += r.saleValue;
      return `
        <tr>
          <td>${r.sku || r.id}</td>
          <td>${r.name}</td>
          <td>${r.category}</td>
          <td>${r.unit || ""}</td>
          <td style="text-align:right;">${money(r.stock)}</td>
          <td style="text-align:right;">${money(r.safety)}</td>
          <td style="text-align:right;">$${money(r.cost)}</td>
          <td style="text-align:right;">$${money(r.price)}</td>
          <td style="text-align:right;">$${money(r.costValue)}</td>
          <td style="text-align:right;">$${money(r.saleValue)}</td>
        </tr>
      `;
    }).join("");

    const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>存貨總表 ${d}</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",Arial,sans-serif; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .meta { color:#666; font-size: 12px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; }
    th { background: #f6f6f6; }
    tfoot th { background:#fafafa; }
    @media print {
      body { padding: 0; }
      .no-print { display:none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:10px;">
    <button onclick="window.print()">🖨️ 列印</button>
  </div>
  <h1>存貨總表（庫存明細）</h1>
  <div class="meta">日期：${d}　｜　成本合計：$${money(totalCost)}　｜　售價合計：$${money(totalSale)}</div>

  <table>
    <thead>
      <tr>
        <th>料號</th>
        <th>品名</th>
        <th>分類</th>
        <th>單位</th>
        <th>庫存</th>
        <th>安全庫存</th>
        <th>成本</th>
        <th>售價</th>
        <th>庫存成本</th>
        <th>庫存售價</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || `<tr><td colspan="10" style="text-align:center;opacity:.7;">（沒有商品資料）</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <th colspan="8" style="text-align:right;">合計</th>
        <th style="text-align:right;">$${money(totalCost)}</th>
        <th style="text-align:right;">$${money(totalSale)}</th>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return alert("瀏覽器阻擋開新視窗，請允許彈出視窗後再列印");
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
  });
}


// ------------------ 初始化 ------------------




function viewProductImage(productId){
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const p = (list || []).find(x => String(x.id) === String(productId));
  if (!p) return alert("找不到商品資料");
  const url = String(p.image || "").trim();
  if (!url) return alert("此商品未設定圖片（Products.image 為空）");
  openImageModal(url, p.name || "");
}

function openImageModal(url, title){
  const modal = document.getElementById("imgModal");
  const img = document.getElementById("imgModalImg");
  const ttl = document.getElementById("imgModalTitle");
  if (!modal || !img) return;

  ttl && (ttl.textContent = title ? `商品：${title}` : "商品圖片");
  img.src = url;
  img.alt = title ? `商品圖片：${title}` : "商品圖片";

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");

  // 若圖片載入失敗給提示
  img.onerror = () => {
    img.onerror = null;
    img.src = "";
    closeImageModal();
    alert("圖片載入失敗，請確認 Products.image 是可公開存取的圖片網址");
  };
}

function closeImageModal(){
  const modal = document.getElementById("imgModal");
  const img = document.getElementById("imgModalImg");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
  if (img) {
    img.onerror = null;
    img.src = "";
    img.alt = "";
  }
}



let historyProductId = "";
let historyProductSku = "";
let historyProductName = "";
let historyProductStockNow = 0;
let historyProductReferencePrice = NaN;
let historyMarketRowsCache_ = [];
let historyRenderedRowsCache_ = [];

/** 產品歷史：以 stock_ledger 為資料源，並嘗試優先走 productLedger API（若後端尚未更新則回退 stockLedger）。 */
function viewProductHistory(productId){
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const p = (list || []).find(x => String(x.id) === String(productId));
  historyProductId = String(productId);
  historyProductSku = String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "");
  historyProductName = p?.name ? String(p.name) : "";
  historyProductStockNow = safeNum(p?.stock ?? p?.qty ?? p?.quantity ?? p?.["庫存"] ?? 0, 0);
  historyProductReferencePrice = parsePriceNumber_(p?.reference_price ?? p?.ref_price ?? "");
  openHistoryModal(historyProductName || "商品");
  loadHistoryForCurrentProduct();
}

function ensurePoModalWired_(){
  const m = document.getElementById("poModal");
  const closeBtn = document.getElementById("poModalClose");
  if (!m || !closeBtn) return;
  if (m.dataset.wired === "1") return;

  closeBtn.addEventListener("click", closePoModal);
  m.addEventListener("click", (e) => {
    // 點背景關閉
    if (e.target === m) closePoModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && m.classList.contains("show")) closePoModal();
  });

  m.dataset.wired = "1";
}

function openPoModal(title, bodyHtml){
  const m = document.getElementById("poModal");
  const t = document.getElementById("poModalTitle");
  const b = document.getElementById("poModalBody");
  if (!m || !t || !b) return alert(bodyHtml?.replace(/<[^>]+>/g,"") || title || "");
  ensurePoModalWired_();
  t.textContent = title || "進貨單";
  b.innerHTML = bodyHtml || "";
  m.classList.add("show");
  m.setAttribute("aria-hidden","false");
}
function closePoModal(){
  const m = document.getElementById("poModal");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden","true");
}


function openHistoryModal(title){
  const modal = document.getElementById("historyModal");
  const ttl = document.getElementById("historyModalTitle");
  if (!modal) return;
  ttl && (ttl.textContent = `商品歷史庫存：${title}`);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("no-scroll");
}

function closeHistoryModal(){
  const modal = document.getElementById("historyModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("no-scroll");
}

function parseMaybeDateTime_(s){
  if (!s) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  // "yyyy-MM-dd HH:mm:ss" -> make it ISO-ish
  const isoLike = str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str;
  const t = Date.parse(isoLike);
  return isNaN(t) ? 0 : t;
}

function historyTypeLabel_(x){
  const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
  if (code === "IN") return "進貨";
  if (code === "OUT") return "出貨";
  if (code === "ADJ") return "調整";
  const r = String(x.reason || "").toLowerCase();
  if (r.includes("purchase")) return "進貨";
  if (r.includes("sale")) return "出貨";
    if (r.includes("pickup")) return "領貨";
  if (String(x.ref_id || x.ref || "") === "ADJ") return "調整";
  return x.type_label || code || "—";
}

function historyDocNo_(x){
  return x.doc_no ?? x.ref ?? x.ref_id ?? "";
}

function historyCostText_(x){
  if (!x) return "";
  const v = x.cost ?? x.unit_cost ?? x.unitCost ?? x.item_cost ?? x.itemCost ?? "";
  const n = Number(v);
  if (!isFinite(n) || v === "" || v === null || v === undefined) return "";
  return (typeof roundedPriceText_ === "function") ? roundedPriceText_(n, "") : String(Math.round(n));
}

function historyQtyText_(x){
  const qty = (x.qty !== undefined) ? x.qty : (x.change !== undefined ? x.change : 0);
  const n = safeNum(qty, 0);
  return (n > 0 ? `+${money(n)}` : `${money(n)}`);
}

function normalizeHistoryMarketRows_(rows){
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  const seen = new Set();
  list.forEach(row => {
    const marketDate = dateOnly(row?.market_date || row?.reference_price_date || "");
    const price = parsePriceNumber_(row?.reference_price ?? row?.upper_price ?? row?.middle_price ?? row?.lower_price ?? "");
    if (!marketDate || !Number.isFinite(price) || price <= 0) return;
    if (seen.has(marketDate)) return;
    seen.add(marketDate);
    out.push({
      marketDate,
      price,
      marketLabel: String(row?.market_label || row?.market || "").trim(),
      rawName: String(row?.raw_name || row?.reference_price_name || "").trim(),
      rawSpec: String(row?.raw_spec || "").trim(),
      syncTime: String(row?.sync_time || "").trim()
    });
  });
  out.sort((a, b) => String(b.marketDate || "").localeCompare(String(a.marketDate || ""), "zh-Hant"));
  return out;
}

function pickHistoryMarketHit_(ledgerDate){
  const targetDate = dateOnly(ledgerDate || "");
  const list = Array.isArray(historyMarketRowsCache_) ? historyMarketRowsCache_ : [];
  if (!list.length) return null;
  if (!targetDate) return list[0] || null;
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    if (String(row.marketDate || "") <= targetDate) return row;
  }
  return null;
}

function historyMarketTitle_(ledgerDate, marketHit){
  if (!marketHit || !marketHit.marketDate) return "";
  const targetDate = dateOnly(ledgerDate || "");
  const sameDay = targetDate && targetDate === marketHit.marketDate;
  return sameDay ? `市場日期：${marketHit.marketDate}` : `市場日期：${marketHit.marketDate}（休市沿用最近一次更新價格）`;
}

function loadHistoryForCurrentProduct(){
  const pid = historyProductId;
  const sku = (historyProductSku || "").trim();
  if (!pid && !sku) return;

  const from = document.getElementById("histFrom")?.value || "";
  const to = document.getElementById("histTo")?.value || "";

  const tbody = document.getElementById("histTbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10">載入中…</td></tr>`;
  }

  historyMarketRowsCache_ = [];

  const loadLedgerData_ = () => {
    // 1) 優先呼叫新 API：productLedger（若後端未更新，會回傳 error）
    gas({ type: "productLedger", sku, product_id: pid, limit: 1000 }, res => {
      if (res?.status === "ok" && Array.isArray(res.data)) {
        renderHistoryRows(res.data, from, to);
        return;
      }
      // 2) 回退：抓全量 stockLedger 後在前端過濾
      gas({ type: "stockLedger" }, res2 => {
        const all = normalizeList(res2);
        const filtered = (all || []).filter(x => {
          const xs = String(x.sku || x.product_sku || x.item_sku || "").trim();
          if (sku && xs && xs === sku) return true;
          // fallback for old records
          return String(x.product_id || x.id || "").trim() === String(pid).trim();
        });
        renderHistoryRows(filtered, from, to);
      });
    });
  };

  gas({ type: "productMarketHistory", sku, product_id: pid, limit: 1000 }, marketRes => {
    if (marketRes?.status === "ok" && Array.isArray(marketRes.data)) {
      historyMarketRowsCache_ = normalizeHistoryMarketRows_(marketRes.data);
    }
    loadLedgerData_();
  }, 30000);
}

function renderHistoryRows(list, from="", to=""){
  const tbody = document.getElementById("histTbody");
  if (!tbody) return;

  const allRows = Array.isArray(list) ? list.slice() : [];

  // 先依時間倒序（全量），用來計算「異動後庫存」
  allRows.sort((a,b) => parseMaybeDateTime_(b.ts || b.time || b.datetime || b.date) - parseMaybeDateTime_(a.ts || a.time || a.datetime || a.date));

  // 以「目前庫存」為起點，往回推每筆的異動後庫存
  let running = safeNum(historyProductStockNow, 0);
  allRows.forEach(x => {
    const delta = safeNum((x.qty !== undefined) ? x.qty : (x.change !== undefined ? x.change : 0), 0);
    x.__after_stock__ = running;
    running = running - delta;
  });

  // 日期篩選（from/to 是 yyyy-MM-dd）
  let rows = allRows;
  if (from) {
    const ft = Date.parse(from + "T00:00:00");
    rows = rows.filter(x => parseMaybeDateTime_(x.ts || x.time || x.datetime || x.date) >= ft);
  }
  if (to) {
    const tt = Date.parse(to + "T23:59:59");
    rows = rows.filter(x => parseMaybeDateTime_(x.ts || x.time || x.datetime || x.date) <= tt);
  }

  if (!rows.length) {
    historyRenderedRowsCache_ = [];
    tbody.innerHTML = `<tr><td colspan="10">查無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  const shownRows = rows.slice(0, 500).map(x => {
    const unitText = String(x.unit ?? x.unit_name ?? x.uom ?? "");
    const afterStock = safeNum(x.__after_stock__, NaN);
    const afterStockText = isNaN(afterStock) ? "—" : money(afterStock);
    const costText = historyCostText_(x);
    const ledgerDate = dateOnly(x.ts ?? x.time ?? x.datetime ?? x.date ?? "");
    const marketHit = pickHistoryMarketHit_(ledgerDate);
    const marketValue = marketHit ? marketHit.price : NaN;
    const marketText = Number.isFinite(marketValue) && marketValue > 0 ? roundedPriceText_(marketValue, "—") : "—";
    const signal = (typeof getCostReferenceSignal_ === "function") ? getCostReferenceSignal_(costText, marketValue) : { valueClass: "", message: "" };
    return {
      date: ledgerDate,
      type: x.type_label ?? historyTypeLabel_(x),
      docNo: historyDocNo_(x),
      qty: historyQtyText_(x),
      stock: afterStockText,
      unit: unitText,
      cost: costText === "" ? "—" : String(costText),
      market: marketText,
      marketDate: marketHit?.marketDate || "",
      marketTitle: historyMarketTitle_(ledgerDate, marketHit),
      operator: userNameOnly(x.operator ?? x.user ?? x.member_id ?? ""),
      target: x.target ?? x.counterparty ?? x.note ?? "",
      signalClass: signal.valueClass || "",
      signalMessage: signal.message || ""
    };
  });

  historyRenderedRowsCache_ = shownRows.slice();
  shownRows.forEach(row => {
    const tr = document.createElement("tr");
    const signalCls = row.signalClass ? ` class="${row.signalClass}"` : "";
    const costTitle = row.signalMessage ? ` title="${escapeAttr_(row.signalMessage)}"` : "";
    const marketTooltip = [row.marketTitle, row.signalMessage].filter(Boolean).join("｜");
    const marketTitleAttr = marketTooltip ? ` title="${escapeAttr_(marketTooltip)}"` : "";
    tr.innerHTML = `
      <td>${row.date}</td>
      <td>${row.type}</td>
      <td>${row.docNo}</td>
      <td>${row.qty}</td>
      <td>${row.stock}</td>
      <td>${row.unit}</td>
      <td${signalCls}${costTitle}>${row.cost}</td>
      <td${signalCls}${marketTitleAttr}>${row.market}</td>
      <td>${row.operator}</td>
      <td>${row.target ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function printCurrentHistoryRows(){
  if (!historyRenderedRowsCache_.length) return alert("目前沒有可列印的歷史資料");

  const title = document.getElementById("historyModalTitle")?.textContent || "商品歷史庫存";
  const from = document.getElementById("histFrom")?.value || "";
  const to = document.getElementById("histTo")?.value || "";
  const periodText = [from ? `起：${from}` : "", to ? `迄：${to}` : ""].filter(Boolean).join("　");
  const bodyRows = historyRenderedRowsCache_.map(row => {
    const cls = row.signalClass ? ` class="${row.signalClass}"` : "";
    return `
      <tr>
        <td>${row.date}</td>
        <td>${row.type}</td>
        <td>${row.docNo}</td>
        <td>${row.qty}</td>
        <td>${row.stock}</td>
        <td>${row.unit}</td>
        <td${cls}>${row.cost}</td>
        <td${cls}>${row.market}</td>
        <td>${row.operator}</td>
        <td>${row.target ?? ""}</td>
      </tr>
    `;
  }).join("");

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",Arial,sans-serif; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .meta { color:#666; font-size: 12px; margin-bottom: 12px; line-height:1.7; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; vertical-align: top; }
    th { background: #f6f6f6; white-space: nowrap; }
    .price-signal-high { color:#c62828; font-weight:800; }
    .price-signal-low { color:#1565c0; font-weight:800; }
    @media print { body { padding: 0; } .no-print { display:none; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:10px;">
    <button onclick="window.print()">🖨️ 列印</button>
  </div>
  <h1>${title}</h1>
  <div class="meta">${periodText ? `${periodText}<br>` : ""}庫存：${num2TextSmart(historyProductStockNow, "0")}　｜　列印筆數：${historyRenderedRowsCache_.length}<br>市價依 MarketPriceHistory 比對當日市場日期；若休市則沿用最近一次更新價格。</div>
  <table>
    <thead>
      <tr>
        <th>日期</th>
        <th>類型</th>
        <th>單號</th>
        <th>數量</th>
        <th>庫存</th>
        <th>單位</th>
        <th>成本</th>
        <th>市價</th>
        <th>操作者</th>
        <th>供應商</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return alert("瀏覽器阻擋開新視窗，請允許彈出視窗後再列印");
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}

function initHistoryModal(){
  const modal = document.getElementById("historyModal");
  const btnClose = document.getElementById("historyModalClose");
  const btnRefresh = document.getElementById("histRefresh");
  const btnPrint = document.getElementById("histPrint");
  if (!modal) return;

  btnClose?.addEventListener("click", closeHistoryModal);
  btnRefresh?.addEventListener("click", loadHistoryForCurrentProduct);
  btnPrint?.addEventListener("click", printCurrentHistoryRows);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeHistoryModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeHistoryModal();
  });
}

function initImageModal(){
  const modal = document.getElementById("imgModal");
  const btnClose = document.getElementById("imgModalClose");
  if (!modal) return;

  btnClose?.addEventListener("click", closeImageModal);

  // 點遮罩關閉（點內容不關）
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeImageModal();
  });

  // ESC 關閉
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeImageModal();
  });
}

function initMobileSidebar(){
  const btn = document.getElementById("sidebarToggleBtn");
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!btn || !sidebar) return;

  const close = () => {
    sidebar.classList.remove("open");
    overlay?.classList.remove("show");
    document.body.classList.remove("no-scroll");
    overlay?.setAttribute("aria-hidden","true");
  };

  const open = () => {
    sidebar.classList.add("open");
    overlay?.classList.add("show");
    document.body.classList.add("no-scroll");
    overlay?.setAttribute("aria-hidden","false");
  };

  btn.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) close();
    else open();
  });

  overlay?.addEventListener("click", close);

  // 點選側邊欄項目後自動收合（只在手機寬度）
  sidebar.querySelectorAll("a[data-target]").forEach(a => {
    a.addEventListener("click", () => {
      if (window.innerWidth <= 900) close();
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireAdmin()) return;

  initHeader();
  initSidebarNav();
  initMobileSidebar();
  initImageModal();
  initHistoryModal();
  if (typeof initDashboardCollapsibles_ === "function") initDashboardCollapsibles_();

  bindProductEvents();
  bindOrderEvents();
  bindSupplierEvents();
  bindCustomerEvents();
  bindMemberEvents();
  bindLedgerEvents();
  bindReportEvents();
  bindSettingEvents();

  // 預設：先用快取快速顯示 KPI，再背景更新資料（避免首次載入很久）
try { refreshDashboard(); } catch(e) {}

// 背景更新資料：先供應商 → 再商品（確保進貨頁供應商帶入商品可比對）
Promise.all([loadSuppliers(), loadAdminProducts()]).then(() => {
  scheduleDashboardRefresh_();
// 商品編輯 Modal：關閉（保留明確關閉按鈕，不再點背景自動關閉）
document.getElementById("productEditModalClose")?.addEventListener("click", closeProductEditModal_);
document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("productEditModal");
  if (e.key === "Escape" && modal?.classList.contains("show")) closeProductEditModal_();
});

// 新增商品 Modal：關閉
document.getElementById("productAddModalClose")?.addEventListener("click", closeProductAddModal_);
document.getElementById("productAddModal")?.addEventListener("click", (e) => {
  if (e.target && e.target.id === "productAddModal") closeProductAddModal_();
});
});

});

// ------------------ 掛到全域（供 onclick 使用） ------------------
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.showItems = showOrderItems;
window.updateOrder = updateOrder;
window.deleteOrder = deleteOrder;
window.editSupplier = editSupplier;
window.deleteSupplier = deleteSupplier;
window.viewPurchase = viewPurchase;
window.deletePurchase = deletePurchase;
window.viewPickup = viewPickup;
window.deletePickup = deletePickup;
window.gotoProductFromDashboard = gotoProductFromDashboard;


// ------------------ 後台銷貨（出庫） ------------------
function bindSaleUIBoot() {
  // 初始化銷貨明細表：至少一列
  const tbody = document.querySelector("#so-items-table tbody");
  if (tbody && !tbody.children.length) addSaleRow();
  const dateEl = document.getElementById("so-date");
  if (dateEl && !dateEl.value) dateEl.value = todayISO();
}

function addSaleRow() {
  const tbody = document.querySelector("#so-items-table tbody");
  if (!tbody) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <div class="combo-wrap">
        <input type="text" class="so-product-combo admin-input combo-input" placeholder="搜尋商品（料號/名稱）" autocomplete="off" />
        <div class="combo-menu"></div>
      </div>
      <input type="hidden" class="so-product-id" value="" />
    </td>
    <td><input type="number" class="so-qty admin-input" value="1" min="0" step="0.01" inputmode="decimal" /></td>
    <td><input type="number" class="so-price admin-input" value="0" min="0" step="0.01" inputmode="decimal" /></td>
    <td class="so-subtotal">0</td>
    <td><button class="so-del">刪除</button></td>
  `;
  tbody.appendChild(tr);

  const inputEl = tr.querySelector(".so-product-combo");
  const menuEl = tr.querySelector(".combo-menu");
  const hiddenId = tr.querySelector(".so-product-id");
  const priceEl = tr.querySelector(".so-price");

  setupCombo_(inputEl, menuEl, (kw) => getProductOptions_(kw, "", true), (picked) => {
    hiddenId.value = String(picked.value || "");
    // 顯示名稱（不塞 ID）
    const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
    inputEl.value = String(p?.name || "");
    // 初次帶出售價
    if (p && priceEl && (!priceEl.value || Number(priceEl.value) === 0)) {
      priceEl.value = safeNum(p.price);
    }
    recalcSaleRow(tr);
  }, {
    minChars: 0,
    maxShow: 40,
    portal: true,
    onInputClear: () => { hiddenId.value = ""; }
  });

  tr.querySelector(".so-qty")?.addEventListener("input", () => recalcSaleRow(tr));
  tr.querySelector(".so-price")?.addEventListener("input", () => recalcSaleRow(tr));
  tr.querySelector(".so-del")?.addEventListener("click", () => {
    tr.remove();
    calcSaleTotal();
  });

  recalcSaleRow(tr);
}

function recalcSaleRow(tr) {
  const qty = Number(tr.querySelector(".so-qty")?.value || 0);
  const price = Number(tr.querySelector(".so-price")?.value || 0);
  const subtotal = Math.max(0, qty) * Math.max(0, price);
  const subEl = tr.querySelector(".so-subtotal");
  if (subEl) subEl.textContent = money(subtotal);
  calcSaleTotal();
}

function collectSaleItems() {
  const rows = Array.from(document.querySelectorAll("#so-items-table tbody tr"));
  const items = [];
  rows.forEach(tr => {
    const pid = tr.querySelector(".so-product-id")?.value || "";
    const p = (adminProducts || []).find(x => String(x.id) === String(pid));
    const qty = Number(tr.querySelector(".so-qty")?.value || 0);
    const price = Number(tr.querySelector(".so-price")?.value || 0);
    if (!pid || !p || !qty || qty <= 0) return;
    items.push({
      product_id: pid,
      product_name: p.name || "",
      qty: qty,
      price: price
    });
  });
  return items;
}

function calcSaleTotal() {
  const items = collectSaleItems();
  const total = items.reduce((s, it) => s + (Number(it.qty) * Number(it.price)), 0);
  const el = document.getElementById("so-total");
  if (el) el.textContent = money(total);
  return total;
}

function submitSale() {
  const date = document.getElementById("so-date")?.value || todayISO();
  const phone = document.getElementById("so-phone")?.value.trim() || "";
  const address = document.getElementById("so-address")?.value.trim() || "";
  const customer = document.getElementById("so-customer-combo")?.value.trim() || "";
  const customer_id = document.getElementById("so-customer-id")?.value.trim() || "";
  const note = document.getElementById("so-note")?.value.trim() || "";

  const items = collectSaleItems();
  if (!items.length) return alert("請至少新增一個品項");

  const total = calcSaleTotal();
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const payload = {
    date,
    name: customer,
    customer_id: customer_id,
    phone,
    address,
    remark: note,
    total,
    items,
    operator
  };

  gas({
    type: "manageSale",
    action: "add",
    sale: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "銷貨失敗（後端寫入未成功）");
      return;
    }

    // 清空明細（保留日期）
    const tbody = document.querySelector("#so-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addSaleRow();
    calcSaleTotal();
    const ci = document.getElementById("so-customer-combo");
    const cid = document.getElementById("so-customer-id");
    if (ci) ci.value = "";
    if (cid) cid.value = "";
    if (document.getElementById("so-phone")) document.getElementById("so-phone").value = "";
    if (document.getElementById("so-address")) document.getElementById("so-address").value = "";
    if (document.getElementById("so-note")) document.getElementById("so-note").value = "";

    // 清快取並刷新
    LS.del("orders");
    LS.del("products");
    LS.del("stockLedger");

    loadAdminProducts(true);
    loadOrders(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || "銷貨單已儲存（待出貨）");
  });
}
