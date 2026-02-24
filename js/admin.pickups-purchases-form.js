function addPickupRow() {
  const tbody = document.querySelector("#pu-items-table tbody");
  if (!tbody) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <div class="combo-wrap">
        <input type="text" class="pu-product-combo admin-input combo-input" placeholder="搜尋商品（料號/名稱）" autocomplete="off" />
        <div class="combo-menu"></div>
      </div>
      <input type="hidden" class="pu-product-id" value="" />
    </td>
    <td><input type="number" class="pu-qty admin-input" value="1" style="min-width:90px" /></td>
    <td><input type="number" class="pu-cost admin-input" value="0" style="min-width:110px" readonly /></td>
    <td class="pu-subtotal">0</td>
    <td><button class="pu-del">刪除</button></td>
  `;

  tbody.appendChild(tr);

  const inputEl = tr.querySelector(".pu-product-combo");
  const menuEl = tr.querySelector(".combo-menu");
  const hiddenId = tr.querySelector(".pu-product-id");
  const costEl = tr.querySelector(".pu-cost");

  setupCombo_(inputEl, menuEl, (kw) => getProductOptions_(kw, "", true), (picked) => {
    hiddenId.value = String(picked.value || "");
    const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
    inputEl.value = String(p?.name || "");
    if (p && costEl) costEl.value = safeNum(p.cost ?? p.purchase_price ?? 0);
    recalcPickupRow(tr);
  }, {
    minChars: 0,
    maxShow: 40,
    onInputClear: () => { hiddenId.value = ""; if (costEl) costEl.value = 0; }
  });

  tr.querySelector(".pu-qty")?.addEventListener("input", () => recalcPickupRow(tr));
  tr.querySelector(".pu-del")?.addEventListener("click", () => {
    tr.remove();
    calcPickupTotal();
  });

  recalcPickupRow(tr);
}

function recalcPickupRow(tr){
  const pid = tr.querySelector(".pu-product-id")?.value || "";
  const qty = safeNum(tr.querySelector(".pu-qty")?.value, 0);
  const cost = safeNum(tr.querySelector(".pu-cost")?.value, 0);

  // 顯示庫存不足提醒（不阻擋；送出時後端會再驗）
  const p = (adminProducts || []).find(x => String(x.id) === String(pid));
  const stock = safeNum(p?.stock, 0);
  if (pid && qty > stock) {
    tr.style.outline = "2px solid rgba(220,38,38,.35)";
  } else {
    tr.style.outline = "";
  }

  const sub = qty * cost;
  tr.querySelector(".pu-subtotal").textContent = money(sub);
  calcPickupTotal();
}

function calcPickupTotal(){
  const rows = Array.from(document.querySelectorAll("#pu-items-table tbody tr"));
  let total = 0;
  rows.forEach(tr => {
    const qty = safeNum(tr.querySelector(".pu-qty")?.value, 0);
    const cost = safeNum(tr.querySelector(".pu-cost")?.value, 0);
    total += qty * cost;
  });
  const el = document.getElementById("pu-total");
  if (el) el.textContent = money(total);
  return total;
}

function collectPickupItems() {
  const rows = Array.from(document.querySelectorAll("#pu-items-table tbody tr"));
  const items = [];
  rows.forEach(tr => {
    const pid = tr.querySelector(".pu-product-id")?.value || "";
    const p = (adminProducts || []).find(x => String(x.id) === String(pid));
    const qty = Number(tr.querySelector(".pu-qty")?.value || 0);
    const cost = Number(tr.querySelector(".pu-cost")?.value || 0);
    if (!pid || !p || !qty || qty <= 0) return;
    items.push({
      product_id: pid,
      product_name: p.name || "",
      qty: qty,
      cost: cost
    });
  });
  return items;
}

function submitPickup(){
  const date = document.getElementById("pu-date")?.value || todayISO();
  const dept = document.getElementById("pu-dept")?.value.trim() || "";
  const receiver = document.getElementById("pu-receiver")?.value.trim() || "";
  const note = document.getElementById("pu-note")?.value.trim() || "";

  if (!dept) return alert("請填寫領用單位／門市");

  const items = collectPickupItems();
  if (!items.length) return alert("請至少新增一個品項");

  // 先在前端做一次庫存檢查（送出時後端也會再驗）
  for (const it of items) {
    const p = (adminProducts || []).find(x => String(x.id) === String(it.product_id));
    const stock = safeNum(p?.stock, 0);
    if (stock < safeNum(it.qty,0)) {
      return alert(`庫存不足：${p?.name || it.product_name} 目前庫存 ${stock}，欲領用 ${it.qty}`);
    }
  }

  const total = calcPickupTotal();
  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  const payload = {
    date,
    department: dept,
    receiver,
    note,
    total,
    items,
    operator
  };

  gas({
    type: "managePickup",
    action: "add",
    pickup: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "領貨失敗（後端寫入未成功）");
      return;
    }

    LS.del("pickups");
    LS.del("products");
    LS.del("stockLedger");

    // 清空表單（保留日期/單位）
    const tbody = document.querySelector("#pu-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addPickupRow();
    calcPickupTotal();
    if (document.getElementById("pu-receiver")) document.getElementById("pu-receiver").value = "";
    if (document.getElementById("pu-note")) document.getElementById("pu-note").value = "";

    loadAdminProducts(true);
    loadPickups(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || "領貨完成");
  });
}

function loadPickups(force = false){
  return new Promise(resolve => {
    gas({ type: "pickups" }, res => {
      const list = normalizeList(res);
      if (!list.length) {
        pickups = LS.get("pickups", []);
        if (!pickups.length) alert("領貨資料載入失敗（後端未回傳/尚未建立工作表 pickups）");
      } else {
        pickups = list;
        LS.set("pickups", list);
      }
      renderPickups(pickups, 1);
      resolve(pickups);
    });
  });
}

function renderPickups(list, page = 1){
  pickupPage = page;
  const tbody = document.querySelector("#pu-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil((list || []).length / pickupsPerPage));
  pickupPage = Math.min(pickupPage, totalPages);

  const start = (pickupPage - 1) * pickupsPerPage;
  const end = start + pickupsPerPage;

  tbody.innerHTML = "";
  (list || []).slice(start, end).forEach(pu => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${pu.pickup_id ?? ""}</td>
      <td>${dateOnly(pu.date)}</td>
      <td>${pu.department ?? ""}</td>
      <td>${pu.receiver ?? ""}</td>
      <td>$${money(pu.total)}</td>
      <td class="row-actions">
        <button onclick="viewPickup('${pu.pickup_id}')">查看</button>
        <button onclick="deletePickup('${pu.pickup_id}')">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("pu-pagination", totalPages, i => renderPickups(list, i), pickupPage);
}

function searchPickups(){
  const keyword = (document.getElementById("pu-search")?.value || "").trim().toLowerCase();
  const list = pickups || [];
  const filtered = list.filter(pu =>
    String(pu.pickup_id || "").toLowerCase().includes(keyword) ||
    String(pu.department || "").toLowerCase().includes(keyword) ||
    String(pu.receiver || "").toLowerCase().includes(keyword)
  );
  renderPickups(filtered, 1);
}

function viewPickup(pickupId){
  const pu = (pickups || []).find(x => String(x.pickup_id) === String(pickupId));
  if (!pu) return alert("找不到領貨單");
  const items = Array.isArray(pu.items) ? pu.items : (typeof pu.items === "string" ? (()=>{try{return JSON.parse(pu.items)}catch(e){return []}})() : []);
  const lines = (items || []).map(it => `${it.product_name || ""} × ${it.qty || 0}（成本 ${money(it.cost || 0)}）`).join("\n");
  alert(`領貨單：${pu.pickup_id}\n日期：${dateOnly(pu.date) || ""}\n單位：${pu.department || ""}\n領貨人：${pu.receiver || ""}\n備註：${pu.note || ""}\n\n品項：\n${lines || "（無）"}`);
}

function deletePickup(pickupId){
  if (!confirm("確定要刪除這張領貨單？（不回滾庫存，建議用沖銷/調整）")) return;
  gas({ type: "managePickup", action: "delete", pickup_id: pickupId }, res => {
    if (!res || res.status !== "ok") return alert(res?.message || "刪除失敗");
    LS.del("pickups");
    loadPickups(true);
    alert(res?.message || "已刪除");
  });
}

function addPurchaseRow() {
  const tbody = document.querySelector("#po-items-table tbody");
  if (!tbody) return;

  ensurePurchaseDataReady_().then(ok => {
    if (!ok) {
      alert("進貨管理載入失敗：供應商/商品資料未就緒");
      return;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="combo-wrap">
          <input type="text" class="po-product-combo admin-input combo-input" placeholder="請先選擇供應商" autocomplete="off" disabled />
          <div class="combo-menu"></div>
        </div>
        <input type="hidden" class="po-product-id" value="" />
      </td>
      <td class="po-unit">-</td>
      <td><select class="po-supplier admin-select"></select></td>
      <td><input type="number" class="po-qty admin-input" value="1" style="min-width:90px" /></td>
      <td><input type="number" class="po-cost admin-input" value="0" style="min-width:110px" /></td>
      <td class="po-subtotal">0</td>
      <td><button class="po-del">刪除</button></td>
    `;

    tbody.appendChild(tr);

    const supSel = tr.querySelector(".po-supplier");
    const inputEl = tr.querySelector(".po-product-combo");
    const menuEl = tr.querySelector(".combo-menu");
    const hiddenId = tr.querySelector(".po-product-id");
    const unitCell = tr.querySelector(".po-unit");
    const qty = tr.querySelector(".po-qty");
    const cost = tr.querySelector(".po-cost");
    const sub = tr.querySelector(".po-subtotal");

    fillSupplierSelect(supSel);

    const clearProduct = () => {
      hiddenId.value = "";
      inputEl.value = "";
      unitCell.textContent = "-";
      cost.value = 0;
      sub.textContent = "0";
    };

    const syncSubtotal = () => {
      const subtotal = (Number(qty.value || 0) * Number(cost.value || 0));
      sub.textContent = fmtMoney_(subtotal);
      updatePurchaseTotal();
    };

    const applyProduct = () => {
      const pid = String(hiddenId.value || "").trim();
      const p = (adminProducts || []).find(x => String(x.id) === String(pid));
      unitCell.textContent = p?.unit || "-";
      if (p && Number(cost.value || 0) === 0) cost.value = Number(p.cost || 0);
      syncSubtotal();
    };

    supSel.addEventListener("change", () => {
      const supplierId = String(supSel.value || "").trim();
      clearProduct();
      if (!supplierId) {
        inputEl.disabled = true;
        inputEl.placeholder = "請先選擇供應商";
        return;
      }
      inputEl.disabled = false;
      inputEl.placeholder = "搜尋商品（料號/名稱）";
    });

    setupCombo_(inputEl, menuEl, (kw) => {
      const supplierId = String(supSel.value || "").trim();
      if (!supplierId) return { items: [], hint: "請先選擇供應商" };
      return getProductOptions_(kw, supplierId, false);
    }, (picked) => {
      hiddenId.value = String(picked.value || "");
      const p = (adminProducts || []).find(x => String(x.id) === String(hiddenId.value));
      inputEl.value = String(p?.name || "");
      applyProduct();
    }, {
      minChars: 0,
      maxShow: 40,
      onInputClear: () => { hiddenId.value = ""; }
    });

    qty.addEventListener("input", syncSubtotal);
    cost.addEventListener("input", syncSubtotal);

    tr.querySelector(".po-del")?.addEventListener("click", () => {
      tr.remove();
      updatePurchaseTotal();
    });

    // 初始化狀態
    inputEl.disabled = !String(supSel.value || "").trim();
  });
}

