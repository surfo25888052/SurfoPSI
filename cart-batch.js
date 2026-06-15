// ===== cart-batch.js =====
// 電商購物車：批次貼上品名＋數量，先比對商品主檔，再一次加入購物車。
let BATCH_CART_PRODUCTS = [];
let BATCH_CART_ROWS = [];
let BATCH_CART_LOADING = false;

function batchCartText_(value) {
  return String(value == null ? "" : value).trim();
}

function batchCartEscapeHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function batchCartNormalizeKey_(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[臺]/g, "台")
    .replace(/[\s\u3000_\-－–—/\\()（）\[\]【】{}<>《》,，.。:：;；'\"「」『』·・、]/g, "")
    .trim();
}

function batchCartSafeNum_(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

function batchCartProductVisible_(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off", "n", "hide", "hidden"].includes(raw);
}

function batchCartNormalizeProducts_(res) {
  let list = res;
  if (list && Array.isArray(list.data)) list = list.data;
  if (!Array.isArray(list)) return [];
  return list.map(p => {
    const rawId = batchCartText_(p.product_id || p.raw_id || p.id);
    const sku = batchCartText_(p.sku || p.part_no || p.code || "");
    const cartKey = sku || rawId;
    return {
      id: cartKey,
      raw_id: rawId,
      product_id: rawId,
      sku: cartKey,
      name: batchCartText_(p.name || p.product_name || ""),
      category: batchCartText_(p.category || ""),
      unit: batchCartText_(p.unit || ""),
      price: batchCartSafeNum_(p.price, 0),
      shop_enabled: batchCartProductVisible_(p.shop_enabled != null ? p.shop_enabled : (p.show_in_shop != null ? p.show_in_shop : p.visible_in_shop))
    };
  }).filter(p => p.id && p.name && p.shop_enabled !== false);
}

function batchCartLoadProducts_(forceRefresh) {
  if (BATCH_CART_PRODUCTS.length && !forceRefresh) return Promise.resolve(BATCH_CART_PRODUCTS);

  const cached = !forceRefresh ? JSON.parse(localStorage.getItem("shop_products_cache") || "null") : null;
  const normalizedCache = batchCartNormalizeProducts_(cached);
  if (normalizedCache.length && !forceRefresh) {
    BATCH_CART_PRODUCTS = normalizedCache;
    return Promise.resolve(BATCH_CART_PRODUCTS);
  }

  if (typeof callGAS !== "function") {
    return Promise.reject(new Error("目前無法讀取商品主檔，請先回商城重新載入商品。"));
  }

  return new Promise((resolve, reject) => {
    callGAS({ type: "products", __options: { timeoutMs: 20000 } }, res => {
      const list = batchCartNormalizeProducts_(res);
      if (!list.length) {
        reject(new Error("商品主檔讀取失敗，請稍後再試。"));
        return;
      }
      BATCH_CART_PRODUCTS = list;
      try { localStorage.setItem("shop_products_cache", JSON.stringify(list)); } catch (e) {}
      resolve(BATCH_CART_PRODUCTS);
    });
  });
}

function batchCartNormalizeLine_(line) {
  return String(line || "")
    .replace(/[｜|]/g, " ")
    .replace(/[　\t]+/g, " ")
    .replace(/^[\s•‧・●○◦▪■□◆◇★☆※◎◉\-*＊×xX]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function batchCartShouldIgnoreLine_(line) {
  const s = batchCartNormalizeKey_(line);
  if (!s) return true;
  if (/^(品名|規格|數量|備註|主廚|經理|採購|製表|日期|年月日)+$/.test(s)) return true;
  if (s.indexOf("採購申請單") >= 0) return true;
  return false;
}

function batchCartParseLine_(line, lineNo) {
  const clean = batchCartNormalizeLine_(line);
  if (!clean || batchCartShouldIgnoreLine_(clean)) return null;

  const numberMatches = Array.from(clean.matchAll(/\d+(?:\.\d+)?/g));
  let qty = 1;
  let unit = "";
  let nameText = clean;
  let qtyWasGuessed = true;

  if (numberMatches.length) {
    const match = numberMatches[numberMatches.length - 1];
    const rawQty = match[0];
    const before = clean.slice(0, match.index).trim();
    const after = clean.slice(match.index + rawQty.length).trim();
    const unitMatch = after.match(/^(kg|kgs|公斤|公克|克|g|斤|台斤|包|盒|個|顆|支|把|袋|箱|瓶|罐|份|pcs|pc|片|條|尾)/i);

    // 只要數字在品名後方，或數字後方接常見單位，就視為數量。
    if (before || unitMatch) {
      qty = batchCartSafeNum_(rawQty, 1);
      unit = unitMatch ? unitMatch[1] : "";
      nameText = before || after.replace(unitMatch ? unitMatch[0] : "", "").trim();
      qtyWasGuessed = false;
    }
  }

  nameText = nameText
    .replace(/[：:,，]+$/g, "")
    .replace(/^(品名|商品|名稱)[:：\s]*/g, "")
    .trim();

  if (!nameText) return null;
  return {
    lineNo,
    original: clean,
    nameText,
    qty: batchCartNormalizeQtyForInput_(qty),
    unit,
    qtyWasGuessed,
    matches: [],
    selectedProductId: "",
    productFilter: "",
    removed: false
  };
}

function batchCartNormalizeQtyForInput_(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const normalized = typeof truncateCartDecimal === "function"
    ? truncateCartDecimal(n, 2)
    : Math.floor(n * 100) / 100;
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function batchCartSimilarityScore_(query, product) {
  const q = batchCartNormalizeKey_(query);
  const name = batchCartNormalizeKey_(product.name);
  const sku = batchCartNormalizeKey_(product.sku);
  if (!q || !name) return 0;
  if (q === name) return 120;
  if (sku && q === sku) return 115;
  if (name.startsWith(q) || q.startsWith(name)) return 100;
  if (name.includes(q) || q.includes(name)) return 88;

  // 簡單 bigram 相似度，處理少量 OCR 或手寫辨識錯字。
  const qChars = Array.from(new Set(q.split("")));
  if (!qChars.length) return 0;
  const hit = qChars.filter(ch => name.includes(ch)).length;
  const score = Math.round((hit / Math.max(q.length, name.length)) * 70);
  return score >= 32 ? score : 0;
}

function batchCartFindMatches_(query, products) {
  const q = batchCartNormalizeKey_(query);
  if (!q) return [];

  const scored = (Array.isArray(products) ? products : [])
    .map(product => ({ product, score: batchCartSimilarityScore_(query, product) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name), "zh-Hant"));

  // 精準／高可信候選優先；若沒有足夠候選，再放寬到相近候選。
  // 目的：下拉選單只顯示依原始文字推估的相關商品，避免整份商品主檔混入不相干選項。
  const strong = scored.filter(x => x.score >= 88);
  const medium = scored.filter(x => x.score >= 45);
  const fallback = scored.filter(x => x.score >= 32);
  const chosen = strong.length >= 2 ? strong : (medium.length ? medium : fallback);
  return chosen.slice(0, 18);
}

function batchCartParseText_(text, products) {
  const lines = String(text || "").split(/\r?\n/);
  const rows = [];
  lines.forEach((line, idx) => {
    const row = batchCartParseLine_(line, idx + 1);
    if (!row) return;
    row.matches = batchCartFindMatches_(row.nameText, products);
    row.selectedProductId = row.matches.length ? row.matches[0].product.id : "";
    rows.push(row);
  });
  return rows;
}

function batchCartSetStatus_(message, tone) {
  const el = document.getElementById("batchCartStatus");
  if (!el) return;
  const text = String(message || "").trim();
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.className = "cart-batch-status";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `cart-batch-status ${tone || "info"}`.trim();
}

function batchCartProductLabel_(product) {
  const p = product || {};
  return `${p.name || ""}${p.unit ? ` / ${p.unit}` : ""}${p.sku ? `（${p.sku}）` : ""}`;
}

function batchCartProductSort_(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant") || String(a.sku || "").localeCompare(String(b.sku || ""));
}

function batchCartProductMatchesFilter_(product, filterText) {
  const q = batchCartNormalizeKey_(filterText);
  if (!q) return true;
  const p = product || {};
  const combined = batchCartNormalizeKey_([p.name, p.sku, p.category, p.unit].filter(Boolean).join(" "));
  if (combined.includes(q) || q.includes(combined)) return true;
  return batchCartSimilarityScore_(filterText, p) > 0;
}

function batchCartOptionForProduct_(product, selectedId) {
  if (!product) return "";
  const selected = String(selectedId || "");
  return `<option value="${batchCartEscapeHtml_(product.id)}"${String(product.id) === selected ? " selected" : ""}>${batchCartEscapeHtml_(batchCartProductLabel_(product))}</option>`;
}

function batchCartProductOptionsForRow_(row) {
  row = row || {};
  const selectedId = String(row.selectedProductId || "");
  const selectedProduct = selectedId ? batchCartProductById_(selectedId) : null;
  const seen = {};
  const parts = [`<option value="">請選擇商品</option>`];

  const pushProduct_ = (product) => {
    if (!product || !product.id || seen[String(product.id)]) return false;
    seen[String(product.id)] = true;
    parts.push(batchCartOptionForProduct_(product, selectedId));
    return true;
  };

  if (selectedProduct) {
    pushProduct_(selectedProduct);
  }

  const matches = Array.isArray(row.matches) ? row.matches : [];
  if (matches.length) {
    parts.push(`<option disabled>依「${batchCartEscapeHtml_(row.nameText || row.original || "原始文字")}」自動篩選候選</option>`);
    matches.forEach(m => pushProduct_(m && m.product));
  } else {
    parts.push(`<option disabled>沒有相近商品，請修正原始文字後重新解析</option>`);
  }

  return parts.join("");
}

function batchCartAllProductOptions_(selectedId) {
  return batchCartProductOptionsForRow_({ selectedProductId: selectedId, productFilter: "", matches: [] });
}

function batchCartSelectedUnitText_(selectedProductId, fallbackUnit) {
  const product = batchCartProductById_(selectedProductId);
  const productUnit = batchCartText_(product && product.unit);
  const parsedUnit = batchCartText_(fallbackUnit);
  return productUnit || parsedUnit || "—";
}

function batchCartUpdateUnitBadges_() {
  const rows = BATCH_CART_ROWS.filter(row => !row.removed);
  rows.forEach(row => {
    const badge = document.querySelector(`[data-batch-unit="${row.lineNo}"]`);
    const select = document.querySelector(`[data-batch-product="${row.lineNo}"]`);
    if (!badge) return;
    const selectedId = select ? select.value : row.selectedProductId;
    const unitText = batchCartSelectedUnitText_(selectedId, row.unit);
    badge.textContent = unitText;
    badge.className = `cart-batch-unit ${unitText === "—" ? "is-empty" : ""}`.trim();
  });
}

function batchCartRenderPreview_() {
  const preview = document.getElementById("batchCartPreview");
  if (!preview) return;
  const rows = BATCH_CART_ROWS.filter(row => !row.removed);
  if (!rows.length) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }

  const unresolved = rows.filter(row => !row.selectedProductId).length;
  preview.hidden = false;
  preview.innerHTML = `
    <div class="cart-batch-preview__head">
      <strong>辨識結果：${rows.length} 項</strong>
      <span>${unresolved ? `尚有 ${unresolved} 項未選商品；下拉選單已隱藏不相干商品` : "系統已依原始文字篩出候選，請確認商品與數量後加入購物車"}</span>
    </div>
    <div class="cart-batch-table-wrap">
      <table class="cart-batch-table">
        <thead>
          <tr><th>原始品名</th><th>比對商品</th><th>數量</th><th>狀態</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${rows.map((row, visibleIndex) => batchCartRenderRow_(row, visibleIndex)).join("")}
        </tbody>
      </table>
    </div>
    <div class="cart-batch-confirm-row">
      <button type="button" class="cart-batch-primary" id="batchCartConfirm">確認加入購物車</button>
      <button type="button" class="cart-batch-secondary" id="batchCartReAnalyze">重新解析</button>
    </div>
  `;

  preview.querySelectorAll("[data-batch-product]").forEach(select => {
    select.addEventListener("change", () => {
      const lineNo = Number(select.getAttribute("data-batch-product"));
      const row = BATCH_CART_ROWS.find(x => x.lineNo === lineNo);
      if (row) row.selectedProductId = select.value;
      batchCartRefreshRowStatus_();
      batchCartUpdateUnitBadges_();
    });
  });
  preview.querySelectorAll("[data-batch-qty]").forEach(input => {
    input.addEventListener("change", () => {
      const lineNo = Number(input.getAttribute("data-batch-qty"));
      const row = BATCH_CART_ROWS.find(x => x.lineNo === lineNo);
      if (row) row.qty = batchCartNormalizeQtyForInput_(input.value);
      input.value = row ? row.qty : input.value;
    });
  });
  preview.querySelectorAll("[data-batch-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const lineNo = Number(btn.getAttribute("data-batch-remove"));
      const row = BATCH_CART_ROWS.find(x => x.lineNo === lineNo);
      if (row) row.removed = true;
      batchCartRenderPreview_();
    });
  });

  const confirmBtn = document.getElementById("batchCartConfirm");
  if (confirmBtn) confirmBtn.addEventListener("click", batchCartAddConfirmedRows_);
  const reAnalyzeBtn = document.getElementById("batchCartReAnalyze");
  if (reAnalyzeBtn) reAnalyzeBtn.addEventListener("click", batchCartAnalyzeText_);
  batchCartRefreshRowStatus_();
  batchCartUpdateUnitBadges_();
}

function batchCartRenderRow_(row) {
  const selectedId = String(row.selectedProductId || "");
  const options = batchCartProductOptionsForRow_(row);
  const score = row.matches.length ? row.matches[0].score : 0;
  const statusText = !row.selectedProductId
    ? "待選商品"
    : (row.qtyWasGuessed ? "數量預設 1，請確認" : (score >= 100 ? "已精準比對" : "候選比對，請確認"));
  const statusClass = !row.selectedProductId ? "warn" : (score >= 100 && !row.qtyWasGuessed ? "ok" : "info");

  return `
    <tr data-batch-line="${row.lineNo}">
      <td>
        <div class="cart-batch-original">${batchCartEscapeHtml_(row.nameText)}</div>
        <div class="cart-batch-raw">${batchCartEscapeHtml_(row.original)}</div>
      </td>
      <td>
        <div class="cart-batch-product-cell">
          <select class="cart-batch-product-select" data-batch-product="${row.lineNo}">${options}</select>
          <div class="cart-batch-match-hint">只顯示依原始品名自動判定的候選商品</div>
        </div>
      </td>
      <td>
        <div class="cart-batch-qty-unit-wrap">
          <input class="cart-batch-qty-input" data-batch-qty="${row.lineNo}" type="number" min="0.01" step="0.01" value="${batchCartEscapeHtml_(row.qty)}">
          <span class="cart-batch-unit" data-batch-unit="${row.lineNo}">${batchCartEscapeHtml_(batchCartSelectedUnitText_(row.selectedProductId, row.unit))}</span>
        </div>
      </td>
      <td><span class="cart-batch-row-status ${statusClass}" data-batch-status="${row.lineNo}">${batchCartEscapeHtml_(statusText)}</span></td>
      <td><button type="button" class="cart-batch-row-remove" data-batch-remove="${row.lineNo}">移除</button></td>
    </tr>
  `;
}

function batchCartRefreshRowStatus_() {
  const rows = BATCH_CART_ROWS.filter(row => !row.removed);
  rows.forEach(row => {
    const status = document.querySelector(`[data-batch-status="${row.lineNo}"]`);
    if (!status) return;
    const select = document.querySelector(`[data-batch-product="${row.lineNo}"]`);
    row.selectedProductId = select ? select.value : row.selectedProductId;
    const score = row.matches.length ? row.matches[0].score : 0;
    const text = !row.selectedProductId
      ? "待選商品"
      : (row.qtyWasGuessed ? "數量預設 1，請確認" : (score >= 100 ? "已精準比對" : "候選比對，請確認"));
    status.textContent = text;
    status.className = `cart-batch-row-status ${!row.selectedProductId ? "warn" : (score >= 100 && !row.qtyWasGuessed ? "ok" : "info")}`;
  });
}

function batchCartProductById_(id) {
  const target = String(id || "");
  return (BATCH_CART_PRODUCTS || []).find(p => String(p.id) === target) || null;
}

function batchCartAddConfirmedRows_() {
  const rows = BATCH_CART_ROWS.filter(row => !row.removed);
  if (!rows.length) {
    batchCartSetStatus_("沒有可加入的品項。", "warn");
    return;
  }

  const skipped = [];
  let addedCount = 0;
  const cart = getCart() || [];

  rows.forEach(row => {
    const product = batchCartProductById_(row.selectedProductId);
    const qty = typeof normalizeCartQty === "function" ? normalizeCartQty(row.qty) : Math.max(1, Math.floor((Number(row.qty) || 1) * 100) / 100);
    if (!product || !(qty > 0)) {
      skipped.push(row.nameText);
      return;
    }
    const itemId = String(product.sku || product.id || product.raw_id);
    const exist = cart.find(item => String(item.id) === itemId || (product.raw_id && String(item.product_id || "") === String(product.raw_id)));
    if (exist) {
      exist.qty = (typeof normalizeCartQty === "function") ? normalizeCartQty(Number(exist.qty || 0) + qty) : (Number(exist.qty || 0) + qty);
    } else {
      cart.push({
        id: itemId,
        sku: product.sku || itemId,
        product_id: product.raw_id || product.product_id || "",
        name: product.name,
        price: batchCartSafeNum_(product.price, 0),
        qty: qty
      });
    }
    addedCount += 1;
  });

  if (!addedCount) {
    batchCartSetStatus_("尚未選擇可加入購物車的商品。", "warn");
    return;
  }

  setCart(cart);
  if (typeof updateCartCount === "function") updateCartCount();
  if (typeof renderCart === "function") renderCart();
  batchCartSetStatus_(`已加入 ${addedCount} 項商品${skipped.length ? `，略過 ${skipped.length} 項未選商品` : ""}。`, skipped.length ? "warn" : "success");

  BATCH_CART_ROWS = [];
  const preview = document.getElementById("batchCartPreview");
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = "";
  }
}

