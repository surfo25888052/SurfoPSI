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

function setReportPurchaseAmountText_(text) {
  const el = document.getElementById("rep-purchase");
  if (el) el.textContent = text || "—";
}

function setReportPurchaseAmountFromSupplierRows_(rows) {
  const total = (Array.isArray(rows) ? rows : [])
    .reduce((sum, row) => sum + supplierPurchaseAmountForReport_(row), 0);
  setReportPurchaseAmountText_(`$${money(total)}`);
}

function getPurchaseDocIdForReport_(po) {
  return String(po?.po_id || po?.purchase_id || po?.id || "").trim();
}

function getPurchaseDocDateForReport_(po) {
  return toISODateStr(po?.arrival_date || po?.receive_date || po?.date || po?.created_at || po?.createdAt || "");
}

function isMultiSupplierReportName_(value) {
  return String(value || "").trim() === "多供應商";
}

function isSupplierPurchaseTax988_(supplierId, supplierName) {
  const sid = String(supplierId || "").trim();
  const name = String(supplierName || "").trim();
  return sid === "988" || name === "988";
}

function supplierPurchaseAmountForReport_(row) {
  const amount = safeNum(row?.amount, 0);
  const multiplier = safeNum(row?.tax_multiplier, 0);
  if (multiplier > 1) return amount;
  return isSupplierPurchaseTax988_(row?.supplier_id, row?.supplier_name) ? amount * 1.05 : amount;
}

function applySupplierPurchaseTaxForReport_(row) {
  if (!row || safeNum(row?.tax_multiplier, 0) > 1) return row;
  if (!isSupplierPurchaseTax988_(row?.supplier_id, row?.supplier_name)) return row;
  const amount = safeNum(row?.amount, 0);
  row.amount_before_tax = amount;
  row.tax_multiplier = 1.05;
  row.tax_amount = amount * 0.05;
  row.amount = amount * 1.05;
  return row;
}

function purchaseReportHasDetailItems_(po) {
  return parsePurchaseItemsForReport_(po).length > 0;
}

function purchaseReportNeedsSupplierDetail_(po) {
  return !!getPurchaseDocIdForReport_(po) && !purchaseReportHasDetailItems_(po);
}

function supplierPurchaseItemNameForReport_(item) {
  return String(
    item?.product_name ??
    item?.ProductName ??
    item?.name ??
    item?.product ??
    item?.item_name ??
    ""
  ).trim() || "未命名品項";
}

function supplierPurchaseItemSpecForReport_(item) {
  return String(item?.spec ?? item?.Spec ?? item?.specification ?? "").trim();
}

function supplierPurchaseItemQtyForReport_(item) {
  const raw = String(item?.qty_raw ?? "").trim();
  if (raw) return raw;
  const qty = safeNum(item?.qty ?? item?.quantity ?? item?.Quantity, 0);
  const unit = String(item?.unit ?? item?.Unit ?? "").trim();
  return unit ? `${reportQtyText_(qty)} ${unit}` : reportQtyText_(qty);
}

function supplierPurchaseItemUnitCostForReport_(item) {
  return safeNum(item?.cost ?? item?.price ?? item?.unit_cost ?? item?.cost_price, 0);
}

function supplierPurchaseItemAmountForReport_(item) {
  const subtotal = safeNum(item?.subtotal ?? item?.Subtotal, NaN);
  if (Number.isFinite(subtotal)) return subtotal;
  const qty = safeNum(item?.qty ?? item?.quantity ?? item?.Quantity, 0);
  return qty * supplierPurchaseItemUnitCostForReport_(item);
}

function supplierPurchaseItemNoteForReport_(item) {
  return String(item?.note ?? item?.remark ?? item?.memo ?? "").trim();
}

function supplierPurchaseItemDateForReport_(item) {
  return dateOnly(item?.receive_date || item?.arrival_date || item?.date || "") || "";
}

function renderSupplierPurchaseOrderItemsHtml_(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return `<div class="customer-sales-empty-detail">此單沒有可顯示的品項明細。</div>`;
  }

  const rows = list.map((it, index) => {
    const name = supplierPurchaseItemNameForReport_(it);
    const spec = supplierPurchaseItemSpecForReport_(it);
    const qtyText = supplierPurchaseItemQtyForReport_(it);
    const receiveDate = supplierPurchaseItemDateForReport_(it);
    const receiptWeight = String(it?.receipt_weight ?? it?.received_weight ?? "").trim();
    const unitCost = supplierPurchaseItemUnitCostForReport_(it);
    const amount = supplierPurchaseItemAmountForReport_(it);
    const note = supplierPurchaseItemNoteForReport_(it);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <div class="customer-sales-item-name">${escapeHtml_(name)}</div>
          ${spec ? `<div class="customer-sales-item-sub">${escapeHtml_(spec)}</div>` : ""}
        </td>
        <td>${escapeHtml_(qtyText || "0")}</td>
        <td>${escapeHtml_(receiveDate || "—")}</td>
        <td>${escapeHtml_(receiptWeight || "—")}</td>
        <td>$${money(unitCost)}</td>
        <td>$${money(amount)}</td>
        <td>${escapeHtml_(note || "—")}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="customer-sales-item-panel">
      <table class="customer-sales-lines-table">
        <thead>
          <tr>
            <th>序</th>
            <th>品項</th>
            <th>訂購數量</th>
            <th>收貨日期</th>
            <th>收據重量</th>
            <th>單價</th>
            <th>金額</th>
            <th>備註</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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
    const displayAmount = supplierPurchaseAmountForReport_(row);
    total += displayAmount;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(row?.supplier_name || row?.supplier_id || "未指定供應商")}</td>
      <td>${safeNum(row?.order_count, 0)}</td>
      <td>${safeNum(row?.item_count, 0)}</td>
      <td>$${money(displayAmount)}</td>
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
  setSupplierAmountHint_(hintText || "依進貨單明細供應商統計期間金額；同一單號有多個供應商時，會依各明細供應商拆分金額。可點查看完整揭露期間到貨日期、編號與金額。");
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
        item_count: 0,
        items: []
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
        detail.items.push({
          ...it,
          subtotal: safeNum(resolvedAmount, 0)
        });
      });
      return;
    }

    const supplierId = String(po?.supplier_id || "").trim();
    const rawSupplierName = String(po?.supplier_name || supplierId || "未指定供應商").trim() || "未指定供應商";
    const supplierName = isMultiSupplierReportName_(rawSupplierName) ? "未指定供應商" : rawSupplierName;
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
    applySupplierPurchaseTaxForReport_(row);
    return row;
  }).sort((a, b) => {
    const diff = supplierPurchaseAmountForReport_(b) - supplierPurchaseAmountForReport_(a);
    if (diff !== 0) return diff;
    return String(a?.supplier_name || "").localeCompare(String(b?.supplier_name || ""), "zh-Hant");
  });
}

