function applyPurchaseToLocalStock(purchase) {
  // 1) 產品庫存加回
  const plist = LS.get("products", adminProducts);

  purchase.items.forEach(it => {
    const idx = plist.findIndex(p => String(p.id) === String(it.product_id));
    if (idx >= 0) {
      plist[idx].stock = safeNum(plist[idx].stock) + safeNum(it.qty);
      // 同步成本
      if (safeNum(it.cost) > 0) plist[idx].cost = safeNum(it.cost);
      // 同步最近進貨日 / 有效日期（本地快取）
      const poDate = String(purchase.date || "").slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
        const oldD = String(plist[idx].last_purchase_date || "").slice(0,10);
        if (!oldD || oldD < poDate) plist[idx].last_purchase_date = poDate;
      }
      const expD = String(it.expiry_date || "").slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(expD)) plist[idx].expiry_date = expD;
    }
  });

  LS.set("products", plist);
  adminProducts = plist;

  // 2) 流水
  const led = LS.get("stockLedger", []);
  purchase.items.forEach(it => {
    led.unshift({
      ts: nowISO(),
      type: "IN",
      ref: purchase.po_id,
      product_id: it.product_id,
      product_name: it.product_name,
      sku: it.sku || "",
      unit: it.unit || "",
      qty: it.qty,
      cost: it.cost,
      note: `${it.supplier_name || purchase.supplier_name || ""} 進貨`
    });
  });
  LS.set("stockLedger", led);
}

function loadPurchases(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("purchases", null);

    if (!force && Array.isArray(cached) && cached.length) {
      purchases = cached;
      if (isSectionActive_("purchase-section")) renderPurchases(purchases, 1);
      scheduleDashboardRefresh_();
      resolve(purchases);
      // 背景抓最新，但不阻塞 UI
      setTimeout(() => {
        gas({ type: "purchases" }, res => {
          const list = normalizeList(res);
          if (Array.isArray(list) && list.length) {
            purchases = list;
            LS.set("purchases", list);
            if (isSectionActive_("purchase-section")) renderPurchases(list, 1);
            scheduleDashboardRefresh_();
          }
        });
      }, 0);
      return;
    }

    gas({ type: "purchases" }, res => {
      const list = normalizeList(res);
      const status = String(res?.status || "").toLowerCase();

      if (Array.isArray(list) && list.length) {
        purchases = list;
        LS.set("purchases", list); // cache only
      } else {
        purchases = Array.isArray(cached) ? cached : [];

        // 僅在明確 timeout/error 且沒有快取時提示；status=ok + 空陣列視為「目前無資料」
        if (!purchases.length && (status === "timeout" || status === "error")) {
          alert(`進貨資料載入失敗：${res?.message || "API 無回應"}`);
        }
      }

      if (isSectionActive_("purchase-section")) renderPurchases(purchases, 1);
      scheduleDashboardRefresh_();
      resolve(purchases);
    });
  });
}

