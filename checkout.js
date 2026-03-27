// ===== checkout.js =====
const CHECKOUT_PENDING_KEY = "checkout_pending_order";
let checkoutSubmitting_ = false;
let checkoutPollTimer_ = null;

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
  try { sessionStorage.setItem(CHECKOUT_PENDING_KEY, JSON.stringify(payload || {})); } catch (e) {}
}

function readPendingCheckout_() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearPendingCheckout_() {
  try { sessionStorage.removeItem(CHECKOUT_PENDING_KEY); } catch (e) {}
}

function redirectOrderSuccess_(orderId, total) {
  clearPendingCheckout_();
  localStorage.removeItem("cart");
  updateCartCount();
  window.location.href = `order-success.html?order_id=${encodeURIComponent(orderId || "")}&total=${encodeURIComponent(total || 0)}`;
}

function pollOrderByToken_(requestToken, attempt) {
  if (!requestToken) return;
  const currentAttempt = Number(attempt || 0);
  if (checkoutPollTimer_) {
    clearTimeout(checkoutPollTimer_);
    checkoutPollTimer_ = null;
  }
  callGAS({
    type: "orderStatusByToken",
    request_token: requestToken,
    __options: { timeoutMs: 15000 }
  }, res => {
    if (res && res.status === "ok" && String(res.order_id || "").trim()) {
      return redirectOrderSuccess_(res.order_id, res.total || 0);
    }
    if (currentAttempt >= 20) {
      setCheckoutSubmittingState_(false);
      alert("系統已收到送單請求，但目前無法立即確認結果。請先到訂單查詢確認是否已成立，請勿重複下單。");
      return;
    }
    checkoutPollTimer_ = setTimeout(() => pollOrderByToken_(requestToken, currentAttempt + 1), 3000);
  });
}

function restorePendingCheckout_() {
  const pending = readPendingCheckout_();
  if (!pending || !pending.request_token) return;
  setCheckoutSubmittingState_(true, "確認訂單中…");
  pollOrderByToken_(pending.request_token, 0);
}

function submitOrder(event) {
  event.preventDefault();
  if (checkoutSubmitting_) return;

  const pending = readPendingCheckout_();
  if (pending && pending.request_token) {
    setCheckoutSubmittingState_(true, "確認訂單中…");
    pollOrderByToken_(pending.request_token, 0);
    return;
  }

  const name = document.getElementById("checkoutName").value.trim();
  const phone = document.getElementById("checkoutPhone").value.trim();
  const address = document.getElementById("checkoutAddress").value.trim();
  const shipDate = normalizeShipDate_(document.getElementById("checkoutShipDate")?.value || "");
  const cart = getCart();
  if (!name || !phone || !address || !shipDate || cart.length === 0) {
    alert("請完整填寫資料、出貨日期或購物車為空");
    return;
  }
  if (shipDate !== String(document.getElementById("checkoutShipDate")?.value || "")) {
    document.getElementById("checkoutShipDate").value = shipDate;
  }

  const member = getMember();
  const requestToken = generateCheckoutRequestToken_();
  savePendingCheckout_({ request_token: requestToken, created_at: Date.now() });
  setCheckoutSubmittingState_(true, "送單中…");

  callGAS({
    type: "order",
    member_id: member?.id || "",
    name, phone, address,
    shipping_date: shipDate,
    request_token: requestToken,
    cart: encodeURIComponent(JSON.stringify(cart)),
    __options: {
      timeoutMs: 45000,
      onTimeout: () => {
        setCheckoutSubmittingState_(true, "確認訂單中…");
        pollOrderByToken_(requestToken, 0);
      }
    }
  }, res => {
    if (res && res.status === "ok") {
      redirectOrderSuccess_(res.order_id, res.total || 0);
      return;
    }
    clearPendingCheckout_();
    setCheckoutSubmittingState_(false);
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
