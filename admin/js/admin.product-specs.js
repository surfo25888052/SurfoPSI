(function(){
  const PRODUCT_SPEC_UNITS = ["箱", "包", "入", "公斤"];
  let currentProductSpecProductId = "";
  let productSpecCache = {};

  function specNum(v, fallback = 0) {
    const n = Number(String(v ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function specRound(v, digits = 4) {
    const n = specNum(v, NaN);
    if (!Number.isFinite(n)) return "";
    const p = Math.pow(10, digits);
    const out = Math.round((n + Number.EPSILON) * p) / p;
    return Number.isInteger(out) ? String(out) : String(out).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  function specMoney(v) {
    const n = specNum(v, NaN);
    if (!Number.isFinite(n)) return "未設定";
    return n.toLocaleString("zh-TW", { maximumFractionDigits: 4 });
  }

  function esc(v) {
    if (typeof escapeHtml_ === "function") return escapeHtml_(v);
    return String(v ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }

  function attr(v) {
    if (typeof escapeAttr_ === "function") return escapeAttr_(v);
    return esc(v);
  }

  function getProductById_(id) {
    const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
    return (list || []).find(p => String(p?.id || p?.product_id || "") === String(id));
  }

  function normalizeUnit_(unit) {
    const text = String(unit || "").trim();
    return PRODUCT_SPEC_UNITS.includes(text) ? text : "";
  }

  function unitOptions_(selected) {
    const sel = normalizeUnit_(selected);
    return PRODUCT_SPEC_UNITS
      .map(unit => `<option value="${attr(unit)}"${unit === sel ? " selected" : ""}>${esc(unit)}</option>`)
      .join("");
  }

  function ensureProductSpecStyles_() {
    if (document.getElementById("product-spec-style")) return;
    const style = document.createElement("style");
    style.id = "product-spec-style";
    style.textContent = `
      .product-spec-modal-content{max-width:min(96vw,960px);}
      .product-spec-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0;}
      .product-spec-summary .spec-box{border:1px solid #d9e7d9;border-radius:8px;padding:10px;background:#f8fcf8;}
      .product-spec-summary .spec-box span{display:block;color:#667085;font-size:12px;margin-bottom:4px;}
      .product-spec-summary .spec-box strong{font-size:16px;color:#1b5e20;}
      .product-spec-rule-table input,.product-spec-rule-table select{width:100%;}
      .product-spec-rule-actions{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:10px 0;}
      .product-spec-preview-table td,.product-spec-preview-table th{text-align:center;}
      .product-spec-status{min-height:20px;margin-top:8px;font-weight:700;}
      .product-spec-status.error{color:#b42318;}
      .product-spec-status.ok{color:#1b5e20;}
      @media (max-width: 760px){.product-spec-summary{grid-template-columns:repeat(2,minmax(0,1fr));}}
    `;
    document.head.appendChild(style);
  }

  function ensureProductSpecModal_() {
    let modal = document.getElementById("productSpecModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "productSpecModal";
    modal.className = "doc-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="doc-modal-content product-spec-modal-content" role="dialog" aria-modal="true" aria-label="商品規格設定">
        <button class="doc-modal-close" id="productSpecModalClose" type="button" aria-label="關閉">×</button>
        <div class="doc-modal-title" id="productSpecModalTitle">商品規格設定</div>
        <div class="doc-modal-body" id="productSpecModalBody"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => {
      if (e.target === modal) closeProductSpecModal_();
    });
    document.getElementById("productSpecModalClose")?.addEventListener("click", closeProductSpecModal_);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && modal.classList.contains("show")) closeProductSpecModal_();
    });
    return modal;
  }

  function closeProductSpecModal_() {
    const modal = document.getElementById("productSpecModal");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    currentProductSpecProductId = "";
  }

  function defaultProductSpec_(product, saved) {
    const productUnit = normalizeUnit_(product?.unit);
    const productCost = specNum(product?.cost ?? product?.purchase_price ?? "", 0);
    const baseUnit = normalizeUnit_(saved?.base_unit) || productUnit || "公斤";
    return {
      product_id: String(product?.id || product?.product_id || saved?.product_id || "").trim(),
      sku: String(product?.sku || product?.part_no || product?.code || saved?.sku || "").trim(),
      spec_text: String(saved?.spec_text || product?.spec || "").trim(),
      base_unit: baseUnit,
      cost_value: saved && saved.cost_value !== undefined ? specNum(saved.cost_value, 0) : productCost,
      cost_unit: normalizeUnit_(saved?.cost_unit) || productUnit || baseUnit,
      relations: Array.isArray(saved?.relations) ? saved.relations : [],
      enabled_units: Array.isArray(saved?.enabled_units) ? saved.enabled_units : [],
      cost_preview: saved?.cost_preview || {},
      note: String(saved?.note || "").trim(),
      updated_at: saved?.updated_at || "",
      updated_by: saved?.updated_by || ""
    };
  }

  function fetchProductSpec_(product) {
    return new Promise(resolve => {
      const productId = String(product?.id || product?.product_id || "").trim();
      const sku = String(product?.sku || product?.part_no || product?.code || "").trim();
      const cached = productSpecCache[productId || sku];
      if (cached) return resolve(cached);
      gas({ type: "productSpecs", product_id: productId, sku }, res => {
        const data = res && res.status === "ok" ? (res.data || null) : null;
        if (data) productSpecCache[productId || sku] = data;
        resolve(data);
      }, 30000);
    });
  }

  function ruleRowHtml_(rel = {}) {
    const fromUnit = normalizeUnit_(rel.from_unit || rel.fromUnit || rel.from) || "箱";
    const toUnit = normalizeUnit_(rel.to_unit || rel.toUnit || rel.to) || "包";
    const qty = specNum(rel.quantity || rel.qty || rel.factor, "");
    return `
      <tr data-spec-rule-row>
        <td>
          <div class="inline-row">
            <span>1</span>
            <select class="admin-input" data-rule-from>${unitOptions_(fromUnit)}</select>
          </div>
        </td>
        <td>
          <input class="admin-input" data-rule-qty type="number" step="0.0001" min="0" value="${attr(qty)}" placeholder="數量">
        </td>
        <td>
          <select class="admin-input" data-rule-to>${unitOptions_(toUnit)}</select>
        </td>
        <td>
          <button class="admin-btn" type="button" data-remove-rule>移除</button>
        </td>
      </tr>
    `;
  }

  function collectProductSpecForm_() {
    const product = getProductById_(currentProductSpecProductId);
    const relations = Array.from(document.querySelectorAll("[data-spec-rule-row]")).map(row => ({
      from_unit: normalizeUnit_(row.querySelector("[data-rule-from]")?.value),
      quantity: specNum(row.querySelector("[data-rule-qty]")?.value, 0),
      to_unit: normalizeUnit_(row.querySelector("[data-rule-to]")?.value)
    })).filter(rel => rel.from_unit && rel.to_unit && rel.from_unit !== rel.to_unit && rel.quantity > 0);
    const baseUnit = normalizeUnit_(document.getElementById("product-spec-base-unit")?.value) || "公斤";
    const costUnit = normalizeUnit_(document.getElementById("product-spec-cost-unit")?.value);
    const costValue = specNum(document.getElementById("product-spec-cost-value")?.value, 0);
    return {
      product_id: String(product?.id || product?.product_id || "").trim(),
      sku: String(product?.sku || product?.part_no || product?.code || "").trim(),
      spec_text: String(document.getElementById("product-spec-text")?.value || "").trim(),
      base_unit: baseUnit,
      cost_value: costValue,
      cost_unit: costUnit,
      relations,
      enabled_units: [],
      cost_preview: {},
      note: String(document.getElementById("product-spec-note")?.value || "").trim()
    };
  }

  function computeUnitFactors_(baseUnit, relations) {
    const factors = { [baseUnit]: 1 };
    const rels = Array.isArray(relations) ? relations : [];
    let changed = true;
    let guard = 0;
    while (changed && guard < 20) {
      changed = false;
      guard += 1;
      rels.forEach(rel => {
        const from = normalizeUnit_(rel.from_unit);
        const to = normalizeUnit_(rel.to_unit);
        const qty = specNum(rel.quantity, 0);
        if (!from || !to || qty <= 0) return;
        if (Number.isFinite(factors[to]) && !Number.isFinite(factors[from])) {
          factors[from] = qty * factors[to];
          changed = true;
        }
        if (Number.isFinite(factors[from]) && !Number.isFinite(factors[to])) {
          factors[to] = factors[from] / qty;
          changed = true;
        }
      });
    }
    return factors;
  }

  function computeCostPreview_(spec) {
    const factors = computeUnitFactors_(spec.base_unit, spec.relations);
    const costValue = specNum(spec.cost_value, 0);
    const costUnit = normalizeUnit_(spec.cost_unit);
    const preview = {};
    const costUnitFactor = factors[costUnit];
    const baseCost = costValue > 0 && Number.isFinite(costUnitFactor) && costUnitFactor > 0
      ? costValue / costUnitFactor
      : NaN;
    PRODUCT_SPEC_UNITS.forEach(unit => {
      const factor = factors[unit];
      preview[unit] = {
        unit,
        factor_to_base: Number.isFinite(factor) ? factor : null,
        cost: Number.isFinite(baseCost) && Number.isFinite(factor) ? baseCost * factor : null
      };
    });
    return { factors, preview, baseCost };
  }

  function renderProductSpecPreview_() {
    const spec = collectProductSpecForm_();
    const result = computeCostPreview_(spec);
    const preview = result.preview || {};
    const tbody = document.getElementById("product-spec-preview-body");
    const status = document.getElementById("product-spec-status");
    if (tbody) {
      tbody.innerHTML = PRODUCT_SPEC_UNITS.map(unit => {
        const row = preview[unit] || {};
        const factorText = row.factor_to_base === null ? "未連接" : `1 ${unit} = ${specRound(row.factor_to_base, 6)} ${spec.base_unit}`;
        const costText = row.cost === null ? "未設定" : specMoney(row.cost);
        return `
          <tr>
            <td>${esc(unit)}</td>
            <td>${esc(factorText)}</td>
            <td>${esc(costText)}</td>
          </tr>
        `;
      }).join("");
    }
    if (status) {
      const costUnit = normalizeUnit_(spec.cost_unit);
      const ok = costUnit && preview[costUnit] && preview[costUnit].factor_to_base !== null;
      status.className = `product-spec-status ${ok || spec.cost_value <= 0 ? "ok" : "error"}`;
      status.textContent = ok
        ? `成本已可換算：${specMoney(spec.cost_value)} / ${costUnit}`
        : (spec.cost_value > 0 ? "成本單位尚未接到基準單位，請補換算規則。" : "可先保存規格，之後再補成本。");
    }
    return { spec, ...result };
  }

  function addProductSpecRule_(rel) {
    const tbody = document.getElementById("product-spec-rule-body");
    if (!tbody) return;
    tbody.insertAdjacentHTML("beforeend", ruleRowHtml_(rel));
    bindProductSpecRuleEvents_();
    renderProductSpecPreview_();
  }

  function bindProductSpecRuleEvents_() {
    document.querySelectorAll("[data-spec-rule-row]").forEach(row => {
      if (row.dataset.bound === "1") return;
      row.dataset.bound = "1";
      row.querySelectorAll("input,select").forEach(el => el.addEventListener("input", renderProductSpecPreview_));
      row.querySelector("[data-remove-rule]")?.addEventListener("click", () => {
        row.remove();
        renderProductSpecPreview_();
      });
    });
  }

  function renderProductSpecForm_(product, saved) {
    const spec = defaultProductSpec_(product, saved);
    const body = document.getElementById("productSpecModalBody");
    const title = document.getElementById("productSpecModalTitle");
    if (!body || !title) return;
    title.textContent = `規格設定：${product?.name || spec.sku || ""}`;
    body.innerHTML = `
      <div class="hint">第一階段只建立商品規格與成本換算預覽，不會改採購、銷貨、庫存與舊報表計算。</div>
      <div class="product-spec-summary">
        <div class="spec-box"><span>料號</span><strong>${esc(spec.sku || "-")}</strong></div>
        <div class="spec-box"><span>目前商品單位</span><strong>${esc(product?.unit || "-")}</strong></div>
        <div class="spec-box"><span>目前商品成本</span><strong>${esc(specMoney(product?.cost ?? product?.purchase_price ?? ""))}</strong></div>
        <div class="spec-box"><span>最後更新</span><strong>${esc(saved?.updated_at || "-")}</strong></div>
      </div>
      <div class="form-grid">
        <div class="field span-2">
          <label for="product-spec-text">規格顯示文字</label>
          <input id="product-spec-text" class="admin-input" type="text" value="${attr(spec.spec_text)}" placeholder="例：1kg/包 / 15包/箱">
        </div>
        <div class="field">
          <label for="product-spec-base-unit">基準單位</label>
          <select id="product-spec-base-unit" class="admin-input">${unitOptions_(spec.base_unit)}</select>
        </div>
        <div class="field">
          <label for="product-spec-cost-unit">成本單位</label>
          <select id="product-spec-cost-unit" class="admin-input">${unitOptions_(spec.cost_unit)}</select>
        </div>
        <div class="field">
          <label for="product-spec-cost-value">成本金額</label>
          <input id="product-spec-cost-value" class="admin-input" type="number" min="0" step="0.01" value="${attr(specRound(spec.cost_value, 6))}">
        </div>
        <div class="field span-2">
          <label for="product-spec-note">備註</label>
          <input id="product-spec-note" class="admin-input" type="text" value="${attr(spec.note)}">
        </div>
      </div>
      <div class="product-spec-rule-actions">
        <strong>換算規則</strong>
        <button class="admin-btn" type="button" id="product-spec-add-rule">＋ 新增規則</button>
      </div>
      <table class="admin-table product-spec-rule-table">
        <thead>
          <tr>
            <th>來源單位</th>
            <th>等於數量</th>
            <th>目標單位</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="product-spec-rule-body">
          ${(spec.relations || []).map(ruleRowHtml_).join("") || ruleRowHtml_({ from_unit:"箱", quantity:"", to_unit:"包" })}
        </tbody>
      </table>
      <div class="product-spec-rule-actions">
        <strong>成本預覽</strong>
      </div>
      <table class="admin-table product-spec-preview-table">
        <thead>
          <tr>
            <th>單位</th>
            <th>換算到基準</th>
            <th>換算成本</th>
          </tr>
        </thead>
        <tbody id="product-spec-preview-body"></tbody>
      </table>
      <div id="product-spec-status" class="product-spec-status"></div>
      <div class="modal-actions">
        <button class="admin-btn" type="button" id="product-spec-cancel">取消</button>
        <button class="admin-btn primary" type="button" id="product-spec-save">儲存規格設定</button>
      </div>
    `;
    document.getElementById("product-spec-base-unit")?.addEventListener("change", renderProductSpecPreview_);
    document.getElementById("product-spec-cost-unit")?.addEventListener("change", renderProductSpecPreview_);
    document.getElementById("product-spec-cost-value")?.addEventListener("input", renderProductSpecPreview_);
    document.getElementById("product-spec-add-rule")?.addEventListener("click", () => addProductSpecRule_());
    document.getElementById("product-spec-cancel")?.addEventListener("click", closeProductSpecModal_);
    document.getElementById("product-spec-save")?.addEventListener("click", saveProductSpec_);
    bindProductSpecRuleEvents_();
    renderProductSpecPreview_();
  }

  function saveProductSpec_() {
    const btn = document.getElementById("product-spec-save");
    const status = document.getElementById("product-spec-status");
    const computed = renderProductSpecPreview_();
    const spec = computed.spec;
    spec.enabled_units = PRODUCT_SPEC_UNITS.filter(unit => computed.preview[unit]?.factor_to_base !== null);
    spec.cost_preview = Object.fromEntries(PRODUCT_SPEC_UNITS.map(unit => [unit, computed.preview[unit]?.cost ?? null]));
    const costUnitPreview = computed.preview[spec.cost_unit];
    if (spec.cost_value > 0 && (!spec.cost_unit || !costUnitPreview || costUnitPreview.factor_to_base === null)) {
      if (status) {
        status.className = "product-spec-status error";
        status.textContent = "成本單位尚未接到基準單位，請先補換算規則。";
      }
      return;
    }
    const member = (typeof getMember === "function") ? getMember() : null;
    if (btn) {
      btn.disabled = true;
      btn.dataset.oldText = btn.textContent || "";
      btn.textContent = "儲存中...";
    }
    gas({
      type: "manageProductSpec",
      action: "update",
      product_id: spec.product_id,
      sku: spec.sku,
      operator: member ? `${member.id || ""}|${member.name || ""}` : "",
      spec_payload: JSON.stringify(spec)
    }, res => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.oldText || "儲存規格設定";
      }
      if (!res || res.status !== "ok") {
        if (status) {
          status.className = "product-spec-status error";
          status.textContent = res?.message || "規格設定儲存失敗。";
        } else {
          alert(res?.message || "規格設定儲存失敗。");
        }
        return;
      }
      productSpecCache[spec.product_id || spec.sku] = res.data || spec;
      if (status) {
        status.className = "product-spec-status ok";
        status.textContent = res.message || "規格設定已儲存。";
      }
    }, 30000);
  }

  function openProductSpecModal_(productId) {
    const product = getProductById_(productId);
    if (!product) return alert("找不到商品資料，請先重新載入商品主檔。");
    ensureProductSpecStyles_();
    const modal = ensureProductSpecModal_();
    const body = document.getElementById("productSpecModalBody");
    currentProductSpecProductId = String(productId || "");
    if (body) body.innerHTML = `<div class="purchase-preview-loading">規格設定載入中...</div>`;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    fetchProductSpec_(product).then(saved => {
      if (currentProductSpecProductId !== String(productId || "")) return;
      renderProductSpecForm_(product, saved);
    });
  }

  window.openProductSpecModal_ = openProductSpecModal_;
})();