function batchCartSetLoading_(loading) {
  BATCH_CART_LOADING = !!loading;
  const analyzeBtn = document.getElementById("batchCartAnalyze");
  if (analyzeBtn) {
    analyzeBtn.disabled = BATCH_CART_LOADING;
    analyzeBtn.textContent = BATCH_CART_LOADING ? "商品主檔讀取中…" : "解析並比對商品";
  }
}

function batchCartAnalyzeText_() {
  if (BATCH_CART_LOADING) return;
  const textarea = document.getElementById("batchCartText");
  const text = textarea ? textarea.value : "";
  if (!String(text || "").trim()) {
    batchCartSetStatus_("請先貼上品名與數量。", "warn");
    return;
  }

  batchCartSetLoading_(true);
  batchCartSetStatus_("正在讀取商品主檔並比對…", "info");
  batchCartLoadProducts_(false)
    .then(products => {
      BATCH_CART_ROWS = batchCartParseText_(text, products);
      if (!BATCH_CART_ROWS.length) {
        batchCartSetStatus_("沒有辨識到可加入的品項，請確認每行是否包含品名與數量。", "warn");
        batchCartRenderPreview_();
        return;
      }
      const unmatched = BATCH_CART_ROWS.filter(row => !row.selectedProductId).length;
      batchCartSetStatus_(unmatched ? `已辨識 ${BATCH_CART_ROWS.length} 項，尚有 ${unmatched} 項沒有相近商品；其餘下拉選單已自動隱藏不相干選項。` : `已辨識 ${BATCH_CART_ROWS.length} 項，系統已自動篩出候選商品，請確認後加入購物車。`, unmatched ? "warn" : "success");
      batchCartRenderPreview_();
    })
    .catch(err => {
      batchCartSetStatus_(String(err && err.message || err || "批次解析失敗"), "error");
    })
    .finally(() => batchCartSetLoading_(false));
}

function initBatchCartTools() {
  const toggleBtn = document.getElementById("batchCartToggle");
  const body = document.getElementById("batchCartBody");
  const analyzeBtn = document.getElementById("batchCartAnalyze");
  const clearBtn = document.getElementById("batchCartClear");
  if (!toggleBtn || !body || !analyzeBtn) return;

  if (window.location.hash === "#batch") {
    body.hidden = false;
    toggleBtn.textContent = "收合批次加入";
  }

  toggleBtn.addEventListener("click", () => {
    body.hidden = !body.hidden;
    toggleBtn.textContent = body.hidden ? "開啟批次加入" : "收合批次加入";
    if (!body.hidden) {
      const textarea = document.getElementById("batchCartText");
      if (textarea) setTimeout(() => textarea.focus(), 0);
    }
  });

  analyzeBtn.addEventListener("click", batchCartAnalyzeText_);
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const textarea = document.getElementById("batchCartText");
      if (textarea) textarea.value = "";
      BATCH_CART_ROWS = [];
      batchCartSetStatus_("", "info");
      batchCartRenderPreview_();
    });
  }
}