function fetchDetailedPurchasesForReport_(done) {
  if (Array.isArray(reportSupplierPurchaseCache_)) {
    done(reportSupplierPurchaseCache_, null);
    return;
  }

  gas({ type: "purchases", summary: 1 }, r => {
    if (String(r?.status || "").toLowerCase() !== "ok") {
      done(null, r?.message || "API timeout");
      return;
    }
    const list = normalizeList(r);
    reportSupplierPurchaseCache_ = list.map(po => ({ ...po, items: parsePurchaseItemsForReport_(po) }));
    done(reportSupplierPurchaseCache_, null);
  }, 30000);
}

function mergePurchaseDetailListForReport_(sourceList, detailList) {
  const detailMap = new Map();
  (Array.isArray(detailList) ? detailList : []).forEach(po => {
    const key = getPurchaseDocIdForReport_(po);
    if (key && purchaseReportHasDetailItems_(po)) detailMap.set(key, po);
  });
  return (Array.isArray(sourceList) ? sourceList : []).map(po => detailMap.get(getPurchaseDocIdForReport_(po)) || po);
}

function loadSupplierPurchaseDetailsForReport_(sourceList, done) {
  const source = Array.isArray(sourceList) ? sourceList : [];
  const cachedMerged = mergePurchaseDetailListForReport_(source, reportSupplierPurchaseCache_);
  const targetIds = Array.from(new Set(cachedMerged
    .filter(purchaseReportNeedsSupplierDetail_)
    .map(po => getPurchaseDocIdForReport_(po))
    .filter(Boolean)));

  if (!targetIds.length || typeof fetchPurchaseDetail_ !== "function") {
    done(cachedMerged, targetIds.length ? "缺少採購明細讀取函式" : null);
    return;
  }

  const fetchedDetails = [];
  const errors = [];
  let index = 0;
  let active = 0;
  const limit = 2;

  const finishIfDone = () => {
    if (index < targetIds.length || active > 0) return;
    const merged = mergePurchaseDetailListForReport_(cachedMerged, fetchedDetails);
    done(merged, errors.length ? `${errors.length} 張單據明細讀取失敗` : null);
  };

  const next = () => {
    while (active < limit && index < targetIds.length) {
      const poId = targetIds[index++];
      active += 1;
      fetchPurchaseDetail_(poId, (po, res) => {
        active -= 1;
        if (po && purchaseReportHasDetailItems_(po)) fetchedDetails.push(po);
        else errors.push(res?.message || poId);
        next();
        finishIfDone();
      }, { useCached: false, allowStaleCached: true, timeout: 45000 });
    }
    finishIfDone();
  };

  next();
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

  document.getElementById("supplierAmountDetailBody")?.addEventListener("click", (e) => {
    const editBtn = e.target?.closest?.("[data-supplier-purchase-edit]");
    if (editBtn) {
      const poId = String(editBtn.getAttribute("data-po-id") || "").trim();
      if (!poId) return;
      closeSupplierPurchaseAmountDetail_();
      if (typeof window.editPurchase === "function") {
        window.editPurchase(poId);
      } else {
        alert("目前找不到採購驗收單編輯功能，請回進貨管理編輯。");
      }
      return;
    }

    const btn = e.target?.closest?.("[data-supplier-purchase-toggle]");
    if (!btn) return;

    const bodyEl = document.getElementById("supplierAmountDetailBody");
    const key = String(btn.getAttribute("data-order-key") || "");
    const detailRow = Array.from(bodyEl?.querySelectorAll("[data-supplier-order-detail-row]") || [])
      .find(row => String(row.getAttribute("data-supplier-order-detail-row") || "") === key);
    if (!detailRow) return;

    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    detailRow.hidden = expanded;
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
  const total = supplierPurchaseAmountForReport_(row);
  titleEl.textContent = `${row?.supplier_name || row?.supplier_id || "未指定供應商"}｜期間到貨明細`;

  const rowsHtml = docs.length
    ? docs.map((it, docIndex) => {
      const rowKey = `supplier-purchase-order-${docIndex}`;
      const poId = String(it?.po_id || "—");
      const editButton = poId && poId !== "—" && poId !== "未編號" ? `
              <button
                type="button"
                class="admin-btn"
                style="padding:4px 10px;font-size:12px;line-height:1.2;"
                data-supplier-purchase-edit
                data-po-id="${reportEscapeAttr_(poId)}"
              >編輯</button>` : "";
      return `
        <tr>
          <td>${escapeHtml_(it?.date || "—")}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <button
                type="button"
                class="customer-sales-order-toggle"
                data-supplier-purchase-toggle
                data-order-key="${reportEscapeAttr_(rowKey)}"
                aria-expanded="false"
                aria-label="展開或收合 ${reportEscapeAttr_(poId)} 的品項明細"
              >
                <span>${escapeHtml_(poId)}</span>
                <span class="customer-sales-toggle-icon" aria-hidden="true">▾</span>
              </button>
              ${editButton}
            </div>
          </td>
          <td>${safeNum(it?.item_count, 0)}</td>
          <td>$${money(safeNum(it?.amount, 0))}</td>
        </tr>
        <tr class="customer-sales-order-detail-row" data-supplier-order-detail-row="${reportEscapeAttr_(rowKey)}" hidden>
          <td colspan="4">${renderSupplierPurchaseOrderItemsHtml_(it?.items)}</td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="4" style="text-align:center;opacity:.7;">（此期間沒有單據資料）</td></tr>`;

  bodyEl.innerHTML = `
    <div class="hint" style="margin-bottom:10px;">完整揭露此供應商在所選到貨日期內的到貨日期、編號與金額；點擊單號可展開或收合品項明細，按編輯可開啟採購驗收單並回存。</div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>到貨日期</th>
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

function renderSupplierPurchaseAmountReportFallback_(sourceList, fallbackReason) {
  const list = Array.isArray(sourceList) ? sourceList : [];
  renderSupplierPurchaseAmountTable_([], "供應商期間金額讀取中…");
  setReportPurchaseAmountText_("供應商統計中…");

  fetchDetailedPurchasesForReport_((detailList, fetchErr) => {
    const mergedSource = Array.isArray(detailList) && detailList.length
      ? mergePurchaseDetailListForReport_(list, detailList)
      : list;
    loadSupplierPurchaseDetailsForReport_(mergedSource, (detailedOrders, detailErr) => {
      const rows = aggregateSupplierPurchaseAmount_(detailedOrders);
      const hint = detailErr
        ? `依進貨單明細供應商統計期間金額；部分單據明細讀取失敗（${detailErr}）。`
        : "依進貨單明細供應商統計期間金額；同一單號有多個供應商時，會依各明細供應商拆分金額。";
      const reason = [fallbackReason, fetchErr].filter(Boolean).join(" ");
      renderSupplierPurchaseAmountTable_(rows, reason ? `${hint} ${reason}` : hint);
      setReportPurchaseAmountFromSupplierRows_(rows);
    });
  });
}

function renderSupplierPurchaseAmountReport_(purchaseOrders, from="", to="") {
  const sourceList = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  renderSupplierPurchaseAmountTable_([], "供應商期間金額讀取中…");
  setReportPurchaseAmountText_("供應商統計中…");

  if (typeof gas !== "function") {
    renderSupplierPurchaseAmountReportFallback_(sourceList, "缺少 GAS 呼叫函式，已改用舊版明細讀取。");
    return;
  }

  gas({
    type: "supplierPurchaseAmountReport",
    date_from: from || "",
    date_to: to || "",
    _ts: Date.now()
  }, res => {
    if (res && String(res.status || "").toLowerCase() === "ok" && Array.isArray(res.data)) {
      const rows = res.data;
      const ms = Number(res.elapsed_ms || 0);
      const poCount = Number(res.po_count || 0);
      const missing = Number(res.missing_item_po_count || 0);
      const extra = missing ? `；${missing} 張單缺少 purchaseItems 明細，已用單頭金額補入` : "";
      renderSupplierPurchaseAmountTable_(
        rows,
        `由後端依 purchaseItems 與到貨日期一次彙總供應商期間金額；期間採購驗收單 ${poCount} 張${ms ? `，GAS ${ms}ms` : ""}${extra}。`
      );
      setReportPurchaseAmountFromSupplierRows_(rows);
      return;
    }
    renderSupplierPurchaseAmountReportFallback_(sourceList, `新版供應商報表 API 失敗，已回退舊版讀取。${res?.message || ""}`);
  }, 30000);
}


function setCustomerSalesHint_(text) {
  const el = document.getElementById("rep-customer-sales-hint");
  if (el) el.textContent = text || "";
}

function getOrderDocIdForReport_(order) {
  return String(order?.order_id || order?.id || "").trim();
}

function getOrderDocDateForReport_(order) {
  return toISODateStr(order?.shipping_date || order?.date || order?.created_at || order?.createdAt || "");
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

function parseOrderItemsForReport_(order) {
  let items = order?.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  return Array.isArray(items) ? items : [];
}

function reportEscapeAttr_(v) {
  return (typeof escapeAttr_ === "function") ? escapeAttr_(v) : escapeHtml_(v);
}

function reportQtyText_(v) {
  const n = safeNum(v, 0);
  if (typeof num2TextSmart === "function") return num2TextSmart(n, "0");
  return Number.isInteger(n) ? String(n) : money(n);
}

function getOrderItemLookupKeysForReport_(it) {
  return [
    it?.product_id,
    it?.ProductID,
    it?.productId,
    it?.id,
    it?.sku,
    it?.SKU,
    it?.product_sku,
    it?.item_no,
    it?.part_no,
    it?.code,
    it?.product_code,
    it?.["料號"]
  ].map(v => String(v ?? "").trim()).filter(Boolean);
}

function resolveOrderItemUnitCostForReport_(it, costLookup) {
  const directCost = safeNum(it?.cost ?? it?.unit_cost ?? it?.cost_price, NaN);
  if (Number.isFinite(directCost)) return directCost;

  const lookup = costLookup || {};
  const fallbackCost = getOrderItemLookupKeysForReport_(it)
    .map(key => lookup[key])
    .find(v => v !== undefined);
  return safeNum(fallbackCost, 0);
}

function buildOrderItemDetailsForReport_(order, costLookup) {
  return parseOrderItemsForReport_(order).map((it, index) => {
    const qty = safeNum(it?.qty ?? it?.Quantity ?? it?.quantity, 0);
    const price = safeNum(it?.price ?? it?.UnitPrice ?? it?.unit_price, 0);
    const subtotalRaw = safeNum(it?.subtotal ?? it?.Subtotal, NaN);
    const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : qty * price;
    const unitCost = resolveOrderItemUnitCostForReport_(it, costLookup);
    const keys = getOrderItemLookupKeysForReport_(it);
    const name = String(
      it?.product_name ??
      it?.ProductName ??
      it?.name ??
      it?.product ??
      it?.item_name ??
      ""
    ).trim();

    return {
      seq: index + 1,
      product_name: name || keys[0] || "未命名品項",
      sku: String(it?.sku ?? it?.SKU ?? it?.product_sku ?? it?.item_no ?? it?.part_no ?? "").trim(),
      spec: String(it?.spec ?? it?.Spec ?? it?.specification ?? "").trim(),
      qty,
      unit: String(it?.unit ?? it?.Unit ?? "").trim(),
      price,
      subtotal,
      unit_cost: unitCost,
      cost: qty * unitCost,
      note: String(it?.note ?? it?.remark ?? it?.memo ?? "").trim()
    };
  });
}

function renderCustomerSalesOrderItemsHtml_(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return `<div class="customer-sales-empty-detail">此單沒有品項明細。</div>`;
  }

  const rows = list.map(it => {
    const nameText = [it?.product_name, it?.sku ? `(${it.sku})` : ""].filter(Boolean).join(" ");
    return `
      <tr>
        <td>${escapeHtml_(it?.seq || "")}</td>
        <td>
          <div class="customer-sales-item-name">${escapeHtml_(nameText || "未命名品項")}</div>
          ${it?.spec ? `<div class="customer-sales-item-sub">${escapeHtml_(it.spec)}</div>` : ""}
        </td>
        <td>${escapeHtml_(reportQtyText_(it?.qty))}${it?.unit ? ` ${escapeHtml_(it.unit)}` : ""}</td>
        <td>$${money(safeNum(it?.unit_cost, 0))}</td>
        <td>$${money(safeNum(it?.cost, 0))}</td>
        <td>$${money(safeNum(it?.price, 0))}</td>
        <td>$${money(safeNum(it?.subtotal, 0))}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="customer-sales-item-panel">
      <table class="customer-sales-lines-table">
        <thead>
          <tr>
            <th>序</th>
            <th>品項</th>
            <th>數量</th>
            <th>成本單價</th>
            <th>成本價</th>
            <th>銷售單價</th>
            <th>銷售金額</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function customerSalesSkuForExport_(item) {
  return String(item?.sku || item?.product_id || item?.product_name || "").trim();
}

function customerSalesSheetKeyForSku_(sku) {
  const ch = String(sku || "").trim().charAt(0).toUpperCase();
  return ["A", "B", "C", "D"].includes(ch) ? ch : "D";
}

function compareCustomerSalesExportRows_(a, b) {
  const skuA = String(a?.sku || "");
  const skuB = String(b?.sku || "");
  const skuCmp = skuA.localeCompare(skuB, "zh-Hant", { numeric: true, sensitivity: "base" });
  if (skuCmp !== 0) return skuCmp;
  return String(a?.product_name || "").localeCompare(String(b?.product_name || ""), "zh-Hant", { numeric: true, sensitivity: "base" });
}

function customerSalesIsPendingShipment_(status) {
  const text = String(status || "").trim().toLowerCase();
  return text === "待出貨" || text === "pending" || text === "pending shipment";
}

function customerSalesNoteForExport_(item) {
  return String(item?.note ?? item?.remark ?? item?.memo ?? "").trim();
}

function customerSalesSheetRefName_(sheetName) {
  return `'${String(sheetName || "").replace(/'/g, "''")}'`;
}

function buildCustomerSalesExcelRows_(customerRow) {
  const docs = Array.isArray(customerRow?.detail_rows) ? customerRow.detail_rows : [];
  const rowMap = new Map();
  docs.forEach(doc => {
    if (customerSalesIsPendingShipment_(doc?.status)) return;
    const items = Array.isArray(doc?.items) ? doc.items : [];
    items.forEach(item => {
      const sku = customerSalesSkuForExport_(item);
      const productName = String(item?.product_name || "").trim();
      const unit = String(item?.unit || "").trim();
      const key = [sku, productName, unit].join("\u0001");
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          sku,
          product_name: productName,
          qty: 0,
          unit,
          cost_amount: 0,
          notes: []
        });
      }
      const row = rowMap.get(key);
      row.qty += safeNum(item?.qty, 0);
      const itemCost = safeNum(item?.cost, NaN);
      row.cost_amount += Number.isFinite(itemCost)
        ? itemCost
        : safeNum(item?.qty, 0) * safeNum(item?.unit_cost, 0);
      const note = customerSalesNoteForExport_(item);
      if (note && !row.notes.includes(note)) row.notes.push(note);
    });
  });
  return Array.from(rowMap.values()).map(row => {
    const qty = safeNum(row.qty, 0);
    return {
      ...row,
      average_unit_price: qty ? row.cost_amount / qty : 0,
      note: row.notes.join("；")
    };
  }).sort(compareCustomerSalesExportRows_);
}

function fillCustomerSalesExcelSheet_(sheet, sheetName, customerRow, rows, periodText) {
  const headers = ["料號", "品項", "數量", "單位", "平均單價", "成本金額", "備註"];
  const customerName = String(customerRow?.customer_name || customerRow?.customer_id || "未指定客戶").trim() || "未指定客戶";
  const title = `${customerName}｜客戶期間銷貨品項總表`;

  sheet.cell("A1").value(title);
  sheet.range("A1:G1").merged(true).style({
    bold: true,
    fontSize: 16,
    horizontalAlignment: "center",
    fill: "E8F5E9"
  });
  sheet.cell("A2").value(`期間：${periodText || "未指定"}`);
  sheet.range("A2:G2").merged(true);
  sheet.cell("A3").value(`料號分類：${sheetName}`);
  sheet.range("A3:G3").merged(true);
  sheet.definedName("_xlnm.Print_Titles", `${customerSalesSheetRefName_(sheetName)}!$1:$5`);

  headers.forEach((header, index) => {
    sheet.cell(5, index + 1).value(header).style({
      bold: true,
      fontSize: 16,
      fill: "DDEEDD",
      fontColor: "1B5E20",
      horizontalAlignment: "center",
      border: true
    });
  });

  if (!rows.length) {
    sheet.cell("A6").value("此分類沒有銷貨品項");
    sheet.range("A6:G6").merged(true).style({ italic: true, fontColor: "667085" });
  } else {
    rows.forEach((row, rowIndex) => {
      const r = rowIndex + 6;
      [
        row.sku,
        row.product_name,
        row.qty,
        row.unit,
        row.average_unit_price,
        row.cost_amount,
        row.note || ""
      ].forEach((value, colIndex) => {
        sheet.cell(r, colIndex + 1).value(value);
      });
    });

    const totalRow = rows.length + 6;
    sheet.range(`A${totalRow}:E${totalRow}`).merged(true).style({
      bold: true,
      fill: "E8F5E9",
      horizontalAlignment: "right"
    });
    sheet.cell(totalRow, 1).value("合計");
    sheet.cell(totalRow, 6).formula(`SUM(F6:F${totalRow - 1})`);
    sheet.cell(totalRow, 7).value("");
    sheet.range(`A${totalRow}:G${totalRow}`).style({
      bold: true,
      fontSize: 16,
      fill: "E8F5E9"
    });
  }

  const lastRow = Math.max(6, rows.length + 6);
  sheet.range(`A1:G${lastRow}`).style({ fontSize: 16 });
  for (let rowIndex = 1; rowIndex <= lastRow; rowIndex += 1) {
    sheet.row(rowIndex).height(30);
  }
  [16, 32, 12, 10, 14, 14, 24].forEach((width, index) => {
    sheet.column(index + 1).width(width);
  });
}

function sanitizeCustomerSalesFilenamePart_(text) {
  const cleaned = String(text || "").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
  return (cleaned || "未指定客戶").slice(0, 60);
}

function downloadCustomerSalesBlob_(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCustomerSalesDetailExcel_(index, triggerBtn) {
  const rows = Array.isArray(reportCustomerSalesDetailRows_) ? reportCustomerSalesDetailRows_ : [];
  const customerRow = rows[Number(index)];
  if (!customerRow) return alert("找不到此客戶明細資料，請重新產生報表後再試。");
  if (!window.XlsxPopulate || typeof window.XlsxPopulate.fromBlankAsync !== "function") {
    return alert("Excel 函式庫尚未載入，請確認網路後重新整理頁面再試。");
  }

  const originalText = triggerBtn ? triggerBtn.textContent : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "產生中…";
  }

  try {
    const from = document.getElementById("report-from")?.value || "";
    const to = document.getElementById("report-to")?.value || "";
    const periodText = `${from || "未指定"} 至 ${to || "未指定"}`;
    const exportRows = buildCustomerSalesExcelRows_(customerRow);
    const workbook = await window.XlsxPopulate.fromBlankAsync();
    const sheetKeys = ["A", "B", "C", "D"];

    sheetKeys.forEach((key, sheetIndex) => {
      const sheet = sheetIndex === 0 ? workbook.sheet(0) : workbook.addSheet(`${key}類料號`);
      sheet.name(`${key}類料號`);
      const sheetRows = exportRows
        .filter(row => customerSalesSheetKeyForSku_(row.sku) === key)
        .sort(compareCustomerSalesExportRows_);
      fillCustomerSalesExcelSheet_(sheet, `${key}類料號`, customerRow, sheetRows, periodText);
    });

    const blob = await workbook.outputAsync();
    const customerName = sanitizeCustomerSalesFilenamePart_(customerRow?.customer_name || customerRow?.customer_id || "未指定客戶");
    const fileFrom = String(from || "起始").replace(/-/g, "");
    const fileTo = String(to || "結束").replace(/-/g, "");
    downloadCustomerSalesBlob_(blob, `客戶期間銷貨品項總表_${customerName}_${fileFrom}_${fileTo}.xlsx`);
  } catch (err) {
    console.error("exportCustomerSalesDetailExcel_ failed", err);
    alert("匯出 Excel 總表失敗：" + (err && err.message ? err.message : err || "未知錯誤"));
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText || "匯出 Excel 總表";
    }
  }
}

function reportProductCostLookup_() {
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const byKey = {};
  (Array.isArray(list) ? list : []).forEach(p => {
    const cost = safeNum(p?.cost ?? p?.purchase_price ?? p?.in_price, 0);
    [
      p?.id,
      p?.product_id,
      p?.raw_id,
      p?.sku,
      p?.part_no,
      p?.code,
      p?.["料號"]
    ].forEach(key => {
      const text = String(key ?? "").trim();
      if (text) byKey[text] = cost;
    });
  });
  return byKey;
}

function getOrderCostForReport_(order, costLookup) {
  const lookup = costLookup || reportProductCostLookup_();
  return buildOrderItemDetailsForReport_(order, lookup).reduce((sum, it) => sum + safeNum(it?.cost, 0), 0);
}

function renderCustomerSalesAmountTable_(rows, hintText) {
  const tbody = document.querySelector("#rep-customer-sales-table tbody");
  const totalEl = document.getElementById("rep-customer-sales-total");
  const totalCostEl = document.getElementById("rep-customer-sales-cost-total");
  if (!tbody) return;

  const list = Array.isArray(rows) ? rows.slice() : [];
  let total = 0;
  let totalCost = 0;
  tbody.innerHTML = "";
  reportCustomerSalesDetailRows_ = list;

  list.forEach((row, idx) => {
    total += safeNum(row?.amount, 0);
    totalCost += safeNum(row?.cost, 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(row?.customer_name || "未指定客戶")}</td>
      <td>${escapeHtml_(row?.customer_id || "—")}</td>
      <td>${safeNum(row?.order_count, 0)}</td>
      <td>$${money(safeNum(row?.cost, 0))}</td>
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
    tr.innerHTML = `<td colspan="6" style="text-align:center;opacity:.7;">（此期間沒有客戶銷貨資料）</td>`;
    tbody.appendChild(tr);
  }

  if (totalCostEl) totalCostEl.textContent = `$${money(totalCost)}`;
  if (totalEl) totalEl.textContent = `$${money(total)}`;
  setCustomerSalesHint_(hintText || "依銷貨單客戶統計期間金額，可點查看完整揭露出貨日期、單號、狀態、成本與金額，方便對帳。");
}

function aggregateCustomerSalesAmount_(salesOrders) {
  const map = new Map();
  const list = Array.isArray(salesOrders) ? salesOrders : [];
  const costLookup = reportProductCostLookup_();

  const ensureRow = (customerId, customerName) => {
    const cid = String(customerId || "").trim();
    const name = String(customerName || cid || "未指定客戶").trim() || "未指定客戶";
    const key = cid || `name:${name}`;
    if (!map.has(key)) {
      map.set(key, {
        customer_id: cid,
        customer_name: name,
        order_count: 0,
        cost: 0,
        amount: 0,
        detail_rows: []
      });
    }
    return map.get(key);
  };

  list.forEach(order => {
    const row = ensureRow(getOrderCustomerIdForReport_(order), getOrderCustomerNameForReport_(order));
    const orderItems = buildOrderItemDetailsForReport_(order, costLookup);
    const orderCost = orderItems.reduce((sum, it) => sum + safeNum(it?.cost, 0), 0);
    const orderAmount = getOrderTotal(order);
    row.order_count += 1;
    row.cost += orderCost;
    row.amount += orderAmount;
    row.detail_rows.push({
      date: getOrderDocDateForReport_(order),
      order_id: getOrderDocIdForReport_(order) || "（未編號）",
      status: getOrderStatusForReport_(order),
      phone: String(order?.phone || "").trim(),
      address: String(order?.address || "").trim(),
      cost: orderCost,
      amount: orderAmount,
      items: orderItems
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

  document.getElementById("customerSalesDetailBody")?.addEventListener("click", (e) => {
    const exportBtn = e.target?.closest?.("[data-customer-sales-export]");
    if (exportBtn) {
      exportCustomerSalesDetailExcel_(exportBtn.getAttribute("data-customer-sales-export"), exportBtn);
      return;
    }

    const btn = e.target?.closest?.("[data-customer-sales-toggle]");
    if (!btn) return;

    const bodyEl = document.getElementById("customerSalesDetailBody");
    const key = String(btn.getAttribute("data-order-key") || "");
    const detailRow = Array.from(bodyEl?.querySelectorAll("[data-order-detail-row]") || [])
      .find(row => String(row.getAttribute("data-order-detail-row") || "") === key);
    if (!detailRow) return;

    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    detailRow.hidden = expanded;
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
  const totalCost = docs.reduce((sum, it) => sum + safeNum(it?.cost, 0), 0);
  titleEl.textContent = `${row?.customer_name || row?.customer_id || "未指定客戶"}｜期間銷貨明細`;
  const customerIndex = Number(index);

  const rowsHtml = docs.length
    ? docs.map((it, docIndex) => {
      const rowKey = `customer-sales-order-${docIndex}`;
      const orderId = String(it?.order_id || "—");
      return `
        <tr>
          <td>${escapeHtml_(it?.date || "—")}</td>
          <td>
            <button
              type="button"
              class="customer-sales-order-toggle"
              data-customer-sales-toggle
              data-order-key="${reportEscapeAttr_(rowKey)}"
              aria-expanded="false"
              aria-label="展開或收合 ${reportEscapeAttr_(orderId)} 的品項明細"
            >
              <span>${escapeHtml_(orderId)}</span>
              <span class="customer-sales-toggle-icon" aria-hidden="true">▾</span>
            </button>
          </td>
          <td>${escapeHtml_(it?.status || "—")}</td>
          <td>${escapeHtml_(it?.phone || "—")}</td>
          <td title="${escapeHtml_(it?.address || "")}">${escapeHtml_(it?.address || "—")}</td>
          <td>$${money(safeNum(it?.cost, 0))}</td>
          <td>$${money(safeNum(it?.amount, 0))}</td>
        </tr>
        <tr class="customer-sales-order-detail-row" data-order-detail-row="${reportEscapeAttr_(rowKey)}" hidden>
          <td colspan="7">${renderCustomerSalesOrderItemsHtml_(it?.items)}</td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="7" style="text-align:center;opacity:.7;">（此期間沒有銷貨單資料）</td></tr>`;

  bodyEl.innerHTML = `
    <div class="customer-sales-detail-toolbar">
      <div class="hint">完整揭露此客戶在所選期間內的銷貨單出貨日期、單號、狀態、成本與金額；點擊單號可展開或收合品項明細。</div>
      <button class="admin-btn primary" type="button" data-customer-sales-export="${reportEscapeAttr_(customerIndex)}">匯出 Excel 總表</button>
    </div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>出貨日期</th>
          <th>單號</th>
          <th>狀態</th>
          <th>電話</th>
          <th>地址</th>
          <th>成本</th>
          <th>金額</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <th colspan="5" style="text-align:right;">合計</th>
          <th>$${money(totalCost)}</th>
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
    const pos = Array.isArray(purchases) ? purchases : [];
    const products = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", adminProducts);

    const inRange = (d) => {
      const dd = toISODateStr(d);
      return dd && dd >= from && dd <= to;
    };

    const salesOrders = (orders || []).filter(o => inRange(o.shipping_date || ""));
    const purchaseOrders = (pos || []).filter(p => inRange(getPurchaseDocDateForReport_(p)));

    const sales = salesOrders.reduce((sum, o) => sum + getOrderTotal(o), 0);

    // 毛利估算：以銷貨明細成本優先，缺值時回查商品主檔成本。
    const costLookup = reportProductCostLookup_();
    const cogs = salesOrders.reduce((sum, o) => sum + getOrderCostForReport_(o, costLookup), 0);

    const profit = sales - cogs;

    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    set("rep-sales", `$${money(sales)}`);
    set("rep-purchase", "供應商統計中…");
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
    try { renderSupplierPurchaseAmountReport_(purchaseOrders, from, to); } catch(e) {}

    // ✅ 客戶期間銷貨金額（依客戶彙總）
    try { renderCustomerSalesAmountTable_(aggregateCustomerSalesAmount_(salesOrders)); } catch(e) {}

    // ✅ 存貨總表（明細）
    try { renderInventoryDetail_(productsForReport); } catch(e) {}
  };

  const haveOrders = (Array.isArray(ordersState) && ordersState.length) || (LS.get("orders", []).length);
  const havePurchases = Array.isArray(purchases) && purchases.length;
  const haveProducts = (Array.isArray(adminProducts) && adminProducts.length) || (LS.get("products", []).length);

  if (!haveOrders) {
    gas({ type: "orders" }, r => {
      const list = normalizeList(r);
      ordersState = list;
      if (list.length) LS.set("orders", list);

      if (!havePurchases) {
        gas({ type: "purchases", summary: 1 }, r2 => {
          const list2 = normalizeList(r2);
          purchases = list2;

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
    gas({ type: "purchases", summary: 1 }, r2 => {
      const list2 = normalizeList(r2);
      purchases = list2;

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
  const safety = safeNum(p?.safety_stock ?? p?.safetyStock ?? p?.safety, 0);

  // 成本/售價（避免誤把庫存帶進售價）
  const cost = safeNum(p?.cost ?? p?.purchase_price ?? 0, 0);
  let price = safeNum(p?.price ?? 0, 0);
  if (price === stock && cost > 0 && cost !== stock) price = cost;

  const costValue = stock * cost;
  const saleValue = stock * price;

  return { id, sku, name, category, unit, stock, safety, cost, price, costValue, saleValue };
}

function hasInventoryStock_(row) {
  return safeNum(row?.stock, 0) > 0;
}

function renderInventoryDetail_(products) {
  const table = document.getElementById("rep-inventory-table");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;

  const list = Array.isArray(products) ? products : [];
  const rows = list.map(normalizeProductForInventory_)
    .filter(hasInventoryStock_)
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
    tr.innerHTML = `<td colspan="10" style="text-align:center;opacity:.7;">（沒有庫存大於 0 的商品）</td>`;
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
    "商品ID", "料號", "品名", "分類", "單位",
    "庫存", "安全庫存", "成本單價", "售價",
    "庫存成本金額", "庫存售價金額"
  ];

  let totalCost = 0;
  let totalSale = 0;

  const lines = [headers.join(",")];
  (rows || []).forEach(r0 => {
    const r = normalizeProductForInventory_(r0);
    if (!hasInventoryStock_(r)) return;
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
      const allRows = (list || []).map(normalizeProductForInventory_).filter(hasInventoryStock_);
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
      const allRows = (list || []).map(normalizeProductForInventory_).filter(hasInventoryStock_);
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
let historyLedgerRowsCache_ = [];

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
  const raw = String(x?.doc_no ?? x?.ref ?? x?.ref_id ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^ADJ-+/i, "");
}

function historyTargetText_(x){
  const raw = String(x?.target ?? x?.counterparty ?? x?.note ?? "").trim();
  if (!raw) return "";
  const lowered = raw.toLowerCase();
  if (lowered === 'admin:setstock' || lowered === 'setstock' || lowered === 'manual_adjust' || lowered === 'manual-adjust') return '人工調整';
  return raw;
}

function historyCostText_(x){
  if (!x) return "";
  const v = x.cost ?? x.unit_cost ?? x.unitCost ?? x.item_cost ?? x.itemCost ?? "";
  const n = Number(v);
  if (!isFinite(n) || v === "" || v === null || v === undefined) return "";
  if (typeof roundedPriceText_ === "function") return roundedPriceText_(n, "");
  if (typeof num2TextSmart === "function") return num2TextSmart(n, "");
  if (typeof round2Num === "function") return String(round2Num(n, 0));
  return String(n);
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

function historyCurrentTypeFilter_(){
  const v = String(document.getElementById("histTypeFilter")?.value || "all").trim().toLowerCase();
  return (v === "in" || v === "out") ? v : "all";
}

function historyRowMatchesTypeFilter_(x, filter){
  const f = String(filter || "all").toLowerCase();
  if (f === "all") return true;
  const direction = String(x?.direction || x?.type_code || x?.type || "").trim().toUpperCase();
  const label = String(x?.type_label || historyTypeLabel_(x) || "").trim();
  const reason = String(x?.reason || "").trim().toLowerCase();
  if (f === "in") {
    return direction === "IN" || label === "進貨" || reason.includes("purchase");
  }
  if (f === "out") {
    return direction === "OUT" || label === "出貨" || reason.includes("order") || reason.includes("sale") || reason.includes("pickup");
  }
  return true;
}

function historyTypeFilterText_(filter){
  const f = String(filter || "all").toLowerCase();
  if (f === "in") return "進貨";
  if (f === "out") return "出貨";
  return "全部";
}

function historyIsMobileLayout_(){
  try {
    return window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
  } catch (e) {
    return (window.innerWidth || 9999) <= 760;
  }
}

function historyCellText_(v, fallback="—"){
  const s = String(v === undefined || v === null ? "" : v).trim();
  return s || fallback;
}

function buildHistoryMobileCardHtml_(row){
  const costCls = row.signalClass ? ` ${row.signalClass}` : "";
  const marketCls = row.signalClass ? ` ${row.signalClass}` : "";
  const signalNote = row.signalMessage ? `<div class="hist-card-note">${escapeHtml_(row.signalMessage)}</div>` : "";
  return `
    <article class="hist-card">
      <div class="hist-card-head">
        <span class="hist-card-type">${escapeHtml_(historyCellText_(row.type))}</span>
        <span class="hist-card-date">${escapeHtml_(historyCellText_(row.date))}</span>
      </div>
      <div class="hist-card-main">
        <div class="hist-card-line"><span>單號</span><strong>${escapeHtml_(historyCellText_(row.docNo))}</strong></div>
        <div class="hist-card-line"><span>對象</span><strong>${escapeHtml_(historyCellText_(row.target))}</strong></div>
      </div>
      <div class="hist-card-grid">
        <div><span>數量</span><strong>${escapeHtml_(historyCellText_(row.qty))}</strong></div>
        <div><span>庫存</span><strong>${escapeHtml_(historyCellText_(row.stock))}</strong></div>
        <div><span>單位</span><strong>${escapeHtml_(historyCellText_(row.unit))}</strong></div>
        <div><span>成本</span><strong class="${costCls.trim()}">${escapeHtml_(historyCellText_(row.cost))}</strong></div>
        <div><span>市價</span><strong class="${marketCls.trim()}" title="${escapeAttr_(row.marketTitle || "")}">${escapeHtml_(historyCellText_(row.market))}</strong></div>
        <div><span>操作者</span><strong>${escapeHtml_(historyCellText_(row.operator))}</strong></div>
      </div>
      ${signalNote}
    </article>
  `;
}

function renderHistoryMobileCards_(rows){
  const wrap = document.getElementById("histMobileCards");
  if (!wrap) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    wrap.innerHTML = `<div class="hist-mobile-empty">查無資料</div>`;
    return;
  }
  wrap.innerHTML = list.map(buildHistoryMobileCardHtml_).join("");
}

function rerenderCurrentHistoryRows_(){
  const from = document.getElementById("histFrom")?.value || "";
  const to = document.getElementById("histTo")?.value || "";
  renderHistoryRows(historyLedgerRowsCache_, from, to);
}

function renderHistoryRows(list, from="", to=""){
  const tbody = document.getElementById("histTbody");
  if (!tbody) return;

  const allRows = Array.isArray(list) ? list.slice() : [];
  historyLedgerRowsCache_ = allRows.slice();
  const typeFilter = historyCurrentTypeFilter_();

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
  rows = rows.filter(x => historyRowMatchesTypeFilter_(x, typeFilter));

  if (!rows.length) {
    historyRenderedRowsCache_ = [];
    tbody.innerHTML = `<tr><td colspan="10">查無資料</td></tr>`;
    renderHistoryMobileCards_([]);
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
      target: historyTargetText_(x),
      signalClass: signal.valueClass || "",
      signalMessage: signal.message || ""
    };
  });

  historyRenderedRowsCache_ = shownRows.slice();
  renderHistoryMobileCards_(shownRows);
  shownRows.forEach(row => {
    const tr = document.createElement("tr");
    const signalCls = row.signalClass ? ` class="${row.signalClass}"` : "";
    const costTitle = row.signalMessage ? ` title="${escapeAttr_(row.signalMessage)}"` : "";
    const marketTooltip = [row.marketTitle, row.signalMessage].filter(Boolean).join("｜");
    const marketTitleAttr = marketTooltip ? ` title="${escapeAttr_(marketTooltip)}"` : "";
    tr.innerHTML = `
      <td>${row.docNo}</td>
      <td>${row.date}</td>
      <td>${row.target ?? ""}</td>
      <td>${row.type}</td>
      <td>${row.qty}</td>
      <td>${row.stock}</td>
      <td>${row.unit}</td>
      <td${signalCls}${costTitle}>${row.cost}</td>
      <td${signalCls}${marketTitleAttr}>${row.market}</td>
      <td>${row.operator}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildHistoryPrintTableRows_(rows){
  return (Array.isArray(rows) ? rows : []).map(row => {
    const cls = row.signalClass ? ` class="${row.signalClass}"` : "";
    return `
      <tr>
        <td>${escapeHtml_(historyCellText_(row.docNo))}</td>
        <td>${escapeHtml_(historyCellText_(row.date))}</td>
        <td>${escapeHtml_(historyCellText_(row.target))}</td>
        <td>${escapeHtml_(historyCellText_(row.type))}</td>
        <td>${escapeHtml_(historyCellText_(row.qty))}</td>
        <td>${escapeHtml_(historyCellText_(row.stock))}</td>
        <td>${escapeHtml_(historyCellText_(row.unit))}</td>
        <td${cls}>${escapeHtml_(historyCellText_(row.cost))}</td>
        <td${cls}>${escapeHtml_(historyCellText_(row.market))}</td>
        <td>${escapeHtml_(historyCellText_(row.operator))}</td>
      </tr>
    `;
  }).join("");
}

function buildHistoryPrintCardRows_(rows){
  return (Array.isArray(rows) ? rows : []).map(row => {
    const costCls = row.signalClass ? ` ${row.signalClass}` : "";
    const marketCls = row.signalClass ? ` ${row.signalClass}` : "";
    const signalNote = row.signalMessage ? `<div class="print-card-note">${escapeHtml_(row.signalMessage)}</div>` : "";
    return `
      <article class="print-card">
        <div class="print-card-head">
          <span class="print-type">${escapeHtml_(historyCellText_(row.type))}</span>
          <span class="print-date">${escapeHtml_(historyCellText_(row.date))}</span>
        </div>
        <div class="print-line"><span>單號</span><strong>${escapeHtml_(historyCellText_(row.docNo))}</strong></div>
        <div class="print-line"><span>對象</span><strong>${escapeHtml_(historyCellText_(row.target))}</strong></div>
        <div class="print-grid">
          <div><span>數量</span><strong>${escapeHtml_(historyCellText_(row.qty))}</strong></div>
          <div><span>庫存</span><strong>${escapeHtml_(historyCellText_(row.stock))}</strong></div>
          <div><span>單位</span><strong>${escapeHtml_(historyCellText_(row.unit))}</strong></div>
          <div><span>成本</span><strong class="${costCls.trim()}">${escapeHtml_(historyCellText_(row.cost))}</strong></div>
          <div><span>市價</span><strong class="${marketCls.trim()}">${escapeHtml_(historyCellText_(row.market))}</strong></div>
          <div><span>操作者</span><strong>${escapeHtml_(historyCellText_(row.operator))}</strong></div>
        </div>
        ${signalNote}
      </article>
    `;
  }).join("");
}

function printCurrentHistoryRows(){
  if (!historyRenderedRowsCache_.length) return alert("目前沒有可列印的歷史資料");

  const title = document.getElementById("historyModalTitle")?.textContent || "商品歷史庫存";
  const from = document.getElementById("histFrom")?.value || "";
  const to = document.getElementById("histTo")?.value || "";
  const typeFilterText = historyTypeFilterText_(historyCurrentTypeFilter_());
  const periodText = [from ? `起：${from}` : "", to ? `迄：${to}` : "", `類型：${typeFilterText}`].filter(Boolean).join("　");
  const isMobilePrint = historyIsMobileLayout_();
  const bodyRows = isMobilePrint ? buildHistoryPrintCardRows_(historyRenderedRowsCache_) : buildHistoryPrintTableRows_(historyRenderedRowsCache_);
  const contentHtml = isMobilePrint ? `
    <section class="print-card-list">
      ${bodyRows}
    </section>
  ` : `
    <table>
      <thead>
        <tr>
          <th>單號</th>
          <th>日期</th>
          <th>對象</th>
          <th>類型</th>
          <th>數量</th>
          <th>庫存</th>
          <th>單位</th>
          <th>成本</th>
          <th>市價</th>
          <th>操作者</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
  `;

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml_(title)}</title>
  <style>
    @page { size: ${isMobilePrint ? "A4 portrait" : "A4 landscape"}; margin: ${isMobilePrint ? "9mm" : "8mm"}; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",Arial,sans-serif; padding: 16px; color:#111; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    h1 { font-size: ${isMobilePrint ? "17px" : "18px"}; margin: 0 0 10px; }
    .meta { color:#666; font-size: 12px; margin-bottom: 12px; line-height:1.7; }
    .print-mode-badge { display:inline-flex; align-items:center; border-radius:999px; padding:3px 8px; margin-left:8px; background:#f3f4f6; color:#374151; font-size:11px; font-weight:700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; vertical-align: top; }
    th { background: #f6f6f6; white-space: nowrap; }
    .price-signal-high { color:#c62828; font-weight:800; }
    .price-signal-low { color:#2E7D32; font-weight:800; }
    .print-card-list { display:grid; gap:10px; }
    .print-card { border:1px solid #d8dde5; border-radius:12px; padding:10px 11px; break-inside:avoid; page-break-inside:avoid; }
    .print-card-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
    .print-type { display:inline-flex; align-items:center; justify-content:center; min-width:52px; padding:4px 8px; border-radius:999px; background:#e8f5e9; color:#1b5e20; font-weight:800; font-size:13px; }
    .print-date { color:#475569; font-size:12px; font-weight:700; }
    .print-line { display:grid; grid-template-columns:42px 1fr; gap:8px; margin:5px 0; font-size:13px; }
    .print-line span, .print-grid span { color:#64748b; font-size:11px; font-weight:700; }
    .print-line strong, .print-grid strong { color:#111827; font-size:13px; word-break:break-word; }
    .print-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; margin-top:10px; }
    .print-grid > div { border-radius:10px; background:#f8fafc; padding:7px 8px; min-height:42px; display:flex; flex-direction:column; gap:3px; }
    .print-card-note { margin-top:8px; padding:7px 8px; border-radius:10px; background:#fff7ed; color:#9a3412; font-size:11px; font-weight:700; }
    @media print { body { padding: 0; } .no-print { display:none; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:10px;">
    <button onclick="window.print()">🖨️ 列印</button>
  </div>
  <h1>${escapeHtml_(title)}<span class="print-mode-badge">${isMobilePrint ? "手機卡片列印" : "電腦表格列印"}</span></h1>
  <div class="meta">${periodText ? `${escapeHtml_(periodText)}<br>` : ""}庫存：${escapeHtml_(num2TextSmart(historyProductStockNow, "0"))}　｜　列印筆數：${historyRenderedRowsCache_.length}<br>市價依 MarketPriceHistory 比對當日市場日期；若休市則沿用最近一次更新價格。</div>
  ${contentHtml}
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
  const typeFilter = document.getElementById("histTypeFilter");
  if (!modal) return;

  btnClose?.addEventListener("click", closeHistoryModal);
  btnRefresh?.addEventListener("click", loadHistoryForCurrentProduct);
  btnPrint?.addEventListener("click", printCurrentHistoryRows);
  typeFilter?.addEventListener("change", rerenderCurrentHistoryRows_);

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
window.editSupplier = (typeof startEditSupplier === "function") ? startEditSupplier : window.startEditSupplier;
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
  if (dateEl) {
    try { dateEl.removeAttribute("min"); } catch (_) {}
    try { dateEl.removeAttribute("max"); } catch (_) {}
    dateEl.readOnly = false;
    dateEl.disabled = false;
    if (!dateEl.dataset.manualShipDateBound) {
      dateEl.dataset.manualShipDateBound = "1";
      const rememberDate = () => { window.__adminSaleManualShipDate__ = String(dateEl.value || "").trim(); };
      dateEl.addEventListener("input", rememberDate);
      dateEl.addEventListener("change", rememberDate);
    }
    if (!dateEl.value) {
      dateEl.value = String(window.__adminSaleManualShipDate__ || "").trim() || todayISO();
    }
  }
}

function saleProductSkuText_(p){
  return String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "").trim();
}

function saleProductIdText_(p){
  return String(p?.id ?? p?.product_id ?? p?.raw_id ?? "").trim();
}

function saleProductPrimaryKey_(p){
  return saleProductSkuText_(p) || saleProductIdText_(p);
}

function saleFindProductBySkuOrId_(valueOrItem){
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  if (typeof findPurchaseProductBySkuOrId_ === "function") {
    const hit = findPurchaseProductBySkuOrId_(valueOrItem);
    if (hit) return hit;
  }
  const item = (valueOrItem && typeof valueOrItem === "object") ? valueOrItem : null;
  const candidates = item
    ? [item.sku, item.SKU, item.product_sku, item.item_sku, item.part_no, item.code, item["料號"], item.product_id, item.product_internal_id, item.raw_id, item.id]
    : [valueOrItem];
  const keys = candidates.map(v => String(v ?? "").trim()).filter(Boolean);
  for (const key of keys) {
    const bySku = (list || []).find(x => saleProductSkuText_(x) === key);
    if (bySku) return bySku;
  }
  for (const key of keys) {
    const byId = (list || []).find(x => saleProductIdText_(x) === key);
    if (byId) return byId;
  }
  return null;
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
    const pickedKey = String(picked.value || "").trim();
    const p = saleFindProductBySkuOrId_(pickedKey);
    const primaryKey = p ? saleProductPrimaryKey_(p) : pickedKey;
    hiddenId.value = primaryKey;
    // 顯示名稱（隱藏值以 SKU 為主，不再只用 Products.id）
    const sku = p ? saleProductSkuText_(p) : "";
    const name = p ? String(p.name || p.product_name || "") : String(picked.label || "");
    inputEl.value = name || (sku ? `${sku}` : "");
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
    const key = String(tr.querySelector(".so-product-id")?.value || "").trim();
    const p = saleFindProductBySkuOrId_(key);
    const qty = Number(tr.querySelector(".so-qty")?.value || 0);
    const price = Number(tr.querySelector(".so-price")?.value || 0);
    if (!key || !p || !qty || qty <= 0) return;
    const sku = saleProductSkuText_(p);
    const rawId = saleProductIdText_(p);
    const productKey = sku || rawId || key;
    items.push({
      product_id: productKey,
      sku: sku,
      raw_id: rawId,
      product_name: p.name || p.product_name || "",
      name: p.name || p.product_name || "",
      unit: p.unit || "",
      spec: p.spec || "",
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
  const submitBtn = document.getElementById("so-submit");
  if (submitBtn && submitBtn.dataset.loading === "1") return;

  const dateEl = document.getElementById("so-date");
  const manualShippingDate = String(dateEl?.value || "").trim();
  const effectiveShippingDate = manualShippingDate || String(window.__adminSaleManualShipDate__ || "").trim() || todayISO();
  window.__adminSaleManualShipDate__ = effectiveShippingDate;
  if (dateEl) dateEl.value = effectiveShippingDate;
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

  // 銷貨單走 JSONP GET，完整 items 物件太大時會造成 script 載入失敗，前端會看到「無法連線」。
  // 這裡改送壓縮 payload，後端再依 SKU/ID 回填品名、單位、規格，避免 URL 過長。
  const compactPayload = {
    sd: effectiveShippingDate,
    n: customer,
    cid: customer_id,
    ph: phone,
    ad: address,
    rm: note,
    t: total,
    op: operator,
    it: items.map(it => [
      String(it.sku || it.product_id || it.raw_id || "").trim(),
      Number(it.qty || 0),
      Number(it.price || 0)
    ])
  };

  const oldText = submitBtn ? submitBtn.textContent : "";
  if (submitBtn) {
    submitBtn.dataset.loading = "1";
    submitBtn.disabled = true;
    submitBtn.textContent = "儲存中...";
  }

  gas({
    type: "manageSale",
    action: "add",
    sale_compact: JSON.stringify(compactPayload),
    __options: { timeoutMs: 30000 }
  }, res => {
    if (submitBtn) {
      submitBtn.dataset.loading = "";
      submitBtn.disabled = false;
      submitBtn.textContent = oldText || "儲存銷貨";
    }

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
  }, 30000);
}
