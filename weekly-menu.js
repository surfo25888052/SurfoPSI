
let MENU_WEEK_OFFSET = 0;
let MENU_CACHE = null;
let MENU_SELECTED_DATE = "";
let SHOP_MENU_WEEK_OFFSET = 0;
let SHOP_MENU_CACHE = null;
let MENU_PROCUREMENT_SERVINGS = 100;

function menuText(v){ return String(v ?? "").trim(); }
function menuEscape(v){
  return menuText(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function menuNum(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function menuQty(v){
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function menuAmount(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function menuFormatAmount(v){
  const n = menuAmount(v, 0);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
  return String(rounded.toFixed(2)).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
}
function isStandaloneWeeklyMenuPage(){
  return !!document.querySelector('.menu-page');
}
function getMenuEl(id){
  return document.getElementById(id);
}
function isShopIndexMenuRail(){
  return !!getMenuEl('shop-menu-rail-list');
}
function shopMenuDateKey(value){
  const text = menuText(value);
  return text ? text.replace(/[^0-9]/g,'') : '';
}
function todayMenuKey(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
function openWeeklyMenuModalForDate(date, weekOffset){
  MENU_WEEK_OFFSET = Number(weekOffset) || 0;
  MENU_SELECTED_DATE = menuText(date);
  return openWeeklyMenuModal();
}
function setShopMenuRailStatus(text, isError){
  const status = getMenuEl('shop-menu-rail-status');
  const list = getMenuEl('shop-menu-rail-list');
  if (!status || !list) return;
  status.style.display = '';
  status.innerHTML = text;
  status.style.color = isError ? '#b91c1c' : '#6b7280';
  list.style.display = 'none';
  list.innerHTML = '';
}
function updateShopMenuWeekLabel(payload){
  const el = getMenuEl('shop-menu-week-label');
  if (!el) return;
  if (!payload) {
    el.textContent = '';
    return;
  }
  el.textContent = `${menuText(payload.week_start_label)} ～ ${menuText(payload.week_end_label)}`;
}
function renderShopMenuRail(){
  if (!isShopIndexMenuRail()) return;
  const payload = SHOP_MENU_CACHE;
  const list = getMenuEl('shop-menu-rail-list');
  const status = getMenuEl('shop-menu-rail-status');
  updateShopMenuWeekLabel(payload);
  if (!list || !status) return;
  const days = Array.isArray(payload && payload.days) ? payload.days : [];
  if (!days.length) {
    setShopMenuRailStatus('這一週沒有可顯示的菜單日期。', true);
    return;
  }
  status.style.display = 'none';
  list.style.display = '';
  const todayKey = todayMenuKey();
  list.innerHTML = days.map(day => {
    const hasMenu = !!day.has_menu;
    const isToday = shopMenuDateKey(day.date) === todayKey;
    return `
      <button type="button" class="shop-menu-rail__day${isToday ? ' is-today' : ''}" onclick="openWeeklyMenuModalForDate('${menuEscape(day.date)}', ${Number(SHOP_MENU_WEEK_OFFSET) || 0})">
        <div class="shop-menu-rail__day-top">${menuEscape(day.display_date || day.date)}</div>
        <div class="shop-menu-rail__day-sub">${menuEscape(day.weekday_label || '')}</div>
        <div class="shop-menu-rail__day-meta">農曆 ${menuEscape(day.lunar || '—')}</div>
        <div class="shop-menu-rail__day-tag${hasMenu ? '' : ' is-empty'}">${hasMenu ? '查看菜單' : '尚無菜單'}</div>
      </button>
    `;
  }).join('');
}
function loadShopMenuRail(){
  if (!isShopIndexMenuRail()) return;
  setShopMenuRailStatus('正在讀取本週日期…', false);
  callGAS({ type: 'weeklyMenu', offset: SHOP_MENU_WEEK_OFFSET }, res => {
    if (!res || res.status !== 'ok') {
      SHOP_MENU_CACHE = null;
      updateShopMenuWeekLabel(null);
      setShopMenuRailStatus(`日期資料載入失敗：${menuEscape(res && res.message ? res.message : '未知錯誤')}`, true);
      return;
    }
    SHOP_MENU_CACHE = res;
    renderShopMenuRail();
  });
}
function changeShopMenuWeek(step){
  SHOP_MENU_WEEK_OFFSET += Number(step) || 0;
  loadShopMenuRail();
}
function resetShopMenuWeek(){
  SHOP_MENU_WEEK_OFFSET = 0;
  loadShopMenuRail();
}
function menuMealDefs(){
  return [
    { key: "lunch", label: "午餐" },
    { key: "dinner", label: "晚餐" }
  ];
}
function menuDishDefs(){
  return [
    { key: "main", label: "主菜" },
    { key: "side", label: "小配菜" },
    { key: "light_veg", label: "淺色蔬菜" },
    { key: "dark_veg", label: "深色蔬菜" },
    { key: "root_veg", label: "根莖瓜果" }
  ];
}
function mealData(day, key){
  const meals = day && day.meals ? day.meals : {};
  return meals[key] || null;
}
function dishValue(meal, key){
  if (!meal) return "";
  return menuText(meal[key]);
}
function menuInputId(date, groupIndex, itemIndex, productId){
  return `menu-qty-${menuText(date).replace(/[^0-9]/g,'')}-${groupIndex}-${itemIndex}-${menuText(productId).replace(/[^\w\-]/g,'')}`;
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
          <div class="menu-meta">點選左側日期即可查看當日菜單、智慧試算與對應食材</div>
        </div>
        <div class="weekly-menu-modal__body">
          <div id="menu-status" class="menu-status">正在讀取菜單資料…</div>
          <div id="menu-layout" class="menu-layout" style="display:none;">
            <aside class="menu-sidebar">
              <div class="menu-sidebar__title">本週日期</div>
              <div id="menu-date-list" class="menu-date-list"></div>
            </aside>
            <section class="menu-detail">
              <div id="menu-day-detail"></div>
            </section>
          </div>
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
function setMenuLayoutVisible(show){
  const layout = getMenuEl("menu-layout");
  if (!layout) return;
  layout.style.display = show ? "" : "none";
}
function updateMenuWeekLabel(payload){
  const el = getMenuEl("menu-week-label");
  if (!el) return;
  if (!payload) {
    el.textContent = "";
    return;
  }
  const range = `${menuText(payload.week_start_label)} ～ ${menuText(payload.week_end_label)}`;
  const mappingSheet = menuText(payload.ingredient_sheet_name);
  const bomSheet = menuText(payload.bom_sheet_name);
  const bits = [range];
  if (mappingSheet) bits.push(`食材對應：${mappingSheet}`);
  if (bomSheet) bits.push(`試算對應：${bomSheet}`);
  el.textContent = bits.join('｜');
}
function getMenuDays(){
  return Array.isArray(MENU_CACHE && MENU_CACHE.days) ? MENU_CACHE.days : [];
}
function getSelectedDay(){
  return getMenuDays().find(day => menuText(day.date) === menuText(MENU_SELECTED_DATE)) || null;
}
function syncSelectedDate(){
  const days = getMenuDays();
  if (!days.length) {
    MENU_SELECTED_DATE = "";
    return;
  }
  const hit = days.find(day => menuText(day.date) === menuText(MENU_SELECTED_DATE));
  MENU_SELECTED_DATE = hit ? hit.date : days[0].date;
}
function renderDateList(){
  const box = getMenuEl("menu-date-list");
  if (!box) return;
  const days = getMenuDays();
  if (!days.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = days.map(day => {
    const active = menuText(day.date) === menuText(MENU_SELECTED_DATE);
    const hasMenu = !!(day.has_menu);
    return `
      <button type="button" class="menu-date-btn${active ? ' active' : ''}" onclick="selectMenuDate('${menuEscape(day.date)}')">
        <div class="menu-date-btn__top">${menuEscape(day.display_date || day.date)}</div>
        <div class="menu-date-btn__sub">${menuEscape(day.weekday_label || '')}</div>
        <div class="menu-date-btn__meta">${menuEscape(day.lunar || '—')}</div>
        <div class="menu-date-btn__tag${hasMenu ? '' : ' is-empty'}">${hasMenu ? '已有菜單' : '尚無菜單'}</div>
      </button>
    `;
  }).join("");
}
function renderMealCard(day, mealInfo){
  const meal = mealData(day, mealInfo.key);
  const rows = menuDishDefs().map(dish => {
    const value = dishValue(meal, dish.key);
    return `
      <div class="menu-dish-row">
        <div class="menu-dish-row__label">${menuEscape(dish.label)}</div>
        <div class="menu-dish-row__value${value ? '' : ' is-empty'}">${menuEscape(value || '—')}</div>
      </div>
    `;
  }).join("");
  return `
    <section class="menu-meal-card">
      <div class="menu-meal-card__title">${menuEscape(mealInfo.label)}</div>
      <div class="menu-dish-list">${rows}</div>
    </section>
  `;
}
function renderIngredientGroup(day, group, groupIndex){
  const items = Array.isArray(group && group.items) ? group.items : [];
  const cards = items.map((item, itemIndex) => {
    const inputId = menuInputId(day.date, groupIndex, itemIndex, item.product_id || item.id || item.sku);
    const itemJson = JSON.stringify({
      id: menuText(item.product_id || item.id || item.sku),
      sku: menuText(item.sku || item.product_id || item.id),
      name: menuText(item.product_name || item.name),
      price: menuNum(item.price, 0)
    }).replace(/'/g, '&#39;');
    const unitText = menuText(item.unit);
    const specText = menuText(item.spec);
    const stockText = Number.isFinite(Number(item.stock)) ? `庫存 ${menuNum(item.stock, 0)}` : "";
    const defaultQty = menuQty(item.default_qty || 1);
    return `
      <article class="menu-ingredient-card">
        <div class="menu-ingredient-card__body">
          <div class="menu-ingredient-card__title">${menuEscape(item.product_name || item.name || '')}</div>
          <div class="menu-ingredient-card__meta">
            ${specText ? `<span>${menuEscape(specText)}</span>` : ''}
            <span>單價 $${menuNum(item.price, 0)}</span>
            ${unitText ? `<span>單位 ${menuEscape(unitText)}</span>` : ''}
            ${stockText ? `<span>${menuEscape(stockText)}</span>` : ''}
          </div>
          ${menuText(item.note) ? `<div class="menu-ingredient-card__note">${menuEscape(item.note)}</div>` : ''}
        </div>
        <div class="menu-ingredient-card__action">
          <label for="${menuEscape(inputId)}">數量</label>
          <input id="${menuEscape(inputId)}" type="number" min="1" step="1" value="${defaultQty}">
          <button type="button" onclick='addMenuIngredientToCart(${itemJson}, "${menuEscape(inputId)}")'>加入購物車</button>
        </div>
      </article>
    `;
  }).join("");
  return `
    <section class="menu-ingredient-group">
      <div class="menu-ingredient-group__head">
        <div>
          <div class="menu-ingredient-group__tag">${menuEscape(group.meal_label || '')}｜${menuEscape(group.dish_label || '')}</div>
          <h4>${menuEscape(group.dish_name || '')}</h4>
        </div>
      </div>
      <div class="menu-ingredient-grid">${cards}</div>
    </section>
  `;
}

function setMenuProcurementServings(value){
  MENU_PROCUREMENT_SERVINGS = menuQty(value || 1);
  renderDayDetail();
}
function renderProcurementSection(day){
  const items = Array.isArray(day && day.procurement_items) ? day.procurement_items : [];
  const unmapped = Array.isArray(day && day.procurement_unmapped_dishes) ? day.procurement_unmapped_dishes : [];
  const servings = menuQty(MENU_PROCUREMENT_SERVINGS || 1);
  const rowsHtml = items.map(item => {
    const unit = menuText(item.qty_unit || item.unit || 'g') || 'g';
    const net = menuAmount(item.per_person_net, 0) * servings;
    const loss = menuAmount(item.per_person_loss, 0) * servings;
    const gross = menuAmount(item.per_person_gross, 0) * servings;
    const sourceList = Array.isArray(item.source_dishes) ? item.source_dishes : [];
    const sourceHtml = sourceList.length ? sourceList.map(v => `<span>${menuEscape(v)}</span>`).join('') : '<span>—</span>';
    return `
      <article class="menu-procurement-card">
        <div class="menu-procurement-card__head">
          <div>
            <h4>${menuEscape(item.product_name || '')}</h4>
            <div class="menu-procurement-card__sub">
              ${menuText(item.spec) ? `<span>${menuEscape(item.spec)}</span>` : ''}
              ${menuText(item.category) ? `<span>${menuEscape(item.category)}</span>` : ''}
              <span>單位 ${menuEscape(item.unit || '—')}</span>
            </div>
          </div>
          <div class="menu-procurement-card__gross">${menuFormatAmount(gross)}<small>${menuEscape(unit)}</small></div>
        </div>
        <div class="menu-procurement-card__stats">
          <div><label>每人淨量</label><strong>${menuFormatAmount(item.per_person_net)} ${menuEscape(unit)}</strong></div>
          <div><label>試算淨量</label><strong>${menuFormatAmount(net)} ${menuEscape(unit)}</strong></div>
          <div><label>預估耗損</label><strong>${menuFormatAmount(loss)} ${menuEscape(unit)}</strong></div>
          <div><label>建議採購量</label><strong>${menuFormatAmount(gross)} ${menuEscape(unit)}</strong></div>
        </div>
        <div class="menu-procurement-card__sources">${sourceHtml}</div>
        ${menuText(item.note) ? `<div class="menu-procurement-card__note">${menuEscape(item.note)}</div>` : ''}
      </article>
    `;
  }).join('');

  const emptyHtml = `
    <div class="menu-empty-tip">
      這一天尚未建立智慧試算對應。請到 Google Sheet 的 <strong>MenuBOM</strong> 分頁補上 dish_name、product 與 per_person_qty / loss_rate。
    </div>
  `;

  const unmappedHtml = unmapped.length ? `
    <div class="menu-warning-box">
      <div class="menu-warning-box__title">以下菜色尚未建立 MenuBOM 試算對應</div>
      <div class="menu-warning-box__list">
        ${unmapped.map(row => `<span>${menuEscape(row.meal_label || '')}｜${menuEscape(row.dish_label || '')}｜${menuEscape(row.dish_name || '')}</span>`).join('')}
      </div>
    </div>
  ` : '';

  return `
    <section class="menu-procurement-panel">
      <div class="menu-procurement-toolbar">
        <div>
          <div class="menu-section-title menu-section-title--compact">智慧食材試算</div>
          <div class="menu-procurement-note">依 MenuBOM 計算：淨量 = 每人用量 × 供餐人數；建議採購量 = 已含耗損的估算結果。</div>
        </div>
        <label class="menu-procurement-servings">
          <span>供餐人數 / 份數</span>
          <input type="number" min="1" step="1" value="${servings}" onchange="setMenuProcurementServings(this.value)">
        </label>
      </div>
      ${rowsHtml ? `<div class="menu-procurement-grid">${rowsHtml}</div>` : emptyHtml}
      ${unmappedHtml}
    </section>
  `;
}
function renderDayDetail(){
  const box = getMenuEl("menu-day-detail");
  if (!box) return;
  const day = getSelectedDay();
  if (!day) {
    box.innerHTML = `<div class="menu-status">找不到對應日期。</div>`;
    return;
  }

  const mealCards = menuMealDefs().map(mealInfo => renderMealCard(day, mealInfo)).join("");
  const ingredientGroups = Array.isArray(day.ingredient_groups) ? day.ingredient_groups : [];
  const unmapped = Array.isArray(day.unmapped_dishes) ? day.unmapped_dishes : [];
  const procurementHtml = renderProcurementSection(day);

  let ingredientHtml = '';
  if (ingredientGroups.length) {
    ingredientHtml = `
      <div class="menu-ingredient-toolbar">
        <div class="menu-section-subtitle">對應食材</div>
        <button type="button" class="menu-bulk-btn" onclick="addSelectedDayIngredientsToCart()">將本日已填數量全部加入購物車</button>
      </div>
      ${ingredientGroups.map((group, idx) => renderIngredientGroup(day, group, idx)).join("")}
    `;
  } else {
    ingredientHtml = `
      <div class="menu-empty-tip">
        這一天尚未建立可購買食材對應。請到 Google Sheet 的 <strong>MenuIngredients</strong> 分頁補上 dish_name 與商品對應。
      </div>
    `;
  }

  const unmappedHtml = unmapped.length ? `
    <div class="menu-warning-box">
      <div class="menu-warning-box__title">以下菜色尚未建立食材對應</div>
      <div class="menu-warning-box__list">
        ${unmapped.map(row => `<span>${menuEscape(row.meal_label || '')}｜${menuEscape(row.dish_label || '')}｜${menuEscape(row.dish_name || '')}</span>`).join("")}
      </div>
    </div>
  ` : "";

  box.innerHTML = `
    <div class="menu-day-panel">
      <div class="menu-day-panel__head">
        <div>
          <h3>${menuEscape(day.display_date || day.date)} ${menuEscape(day.weekday_label || '')}</h3>
          <div class="menu-day-panel__meta">農曆：${menuEscape(day.lunar || '—')}</div>
        </div>
      </div>
      ${day.has_menu ? `
        <div class="menu-meal-grid">${mealCards}</div>
        ${procurementHtml}
        <div class="menu-section-title">可加入購物車的對應食材</div>
        ${ingredientHtml}
        ${unmappedHtml}
      ` : `
        <div class="menu-empty-tip">
          這一天目前沒有菜單資料。請先在菜單分頁補上當日午餐與晚餐內容。
        </div>
      `}
    </div>
  `;
}
function renderMenu(payload){
  MENU_CACHE = payload || null;
  updateMenuWeekLabel(payload);
  const days = getMenuDays();
  if (!days.length) {
    setMenuLayoutVisible(false);
    setMenuStatus(
      `<div class="menu-empty"><strong>這一週還沒有菜單資料。</strong><div class="menu-note">請在 Google Sheet 維護菜單分頁，並於 MenuIngredients 分頁建立 dish_name 對應商品資料。</div></div>`,
      true
    );
    return;
  }
  syncSelectedDate();
  hideMenuStatus();
  setMenuLayoutVisible(true);
  renderDateList();
  renderDayDetail();
}
function loadWeeklyMenu(){
  setMenuLayoutVisible(false);
  setMenuStatus("正在讀取菜單資料…", false);
  callGAS({ type: "weeklyMenu", offset: MENU_WEEK_OFFSET }, res => {
    if (!res || res.status !== "ok") {
      setMenuLayoutVisible(false);
      setMenuStatus(`菜單資料載入失敗：${menuEscape(res && res.message ? res.message : "未知錯誤")}`, true);
      return;
    }
    renderMenu(res);
  });
}
function selectMenuDate(date){
  MENU_SELECTED_DATE = menuText(date);
  renderDateList();
  renderDayDetail();
}
function changeMenuWeek(step){
  MENU_WEEK_OFFSET += Number(step) || 0;
  MENU_SELECTED_DATE = "";
  loadWeeklyMenu();
}
function resetMenuWeek(){
  MENU_WEEK_OFFSET = 0;
  MENU_SELECTED_DATE = "";
  loadWeeklyMenu();
}
function pushCartItemSilently(item, qty){
  if (!item || !item.id) return false;
  const addQty = menuQty(qty);
  if (typeof getCart !== "function" || typeof setCart !== "function") {
    if (typeof addToCart === "function") {
      addToCart(item, addQty);
      return true;
    }
    return false;
  }
  const cart = getCart();
  const exist = cart.find(i => String(i.id) === String(item.id));
  if (exist) {
    exist.qty = menuQty(Number(exist.qty || 0) + addQty);
  } else {
    cart.push({ ...item, qty: addQty });
  }
  setCart(cart);
  if (typeof updateCartCount === "function") updateCartCount();
  return true;
}
function addMenuIngredientToCart(item, qtyInputId){
  if (!item || !item.id) return;
  const qtyEl = qtyInputId ? document.getElementById(qtyInputId) : null;
  const qty = qtyEl ? menuQty(qtyEl.value) : 1;
  if (typeof addToCart === "function") {
    addToCart(item, qty);
  } else {
    pushCartItemSilently(item, qty);
    alert(`${item.name} 已加入購物車（${qty} 件）`);
  }
}
function addSelectedDayIngredientsToCart(){
  const day = getSelectedDay();
  if (!day || !Array.isArray(day.ingredient_groups) || !day.ingredient_groups.length) {
    alert("這一天目前沒有可加入購物車的對應食材。");
    return;
  }
  let addedRows = 0;
  let addedQty = 0;
  day.ingredient_groups.forEach((group, groupIndex) => {
    (group.items || []).forEach((item, itemIndex) => {
      const inputId = menuInputId(day.date, groupIndex, itemIndex, item.product_id || item.id || item.sku);
      const input = document.getElementById(inputId);
      const raw = input ? Number(input.value) : Number(item.default_qty || 1);
      if (!Number.isFinite(raw) || raw <= 0) return;
      const qty = menuQty(raw);
      const ok = pushCartItemSilently({
        id: menuText(item.product_id || item.id || item.sku),
        sku: menuText(item.sku || item.product_id || item.id),
        name: menuText(item.product_name || item.name),
        price: menuNum(item.price, 0)
      }, qty);
      if (ok) {
        addedRows += 1;
        addedQty += qty;
      }
    });
  });
  if (!addedRows) {
    alert("請先填入有效數量，再加入購物車。");
    return;
  }
  alert(`已將 ${addedRows} 項食材、共 ${addedQty} 件加入購物車。`);
}

function openWeeklyMenuModal(event){
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const triggeredByClick = !!(event && typeof event.preventDefault === 'function');
  if (isStandaloneWeeklyMenuPage()) {
    if (triggeredByClick) {
      MENU_WEEK_OFFSET = 0;
      MENU_SELECTED_DATE = "";
    }
    loadWeeklyMenu();
    return false;
  }
  ensureWeeklyMenuModal();
  const modal = getMenuEl('weekly-menu-modal');
  if (!modal) return false;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('weekly-menu-modal-open');
  if (triggeredByClick) {
    MENU_WEEK_OFFSET = 0;
    MENU_SELECTED_DATE = "";
  }
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
    if (isShopIndexMenuRail()) loadShopMenuRail();
  }
});