function supplierNameById_(sid){
  const id = String(sid || "").trim();
  if (!id) return "";
  const list = suppliers.length ? suppliers : LS.get("suppliers", []);
  const s = (list || []).find(x => String(x.id) === id);
  return s ? (s.name || "") : "";
}

function primarySupplierName_(p){
  const ids = parseSupplierIds_(p);
  return supplierNameById_(ids[0] || "");
}

function parseSupplierIds_(p){
  if (!p) return [];
  // 只解析「供應商代碼/ID」欄位；不使用中文名稱比對
  const rawMulti = String(p.supplier_ids || "").trim();
  const rawSingle = String(p.supplier_id || "").trim();

  const raw = rawMulti || rawSingle;
  if (!raw) return [];
  return raw.split(",").map(s => String(s).trim()).filter(Boolean);
}
function hasSupplier_(p, supplierId){
  // 嚴格：只用供應商代碼/ID 比對；空值一律視為不符合
  const sid = String(supplierId || "").trim();
  if (!sid) return false;
  const ids = parseSupplierIds_(p);
  if (!ids.length) return false;
  return ids.includes(sid);
}

function getProductOptions_(kw, supplierId, includeStock){
  kw = String(kw || "").trim().toLowerCase();
  supplierId = supplierId ? String(supplierId).trim() : "";
  const list = adminProducts.length ? adminProducts : LS.get("products", []);

  let base = list || [];
  if (supplierId){
    buildSupplierProductIndex_();
    base = (supplierProductIndex_ && supplierProductIndex_[supplierId]) ? supplierProductIndex_[supplierId] : base.filter(p => hasSupplier_(p, supplierId));
  }

  const MAX_SHOW = 80;

  // 點擊/聚焦時：若尚未輸入關鍵字，先顯示前 N 筆（可再輸入縮小範圍）
  if (!kw){
    return (base || []).slice(0, MAX_SHOW).map(p => {
      const sku = p.sku ?? p.part_no ?? p.code ?? "";
      const name = p.name ?? "";
      const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
      return { value: String(p.id), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
    });
  }

  const items = (base || [])
    .filter(p => {
      const sku = String(p.sku ?? p.part_no ?? p.code ?? "").toLowerCase();
      const name = String(p.name ?? "").toLowerCase();
      return sku.includes(kw) || name.includes(kw);
    })
    .slice(0, MAX_SHOW)
    .map(p => {
      const sku = p.sku ?? p.part_no ?? p.code ?? "";
      const name = p.name ?? "";
      const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
      return { value: String(p.id), label: sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}` };
    });

  return items;
}

function refillProductSelect_(selectEl, arg1=null, arg2=null, arg3=null){
  if (!selectEl) return;
  const prev = String(selectEl.value || "");
  fillProductSelect(selectEl, arg1, arg2, arg3);
  if (prev && Array.from(selectEl.options).some(o => String(o.value) === prev)) {
    selectEl.value = prev;
  }
}

function fillProductSelect(selectEl, arg1=null, arg2=null, arg3=null) {
  if (!selectEl) return;

  // 兼容舊呼叫：
  // - fillProductSelect(sel, true) => includeStock
  // - fillProductSelect(sel, true, keyword) => includeStock + keyword
  // - fillProductSelect(sel, supplierId, includeStock) => supplier filter
  // - fillProductSelect(sel, supplierId, includeStock, keyword) => supplier + keyword
  let supplierId = null;
  let includeStock = false;
  let keyword = "";

  if (typeof arg1 === "boolean") {
    includeStock = arg1;
    keyword = (typeof arg2 === "string") ? arg2 : "";
  } else {
    supplierId = (arg1 === undefined || arg1 === null) ? null : String(arg1).trim();
    includeStock = !!arg2;
    keyword = (typeof arg3 === "string") ? arg3 : "";
  }

  keyword = String(keyword || "").trim().toLowerCase();

  const list = adminProducts.length ? adminProducts : LS.get("products", []);
  selectEl.innerHTML = "";

  // 嚴格配對：若指定 supplierId，僅顯示該供應商代碼擁有的商品（以代碼核對）
  let filtered = [];
  if (supplierId) {
    if (supplierProductIndex_ && supplierProductIndex_[supplierId]) {
      filtered = supplierProductIndex_[supplierId];
    } else {
      filtered = (list || []).filter(p => hasSupplier_(p, supplierId));
    }
  } else {
    filtered = list || [];
  }

  // 關鍵字篩選（sku/name）
  if (keyword) {
    filtered = filtered.filter(p => {
      const sku = String(p.sku ?? p.part_no ?? p.code ?? "").toLowerCase();
      const name = String(p.name ?? "").toLowerCase();
      return sku.includes(keyword) || name.includes(keyword);
    });
  }

  if (!filtered.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = supplierId ? "（此供應商尚無商品）" : "（尚無商品，請先新增）";
    selectEl.appendChild(opt);
    return;
  }

  // 大量品項：未輸入關鍵字時限制顯示數量，避免下拉過長
  const MAX_SHOW = 80;
  let showList = filtered;
  if (!keyword && filtered.length > MAX_SHOW) {
    const hint = document.createElement("option");
    hint.value = "";
    hint.textContent = `（請輸入關鍵字搜尋，已顯示前 ${MAX_SHOW} 筆）`;
    selectEl.appendChild(hint);
    showList = filtered.slice(0, MAX_SHOW);
  }

  showList.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    const sku = p.sku ?? p.part_no ?? p.code ?? "";
    const name = p.name ?? "";
    const stockTxt = includeStock ? `（庫存 ${safeNum(p.stock)}）` : "";
    opt.textContent = sku ? `${sku} - ${name}${stockTxt}` : `${name}${stockTxt}`;
    selectEl.appendChild(opt);
  });
}

function calcPurchaseTotal() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  const total = rows.reduce((sum, tr) => {
    const qty = safeNum(tr.querySelector(".po-qty")?.value);
    const cost = safeNum(tr.querySelector(".po-cost")?.value);
    return sum + qty * cost;
  }, 0);

  const el = document.getElementById("po-total");
  if (el) el.textContent = money(total);
  return total;
}

function updatePurchaseTotal(){
  // 兼容：舊版事件綁定使用 updatePurchaseTotal
  return calcPurchaseTotal();
}


function collectPurchaseItems() {
  const rows = Array.from(document.querySelectorAll("#po-items-table tbody tr"));
  const supList = suppliers.length ? suppliers : LS.get("suppliers", []);
  return rows
    .map(tr => {
      const pid = tr.querySelector(".po-product-id")?.value || "";
      const p = (adminProducts || []).find(x => String(x.id) === String(pid)) || {};
      const qty = safeNum(tr.querySelector(".po-qty")?.value);
      const cost = safeNum(tr.querySelector(".po-cost")?.value);
      const supId = tr.querySelector(".po-supplier")?.value || "";
      const supObj = supList.find(s => String(s.id) === String(supId));
      return {
        product_id: pid,
        product_name: p.name || "",
        qty,
        cost,
        supplier_id: String(supId || "").trim(),
        supplier_name: supObj?.name || "",
        unit: p.unit || "",
        sku: p.sku || ""
      };
    })
    .filter(it => it.product_id && it.supplier_id && it.qty > 0);
}

function submitPurchase() {
  const date = document.getElementById("po-date")?.value || todayISO();

  const items = collectPurchaseItems();
  if (!items.length) return alert("請至少新增一個品項");

  const missingSup = items.find(it => !String(it.supplier_id || "").trim());
  if (missingSup) return alert("每個品項都必須選擇供應商");

// 嚴格驗證：每筆商品必須屬於該供應商（只用供應商代碼比對；不使用中文名稱）
for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const pid = String(it.product_id || "").trim();
  const sid = String(it.supplier_id || "").trim();
  if (!pid || !sid) return alert("每個品項都必須選擇供應商與商品（不可空白）");
  const p = adminProducts.find(x => String(x.id) === String(pid));
  if (!p) return alert(`找不到商品：${pid}`);
  if (!hasSupplier_(p, sid)) return alert(`供應商與商品不匹配：供應商=${sid} / 商品=${it.product_name || pid}`);
}

  const total = calcPurchaseTotal();

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  // 進貨單層級供應商：若多供應商則標記 MULTI（列表已不顯示供應商，但後端仍保留欄位）
  const uniqSupIds = Array.from(new Set(items.map(it => String(it.supplier_id || "").trim()).filter(Boolean)));
  const uniqSupNames = Array.from(new Set(items.map(it => String(it.supplier_name || "").trim()).filter(Boolean)));
  const headerSupplierId = (uniqSupIds.length === 1) ? uniqSupIds[0] : "MULTI";
  const headerSupplierName = (uniqSupNames.length === 1) ? uniqSupNames[0] : "多供應商";

  const payload = {
    date,
    supplier_id: headerSupplierId,
    supplier_name: headerSupplierName,
    total,
    items,
    operator
  };

  gas({
    type: "managePurchase",
    action: "add",
    purchase: encodeURIComponent(JSON.stringify(payload))
  }, res => {
    if (!res || res.status !== "ok") {
      alert(res?.message || "進貨失敗（後端寫入未成功）");
      return;
    }
    LS.del("purchases");
    LS.del("products");
    LS.del("stockLedger");

    // 清空表單（保留日期）
    const tbody = document.querySelector("#po-items-table tbody");
    if (tbody) tbody.innerHTML = "";
    addPurchaseRow();
    calcPurchaseTotal();

    loadAdminProducts(true);
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();

    alert(res?.message || `進貨完成：${res?.po_id || ""}`);
  });
}