function renderPurchases(list, page = 1) {
  purchasePage = page;
  const tbody = document.querySelector("#po-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / purchasesPerPage));
  purchasePage = Math.min(purchasePage, totalPages);

  const start = (purchasePage - 1) * purchasesPerPage;
  const end = start + purchasesPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(po => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${po.po_id ?? ""}</td>
      <td>${dateOnly(po.date)}</td>
      <td>$${money(po.total)}</td>
      <td class="row-actions">
        <button onclick="viewPurchase('${po.po_id}')">查看</button>
        <button onclick="deletePurchase('${po.po_id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("po-pagination", totalPages, i => renderPurchases(list, i), purchasePage);
}

function searchPurchases() {
  const keyword = (document.getElementById("po-search")?.value || "").trim().toLowerCase();
  const list = purchases || [];
  const filtered = list.filter(po =>
    String(po.po_id || "").toLowerCase().includes(keyword)
  );
  renderPurchases(filtered, 1);
}

function viewPurchase(poId) {
  const po = (purchases || []).find(p => String(p.po_id) === String(poId));
  if (!po) return alert("找不到進貨單");

  const items = Array.isArray(po.items) ? po.items : [];
  const rows = items.map(it => `
    <tr>
      <td>${it.product_name ?? ""}</td>
      <td>${it.unit ?? ""}</td>
      <td>${it.supplier_name ?? po.supplier_name ?? ""}</td>
      <td>${dateOnly(it.expiry_date || "") || ""}</td>
      <td>${money(it.qty)}</td>
      <td>${money(it.cost)}</td>
    </tr>
  `).join("");

  const body = `
    <table class="doc-kv">
      <tbody>
        <tr>
          <th>日期</th><td>${dateOnly(po.date)}</td>
          <th>單號</th><td>${po.po_id ?? ""}</td>
        </tr>
      </tbody>
    </table>

    <div style="overflow:auto; border:1px solid rgba(0,0,0,.08); border-radius:12px;">
      <table class="admin-table doc-items">
        <thead>
          <tr>
            <th>商品</th>
            <th>單位</th>
            <th>供應商</th>
            <th>有效日期</th>
            <th>數量</th>
            <th>成本</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6">（無品項）</td></tr>`}
        </tbody>
      </table>
    </div>

    <div style="display:flex; justify-content:flex-end; margin-top:10px; font-weight:800;">
      合計：$${money(po.total)}
    </div>
  `;
  openPoModal(`進貨單查看`, body);
}

function deletePurchase(poId) {
  if (!confirm(`確定刪除進貨單 ${poId}？\n（注意：刪除僅移除單據，不回滾庫存；如需回沖請用「庫存調整」或做沖銷單）`)) return;

  gas({ type: "managePurchase", action: "delete", po_id: poId }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "刪除失敗（後端未成功）");
      return;
    }
    alert(res?.message || "刪除完成");
    LS.del("purchases");
    LS.del("stockLedger");
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();
  });
}

// ------------------ 銷貨（沿用訂單） ------------------
function initCustomerCombo_(){
  const inputEl = document.getElementById("so-customer-combo");
  const menuEl = document.getElementById("so-customer-menu");
  const hiddenId = document.getElementById("so-customer-id");
  const phoneEl = document.getElementById("so-phone");
  if (!inputEl || !menuEl || !hiddenId) return;

  const getOptions = (kw) => {
    const list = customers.length ? customers : LS.get("customers", []);
    const key = String(kw || "").trim().toLowerCase();
    if (!key) {
      // 不輸入就不展開，避免太長
      return { items: [], hint: "請輸入關鍵字搜尋" };
    }
    const items = (list || [])
      .filter(c => {
        const id = String(c.id || "").toLowerCase();
        const name = String(c.name || "").toLowerCase();
        return id.includes(key) || name.includes(key);
      })
      .slice(0, 40)
      .map(c => ({ value: String(c.id || ""), label: `${c.id} - ${c.name}` }));
    return items;
  };

  setupCombo_(inputEl, menuEl, getOptions, (picked) => {
    const list = customers.length ? customers : LS.get("customers", []);
    const c = (list || []).find(x => String(x.id) === String(picked.value));
    hiddenId.value = String(picked.value || "");
    inputEl.value = String(c?.name || "");
    if (phoneEl && c) phoneEl.value = c.phone || "";
  }, {
    minChars: 1,
    maxShow: 40,
    onInputClear: () => {
      hiddenId.value = "";
    }
  });
}

function bindOrderEvents() {
  document.getElementById("order-search")?.addEventListener("input", searchOrders);
  document.getElementById("status-filter")?.addEventListener("change", searchOrders);
  document.getElementById("reload-orders")?.addEventListener("click", () => {
    LS.del("orders");
    loadOrders(true);
  });

  // ---- 新增銷貨單（後台出庫）----
  initCustomerCombo_();

  document.getElementById("so-add-row")?.addEventListener("click", addSaleRow);
  document.getElementById("so-submit")?.addEventListener("click", submitSale);

}

function loadOrders(force = false) {
  const cached = LS.get("orders", null);
  if (!force && Array.isArray(cached) && cached.length) {
    ordersState = cached;
    if (isSectionActive_("order-section")) renderOrders(cached, 1);
    scheduleDashboardRefresh_();
    return;
  }

  gas({ type: "orders" }, res => {
    const list = normalizeList(res);
    ordersState = list;
    if (list.length) LS.set("orders", list);
    if (isSectionActive_("order-section")) renderOrders(list, 1);
    scheduleDashboardRefresh_();
  });
}

function renderOrders(orders, page = 1) {
  const tbody = document.querySelector("#admin-order-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((orders || []).length / ordersPerPage));
  orderPage = Math.min(page, totalPages);

  const start = (orderPage - 1) * ordersPerPage;
  const end = start + ordersPerPage;

  const pageOrders = (orders || []).slice(start, end);

  tbody.innerHTML = pageOrders.map(o => `
    <tr>
      <td>${o.order_id ?? ""}</td>
      <td>${dateOnly(o.date)}</td>
      <td>${o.name ?? ""}</td>
      <td>${o.phone ?? ""}</td>
      <td>$${money(o.total)}</td>
      <td><button onclick="showOrderItems(\'${o.order_id}\')">查看</button></td>
      <td class="row-actions">
        <button onclick="updateOrder('${o.order_id}', '已出貨')">出貨</button>
        <button onclick="updateOrder('${o.order_id}', '已完成')">完成</button>
        <button onclick="deleteOrder('${o.order_id}')">刪除</button>
      </td>
    </tr>
  `).join("");

  renderPagination("order-pagination", totalPages, i => {
    const list = LS.get("orders", orders);
    renderOrders(list, i);
  }, orderPage);
}

function showOrderItems(orderId) {
  const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
  const o = (orders || []).find(x => String(x.order_id) === String(orderId));
  if (!o) return alert("找不到該銷貨單");

  let items = o.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e) {}
  }
  if (!Array.isArray(items)) items = [];

  if (!items.length) {
    return alert("無商品資料");
  }

  const lines = items.map((it, idx) => {
    const name = it.product_name || it.name || it.ProductName || it.product || `品項${idx+1}`;
    const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity ?? 0, 0);
    const price = safeNum(it.price ?? it.UnitPrice ?? it.unit_price ?? 0, 0);
    const subtotal = (qty && price) ? qty * price : safeNum(it.subtotal ?? it.Subtotal ?? 0, 0);
    const parts = [];
    parts.push(name);
    parts.push(`x${qty}`);
    if (price) parts.push(`@$${money(price)}`);
    if (subtotal) parts.push(`= $${money(subtotal)}`);
    return parts.join(" ");
  });

  const header = `銷貨單 #${o.order_id}\n日期：${o.date || ""}\n客戶：${o.name || ""}\n\n`;
  alert(header + lines.join("\n"));
}

function searchOrders() {
  const keyword = (document.getElementById("order-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("status-filter")?.value || "";
  const orders = LS.get("orders", []);

  const filtered = orders.filter(o => {
    const okKeyword =
      String(o.order_id || "").toLowerCase().includes(keyword) ||
      String(o.name || "").toLowerCase().includes(keyword) ||
      String(o.phone || "").toLowerCase().includes(keyword);

    const okStatus = status ? String(o.status || "") === status : true;
    return okKeyword && okStatus;
  });

  renderOrders(filtered, 1);
}

function updateOrder(orderId, status) {
  if (!confirm(`確定將訂單 ${orderId} 設為「${status}」？`)) return;

  gas({ type: "manageOrder", action: "update", order_id: orderId, status }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "更新失敗（後端未成功）");
      return;
    }
    alert(res?.message || "更新成功");
    LS.del("orders");
    loadOrders(true);
  });
}

