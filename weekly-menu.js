let MENU_WEEK_OFFSET = 0;
let MENU_CACHE = null;

function menuText(v){ return String(v ?? "").trim(); }
function menuEscape(v){
  return menuText(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function mealData(day, key){
  const meals = day && day.meals ? day.meals : {};
  return meals[key] || null;
}
function dishValue(meal, key){
  if (!meal) return "";
  return menuText(meal[key]);
}

function isStandaloneWeeklyMenuPage(){
  return !!document.querySelector('.menu-page');
}

function getMenuEl(id){
  return document.getElementById(id);
}

function ensureWeeklyMenuModal(){
  if (isStandaloneWeeklyMenuPage() || getMenuEl('weekly-menu-modal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="weekly-menu-modal" class="weekly-menu-modal" aria-hidden="true">
      <div class="weekly-menu-modal__backdrop" onclick="closeWeeklyMenuModal()"></div>
      <div class="weekly-menu-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-menu-modal-title">
        <div class="weekly-menu-modal__header">
          <div>
            <h2 id="weekly-menu-modal-title">本週菜單</h2>
            <div id="menu-week-label" class="menu-meta"></div>
          </div>
          <button type="button" class="weekly-menu-modal__close" onclick="closeWeeklyMenuModal()" aria-label="關閉本週菜單">✕</button>
        </div>
        <div class="menu-toolbar weekly-menu-modal__toolbar">
          <div class="menu-actions">
            <button type="button" class="secondary" onclick="changeMenuWeek(-1)">上一週</button>
            <button type="button" class="secondary" onclick="resetMenuWeek()">本週</button>
            <button type="button" class="secondary" onclick="changeMenuWeek(1)">下一週</button>
          </div>
          <div class="menu-meta">可直接查看當週菜單，不需離開目前頁面</div>
        </div>
        <div class="weekly-menu-modal__body">
          <div id="menu-status" class="menu-status">正在讀取菜單資料…</div>
          <div id="menu-desktop-wrap" class="menu-desktop-wrap" style="display:none;"></div>
          <div id="menu-mobile" class="menu-mobile"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);
}

function setMenuStatus(text, isError){
  const box = getMenuEl("menu-status");
  if (!box) return;
  box.style.display = "";
  box.className = isError ? "menu-status menu-empty" : "menu-status";
  box.innerHTML = text;
}

function hideMenuStatus(){
  const box = getMenuEl("menu-status");
  if (!box) return;
  box.style.display = "none";
}

function updateMenuWeekLabel(payload){
  const el = getMenuEl("menu-week-label");
  if (!el) return;
  if (!payload) {
    el.textContent = "";
    return;
  }
  const range = `${menuText(payload.week_start_label)} ～ ${menuText(payload.week_end_label)}`;
  const sheetName = menuText(payload.sheet_name);
  el.textContent = sheetName ? `${range}｜資料表：${sheetName}` : range;
}

function renderDesktopTable(days){
  const wrap = getMenuEl("menu-desktop-wrap");
  if (!wrap) return;
  if (!Array.isArray(days) || !days.length) {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }

  const mealRows = [
    { key: "lunch", label: "午餐" },
    { key: "dinner", label: "晚餐" }
  ];
  const dishRows = [
    { key: "main", label: "主菜" },
    { key: "side", label: "小配菜" },
    { key: "light_veg", label: "淺色蔬菜" },
    { key: "dark_veg", label: "深色蔬菜" },
    { key: "root_veg", label: "根莖瓜果" }
  ];

  let html = '<table class="menu-table">';
  html += '<thead><tr><th class="menu-label">項目</th>';
  html += days.map(day => `<th class="day-head">${menuEscape(day.display_date || day.date)}<div style="margin-top:6px;font-size:13px;color:#666;">${menuEscape(day.weekday_label || "")}</div></th>`).join("");
  html += '</tr></thead><tbody>';

  html += '<tr><td class="menu-label menu-sub-label">農曆</td>';
  html += days.map(day => `<td class="lunar">${menuEscape(day.lunar || "-")}</td>`).join("");
  html += '</tr>';

  mealRows.forEach(mealRow => {
    html += `<tr class="menu-meal-divider"><td colspan="${days.length + 1}">${menuEscape(mealRow.label)}</td></tr>`;
    dishRows.forEach(dishRow => {
      html += '<tr>';
      html += `<td class="menu-label menu-sub-label">${menuEscape(dishRow.label)}</td>`;
      html += days.map(day => {
        const meal = mealData(day, mealRow.key);
        const value = dishValue(meal, dishRow.key);
        return `<td class="dish ${value ? '' : 'empty'}">${menuEscape(value || "—")}</td>`;
      }).join("");
      html += '</tr>';
    });
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
  wrap.style.display = "";
}

function renderMobileCards(days){
  const box = getMenuEl("menu-mobile");
  if (!box) return;
  if (!Array.isArray(days) || !days.length) {
    box.innerHTML = "";
    return;
  }
  const meals = [
    { key: "lunch", label: "午餐" },
    { key: "dinner", label: "晚餐" }
  ];
  const dishes = [
    { key: "main", label: "主菜" },
    { key: "side", label: "小配菜" },
    { key: "light_veg", label: "淺色蔬菜" },
    { key: "dark_veg", label: "深色蔬菜" },
    { key: "root_veg", label: "根莖瓜果" }
  ];
  box.innerHTML = days.map(day => {
    const mealHtml = meals.map(mealInfo => {
      const meal = mealData(day, mealInfo.key);
      const listHtml = dishes.map(dish => {
        const value = dishValue(meal, dish.key);
        return `
          <div class="menu-dish-item">
            <div class="k">${menuEscape(dish.label)}</div>
            <div class="v">${menuEscape(value || "—")}</div>
          </div>
        `;
      }).join("");
      return `
        <div class="menu-meal-block menu-meal">
          <div class="menu-meal-title">${menuEscape(mealInfo.label)}</div>
          <div class="menu-list">${listHtml}</div>
        </div>
      `;
    }).join("");
    return `
      <section class="menu-card">
        <div class="menu-day-badge">${menuEscape(day.weekday_label || "")}</div>
        <h3>${menuEscape(day.display_date || day.date)}</h3>
        <div class="lunar">農曆：${menuEscape(day.lunar || "-")}</div>
        ${mealHtml}
      </section>
    `;
  }).join("");
}

function renderMenu(payload){
  MENU_CACHE = payload || null;
  updateMenuWeekLabel(payload);
  const days = Array.isArray(payload && payload.days) ? payload.days : [];
  if (!days.length) {
    renderDesktopTable([]);
    renderMobileCards([]);
    setMenuStatus(
      `<div class="menu-empty"><strong>這一週還沒有菜單資料。</strong><div class="menu-note">請在 Google Sheet 新增或貼上「菜單」分頁資料，欄位順序請對應：日期、星期、農曆、餐別、主菜、小配菜、淺色蔬菜、深色蔬菜、根莖瓜果。</div></div>`,
      true
    );
    return;
  }
  hideMenuStatus();
  renderDesktopTable(days);
  renderMobileCards(days);
}

function loadWeeklyMenu(){
  setMenuStatus("正在讀取菜單資料…", false);
  callGAS({ type: "weeklyMenu", offset: MENU_WEEK_OFFSET }, res => {
    if (!res || res.status !== "ok") {
      renderDesktopTable([]);
      renderMobileCards([]);
      setMenuStatus(`菜單資料載入失敗：${menuEscape(res && res.message ? res.message : "未知錯誤")}`, true);
      return;
    }
    renderMenu(res);
  });
}

function changeMenuWeek(step){
  MENU_WEEK_OFFSET += Number(step) || 0;
  loadWeeklyMenu();
}

function resetMenuWeek(){
  MENU_WEEK_OFFSET = 0;
  loadWeeklyMenu();
}

function openWeeklyMenuModal(event){
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (isStandaloneWeeklyMenuPage()) {
    MENU_WEEK_OFFSET = 0;
    loadWeeklyMenu();
    return false;
  }
  ensureWeeklyMenuModal();
  const modal = getMenuEl('weekly-menu-modal');
  if (!modal) return false;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('weekly-menu-modal-open');
  MENU_WEEK_OFFSET = 0;
  loadWeeklyMenu();
  return false;
}

function closeWeeklyMenuModal(){
  const modal = getMenuEl('weekly-menu-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('weekly-menu-modal-open');
}

function bindWeeklyMenuTriggers(){
  document.addEventListener('click', function(e){
    const link = e.target.closest('a[href="weekly-menu.html"], a[href="./weekly-menu.html"], [data-weekly-menu-open="1"]');
    if (!link) return;
    if (isStandaloneWeeklyMenuPage()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (link.target && link.target === '_blank')) return;
    openWeeklyMenuModal(e);
  });
}

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') closeWeeklyMenuModal();
});

document.addEventListener("DOMContentLoaded", () => {
  bindWeeklyMenuTriggers();
  if (typeof updateMemberArea === "function") updateMemberArea();
  if (typeof updateCartCount === "function") updateCartCount();
  if (isStandaloneWeeklyMenuPage()) {
    loadWeeklyMenu();
  } else {
    ensureWeeklyMenuModal();
  }
});
