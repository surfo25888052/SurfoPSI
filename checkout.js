// ===== checkout.js =====
const CHECKOUT_PENDING_KEY = "checkout_pending_order";
let checkoutSubmitting_ = false;
let checkoutPollTimer_ = null;
let checkoutFallbackLookupRunning_ = false;

function renderCheckoutCart() {
  const container = document.getElementById("checkout-cart");
  if (!container) return;
  const cart = getCart();
  container.innerHTML = "";

  cart.forEach(item => {
    const div = document.createElement("div");
    div.className = "checkout-item";
    div.innerHTML = `
      <span>${item.name}</span>
      <span>數量: ${item.qty}</span>
      <span>小計: $${item.price * item.qty}</span>
    `;
    container.appendChild(div);
  });

  calculateTotal();
}

function calculateTotal() {
  const totalEl = document.getElementById("checkout-total");
  if (!totalEl) return;
  const total = getCart().reduce((sum, i) => sum + i.price * i.qty, 0);
  totalEl.textContent = `總計: $${total}`;
}

function prefillCustomerFields() {
  const member = getMember();
  if (!member) return;
  const nameEl = document.getElementById("checkoutName");
  const phoneEl = document.getElementById("checkoutPhone");
  const addrEl = document.getElementById("checkoutAddress");
  if (nameEl && !nameEl.value.trim()) nameEl.value = member.name || "";
  if (phoneEl && !phoneEl.value.trim()) phoneEl.value = member.phone || "";
  if (addrEl && !addrEl.value.trim()) addrEl.value = member.address || "";
}

function pad2_(n) { return String(n).padStart(2, "0"); }

function toLocalISODate_(date) {
  return `${date.getFullYear()}-${pad2_(date.getMonth() + 1)}-${pad2_(date.getDate())}`;
}