function deleteOrder(orderId) {
  if (!confirm(`確定刪除訂單 ${orderId}？`)) return;

  gas({ type: "manageOrder", action: "delete", order_id: orderId }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "刪除失敗（後端未成功）");
      return;
    }
    alert(res?.message || "刪除成功");
    LS.del("orders");
    loadOrders(true);
  });
}

// ------------------ 庫存流水 ------------------
function bindLedgerEvents() {
  document.getElementById("ledger-type")?.addEventListener("change", filterLedger);
  document.getElementById("ledger-search")?.addEventListener("input", filterLedger);
  document.getElementById("ledger-reload")?.addEventListener("click", () => {
    LS.del("stockLedger");
    loadLedger(true);
  });
}

function loadLedger(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("stockLedger", null);
    if (!force && Array.isArray(cached) && cached.length) {
      ledger = cached;
      if (isSectionActive_("ledger-section")) renderLedger(ledger, 1);
      resolve(ledger);
      return;
    }

    gas({ type: "stockLedger" }, res => {
      const list = normalizeList(res);
      if (!list.length) ledger = LS.get("stockLedger", []);
      else {
        ledger = list;
        LS.set("stockLedger", list);
      }

      if (isSectionActive_("ledger-section")) renderLedger(ledger, 1);
      resolve(ledger);
    });
  });
}

