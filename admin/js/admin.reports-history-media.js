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

    // ✅ 庫存依分類（不是總庫存）
    const catMap = {};
    (products || []).forEach(p => {
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

/** 產品歷史：以 stock_ledger 為資料源，並嘗試優先走 productLedger API（若後端尚未更新則回退 stockLedger）。 */
function viewProductHistory(productId){
  const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
  const p = (list || []).find(x => String(x.id) === String(productId));
  historyProductId = String(productId);
  historyProductSku = String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "");
  historyProductName = p?.name ? String(p.name) : "";
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
  return safeNum(n);
}

function historyQtyText_(x){
  const qty = (x.qty !== undefined) ? x.qty : (x.change !== undefined ? x.change : 0);
  const n = safeNum(qty, 0);
  return (n > 0 ? `+${money(n)}` : `${money(n)}`);
}

function loadHistoryForCurrentProduct(){
  const pid = historyProductId;
  const sku = (historyProductSku || "").trim();
  if (!pid && !sku) return;

  const from = document.getElementById("histFrom")?.value || "";
  const to = document.getElementById("histTo")?.value || "";

  const tbody = document.getElementById("histTbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8">載入中…</td></tr>`;
  }

  // 1) 優先呼叫新 API：productLedger（若後端未更新，會回傳 error）
  gas({ type: "productLedger", sku, product_id: pid, from, to, limit: 500 }, res => {
    if (res?.status === "ok" && Array.isArray(res.data)) {
      renderHistoryRows(res.data);
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
}

function renderHistoryRows(list, from="", to=""){
  const tbody = document.getElementById("histTbody");
  if (!tbody) return;

  let rows = Array.isArray(list) ? list.slice() : [];

  // 日期篩選（from/to 是 yyyy-MM-dd）
  if (from) {
    const ft = Date.parse(from + "T00:00:00");
    rows = rows.filter(x => parseMaybeDateTime_(x.ts || x.time || x.datetime || x.date) >= ft);
  }
  if (to) {
    const tt = Date.parse(to + "T23:59:59");
    rows = rows.filter(x => parseMaybeDateTime_(x.ts || x.time || x.datetime || x.date) <= tt);
  }

  // 依時間倒序
  rows.sort((a,b) => parseMaybeDateTime_(b.ts || b.time || b.datetime || b.date) - parseMaybeDateTime_(a.ts || a.time || a.datetime || a.date));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">查無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  rows.slice(0, 500).forEach(x => {
    const tr = document.createElement("tr");
    const unitText = String(x.unit ?? x.unit_name ?? x.uom ?? "");
    tr.innerHTML = `
      <td>${dateOnly(x.ts ?? x.time ?? x.datetime ?? x.date ?? "")}</td>
      <td>${x.type_label ?? historyTypeLabel_(x)}</td>
      <td>${historyDocNo_(x)}</td>
      <td>${historyQtyText_(x)}</td>
      <td>${unitText}</td>
      <td>${historyCostText_(x)}</td>
      <td>${userNameOnly(x.operator ?? x.user ?? x.member_id ?? "")}</td>
      <td>${x.target ?? x.counterparty ?? x.note ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function initHistoryModal(){
  const modal = document.getElementById("historyModal");
  const btnClose = document.getElementById("historyModalClose");
  const btnRefresh = document.getElementById("histRefresh");
  if (!modal) return;

  btnClose?.addEventListener("click", closeHistoryModal);
  btnRefresh?.addEventListener("click", loadHistoryForCurrentProduct);

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

  bindProductEvents();
  bindOrderEvents();
  bindSupplierEvents();
  bindCustomerEvents();
  bindLedgerEvents();
  bindReportEvents();

  // 預設：先用快取快速顯示 KPI，再背景更新資料（避免首次載入很久）
try { refreshDashboard(); } catch(e) {}

// 背景更新資料：先供應商 → 再商品（確保進貨頁供應商帶入商品可比對）
Promise.all([loadSuppliers(), loadAdminProducts()]).then(() => {
  scheduleDashboardRefresh_();
// 商品編輯 Modal：關閉
document.getElementById("productEditModalClose")?.addEventListener("click", closeProductEditModal_);
document.getElementById("productEditModal")?.addEventListener("click", (e) => {
  if (e.target && e.target.id === "productEditModal") closeProductEditModal_();
// 新增商品 Modal：關閉
document.getElementById("productAddModalClose")?.addEventListener("click", closeProductAddModal_);
document.getElementById("productAddModal")?.addEventListener("click", (e) => {
  if (e.target && e.target.id === "productAddModal") closeProductAddModal_();
});
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
    <td><input type="number" class="so-qty admin-input" value="1" style="min-width:90px" /></td>
    <td><input type="number" class="so-price admin-input" value="0" style="min-width:110px" /></td>
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
  const customer = document.getElementById("so-customer-combo")?.value.trim() || "";
  const customer_id = document.getElementById("so-customer-id")?.value.trim() || "";
  const note = document.getElementById("so-note")?.value.trim() || "";

  const items = collectSaleItems();
  if (!items.length) return alert("請至少新增一個品項");

  // 檢查庫存足夠
  for (const it of items) {
    const p = (adminProducts || []).find(x => String(x.id) === String(it.product_id));
    const stock = Number(p?.stock || 0);
    if (stock < Number(it.qty || 0)) {
      return alert(`庫存不足：${p?.name || it.product_name} 目前庫存 ${stock}，欲出庫 ${it.qty}`);
    }
  }

  const total = calcSaleTotal();
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const payload = {
    date,
    name: customer,
    customer_id: customer_id,
    phone,
    address: note,     // 沿用 Orders.address 作為備註
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
    if (document.getElementById("so-note")) document.getElementById("so-note").value = "";

    // 清快取並刷新
    LS.del("orders");
    LS.del("products");
    LS.del("stockLedger");

    loadAdminProducts(true);
    loadOrders(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || "銷貨完成");
  });
}