function normalizeDateOnly_(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function addDaysLocal_(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function isWeekendDate_(value) {
  const iso = normalizeDateOnly_(value);
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getEarliestShipDate_() {
  const today = new Date();
  let d = addDaysLocal_(today, 2);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDaysLocal_(d, 1);
  return toLocalISODate_(d);
}

function normalizeShipDate_(value) {
  let iso = normalizeDateOnly_(value) || getEarliestShipDate_();
  const minIso = getEarliestShipDate_();
  let d = new Date(`${iso}T00:00:00`);
  const minD = new Date(`${minIso}T00:00:00`);
  if (d < minD) d = minD;
  while (d.getDay() === 0 || d.getDay() === 6) d = addDaysLocal_(d, 1);
  return toLocalISODate_(d);
}

function setupShipDateField() {
  const dateEl = document.getElementById("checkoutShipDate");
  const hintEl = document.getElementById("checkoutShipDateHint");
  if (!dateEl) return;
  const earliest = getEarliestShipDate_();
  dateEl.min = earliest;
  if (!normalizeDateOnly_(dateEl.value)) dateEl.value = earliest;
  else dateEl.value = normalizeShipDate_(dateEl.value);
  if (hintEl) hintEl.textContent = `最早可選日期為 ${earliest}，且週六、週日不可選。`;

  dateEl.addEventListener("change", () => {
    const picked = normalizeDateOnly_(dateEl.value);
    const normalized = normalizeShipDate_(picked);
    if (!picked || picked !== normalized || isWeekendDate_(picked)) {
      alert(`出貨日期只能選擇 ${earliest} 之後的平日，週六、週日不可選。`);
      dateEl.value = normalized;
    }
  });
}

function generateCheckoutRequestToken_() {
  return `REQ_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getCheckoutSubmitButton_() {
  return document.querySelector('#checkoutForm button[type="submit"]');
}

function escapeCheckoutHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setCheckoutStatus_(message, tone) {
  const box = document.getElementById("checkoutStatus");
  if (!box) return;
  const text = String(message || "").trim();
  if (!text) {
    box.hidden = true;
    box.textContent = "";
    box.className = "checkout-status";
    return;
  }
  box.hidden = false;
  box.textContent = text;
  box.className = `checkout-status ${tone || "info"}`.trim();
}

function setCheckoutStatusActions_(message, tone, actions) {
  const box = document.getElementById("checkoutStatus");
  if (!box) return;
  const text = String(message || "").trim();
  if (!text) return setCheckoutStatus_("", tone);
  const list = Array.isArray(actions) ? actions : [];
  box.hidden = false;
  box.className = `checkout-status ${tone || "info"}`.trim();
  box.innerHTML = `
    <div class="checkout-status-message">${escapeCheckoutHtml_(text)}</div>
    ${list.length ? `<div class="checkout-status-actions">${list.map((a, i) => `
      <button type="button" class="checkout-status-btn ${escapeCheckoutHtml_(a.className || "")}" data-checkout-action="${i}">${escapeCheckoutHtml_(a.label || "執行")}</button>
    `).join("")}</div>` : ""}
  `;
  box.querySelectorAll("[data-checkout-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-checkout-action"));
      const action = list[idx];
      if (action && typeof action.handler === "function") action.handler();
    });
  });
}

function setCheckoutSubmittingState_(isSubmitting, label) {
  checkoutSubmitting_ = !!isSubmitting;
  const btn = getCheckoutSubmitButton_();
  if (btn) {
    if (!btn.dataset.defaultLabel) btn.dataset.defaultLabel = btn.textContent || "送出訂單";
    btn.disabled = !!isSubmitting;
    btn.textContent = isSubmitting ? (label || "訂單送出中…") : (btn.dataset.defaultLabel || "送出訂單");
  }
}

function savePendingCheckout_(payload) {
  const raw = JSON.stringify(payload || {});
  try { sessionStorage.setItem(CHECKOUT_PENDING_KEY, raw); } catch (e) {}
  try { localStorage.setItem(CHECKOUT_PENDING_KEY, raw); } catch (e) {}
}

function readPendingCheckout_() {
  try {
    const raw = localStorage.getItem(CHECKOUT_PENDING_KEY) || sessionStorage.getItem(CHECKOUT_PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearPendingCheckout_() {
  try { sessionStorage.removeItem(CHECKOUT_PENDING_KEY); } catch (e) {}
  try { localStorage.removeItem(CHECKOUT_PENDING_KEY); } catch (e) {}
}

function discardPendingCheckout_(options) {
  const opts = options || {};
  stopCheckoutPolling_();
  clearPendingCheckout_();
  setCheckoutSubmittingState_(false);
  if (opts.clearCart) {
    setCart([]);
    updateCartCount();
    renderCheckoutCart();
  }
  setCheckoutStatus_(opts.message || "已清除上一筆失敗送單紀錄，可以重新選購或送出新的訂單。", "info");
}

function discardPendingAndSubmitCurrentCart_() {
  discardPendingCheckout_({ message: "已清除上一筆失敗送單紀錄，正在送出目前購物車。" });
  setTimeout(() => {
    const form = document.getElementById("checkoutForm");
    if (form && typeof form.requestSubmit === "function") form.requestSubmit();
  }, 0);
}

function stopCheckoutPolling_() {
  if (checkoutPollTimer_) {
    clearTimeout(checkoutPollTimer_);
    checkoutPollTimer_ = null;
  }
  checkoutFallbackLookupRunning_ = false;
}

function updatePendingCheckout_(patch) {
  const current = readPendingCheckout_() || {};
  savePendingCheckout_(Object.assign({}, current, patch || {}));
}

function restoreCartFromPending_(pending) {
  if (!pending || !Array.isArray(pending.cart) || !pending.cart.length) return false;
  setCart(pending.cart);
  updateCartCount();
  renderCheckoutCart();
  return true;
}

function redirectOrderSuccess_(orderId, total) {
  stopCheckoutPolling_();
  setCheckoutStatus_("訂單已成立，正在跳轉成功頁…", "success");
  clearPendingCheckout_();
  localStorage.removeItem("cart");
  updateCartCount();
  window.location.href = `order-success.html?order_id=${encodeURIComponent(orderId || "")}&total=${encodeURIComponent(total || 0)}`;
}

function normalizeCheckoutPhone_(value) {
  return String(value || "").replace(/[^0-9]/g, "").trim();
}

function normalizeCheckoutAddress_(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeCheckoutItemsForCompare_(items) {
  let list = items;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch (e) { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map(it => ({
    id: String(it?.sku || it?.product_id || it?.id || "").trim(),
    qty: Number(it?.qty || it?.quantity || 0),
    price: Number(it?.price || 0),
    name: String(it?.name || it?.product_name || "").trim()
  })).filter(it => it.id && it.qty > 0).sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return a.qty - b.qty;
  });
}

function buildCheckoutCartSignature_(items) {
  const normalized = normalizeCheckoutItemsForCompare_(items);
  return normalized.map(it => `${it.id}:${it.qty}:${Number.isFinite(it.price) ? it.price : 0}`).join("|");
}

function calculateCheckoutCartTotal_(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, it) => {
    const qty = Number(it?.qty || it?.quantity || 0);
    const price = Number(it?.price || 0);
    return sum + ((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0));
  }, 0);
}

function getCheckoutItemKey_(item) {
  const it = item || {};
  return String(it.sku || it.id || it.product_id || it.productInternalId || "").trim();
}

function formatCheckoutCompactNumber_(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function buildCheckoutCartCompactText_(items) {
  const rows = (Array.isArray(items) ? items : []).map(it => {
    const key = getCheckoutItemKey_(it);
    const qty = formatCheckoutCompactNumber_(it?.qty || it?.quantity || 0);
    const price = formatCheckoutCompactNumber_(it?.price || 0);
    if (!key || Number(qty) <= 0) return "";
    return [key, qty, price].join("~");
  }).filter(Boolean);
  return rows.join(";");
}

function buildPendingCheckoutPayload_(requestToken, data) {
  const member = data?.member || getMember() || {};
  const cart = Array.isArray(data?.cart) ? data.cart : getCart();
  return {
    request_token: String(requestToken || "").trim(),
    created_at: Number(data?.created_at || Date.now()),
    member_id: String(data?.member_id || member?.id || "").trim(),
    name: String(data?.name || "").trim(),
    phone: String(data?.phone || "").trim(),
    address: String(data?.address || "").trim(),
    shipping_date: normalizeShipDate_(data?.shipping_date || ""),
    total: Number(data?.total != null ? data.total : calculateCheckoutCartTotal_(cart)) || 0,
    cart_signature: buildCheckoutCartSignature_(cart),
    cart: cart
  };
}

function buildOrderRequestFromPending_(pending) {
  const p = pending || {};
  const cart = Array.isArray(p.cart) && p.cart.length ? p.cart : getCart();
  const member = getMember() || {};
  return {
    type: "order",
    member_id: String(p.member_id || member?.id || "").trim(),
    name: String(p.name || "").trim(),
    phone: String(p.phone || "").trim(),
    address: String(p.address || "").trim(),
    shipping_date: normalizeShipDate_(p.shipping_date || ""),
    request_token: String(p.request_token || "").trim(),
    cart_compact: buildCheckoutCartCompactText_(cart)
  };
}

function showCheckoutTimeoutRecovery_(message) {
  stopCheckoutPolling_();
  setCheckoutSubmittingState_(false);
  updatePendingCheckout_({
    state: "timeout",
    last_error: "TIMEOUT",
    last_timeout_at: Date.now()
  });
  setCheckoutStatusActions_(message || "送單逾時。原購物車已保留在待重送資料中。可按「重新送單」用同一筆送單碼重送；若已改由其他電腦完成訂單，請按「清除失敗紀錄」後建立新訂單。", "error", [
    { label: "重新送單", className: "primary", handler: () => resendPendingCheckout_() },
    { label: "檢查訂單狀態", className: "secondary", handler: () => checkPendingCheckoutStatus_() },
    { label: "清除失敗紀錄", className: "secondary", handler: () => discardPendingCheckout_() }
  ]);
}

function showPendingCheckoutRecovery_(message) {
  const pending = readPendingCheckout_();
  if (!pending || !pending.request_token) return;
  stopCheckoutPolling_();
  setCheckoutSubmittingState_(false);
  setCheckoutStatusActions_(message || "偵測到上一筆訂單尚未完成。可按「重新送單」用同一筆送單碼重送，或先檢查訂單是否已成立；若已在其他電腦完成訂單，請清除失敗紀錄後建立新訂單。", "error", [
    { label: "重新送單", className: "primary", handler: () => resendPendingCheckout_() },
    { label: "檢查訂單狀態", className: "secondary", handler: () => checkPendingCheckoutStatus_() },
    { label: "清除失敗紀錄", className: "secondary", handler: () => discardPendingCheckout_() }
  ]);
}

function checkPendingCheckoutStatus_() {
  const pending = readPendingCheckout_();
  if (!pending || !pending.request_token) {
    setCheckoutStatus_("目前沒有待確認的訂單。", "info");
    return;
  }
  setCheckoutSubmittingState_(true, "檢查中…");
  setCheckoutStatus_("正在檢查這筆訂單是否已成立…", "pending");
  callGAS({
    type: "orderStatusByToken",
    request_token: pending.request_token,
    __options: {
      timeoutMs: 20000,
      onTimeout: () => showCheckoutTimeoutRecovery_("檢查訂單狀態逾時。請按「重新送單」使用同一筆送單碼重新送出。"),
      onError: () => showCheckoutTimeoutRecovery_("檢查訂單狀態時連線異常。請按「重新送單」使用同一筆送單碼重新送出。")
    }
  }, res => {
    if (res && res.status === "ok" && String(res.order_id || "").trim()) {
      redirectOrderSuccess_(res.order_id, res.total || pending.total || 0);
      return;
    }
    confirmPendingCheckoutByMyOrders_(pending, "尚未透過送單碼查到訂單，正在從我的訂單交叉確認…");
    showCheckoutTimeoutRecovery_("目前尚未查到訂單成立。請按「重新送單」用同一筆送單碼重送，不需要重新選購。 ");
  });
}

function resendPendingCheckout_() {
  if (checkoutSubmitting_) return;
  const pending = readPendingCheckout_();
  if (!pending || !pending.request_token) {
    setCheckoutStatus_("找不到可重送的訂單資料，請確認購物車內容後再送出。", "error");
    return;
  }
  const cart = Array.isArray(pending.cart) && pending.cart.length ? pending.cart : getCart();
  if (!cart.length) {
    setCheckoutStatus_("購物車資料已遺失，無法重新送單。", "error");
    return;
  }
  pending.cart = cart;
  pending.cart_signature = buildCheckoutCartSignature_(cart);
  pending.total = calculateCheckoutCartTotal_(cart);
  savePendingCheckout_(pending);
  restoreCartFromPending_(pending);
  setCheckoutSubmittingState_(true, "重新送單中…");
  setCheckoutStatus_("正在使用同一筆送單碼重新送單，請勿重複點擊。", "pending");
  callGAS(Object.assign(buildOrderRequestFromPending_(pending), {
    __options: {
      timeoutMs: 45000,
      onTimeout: () => showCheckoutTimeoutRecovery_("重新送單逾時。請稍後再按「重新送單」，系統仍會使用同一筆送單碼避免重複訂單。"),
      onError: () => showCheckoutTimeoutRecovery_("重新送單時連線異常。請稍後再按「重新送單」，不用重新選購。")
    }
  }), res => {
    if (res && res.status === "ok") {
      redirectOrderSuccess_(res.order_id, res.total || pending.total || 0);
      return;
    }
    if (res && (res.code === "TIMEOUT" || res.code === "NETWORK_ERROR")) {
      showCheckoutTimeoutRecovery_("重新送單逾時或連線異常。請稍後再按「重新送單」，不用重新選購。");
      return;
    }
    clearPendingCheckout_();
    setCheckoutSubmittingState_(false);
    setCheckoutStatus_((res && res.message) || "重新送單失敗，請檢查資料後再試。", "error");
    alert((res && res.message) || "重新送單失敗");
  });
}

function findMatchingRecentOrder_(orders, pending) {
  const list = Array.isArray(orders) ? orders.slice() : [];
  const targetToken = String(pending?.request_token || "").trim();
  const targetShipDate = normalizeDateOnly_(pending?.shipping_date || "");
  const targetPhone = normalizeCheckoutPhone_(pending?.phone || "");
  const targetAddress = normalizeCheckoutAddress_(pending?.address || "");
  const targetName = String(pending?.name || "").trim();
  const targetTotal = Number(pending?.total || 0);
  const targetSignature = String(pending?.cart_signature || buildCheckoutCartSignature_(pending?.cart || [])).trim();
  const submittedAt = Number(pending?.created_at || 0);

  if (targetToken) {
    const directHit = list.find(order => String(order?.request_token || "").trim() === targetToken && String(order?.order_id || "").trim());
    if (directHit) return directHit;
  }

  const scoreOrder = (order) => {
    let score = 0;
    const orderShipDate = normalizeDateOnly_(order?.shipping_date || "");
    const orderPhone = normalizeCheckoutPhone_(order?.phone || "");
    const orderAddress = normalizeCheckoutAddress_(order?.address || "");
    const orderName = String(order?.name || "").trim();
    const orderTotal = Number(order?.total || 0);
    const orderSignature = buildCheckoutCartSignature_(order?.items || []);
    if (targetSignature && orderSignature && orderSignature === targetSignature) score += 8;
    if (targetShipDate && orderShipDate === targetShipDate) score += 3;
    if (targetPhone && orderPhone && orderPhone === targetPhone) score += 2;
    if (targetAddress && orderAddress && orderAddress === targetAddress) score += 2;
    if (targetName && orderName && orderName === targetName) score += 1;
    if (Math.abs(orderTotal - targetTotal) < 0.0001) score += 4;
    if (submittedAt) {
      const orderTime = Date.parse(String(order?.date || "").replace(/\//g, "-"));
      if (Number.isFinite(orderTime) && Math.abs(orderTime - submittedAt) <= 20 * 60 * 1000) score += 2;
    }
    return score;
  };

  const ranked = list.map(order => ({ order, score: scoreOrder(order) }))
    .filter(entry => entry.score >= 7)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.order?.order_id || "").localeCompare(String(a.order?.order_id || ""));
    });

  return ranked.length ? ranked[0].order : null;
}

function confirmPendingCheckoutByMyOrders_(pending, reason) {
  if (checkoutFallbackLookupRunning_) return;
  const memberId = String(pending?.member_id || getMember()?.id || "").trim();
  if (!memberId) return;
  checkoutFallbackLookupRunning_ = true;
  setCheckoutStatus_(reason || "正在從我的訂單確認是否已成立，請勿重複下單。", "pending");
  callGAS({
    type: "myOrders",
    member_id: memberId,
    __options: { timeoutMs: 30000 }
  }, res => {
    checkoutFallbackLookupRunning_ = false;
    if (res && res.status === "ok") {
      const hit = findMatchingRecentOrder_(res.orders, pending);
      if (hit && String(hit.order_id || "").trim()) {
        redirectOrderSuccess_(hit.order_id, hit.total || pending?.total || 0);
        return;
      }
    }
  });
}

function continuePendingCheckout_(requestToken, message) {
  if (!requestToken) return;
  checkPendingCheckoutStatus_();
  if (message) setCheckoutStatus_(message, "pending");
}

function pollOrderByToken_(requestToken, attempt) {
  if (!requestToken) return;
  const currentAttempt = Number(attempt || 0);
  const pending = readPendingCheckout_();
  if (checkoutPollTimer_) {
    clearTimeout(checkoutPollTimer_);
    checkoutPollTimer_ = null;
  }
  setCheckoutSubmittingState_(true, "確認訂單中…");
  setCheckoutStatus_("系統正在確認訂單是否已建立，送出按鈕已鎖定，請勿重複下單。", "pending");

  callGAS({
    type: "orderStatusByToken",
    request_token: requestToken,
    __options: { timeoutMs: 30000 }
  }, res => {
    if (res && res.status === "ok" && String(res.order_id || "").trim()) {
      return redirectOrderSuccess_(res.order_id, res.total || 0);
    }

    const nextDelay = currentAttempt < 10 ? 3000 : 5000;
    if (res && res.status === "error") {
      confirmPendingCheckoutByMyOrders_(pending, "request_token 查單失敗，正在改用我的訂單交叉確認，請勿重複下單。");
      if (res.code === "TIMEOUT") {
        setCheckoutStatus_("確認訂單狀態逾時，系統將自動重試並同步檢查我的訂單，請勿重複下單。", "pending");
      } else if (res.code === "NETWORK_ERROR") {
        setCheckoutStatus_("系統連線不穩，正在重新確認訂單狀態並同步檢查我的訂單，請勿重複下單。", "pending");
      } else {
        setCheckoutStatus_((res.message || "request_token 查單失敗") + "，正在改用我的訂單交叉確認，請勿重複下單。", "pending");
      }
    } else if (res && res.code === "TIMEOUT") {
      confirmPendingCheckoutByMyOrders_(pending, "確認訂單狀態逾時，正在改用我的訂單交叉確認，請勿重複下單。");
      setCheckoutStatus_("確認訂單狀態逾時，系統將自動重試中，請勿重複下單。", "pending");
    } else if (res && res.code === "NETWORK_ERROR") {
      confirmPendingCheckoutByMyOrders_(pending, "系統連線不穩，正在改用我的訂單交叉確認，請勿重複下單。");
      setCheckoutStatus_("系統連線不穩，正在重新確認訂單狀態，請勿重複下單。", "pending");
    } else if (currentAttempt % 3 === 0) {
      confirmPendingCheckoutByMyOrders_(pending, "系統正在同步檢查我的訂單是否已成立，請勿重複下單。");
    }

    if (currentAttempt >= 20) {
      confirmPendingCheckoutByMyOrders_(pending, "系統仍在確認此筆訂單，正在同步我的訂單。");
      showCheckoutTimeoutRecovery_("確認訂單狀態逾時。請按「重新送單」使用同一筆送單碼重新送出，不需要重新選購。 ");
      return;
    }

    checkoutPollTimer_ = setTimeout(() => pollOrderByToken_(requestToken, currentAttempt + 1), nextDelay);
  });
}

function restorePendingCheckout_() {
  const pending = readPendingCheckout_();
  if (!pending || !pending.request_token) return;
  showPendingCheckoutRecovery_("偵測到上一筆訂單尚未完成。系統不會再自動把舊購物車灌回來；需要續送才按「重新送單」，若已在其他電腦完成訂單，請按「清除失敗紀錄」。 ");
}

function submitOrder(event) {
  event.preventDefault();
  if (checkoutSubmitting_) return;

  const pending = readPendingCheckout_();
  if (pending && pending.request_token) {
    stopCheckoutPolling_();
    setCheckoutSubmittingState_(false);
    const currentCart = getCart();
    const hasCurrentCart = Array.isArray(currentCart) && currentCart.length > 0;
    setCheckoutStatusActions_(
      hasCurrentCart
        ? "上一筆送單失敗紀錄尚未清除。若要繼續上一筆，請按「重新送單」；若要送出目前購物車，請先清除舊失敗紀錄。"
        : "上一筆送單失敗紀錄尚未清除。若已在其他電腦完成訂單，請清除失敗紀錄後重新選購。",
      "error",
      [
        { label: "重新送單", className: "primary", handler: () => resendPendingCheckout_() },
        { label: "檢查訂單狀態", className: "secondary", handler: () => checkPendingCheckoutStatus_() },
        hasCurrentCart
          ? { label: "清除舊紀錄並送出目前購物車", className: "secondary", handler: () => discardPendingAndSubmitCurrentCart_() }
          : { label: "清除失敗紀錄", className: "secondary", handler: () => discardPendingCheckout_() }
      ]
    );
    return;
  }

  const name = document.getElementById("checkoutName").value.trim();
  const phone = document.getElementById("checkoutPhone").value.trim();
  const address = document.getElementById("checkoutAddress").value.trim();
  const shipDate = normalizeShipDate_(document.getElementById("checkoutShipDate")?.value || "");
  const cart = getCart();
  if (!name || !phone || !address || !shipDate || cart.length === 0) {
    setCheckoutStatus_("請完整填寫資料、出貨日期，且購物車不可為空。", "error");
    alert("請完整填寫資料、出貨日期或購物車為空");
    return;
  }
  if (shipDate !== String(document.getElementById("checkoutShipDate")?.value || "")) {
    document.getElementById("checkoutShipDate").value = shipDate;
  }

  const member = getMember();
  const requestToken = generateCheckoutRequestToken_();
  savePendingCheckout_(buildPendingCheckoutPayload_(requestToken, {
    created_at: Date.now(),
    member: member,
    member_id: member?.id || "",
    name,
    phone,
    address,
    shipping_date: shipDate,
    cart
  }));
  setCheckoutSubmittingState_(true, "送單中…");
  setCheckoutStatus_("訂單送出中，送出按鈕已鎖定，請稍候。", "pending");

  callGAS({
    type: "order",
    member_id: member?.id || "",
    name, phone, address,
    shipping_date: shipDate,
    request_token: requestToken,
    cart_compact: buildCheckoutCartCompactText_(cart),
    __options: {
      timeoutMs: 45000,
      onTimeout: () => {
        showCheckoutTimeoutRecovery_("送單 API 超時。請按「重新送單」用同一筆送單碼重新送出，不需要重新選購。 ");
      },
      onError: () => {
        showCheckoutTimeoutRecovery_("送單連線異常。請按「重新送單」用同一筆送單碼重新送出，不需要重新選購。 ");
      }
    }
  }, res => {
    if (res && res.status === "ok") {
      redirectOrderSuccess_(res.order_id, res.total || 0);
      return;
    }

    if (res && (res.code === "TIMEOUT" || res.code === "NETWORK_ERROR")) {
      showCheckoutTimeoutRecovery_("送單 API 超時或連線異常。請按「重新送單」用同一筆送單碼重新送出，不需要重新選購。 ");
      return;
    }

    clearPendingCheckout_();
    setCheckoutSubmittingState_(false);
    setCheckoutStatus_((res && res.message) || "送單失敗，請檢查資料後再試。", "error");
    alert((res && res.message) || "送單失敗");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  updateMemberArea();
  updateCartCount();
  renderCheckoutCart();
  prefillCustomerFields();
  setupShipDateField();
  restorePendingCheckout_();
  document.getElementById("checkoutForm")?.addEventListener("submit", submitOrder);
});
