// ===== checkout.js =====
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

function submitOrder(event) {
  event.preventDefault();
  const name = document.getElementById("checkoutName").value.trim();
  const phone = document.getElementById("checkoutPhone").value.trim();
  const address = document.getElementById("checkoutAddress").value.trim();
  const cart = getCart();
  if (!name || !phone || !address || cart.length === 0) {
    alert("請完整填寫資料或購物車為空");
    return;
  }

  const member = getMember();
  callGAS({
    type: "order",
    member_id: member?.id || "",
    name, phone, address,
    cart: encodeURIComponent(JSON.stringify(cart))
  }, res => {
    if (res.status === "ok") {
      localStorage.removeItem("cart");
      updateCartCount();
      window.location.href = `order-success.html?order_id=${res.order_id}&total=${res.total}`;
    } else if (res.status === "stock_error") {
      alert(`❌ 商品「${res.product}」庫存不足（剩餘 ${res.remaining} 件）`);
    } else {
      alert(res.message || "送單失敗");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  updateMemberArea();
  updateCartCount();       // ✅ 確保紅點數字在 checkout 頁面更新
  renderCheckoutCart();
  document.getElementById("checkoutForm")?.addEventListener("submit", submitOrder);
});
