// ===== cart-utils.js =====
const CHECKOUT_PENDING_ORDER_KEY = "checkout_pending_order";

function getCart() {
  return JSON.parse(localStorage.getItem("cart") || "[]");
}

function clearCheckoutPendingOrderCache() {
  try { localStorage.removeItem(CHECKOUT_PENDING_ORDER_KEY); } catch (e) {}
  try { sessionStorage.removeItem(CHECKOUT_PENDING_ORDER_KEY); } catch (e) {}
}

function setCart(cart) {
  const nextCart = Array.isArray(cart) ? cart : [];
  localStorage.setItem("cart", JSON.stringify(nextCart));
  // 使用者把購物車清空時，也一併清除舊的超時送單狀態，避免舊失敗資料重新灌回購物車。
  if (!nextCart.length) clearCheckoutPendingOrderCache();
}

function normalizeCartQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 1;
  const v = truncateCartDecimal(n, 2);
  return v > 0 ? v : 1;
}

function truncateCartDecimal(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const scale = Math.max(0, Math.floor(Number(digits) || 0));
  const factor = Math.pow(10, scale);
  return (n < 0 ? Math.ceil(n * factor) : Math.floor(n * factor)) / factor;
}

function formatCartMoney(value) {
  return truncateCartDecimal(value, 2).toFixed(2);
}

function formatCartQty(value) {
  const n = normalizeCartQty(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function updateCartCount() {
  const countEl = document.getElementById("cart-count");
  if (!countEl) return;
  const itemCount = getCart().filter(i => i && i.id).length;
  if (itemCount > 0) {
    countEl.textContent = itemCount;
    countEl.style.visibility = "visible"; // 顯示紅點
  } else {
    countEl.textContent = "";
    countEl.style.visibility = "hidden";  // 隱藏紅點，但保留位置
  }
}

function addToCart(item, qty) {
  if (!item || !item.id) return;
  const addQty = normalizeCartQty(qty);
  const cart = getCart();
  const itemKey = String(item.id || item.sku || item.product_id || "");
  const exist = cart.find(i => String(i.id || i.sku || i.product_id || "") === itemKey);
  if (exist) {
    exist.qty = normalizeCartQty(Number(exist.qty || 0) + addQty);
  } else {
    cart.push({ ...item, id: itemKey, sku: String(item.sku || itemKey), qty:addQty });
  }
  setCart(cart);
  updateCartCount();
  alert(`${item.name} 已加入購物車（${addQty} 件）`);
}
function updateCartItemQty(id, qty) {
  const targetId = String(id || "");
  const nextQty = normalizeCartQty(qty);
  const cart = getCart().map(item => {
    if (String(item.id) === targetId) return { ...item, qty: nextQty };
    return item;
  });
  setCart(cart);
  updateCartCount();
  if (typeof renderCart === "function") renderCart();
  if (typeof renderCheckoutCart === "function") renderCheckoutCart();
}


function removeCartItem(id) {
  let cart = getCart();
  const targetId = String(id || "");
  cart = cart.filter(i => String(i.id) !== targetId);
  setCart(cart);
  updateCartCount();
  renderCart();  // 只有在 cart.html 使用
}
