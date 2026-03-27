(function(){
  const state = {
    loaded: false,
    loading: false,
    rows: [],
    dishOptions: [],
    editing: null
  };

  function el(id){ return document.getElementById(id); }
  function safeText(v){
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function trim(v){ return String(v == null ? '' : v).trim(); }
  function productList_(){
    const live = (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : null;
    const list = live || ((typeof LS !== 'undefined' && LS && typeof LS.get === 'function') ? (LS.get('products', []) || []) : []);
    return Array.isArray(list) ? list : [];
  }
  function findProductById_(id){
    const key = trim(id);
    if (!key) return null;
    return productList_().find(p => trim(p?.id) === key) || null;
  }
  function productLabel_(p){
    if (!p) return '';
    const sku = trim(p.sku || p.part_no || p.code || p.id);
    const name = trim(p.name);
    return sku ? `${sku} - ${name}` : name;
  }
  function renderProductChip_(product, fallback){
    const node = el('menu-map-product-chip');
    if (!node) return;
    if (product) {
      const spec = trim(product.spec);
      const unit = trim(product.unit);
      const bits = [];
      if (spec) bits.push(`規格：${spec}`);
      if (unit) bits.push(`單位：${unit}`);
      node.innerHTML = `<strong>${safeText(productLabel_(product))}</strong><span>${safeText(bits.join('｜') || '已選商品')}</span>`;
      return;
    }
    node.textContent = fallback || '尚未選擇商品';
  }
  function setStatus_(text, isError){
    const node = el('menu-mapping-status');
    if (!node) return;
    node.textContent = text || '';
    node.style.color = isError ? '#B71C1C' : '#64748B';
  }
  function statsFromRows_(rows){
    const stats = { total: 0, ingredient: 0, bom: 0, both: 0 };
    (Array.isArray(rows) ? rows : []).forEach(row => {
      stats.total += 1;
      const t = targetInfo_(row.mapping_targets || row.target || row.mode);
      if (t.ingredient) stats.ingredient += 1;
      if (t.bom) stats.bom += 1;
      if (t.ingredient && t.bom) stats.both += 1;
    });
    return stats;
  }
  function renderStats_(stats){
    el('menu-map-stat-total').textContent = String(stats.total || 0);
    el('menu-map-stat-ingredient').textContent = String(stats.ingredient || 0);
    el('menu-map-stat-bom').textContent = String(stats.bom || 0);
    el('menu-map-stat-both').textContent = String(stats.both || 0);
  }
  function updateDishOptions_(){
    const list = el('menu-dish-options');
    const pillWrap = el('menu-mapping-dish-pills');
    if (list) {
      list.innerHTML = (state.dishOptions || []).map(v => `<option value="${safeText(v)}"></option>`).join('');
    }
    if (pillWrap) {
      const top = (state.dishOptions || []).slice(0, 50);
      pillWrap.innerHTML = top.length
        ? top.map(v => `<button type="button" class="menu-mapping-dish-pill" data-dish="${safeText(v)}">${safeText(v)}</button>`).join('')
        : '<span class="menu-mapping-muted">尚未從菜單分頁抓到菜色</span>';
    }
  }
  function normalizeTargetToken_(v){
    const s = trim(v).toLowerCase();
    if (!s) return '';
    if (['both','all','全部','雙用途'].includes(s)) return 'both';
    if (s.includes('ingredient') || s.includes('cart') || s.includes('shop') || s.includes('食材') || s.includes('購物')) return 'ingredient';
    if (s.includes('bom') || s.includes('procurement') || s.includes('採購') || s.includes('試算')) return 'bom';
    return s;
  }
  function targetInfo_(raw){
    const values = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,|/、]+/);
    let ingredient = false;
    let bom = false;
    values.forEach(v => {
      const token = normalizeTargetToken_(v);
      if (token === 'both') { ingredient = true; bom = true; return; }
      if (token === 'ingredient') ingredient = true;
      if (token === 'bom') bom = true;
    });
    if (!ingredient && !bom) ingredient = true;
    return {
      ingredient,
      bom,
      text: ingredient && bom ? 'both' : (bom ? 'bom' : 'ingredient'),
      label: ingredient && bom ? '雙用途' : (bom ? '採購試算' : '加入購物車')
    };
  }
  function targetChipsHtml_(row){
    const t = targetInfo_(row.mapping_targets || row.target || row.mode);
    if (t.ingredient && t.bom) {
      return '<span class="menu-mapping-purpose-chip both">加入購物車 + 採購試算</span>';
    }
    if (t.ingredient) return '<span class="menu-mapping-purpose-chip ingredient">加入購物車</span>';
    return '<span class="menu-mapping-purpose-chip bom">採購試算</span>';
  }
  function syncFieldState_(){
    const ingredientOn = !!el('menu-map-target-ingredient')?.checked;
    const bomOn = !!el('menu-map-target-bom')?.checked;
    const ingredientFields = ['menu-map-default-qty'];
    const bomFields = ['menu-map-per-person-qty','menu-map-loss-rate','menu-map-qty-unit','menu-map-category'];
    ingredientFields.forEach(id => {
      const n = el(id);
      if (!n) return;
      n.disabled = !ingredientOn;
      n.closest('.field')?.style.setProperty('opacity', ingredientOn ? '1' : '.55');
    });
    bomFields.forEach(id => {
      const n = el(id);
      if (!n) return;
      n.disabled = !bomOn;
      n.closest('.field')?.style.setProperty('opacity', bomOn ? '1' : '.55');
    });
  }
  function formPayload_(){
    const productId = trim(el('menu-map-product-id')?.value);
    const product = findProductById_(productId);
    const ingredient = !!el('menu-map-target-ingredient')?.checked;
    const bom = !!el('menu-map-target-bom')?.checked;
    return {
      row_no: state.editing?.row_no || '',
      dish_name: trim(el('menu-map-dish')?.value),
      product_id: productId,
      product_name: trim(product?.name),
      spec: trim(product?.spec),
      mapping_targets: ingredient && bom ? 'both' : (bom ? 'bom' : 'ingredient'),
      enabled: trim(el('menu-map-enabled')?.value || '1'),
      sort_no: trim(el('menu-map-sort-no')?.value || '1'),
      default_qty: trim(el('menu-map-default-qty')?.value || '1'),
      category: trim(el('menu-map-category')?.value),
      per_person_qty: trim(el('menu-map-per-person-qty')?.value),
      loss_rate: trim(el('menu-map-loss-rate')?.value),
      qty_unit: trim(el('menu-map-qty-unit')?.value || product?.unit),
      note: trim(el('menu-map-note')?.value)
    };
  }
  function resetForm_(){
    state.editing = null;
    el('menu-map-dish').value = '';
    el('menu-map-product-combo').value = '';
    el('menu-map-product-id').value = '';
    el('menu-map-target-ingredient').checked = true;
    el('menu-map-target-bom').checked = true;
    el('menu-map-default-qty').value = '1';
    el('menu-map-category').value = '';
    el('menu-map-per-person-qty').value = '';
    el('menu-map-loss-rate').value = '';
    el('menu-map-qty-unit').value = '';
    el('menu-map-sort-no').value = '1';
    el('menu-map-enabled').value = '1';
    el('menu-map-note').value = '';
    renderProductChip_(null);
    if (el('menu-map-cancel')) el('menu-map-cancel').style.display = 'none';
    if (el('menu-map-editing')) el('menu-map-editing').style.display = 'none';
    syncFieldState_();
  }
  function fillForm_(row){
    state.editing = row || null;
    const t = targetInfo_(row?.mapping_targets || row?.target || row?.mode);
    el('menu-map-dish').value = trim(row?.dish_name);
    el('menu-map-product-combo').value = trim(row?.display_product_label || row?.product_label || row?.product_name);
    el('menu-map-product-id').value = trim(row?.product_id);
    el('menu-map-target-ingredient').checked = t.ingredient;
    el('menu-map-target-bom').checked = t.bom;
    el('menu-map-default-qty').value = String(row?.default_qty || '1');
    el('menu-map-category').value = trim(row?.category);
    el('menu-map-per-person-qty').value = trim(row?.per_person_qty);
    el('menu-map-loss-rate').value = trim(row?.loss_rate);
    el('menu-map-qty-unit').value = trim(row?.qty_unit);
    el('menu-map-sort-no').value = String(row?.sort_no || '1');
    el('menu-map-enabled').value = String(row?.enabled || '1');
    el('menu-map-note').value = trim(row?.note);
    renderProductChip_(findProductById_(row?.product_id), row?.display_product_text || row?.product_name || '尚未選擇商品');
    if (el('menu-map-cancel')) el('menu-map-cancel').style.display = '';
    if (el('menu-map-editing')) el('menu-map-editing').style.display = '';
    syncFieldState_();
  }
  function sortRows_(rows){
    return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
      const da = trim(a.dish_name);
      const db = trim(b.dish_name);
      if (da !== db) return da.localeCompare(db, 'zh-Hant');
      const sa = Number(a.sort_no || 0);
      const sb = Number(b.sort_no || 0);
      if (sa !== sb) return sa - sb;
      return trim(a.product_name).localeCompare(trim(b.product_name), 'zh-Hant');
    });
  }
  function renderTable_(){
    const tbody = el('menu-mapping-table')?.querySelector('tbody');
    if (!tbody) return;
    const kw = trim(el('menu-mapping-filter')?.value).toLowerCase();
    const targetFilter = trim(el('menu-mapping-target-filter')?.value || 'all');
    const enabledFilter = trim(el('menu-mapping-enabled-filter')?.value || 'all');
    const rows = (state.rows || []).filter(row => {
      if (kw) {
        const hay = [row.dish_name, row.product_name, row.display_product_label, row.spec, row.category, row.note].join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      const t = targetInfo_(row.mapping_targets || row.target || row.mode);
      if (targetFilter === 'ingredient' && !(t.ingredient && !t.bom)) return false;
      if (targetFilter === 'bom' && !(!t.ingredient && t.bom)) return false;
      if (targetFilter === 'both' && !(t.ingredient && t.bom)) return false;
      if (enabledFilter !== 'all' && String(row.enabled || '1') !== enabledFilter) return false;
      return true;
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="menu-mapping-empty">查無對應資料</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const t = targetInfo_(row.mapping_targets || row.target || row.mode);
      const shopping = t.ingredient ? `預設 ${safeText(row.default_qty || '1')}` : '—';
      const bom = t.bom
        ? `<div class="menu-mapping-cell-stack"><span>${safeText(row.per_person_qty || '')} ${safeText(row.qty_unit || '')}</span><small>耗損 ${safeText(row.loss_rate || '0')}</small>${row.category ? `<small>${safeText(row.category)}</small>` : ''}</div>`
        : '—';
      return `
        <tr>
          <td>${safeText(row.dish_name || '')}</td>
          <td>
            <div class="menu-mapping-cell-stack">
              <span>${safeText(row.display_product_label || row.product_name || '')}</span>
              ${row.spec ? `<small>${safeText(row.spec)}</small>` : ''}
              ${row.product_id ? `<small>ID: ${safeText(row.product_id)}</small>` : ''}
            </div>
          </td>
          <td>${targetChipsHtml_(row)}</td>
          <td>${shopping}</td>
          <td>${bom}</td>
          <td>${safeText(row.sort_no || '')}</td>
          <td>${String(row.enabled || '1') === '0' ? '停用' : '啟用'}</td>
          <td>${safeText(row.note || '')}</td>
          <td>
            <button type="button" class="btn-mini" data-act="edit" data-row="${safeText(row.row_no)}">編輯</button>
            <button type="button" class="btn-mini btn-danger" data-act="delete" data-row="${safeText(row.row_no)}">刪除</button>
          </td>
        </tr>
      `;
    }).join('');
  }
  function loadMenuMappingSectionData_(forceProducts){
    if (state.loading) return;
    state.loading = true;
    setStatus_('載入中…');
    const needProducts = forceProducts || !productList_().length;
    const ready = (needProducts && typeof loadAdminProducts === 'function')
      ? loadAdminProducts(true, null, { skipProductRender: true, skipCategoryRender: true })
      : Promise.resolve();
    Promise.resolve(ready).then(() => {
      gas({ type: 'menuMappingConfig' }, res => {
        state.loading = false;
        if (!res || res.status !== 'ok') {
          setStatus_(res?.message || '菜單管理資料載入失敗', true);
          return;
        }
        state.loaded = true;
        state.rows = sortRows_(res.rows || res.mapping_rows || []);
        state.dishOptions = Array.isArray(res.dish_options) ? res.dish_options : [];
        updateDishOptions_();
        renderStats_(res.stats || statsFromRows_(state.rows));
        renderTable_();
        setStatus_(`已載入 ${state.rows.length} 筆菜單管理對應`);
      });
    }).catch(err => {
      state.loading = false;
      setStatus_(String(err || '載入失敗'), true);
    });
  }
  function save_(){
    const payload = formPayload_();
    const t = targetInfo_(payload.mapping_targets);
    if (!payload.dish_name) return alert('請先輸入菜色');
    if (!payload.product_id) return alert('請先選擇商品');
    if (!t.ingredient && !t.bom) return alert('請至少勾選一種用途');
    if (t.bom && !(Number(payload.per_person_qty || 0) > 0)) return alert('採購試算用途請先輸入每人用量');
    const btn = el('menu-map-save');
    if (btn) btn.disabled = true;
    gas({
      type: 'manageMenuMapping',
      mode: 'unified',
      action: state.editing ? 'update' : 'add',
      payload: encodeURIComponent(JSON.stringify(payload))
    }, res => {
      if (btn) btn.disabled = false;
      if (!res || res.status !== 'ok') return alert(res?.message || '儲存失敗');
      resetForm_();
      loadMenuMappingSectionData_(false);
    });
  }
  function deleteRow_(rowNo){
    if (!rowNo) return;
    if (!confirm('確定要刪除這筆菜單管理對應嗎？')) return;
    gas({ type: 'manageMenuMapping', mode: 'unified', action: 'delete', row_no: String(rowNo) }, res => {
      if (!res || res.status !== 'ok') return alert(res?.message || '刪除失敗');
      resetForm_();
      loadMenuMappingSectionData_(false);
    });
  }
  function handleTableAction_(e){
    const btn = e.target.closest('button[data-act][data-row]');
    if (!btn) return;
    const act = btn.dataset.act;
    const rowNo = trim(btn.dataset.row);
    const row = (state.rows || []).find(it => trim(it.row_no) === rowNo);
    if (!row) return;
    if (act === 'edit') return fillForm_(row);
    if (act === 'delete') return deleteRow_(rowNo);
  }
  function bindQuickDishPills_(){
    el('menu-mapping-dish-pills')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-dish]');
      if (!btn) return;
      const dish = trim(btn.dataset.dish);
      if (!dish) return;
      el('menu-map-dish').value = dish;
      el('menu-map-dish').focus();
    });
  }
  function setupProductCombo_(){
    const inputEl = el('menu-map-product-combo');
    const menuEl = el('menu-map-product-menu');
    const hiddenEl = el('menu-map-product-id');
    if (!inputEl || !menuEl || !hiddenEl || typeof setupCombo_ !== 'function') return;
    setupCombo_(
      inputEl,
      menuEl,
      kw => {
        if (typeof getProductOptions_ === 'function') return getProductOptions_(kw, '', false);
        const list = productList_();
        const q = trim(kw).toLowerCase();
        return list.filter(p => {
          const sku = trim(p.sku || p.id).toLowerCase();
          const name = trim(p.name).toLowerCase();
          return !q || sku.includes(q) || name.includes(q);
        }).slice(0, 80).map(p => ({ value: String(p.id), label: productLabel_(p) }));
      },
      picked => {
        const p = findProductById_(picked?.value);
        hiddenEl.value = String(picked?.value || '');
        inputEl.value = p ? productLabel_(p) : String(picked?.label || '');
        renderProductChip_(p, picked?.label || '尚未選擇商品');
        const qtyUnitEl = el('menu-map-qty-unit');
        if (qtyUnitEl && p && !trim(qtyUnitEl.value)) qtyUnitEl.value = trim(p.unit);
      },
      {
        portal: true,
        maxShow: 80,
        onInputClear: () => {
          hiddenEl.value = '';
          renderProductChip_(null);
        }
      }
    );
  }
  function bindEvents_(){
    el('menu-mapping-refresh')?.addEventListener('click', () => loadMenuMappingSectionData_(true));
    el('menu-map-save')?.addEventListener('click', save_);
    el('menu-map-cancel')?.addEventListener('click', resetForm_);
    el('menu-mapping-filter')?.addEventListener('input', renderTable_);
    el('menu-mapping-target-filter')?.addEventListener('change', renderTable_);
    el('menu-mapping-enabled-filter')?.addEventListener('change', renderTable_);
    el('menu-mapping-table')?.addEventListener('click', handleTableAction_);
    el('menu-map-target-ingredient')?.addEventListener('change', syncFieldState_);
    el('menu-map-target-bom')?.addEventListener('change', syncFieldState_);
    bindQuickDishPills_();
    setupProductCombo_();
    syncFieldState_();
    document.querySelector('.sidebar a[data-target="menu-mapping-section"]')?.addEventListener('click', () => {
      setTimeout(() => loadMenuMappingSectionData_(false), 0);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!el('menu-mapping-section')) return;
    bindEvents_();
  });

  window.loadMenuMappingSectionData_ = loadMenuMappingSectionData_;
})();
