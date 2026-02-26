// =============================
// ===== 會員資料管理函式 =====
// =============================

// 取得目前登入會員資訊
function getMember() {
  return JSON.parse(localStorage.getItem("member") || "null");
}

// 更新頁面上的會員顯示區
function updateMemberArea() {
  const memberArea = document.getElementById("memberArea");
  if (!memberArea) return;

  const member = getMember();

  if (member) {
    // 已登入 → 顯示會員名稱、登出按鈕、我的訂單按鈕
    memberArea.innerHTML = `
      👋 歡迎，${member.name} 
      <button onclick="logout()">登出</button>
      <button id="myOrdersBtn">我的訂單</button>
    `;

    const ordersBtn = document.getElementById("myOrdersBtn");
    if (ordersBtn) {
      ordersBtn.addEventListener("click", () => {
        window.location.href = "order-list.html";
      });
    }

    // 管理者面板
    if (member.role === "admin") {
      showAdminPanel();
    } else {
      hideAdminPanel();
    }

  } else {
    // 未登入 → 顯示登入連結
    memberArea.innerHTML = `<a href="login.html">會員登入</a>`;
    hideAdminPanel();
  }
}

// ------------------ 管理者面板顯示/隱藏 ------------------
function showAdminPanel() {
  const panel = document.getElementById("adminPanel");
  if (panel) panel.style.display = "block";
}

function hideAdminPanel() {
  const panel = document.getElementById("adminPanel");
  if (panel) panel.style.display = "none";
}

// =============================
// ===== 登入 / 註冊 / 登出 =====
// =============================

// 前端登入表單呼叫
function login(event) {
  if (event) event.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!username || !password) {
    alert("請輸入帳號密碼");
    return;
  }

  // JSONP 呼叫 GAS
  callGAS({ type: "members", username, password }, res => {
    if (res.status === "ok") {
      // 儲存會員資訊到 localStorage
      localStorage.setItem("member", JSON.stringify({
        id: res.id,
        name: res.name,
        role: res.role || "user" // 如果沒有 role 就當一般用戶
      }));
      updateMemberArea();
      alert("登入成功！");
      window.location.href = "index.html";
    } else {
      alert(res.message || "登入失敗");
    }
  });
}

// 前端註冊表單呼叫
function register(event) {
  if (event) event.preventDefault();
  const name = document.getElementById("regName").value.trim();
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value.trim();
  if (!name || !username || !password) {
    alert("請輸入完整資料");
    return;
  }

  callGAS({ type: "register", name, username, password }, res => {
    if (res.status === "ok") {
      alert("註冊成功，請登入！");
      window.location.href = "login.html";
    } else {
      alert(res.message || "註冊失敗");
    }
  });
}

// 登出
function logout() {
  localStorage.removeItem("member");
  updateMemberArea();
  alert("已登出");
  window.location.href = "index.html";
}

// =============================
// ===== 初始化 =================
// =============================
document.addEventListener("DOMContentLoaded", updateMemberArea);

// =============================
// ===== 掛到全域 =================
// =============================
window.login = login;
window.register = register;
window.logout = logout;
window.updateMemberArea = updateMemberArea;