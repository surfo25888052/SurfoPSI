let MENU_DASHBOARD_MONTH = "";
let MENU_DASHBOARD_SELECTED_DATE = "";
let MENU_DASHBOARD_VIEW = "menu";
let MENU_DASHBOARD_SERVINGS = 100;
let MENU_DASHBOARD_CACHE = null;

const MENU_CLIENT_CACHE_VERSION = 'v2';
const MENU_WEEK_CACHE_MAX_AGE = 90 * 1000;
const MENU_DASHBOARD_CACHE_MAX_AGE = 45 * 1000;
const MENU_DASHBOARD_PREFETCH_DELAY = 900;
const MENU_API_INFLIGHT = {};

function menuText(v){ return String(v ?? "").trim(); }
function menuEscape(v){ return menuText(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function menuNum(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }
function menuQty(v){ const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 1; }
function menuIntQty(v){ const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 1; }
function menuFormatAmount(v, digits=0){
  const n = Number(v);
  if (!Number.isFinite(n)) return digits > 0 ? (0).toFixed(digits) : '0';
  if (digits > 0) return n.toFixed(digits).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
  return String(Math.round(n));
}
function menuFormatWeight(v, unit){
  const n = Number(v);
  const rawUnit = menuText(unit) || 'g';
  if (!Number.isFinite(n)) return { value: '0', unit: rawUnit.toUpperCase(), sub: '' };
  if (/^(g|公克|克)$/i.test(rawUnit) && Math.abs(n) >= 1000) return { value: menuFormatAmount(n / 1000, 2), unit: 'KG', sub: `(${menuFormatAmount(n,0)}g)` };
  return { value: menuFormatAmount(n, /^(kg|公斤)$/i.test(rawUnit) ? 2 : 0), unit: rawUnit.toUpperCase(), sub: '' };
}
function menuTodayIso(){ const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
function menuMonthKeyFromDate(dateStr){ const text = menuText(dateStr); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(0,7) : menuTodayIso().slice(0,7); }
function menuShiftMonth(monthKey, delta){ const base = /^\d{4}-\d{2}$/.test(menuText(monthKey)) ? `${monthKey}-01` : `${menuTodayIso().slice(0,7)}-01`; const dt = new Date(`${base}T00:00:00`); dt.setMonth(dt.getMonth() + Number(delta || 0)); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }
function getMenuEl(id){ return document.getElementById(id); }
function isStandaloneWeeklyMenuPage(){ return !!getMenuEl('menu-dashboard-page-root'); }
function menuStorage(){ try { return window.sessionStorage; } catch (_) { return null; } }
function menuClientCacheKey(kind, key){ return `menu-cache:${MENU_CLIENT_CACHE_VERSION}:${kind}:${key}`; }
function getMenuClientCache(kind, key){
  const storage = menuStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(menuClientCacheKey(kind, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null;
    parsed.ageMs = Date.now() - Number(parsed.ts || 0);
    return parsed;
  } catch (_) {
    return null;
  }
}
function setMenuClientCache(kind, key, data){
  const storage = menuStorage();
  if (!storage) return;
  try {
    storage.setItem(menuClientCacheKey(kind, key), JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}
function menuApiRequest(type, payload, cacheKind, cacheKey, maxAgeMs, options){
  options = options || {};
  const cached = options.forceRefresh ? null : getMenuClientCache(cacheKind, cacheKey);
  if (cached && typeof options.onCached === 'function') options.onCached(cached.data, cached.ageMs);
  const cacheFresh = !!(cached && cached.ageMs <= maxAgeMs);
  const shouldFetch = options.forceRefresh || !cacheFresh || !!options.revalidate;
  if (!shouldFetch) return;
  const inflightKey = `${type}:${cacheKey}`;
  const waiters = MENU_API_INFLIGHT[inflightKey];
  const waiter = {
    onFresh: typeof options.onFresh === 'function' ? options.onFresh : null,
    onError: typeof options.onError === 'function' ? options.onError : null,
    hadCache: !!cached
  };
  if (waiters) {
    waiters.push(waiter);
    return;
  }
  MENU_API_INFLIGHT[inflightKey] = [waiter];
  callGAS({ type, ...payload }, res => {
    const doneWaiters = Array.isArray(MENU_API_INFLIGHT[inflightKey]) ? MENU_API_INFLIGHT[inflightKey].slice() : [];
    delete MENU_API_INFLIGHT[inflightKey];
    if (!res || res.status !== 'ok') {
      doneWaiters.forEach(item => {
        if (item && typeof item.onError === 'function') {
          try { item.onError(res, !!item.hadCache); } catch (_) {}
        }
      });
      return;
    }
    setMenuClientCache(cacheKind, cacheKey, res);
    doneWaiters.forEach(item => {
      if (item && typeof item.onFresh === 'function') {
        try { item.onFresh(res, !!item.hadCache); } catch (_) {}
      }
    });
  });
}

function menuDashboardShellHtml(isModal){
  return `<div class="menu-dashboard-shell${isModal ? ' is-modal' : ''}">
    <aside class="menu-dashboard-sidebar">
      <div class="menu-dashboard-brand">
        <div class="menu-dashboard-brand__logo">YQ</div>
        <div><h1>共同採購平台</h1><p>每日菜單與採購試算</p></div>
      </div>
      <section class="menu-calendar-panel">
        <div class="menu-calendar-panel__head">
          <div>
            <div class="menu-calendar-panel__eyebrow">Navigator</div>
            <div id="menu-dashboard-month-label" class="menu-calendar-panel__month">載入中…</div>
          </div>
          <div class="menu-calendar-panel__nav">
            <button type="button" onclick="changeMenuDashboardMonth(-1)">‹</button>
            <button type="button" onclick="resetMenuDashboardMonth()">●</button>
            <button type="button" onclick="changeMenuDashboardMonth(1)">›</button>
          </div>
        </div>
        <div class="menu-calendar-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
        <div id="menu-dashboard-calendar" class="menu-calendar-grid"></div>
      </section>
    </aside>
    <section class="menu-dashboard-main">
      <div class="menu-dashboard-topbar">
        <div class="menu-dashboard-tabs">
          <button id="menu-tab-menu" type="button" class="menu-dashboard-tab is-active" onclick="setMenuDashboardView('menu')">每日菜單</button>
          <button id="menu-tab-procurement" type="button" class="menu-dashboard-tab" onclick="setMenuDashboardView('procurement')">採購試算</button>
        </div>
        <div class="menu-dashboard-actions">
          <a href="index.html" class="menu-dashboard-link">採購平台</a>
          ${isModal ? '<button type="button" class="menu-dashboard-close" onclick="closeWeeklyMenuModal()">✕</button>' : ''}
        </div>
      </div>
      <div id="menu-dashboard-status" class="menu-dashboard-status">正在讀取菜單資料…</div>
      <div id="menu-dashboard-view"></div>
    </section>
  </div>`;
}
function ensureWeeklyMenuModal(){
  if (isStandaloneWeeklyMenuPage() || getMenuEl('weekly-menu-modal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div id="weekly-menu-modal" class="weekly-menu-modal" aria-hidden="true"><div class="weekly-menu-modal__backdrop" onclick="closeWeeklyMenuModal()"></div><div class="weekly-menu-modal__dialog">${menuDashboardShellHtml(true)}</div></div>`;
  document.body.appendChild(wrap.firstElementChild);
}
function initStandaloneDashboard(){ const root = getMenuEl('menu-dashboard-page-root'); if (root) root.innerHTML = menuDashboardShellHtml(false); }
function setMenuDashboardStatus(text, isError){ const box = getMenuEl('menu-dashboard-status'); if (!box) return; box.style.display=''; box.className = `menu-dashboard-status${isError ? ' is-error' : ''}`; box.innerHTML = text; }
function hideMenuDashboardStatus(){ const box = getMenuEl('menu-dashboard-status'); if (box) box.style.display='none'; }
function currentMenuDay(){ return MENU_DASHBOARD_CACHE && MENU_DASHBOARD_CACHE.selected_day ? MENU_DASHBOARD_CACHE.selected_day : null; }
function syncMenuDashboardMeta(){ const month = getMenuEl('menu-dashboard-month-label'); if (month) month.textContent = MENU_DASHBOARD_CACHE ? menuText(MENU_DASHBOARD_CACHE.month_label || MENU_DASHBOARD_CACHE.month || '') : ''; }
function setMenuDashboardView(view){ MENU_DASHBOARD_VIEW = ['menu','procurement'].includes(view) ? view : 'menu'; ['menu','procurement'].forEach(key => { const btn = getMenuEl(`menu-tab-${key}`); if (btn) btn.classList.toggle('is-active', MENU_DASHBOARD_VIEW === key); }); renderMenuDashboardView(); }
function changeMenuDashboardMonth(step){ MENU_DASHBOARD_MONTH = menuShiftMonth(MENU_DASHBOARD_MONTH || menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE || menuTodayIso()), step); MENU_DASHBOARD_SELECTED_DATE = `${MENU_DASHBOARD_MONTH}-01`; loadMenuDashboard({ forceRefresh: true }); }
function resetMenuDashboardMonth(){ MENU_DASHBOARD_MONTH = menuTodayIso().slice(0,7); MENU_DASHBOARD_SELECTED_DATE = menuTodayIso(); loadMenuDashboard({ forceRefresh: true }); }
function selectMenuDashboardDate(date){ MENU_DASHBOARD_SELECTED_DATE = menuText(date); MENU_DASHBOARD_MONTH = menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE); loadMenuDashboard(); }
function openWeeklyMenuModalForDate(date){ MENU_DASHBOARD_SELECTED_DATE = menuText(date) || menuTodayIso(); MENU_DASHBOARD_MONTH = menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE); MENU_DASHBOARD_VIEW = 'menu'; return openWeeklyMenuModal(); }
function openTodayMenuModal(event){ MENU_DASHBOARD_SELECTED_DATE = menuTodayIso(); MENU_DASHBOARD_MONTH = menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE); MENU_DASHBOARD_VIEW = 'menu'; return openWeeklyMenuModal(event); }
function openWeeklyMenuModal(event){
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (isStandaloneWeeklyMenuPage()) {
    if (!MENU_DASHBOARD_SELECTED_DATE) MENU_DASHBOARD_SELECTED_DATE = menuTodayIso();
    if (!MENU_DASHBOARD_MONTH) MENU_DASHBOARD_MONTH = menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE);
    loadMenuDashboard();
    return false;
  }
  ensureWeeklyMenuModal();
  const modal = getMenuEl('weekly-menu-modal');
  if (!modal) return false;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('weekly-menu-modal-open');
  if (!MENU_DASHBOARD_SELECTED_DATE) MENU_DASHBOARD_SELECTED_DATE = menuTodayIso();
  if (!MENU_DASHBOARD_MONTH) MENU_DASHBOARD_MONTH = menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE);
  loadMenuDashboard();
  return false;
}
function closeWeeklyMenuModal(){ const modal = getMenuEl('weekly-menu-modal'); if (!modal) return; modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); document.body.classList.remove('weekly-menu-modal-open'); }
function bindWeeklyMenuTriggers(){
  document.addEventListener('click', function(e){
    const link = e.target.closest('a[href="weekly-menu.html"], a[href="./weekly-menu.html"], [data-weekly-menu-open="1"]');
    if (!link || isStandaloneWeeklyMenuPage()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (link.target && link.target === '_blank')) return;
    openWeeklyMenuModal(e);
  });
}
function applyMenuDashboardResponse(res){
  MENU_DASHBOARD_CACHE = res;
  MENU_DASHBOARD_MONTH = menuText(res.month || MENU_DASHBOARD_MONTH);
  MENU_DASHBOARD_SELECTED_DATE = menuText(res.selected_date || MENU_DASHBOARD_SELECTED_DATE);
  syncMenuDashboardMeta();
  renderMenuDashboardCalendar();
  renderMenuDashboardView();
  hideMenuDashboardStatus();
}
function loadMenuDashboard(options){
  options = options || {};
  const month = MENU_DASHBOARD_MONTH || menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE || menuTodayIso());
  const date = MENU_DASHBOARD_SELECTED_DATE || `${month}-01`;
  const cacheKey = `${month}|${date}`;
  let hadCached = false;
  menuApiRequest('menuDashboard', { month, date }, 'dashboard', cacheKey, MENU_DASHBOARD_CACHE_MAX_AGE, {
    forceRefresh: !!options.forceRefresh,
    onCached: (cachedData) => {
      hadCached = true;
      applyMenuDashboardResponse(cachedData);
    },
    onFresh: (freshData) => applyMenuDashboardResponse(freshData),
    onError: (res, hadCache) => {
      if (hadCache) return;
      MENU_DASHBOARD_CACHE = null;
      setMenuDashboardStatus(`菜單資料載入失敗：${menuEscape(res && res.message ? res.message : '未知錯誤')}`, true);
    }
  });
  if (!hadCached) setMenuDashboardStatus('正在讀取菜單資料…', false);
}
function prefetchTodayMenuDashboard(){
  if (isStandaloneWeeklyMenuPage()) return;
  const today = menuTodayIso();
  const month = menuMonthKeyFromDate(today);
  const cacheKey = `${month}|${today}`;
  if (getMenuClientCache('dashboard', cacheKey)) return;
  menuApiRequest('menuDashboard', { month, date: today }, 'dashboard', cacheKey, MENU_DASHBOARD_CACHE_MAX_AGE, { revalidate: true });
}
function renderMenuDashboardCalendar(){
  const box = getMenuEl('menu-dashboard-calendar');
  const payload = MENU_DASHBOARD_CACHE;
  if (!box || !payload) return;
  const days = Array.isArray(payload.calendar_days) ? payload.calendar_days : [];
  if (!days.length){ box.innerHTML=''; return; }
  const firstDate = days[0] && days[0].date ? new Date(`${days[0].date}T00:00:00`) : new Date();
  const blanks = Array.from({ length: firstDate.getDay() }, () => '<span class="menu-calendar-grid__blank"></span>').join('');
  const todayIso = menuTodayIso();
  box.innerHTML = blanks + days.map(day => `<button type="button" class="menu-calendar-cell${menuText(day.date) === menuText(MENU_DASHBOARD_SELECTED_DATE) ? ' is-active' : ''}${menuText(day.date) === todayIso ? ' is-today' : ''}" onclick="selectMenuDashboardDate('${menuEscape(day.date)}')"><span class="menu-calendar-cell__day">${menuEscape(day.day)}</span><span class="menu-calendar-cell__dot${day.has_menu ? ' has-menu' : ''}"></span></button>`).join('');
}
function dashboardMealDefs(){ return [{ key:'lunch', label:'午餐', tone:'lunch' }, { key:'dinner', label:'晚餐', tone:'dinner' }]; }
function dashboardDishDefs(){ return [{ key:'main', label:'主菜' }, { key:'side', label:'小配菜' }, { key:'light_veg', label:'淺色蔬菜' }, { key:'dark_veg', label:'深色蔬菜' }, { key:'root_veg', label:'根莖瓜果' }]; }
function renderMenuMealCard(day, mealInfo){
  const meal = day && day.meals ? day.meals[mealInfo.key] || {} : {};
  const rows = dashboardDishDefs().map((dish, idx) => {
    return `<div class="menu-meal-row"><div class="menu-meal-row__index">${idx + 1}</div><div class="menu-meal-row__name">${menuEscape(meal[dish.key] || '—')}</div><div class="menu-meal-row__tag">${menuEscape(dish.label)}</div></div>`;
  }).join('');
  return `<section class="menu-meal-card menu-meal-card--${menuEscape(mealInfo.tone)}"><div class="menu-meal-card__head">${menuEscape(mealInfo.label)}</div><div class="menu-meal-card__body">${rows}</div></section>`;
}
function renderAnalysisMetric(label, value, unit, progress, target){ const pct = Math.max(0, Math.min(100, Math.round(Number(progress || 0) * 100))); return `<div class="menu-analysis-metric"><div class="menu-analysis-metric__label">${menuEscape(label)}</div><div class="menu-analysis-metric__value">${menuEscape(value)}<small>${menuEscape(unit)}</small></div><div class="menu-analysis-metric__target">建議值 ${menuEscape(target)} ${menuEscape(unit)}</div><div class="menu-analysis-metric__bar"><span style="width:${pct}%"></span></div></div>`; }
function renderMenuTab(day){
  if (!day || !day.has_menu) return `<section class="menu-panel-empty"><h3>這一天尚未建立菜單</h3><p>請先在 Google Sheet 菜單分頁建立當日午餐與晚餐內容。</p></section>`;
  const nutrition = day.nutrition_summary || {};
  const progress = nutrition.progress || {};
  return `<section class="menu-dashboard-section"><div class="menu-meal-board">${dashboardMealDefs().map(meal => renderMenuMealCard(day, meal)).join('')}</div><section class="menu-analysis-panel"><div class="menu-analysis-panel__title">國健署飲食對標分析（每人平均）</div><div class="menu-analysis-grid">${renderAnalysisMetric('熱量估計', menuFormatAmount(nutrition.calories,0), 'kcal', progress.calories, nutrition.targets ? nutrition.targets.calories : 1800)}${renderAnalysisMetric('蛋白質', menuFormatAmount(nutrition.protein,1), 'g', progress.protein, nutrition.targets ? nutrition.targets.protein : 65)}${renderAnalysisMetric('蔬菜總量', menuFormatAmount(nutrition.vegetables,0), 'g', progress.vegetables, nutrition.targets ? nutrition.targets.vegetables : 300)}${renderAnalysisMetric('全穀雜糧', menuFormatAmount(nutrition.grains,0), 'g', progress.grains, nutrition.targets ? nutrition.targets.grains : 220)}</div><div class="menu-analysis-panel__note">${menuEscape(nutrition.formula_note || '依菜單與 BOM 結構估算每人平均對標值。')}</div></section></section>`;
}
function setMenuDashboardServings(value){ MENU_DASHBOARD_SERVINGS = menuQty(value || 1); renderMenuDashboardView(); }
function renderProcurementRow(item){
  const servings = menuQty(MENU_DASHBOARD_SERVINGS || 1);
  const net = menuNum(item.per_person_net,0) * servings;
  const loss = menuNum(item.per_person_loss,0) * servings;
  const gross = menuNum(item.per_person_gross,0) * servings;
  const netFmt = menuFormatWeight(net, item.qty_unit || item.unit || 'g');
  const lossFmt = menuFormatWeight(loss, item.qty_unit || item.unit || 'g');
  const grossFmt = menuFormatWeight(gross, item.qty_unit || item.unit || 'g');
  return `<div class="menu-proc-row"><div class="menu-proc-row__item"><div class="menu-proc-row__icon">◫</div><div><div class="menu-proc-row__name">${menuEscape(item.product_name || '未命名食材')}</div><div class="menu-proc-row__meta">${menuEscape(item.category || '')}${item.spec ? `｜${menuEscape(item.spec)}` : ''}${item.has_linked_product ? '' : '｜未連商品主檔'}</div><div class="menu-proc-row__sources">${(item.source_dishes || []).map(v => `<span>${menuEscape(v)}</span>`).join('')}</div></div></div><div class="menu-proc-row__metric"><strong>${menuEscape(netFmt.value)}</strong><small>${menuEscape(netFmt.unit)}</small>${netFmt.sub ? `<em>${menuEscape(netFmt.sub)}</em>` : ''}</div><div class="menu-proc-row__metric menu-proc-row__metric--warn"><strong>${menuEscape(lossFmt.value)}</strong><small>${menuEscape(lossFmt.unit)}</small>${lossFmt.sub ? `<em>${menuEscape(lossFmt.sub)}</em>` : ''}</div><div class="menu-proc-row__metric menu-proc-row__metric--accent"><strong>${menuEscape(grossFmt.value)}</strong><small>${menuEscape(grossFmt.unit)}</small>${grossFmt.sub ? `<em>${menuEscape(grossFmt.sub)}</em>` : ''}</div></div>`;
}
function menuIngredientInputId(date, groupIndex, itemIndex, productId){ return `menu-qty-${menuText(date).replace(/[^0-9]/g,'')}-${groupIndex}-${itemIndex}-${menuText(productId).replace(/[^\w\-]/g,'')}`; }
function renderIngredientGroup(day, group, groupIndex){
  const items = Array.isArray(group && group.items) ? group.items : [];
  return `<section class="menu-quickbuy-group"><div class="menu-quickbuy-group__head"><div class="menu-quickbuy-group__tag">${menuEscape(group.meal_label || '')}｜${menuEscape(group.dish_label || '')}</div><h4>${menuEscape(group.dish_name || '')}</h4></div><div class="menu-quickbuy-grid">${items.map((item, itemIndex) => { const inputId = menuIngredientInputId(day.date, groupIndex, itemIndex, item.product_id || item.id || item.sku); const itemJson = JSON.stringify({ id:menuText(item.product_id || item.id || item.sku), sku:menuText(item.sku || item.product_id || item.id), name:menuText(item.product_name || item.name), price:menuNum(item.price,0) }).replace(/'/g,'&#39;'); return `<article class="menu-quickbuy-card"><div class="menu-quickbuy-card__title">${menuEscape(item.product_name || item.name || '')}</div><div class="menu-quickbuy-card__meta">${item.spec ? `<span>${menuEscape(item.spec)}</span>` : ''}${item.unit ? `<span>單位 ${menuEscape(item.unit)}</span>` : ''}<span>單價 $${menuEscape(menuFormatAmount(item.price,0))}</span></div><div class="menu-quickbuy-card__actions"><input id="${menuEscape(inputId)}" type="number" min="1" step="1" value="${menuIntQty(item.default_qty || 1)}"><button type="button" onclick='addMenuIngredientToCart(${itemJson}, "${menuEscape(inputId)}")'>加入購物車</button></div></article>`; }).join('')}</div></section>`;
}
function pushCartItemSilently(item, qty){
  if (!item || !item.id) return false;
  const addQty = menuIntQty(qty);
  if (typeof getCart !== 'function' || typeof setCart !== 'function') { if (typeof addToCart === 'function') { addToCart(item, addQty); return true; } return false; }
  const cart = getCart();
  const exist = cart.find(i => String(i.id) === String(item.id));
  if (exist) exist.qty = menuIntQty(Number(exist.qty || 0) + addQty);
  else cart.push({ ...item, qty: addQty });
  setCart(cart);
  if (typeof updateCartCount === 'function') updateCartCount();
  return true;
}
function addMenuIngredientToCart(item, qtyInputId){ if (!item || !item.id) return; const qtyEl = qtyInputId ? document.getElementById(qtyInputId) : null; const qty = qtyEl ? menuIntQty(qtyEl.value) : 1; if (typeof addToCart === 'function') addToCart(item, qty); else { pushCartItemSilently(item, qty); alert(`${item.name} 已加入購物車（${qty} 件）`); } }
function addSelectedDayIngredientsToCart(){
  const day = currentMenuDay();
  if (!day || !Array.isArray(day.ingredient_groups) || !day.ingredient_groups.length) { alert('這一天目前沒有可加入購物車的對應食材。'); return; }
  let addedRows = 0;
  day.ingredient_groups.forEach((group, groupIndex) => {
    (group.items || []).forEach((item, itemIndex) => {
      const inputId = menuIngredientInputId(day.date, groupIndex, itemIndex, item.product_id || item.id || item.sku);
      const input = document.getElementById(inputId);
      const raw = input ? Number(input.value) : Number(item.default_qty || 1);
      if (!Number.isFinite(raw) || raw <= 0) return;
      const ok = pushCartItemSilently({ id:menuText(item.product_id || item.id || item.sku), sku:menuText(item.sku || item.product_id || item.id), name:menuText(item.product_name || item.name), price:menuNum(item.price,0) }, menuIntQty(raw));
      if (ok) addedRows += 1;
    });
  });
  if (!addedRows) { alert('請先填入有效數量，再加入購物車。'); return; }
  alert(`已將 ${addedRows} 項食材加入購物車。`);
}
function renderProcurementTab(day){
  if (!day || !day.has_menu) return `<section class="menu-panel-empty"><h3>這一天尚未建立菜單</h3><p>請先建立當日午餐與晚餐內容，再進行採購試算。</p></section>`;
  const items = Array.isArray(day.procurement_items) ? day.procurement_items : [];
  const groups = Array.isArray(day.ingredient_groups) ? day.ingredient_groups : [];
  const unmapped = Array.isArray(day.procurement_unmapped_dishes) ? day.procurement_unmapped_dishes : [];
  const servings = menuQty(MENU_DASHBOARD_SERVINGS || 1);
  const groupHtml = groups.length ? `<section class="menu-quickbuy-panel"><div class="menu-quickbuy-panel__head"><div><div class="menu-section-mini">對應食材 / 快速加入購物車</div><p>這一區使用菜單管理中的「加入購物車」用途，方便將已建好的商品直接加入購物車。</p></div><button type="button" class="menu-bulk-btn" onclick="addSelectedDayIngredientsToCart()">本日食材全部加入購物車</button></div>${groups.map((group, idx) => renderIngredientGroup(day, group, idx)).join('')}</section>` : '';
  return `<section class="menu-dashboard-section"><div class="menu-proc-hero"><div><div class="menu-proc-hero__title">智慧食材採購清單</div><div class="menu-proc-hero__sub">上方輸入供餐人數，下方會直接帶入當日菜單對應的原形食材與建議採購量。</div></div><label class="menu-proc-hero__count"><span>供餐人數</span><input type="number" min="1" step="1" value="${menuEscape(menuFormatAmount(servings,0))}" onchange="setMenuDashboardServings(this.value)"></label></div><div class="menu-proc-board"><div class="menu-proc-board__head"><span>食材原形（BOM 子件）</span><span>必須使用量（淨重）</span><span>預估耗損量</span><span>建議採購量（毛重）</span></div>${items.length ? items.map(item => renderProcurementRow(item)).join('') : `<div class="menu-panel-empty is-inline"><h3>尚未建立採購試算對應</h3><p>請在菜單管理勾選「採購試算」，並填寫每人用量與耗損率。</p></div>`}</div>${unmapped.length ? `<div class="menu-warning-box"><div class="menu-warning-box__title">以下菜色尚未建立採購試算對應</div><div class="menu-warning-box__list">${unmapped.map(v => `<span>${menuEscape(v.meal_label || '')}｜${menuEscape(v.dish_name || '')}</span>`).join('')}</div></div>` : ''}<div class="menu-proc-footnote">${menuEscape(`採購量計算＝(每人淨量 × ${menuFormatAmount(servings,0)} 人) ÷ (1 - 耗損率)。`)}</div>${groupHtml}</section>`;
}
function renderMenuDashboardView(){ const box = getMenuEl('menu-dashboard-view'); if (!box) return; const day = currentMenuDay(); if (!MENU_DASHBOARD_CACHE) { box.innerHTML=''; return; } box.innerHTML = MENU_DASHBOARD_VIEW === 'procurement' ? renderProcurementTab(day) : renderMenuTab(day); }

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWeeklyMenuModal(); });
document.addEventListener('DOMContentLoaded', () => {
  bindWeeklyMenuTriggers();
  if (typeof updateMemberArea === 'function') updateMemberArea();
  if (typeof updateCartCount === 'function') updateCartCount();
  if (isStandaloneWeeklyMenuPage()) {
    initStandaloneDashboard();
    MENU_DASHBOARD_SELECTED_DATE = menuTodayIso();
    MENU_DASHBOARD_MONTH = menuMonthKeyFromDate(MENU_DASHBOARD_SELECTED_DATE);
    loadMenuDashboard();
  } else {
    ensureWeeklyMenuModal();
    setTimeout(prefetchTodayMenuDashboard, MENU_DASHBOARD_PREFETCH_DELAY);
  }
});
