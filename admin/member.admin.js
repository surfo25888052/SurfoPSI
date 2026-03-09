// =============================
// ===== 會員資料管理函式 =====
// =============================

window.ADMIN_MEMBER_KEY = "admin_member";
window.LEGACY_SHARED_MEMBER_KEY = window.LEGACY_SHARED_MEMBER_KEY || "member";

function isAdminRole_(role) {
  const v = String(role || "").trim().toLowerCase();
  return ["admin", "staff", "manager", "operator", "owner"].includes(v);
}

function readJsonFromStorage_(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (err) {
    return null;
  }
}

function clearLegacyAdminMember_() {
  const legacy = readJsonFromStorage_(window.LEGACY_SHARED_MEMBER_KEY);
  if (legacy && isAdminRole_(legacy.role)) {
    localStorage.removeItem(window.LEGACY_SHARED_MEMBER_KEY);
  }
}

// 取得目前登入會員資訊
function getMember() {
  const direct = readJsonFromStorage_(window.ADMIN_MEMBER_KEY);
  if (direct) return direct;

  // 相容舊版：以前前後台共用 localStorage['member']
  const legacy = readJsonFromStorage_(window.LEGACY_SHARED_MEMBER_KEY);
  if (legacy && isAdminRole_(legacy.role)) {
    localStorage.setItem(window.ADMIN_MEMBER_KEY, JSON.stringify(legacy));
    // 只搬移管理者舊 key，避免之後登出又被自動登入回來
    localStorage.removeItem(window.LEGACY_SHARED_MEMBER_KEY);
    return legacy;
  }
  return null;
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
        window.location.href = "admin-dashboard.html";
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
    memberArea.innerHTML = `<a href="login.html">後台登入</a>`;
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
      // 儲存後台登入資訊到 localStorage（與 customers 分開）
      localStorage.setItem(window.ADMIN_MEMBER_KEY, JSON.stringify({
        id: res.id,
        name: res.name,
        role: res.role || "user"
      }));
      clearLegacyAdminMember_();
      updateMemberArea();
      alert("登入成功！");
      window.location.href = "admin-dashboard.html";
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
      window.location.href = "admin-dashboard.html";
    } else {
      alert(res.message || "註冊失敗");
    }
  });
}

// 登出
function logout() {
  localStorage.removeItem(window.ADMIN_MEMBER_KEY);
  clearLegacyAdminMember_();
  updateMemberArea();
  alert("已登出");
  window.location.href = "login.html";
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
