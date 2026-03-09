// ===== cart-utils.js =====
function getCart() {
  return JSON.parse(localStorage.getItem("cart") || "[]");
}

function setCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function normalizeCartQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 1;
  const v = Math.floor(n);
  return v > 0 ? v : 1;
}

function updateCartCount() {
  const countEl = document.getElementById("cart-count");
  if (!countEl) return;
  const total = getCart().reduce((sum,i)=>sum+i.qty,0);
  if (total > 0) {
    countEl.textContent = total;
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
  const exist = cart.find(i => i.id === item.id);
  if (exist) {
    exist.qty = normalizeCartQty(exist.qty + addQty);
  } else {
    cart.push({...item, qty:addQty});
  }
  setCart(cart);
  updateCartCount();
  alert(`${item.name} 已加入購物車（${addQty} 件）`);
}

function removeCartItem(id) {
  let cart = getCart();
  cart = cart.filter(i => i.id !== id);
  setCart(cart);
  updateCartCount();
  renderCart();  // 只有在 cart.html 使用
}