function filterLedger() {
  const type = document.getElementById("ledger-type")?.value || "";
  const keyword = (document.getElementById("ledger-search")?.value || "").trim().toLowerCase();

  const codeOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    if (code === "IN" || code === "OUT" || code === "ADJ") return code;
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase")) return "IN";
    if (r.includes("sale")) return "OUT";
    if (String(x.ref_id || x.ref || "") === "ADJ") return "ADJ";
    return "";
  };

  const filtered = (ledger || []).filter(l => {
    if (type && codeOf(l) !== type) return false;
    if (!keyword) return true;

    const hay = [
      l.product_name, l.product, l.name,
      l.doc_no, l.ref, l.ref_id,
      l.operator, l.user, l.member_id,
      l.target, l.counterparty, l.note
    ].map(v => String(v || "").toLowerCase()).join(" ");
    return hay.includes(keyword);
  });

  renderLedger(filtered, 1);
}

function renderLedger(list, page = 1) {
  ledgerPage = page;
  const tbody = document.querySelector("#ledger-table tbody");
  if (!tbody) return;

const toTs = (v) => {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return 0;
  // yyyy-mm-dd or yyyy-mm-dd hh:mm:ss
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m){
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0);
    return new Date(y, mo, d, hh, mm, ss).getTime();
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? 0 : dt.getTime();
};

const sorted = [...(list || [])].sort((a,b) => {
  const at = toTs(a.ts ?? a.time ?? a.datetime ?? a.date ?? "");
  const bt = toTs(b.ts ?? b.time ?? b.datetime ?? b.date ?? "");
  return bt - at; // 新到舊
});

  const totalPages = Math.max(1, Math.ceil(sorted.length / ledgerPerPage));
  ledgerPage = Math.min(ledgerPage, totalPages);

  const start = (ledgerPage - 1) * ledgerPerPage;
  const end = start + ledgerPerPage;

  const labelOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    if (code === "IN") return "進貨";
    if (code === "OUT") return "出貨";
    if (code === "ADJ") return "調整";
    // fallback: reason
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase")) return "進貨";
    if (r.includes("sale")) return "出貨";
    if (r.includes("pickup")) return "領貨";
    return code || "—";
  };

  const codeOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    if (code === "IN" || code === "OUT" || code === "ADJ") return code;
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase")) return "IN";
    if (r.includes("sale")) return "OUT";
    if (String(x.ref_id || x.ref || "") === "ADJ") return "ADJ";
    return "";
  };

  tbody.innerHTML = "";
  sorted.slice(start, end).forEach(l => {
    const qty = (l.qty !== undefined) ? l.qty : (l.change !== undefined ? l.change : 0);
    const qtyNum = safeNum(qty, 0);
    const qtyText = (qtyNum > 0 ? `+${money(qtyNum)}` : `${money(qtyNum)}`);
    const costRaw = (l.cost ?? l.unit_cost ?? l.cost_price ?? "");
    const costText = (costRaw === "" || costRaw === null || costRaw === undefined) ? "" : money(safeNum(costRaw, 0));

    const skuText = String(l.sku ?? l.product_sku ?? l.item_sku ?? l.part_no ?? l.code ?? "");
    const unitText = String(l.unit ?? l.unit_name ?? l.uom ?? "");

    const tr = document.createElement("tr");
    tr.dataset.type = codeOf(l);
    tr.innerHTML = `
      <td>${dateTimeText(l.ts ?? l.time ?? l.datetime ?? l.date ?? "")}</td>
      <td>${l.type_label ?? labelOf(l)}</td>
      <td>${skuText}</td>
      <td>${l.doc_no ?? l.ref ?? l.ref_id ?? ""}</td>
      <td>${l.product_name ?? ""}</td>
      <td>${qtyText}</td>
      <td>${unitText}</td>
      <td>${costText}</td>
      <td>${userNameOnly(l.operator ?? l.user ?? l.member_id ?? "")}</td>
      <td>${l.target ?? l.counterparty ?? l.note ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("ledger-pagination", totalPages, i => renderLedger(sorted, i), ledgerPage);
}

// ------------------ 報表 ------------------
function bindReportEvents() {
  const fromEl = document.getElementById("report-from");
  const toEl = document.getElementById("report-to");
  if (fromEl && !fromEl.value) fromEl.value = todayISO();
  if (toEl && !toEl.value) toEl.value = todayISO();

  document.getElementById("report-run")?.addEventListener("click", runReport);
}

