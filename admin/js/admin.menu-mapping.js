(function(){
  const state = {
    loaded: false,
    loading: false,
    ingredientRows: [],
    bomRows: [],
    dishOptions: [],
    ingredientEditing: null,
    bomEditing: null
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
  function productList_(){
    const live = (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : null;
    const list = live || ((typeof LS !== 'undefined' && LS && typeof LS.get === 'function') ? (LS.get('products', []) || []) : []);
    return Array.isArray(list) ? list : [];
  }
  function findProductById_(id){
    const key = String(id || '').trim();
    if (!key) return null;
    return productList_().find(p => String(p?.id || '').trim() === key) || null;
  }
  function productLabel_(p){
    if (!p) return '';
    const sku = String(p.sku || p.part_no || p.code || p.id || '').trim();
    const name = String(p.name || '').trim();
    return sku ? `${sku} - ${name}` : name;
  }
  function renderProductChip_(targetId, product, fallback){
    const node = el(targetId);
    if (!node) return;
    if (product) {
      const spec = String(product.spec || '').trim();
      const unit = String(product.unit || '').trim();
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
  function updateDishOptions_(){
    const list = el('menu-dish-options');
    const pillWrap = el('menu-mapping-dish-pills');
    if (list) {
      list.innerHTML = (state.dishOptions || []).map(v => `<option value="${safeText(v)}"></option>`).join('');
    }
    if (pillWrap) {
      const top = (state.dishOptions || []).slice(0, 40);
      pillWrap.innerHTML = top.length
        ? top.map(v => `<button type="button" class="menu-mapping-dish-pill" data-dish="${safeText(v)}">${safeText(v)}</button>`).join('')
        : '<span class="menu-mapping-muted">尚未從菜單分頁抓到菜色</span>';
    }
  }
  function ingredientFormPayload_(){
    const productId = String(el('menu-ingredient-product-id')?.value || '').trim();
    const product = findProductById_(productId);
    return {
      row_no: state.ingredientEditing?.row_no || '',
      dish_name: String(el('menu-ingredient-dish')?.value || '').trim(),
      product_id: productId,
      product_name: String(product?.name || '').trim(),
      spec: String(product?.spec || '').trim(),
      default_qty: String(el('menu-ingredient-default-qty')?.value || '1').trim(),
      sort_no: String(el('menu-ingredient-sort-no')?.value || '1').trim(),
      enabled: String(el('menu-ingredient-enabled')?.value || '1').trim(),
      note: String(el('menu-ingredient-note')?.value || '').trim()
    };
  }
  function bomFormPayload_(){
    const productId = String(el('menu-bom-product-id')?.value || '').trim();
    const product = findProductById_(productId);
    return {
      row_no: state.bomEditing?.row_no || '',
      dish_name: String(el('menu-bom-dish')?.value || '').trim(),
      product_id: productId,
      product_name: String(product?.name || '').trim(),
      spec: String(product?.spec || '').trim(),
      category: String(el('menu-bom-category')?.value || '').trim(),
      per_person_qty: String(el('menu-bom-per-person-qty')?.value || '').trim(),
      loss_rate: String(el('menu-bom-loss-rate')?.value || '').trim(),
      qty_unit: String(el('menu-bom-qty-unit')?.value || '').trim(),
      sort_no: String(el('menu-bom-sort-no')?.value || '1').trim(),
      enabled: String(el('menu-bom-enabled')?.value || '1').trim(),
      note: String(el('menu-bom-note')?.value || '').trim()
    };
  }
  function resetIngredientForm_(){
    state.ingredientEditing = null;
    el('menu-ingredient-dish').value = '';
    el('menu-ingredient-product-combo').value = '';
    el('menu-ingredient-product-id').value = '';
    el('menu-ingredient-default-qty').value = '1';
    el('menu-ingredient-sort-no').value = '1';
    el('menu-ingredient-enabled').value = '1';
    el('menu-ingredient-note').value = '';
    renderProductChip_('menu-ingredient-product-chip', null);
    if (el('menu-ingredient-cancel')) el('menu-ingredient-cancel').style.display = 'none';
    if (el('menu-ingredient-editing')) el('menu-ingredient-editing').style.display = 'none';
  }
  function resetBomForm_(){
    state.bomEditing = null;
    el('menu-bom-dish').value = '';
    el('menu-bom-product-combo').value = '';
    el('menu-bom-product-id').value = '';
    el('menu-bom-category').value = '';
    el('menu-bom-per-person-qty').value = '';
    el('menu-bom-loss-rate').value = '';
    el('menu-bom-qty-unit').value = '';
    el('menu-bom-sort-no').value = '1';
    el('menu-bom-enabled').value = '1';
    el('menu-bom-note').value = '';
    renderProductChip_('menu-bom-product-chip', null);
    if (el('menu-bom-cancel')) el('menu-bom-cancel').style.display = 'none';
    if (el('menu-bom-editing')) el('menu-bom-editing').style.display = 'none';
  }
  function fillIngredientForm_(row){
    state.ingredientEditing = row || null;
    el('menu-ingredient-dish').value = String(row?.dish_name || '');
    el('menu-ingredient-product-combo').value = String(row?.display_product_label || row?.product_label || row?.product_name || '');
    el('menu-ingredient-product-id').value = String(row?.product_id || '');
    el('menu-ingredient-default-qty').value = String(row?.default_qty || '1');
    el('menu-ingredient-sort-no').value = String(row?.sort_no || '1');
    el('menu-ingredient-enabled').value = String(row?.enabled || '1');
    el('menu-ingredient-note').value = String(row?.note || '');
    renderProductChip_('menu-ingredient-product-chip', findProductById_(row?.product_id), row?.display_product_text || row?.product_name || '尚未選擇商品');
    if (el('menu-ingredient-cancel')) el('menu-ingredient-cancel').style.display = '';
    if (el('menu-ingredient-editing')) el('menu-ingredient-editing').style.display = '';
  }
  function fillBomForm_(row){
    state.bomEditing = row || null;
    el('menu-bom-dish').value = String(row?.dish_name || '');
    el('menu-bom-product-combo').value = String(row?.display_product_label || row?.product_label || row?.product_name || '');
    el('menu-bom-product-id').value = String(row?.product_id || '');
    el('menu-bom-category').value = String(row?.category || '');
    el('menu-bom-per-person-qty').value = String(row?.per_person_qty || '');
    el('menu-bom-loss-rate').value = String(row?.loss_rate || '');
    el('menu-bom-qty-unit').value = String(row?.qty_unit || '');
    el('menu-bom-sort-no').value = String(row?.sort_no || '1');
    el('menu-bom-enabled').value = String(row?.enabled || '1');
    el('menu-bom-note').value = String(row?.note || '');
    renderProductChip_('menu-bom-product-chip', findProductById_(row?.product_id), row?.display_product_text || row?.product_name || '尚未選擇商品');
    if (el('menu-bom-cancel')) el('menu-bom-cancel').style.display = '';
    if (el('menu-bom-editing')) el('menu-bom-editing').style.display = '';
  }
  function renderIngredientTable_(){
    const tbody = el('menu-ingredient-table')?.querySelector('tbody');
    if (!tbody) return;
    const kw = String(el('menu-ingredient-filter')?.value || '').trim().toLowerCase();
    const rows = (state.ingredientRows || []).filter(row => {
      if (!kw) return true;
      const hay = [row.dish_name, row.product_name, row.display_product_label, row.spec, row.note].join(' ').toLowerCase();
      return hay.includes(kw);
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="menu-mapping-empty">查無對應資料</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr>
        <td>${safeText(row.dish_name || '')}</td>
        <td>${safeText(row.display_product_label || row.product_name || '')}<div class="menu-mapping-muted">${safeText(row.product_id ? 'ID: ' + row.product_id : '')}</div></td>
        <td>${safeText(row.spec || '')}</td>
        <td>${safeText(row.default_qty || '1')}</td>
        <td>${safeText(row.sort_no || '')}</td>
        <td>${String(row.enabled || '1') === '0' ? '停用' : '啟用'}</td>
        <td>${safeText(row.note || '')}</td>
        <td>
          <button type="button" class="btn-mini" data-map-type="ingredient" data-act="edit" data-row="${safeText(row.row_no)}">編輯</button>
          <button type="button" class="btn-mini btn-danger" data-map-type="ingredient" data-act="delete" data-row="${safeText(row.row_no)}">刪除</button>
        </td>
      </tr>
    `).join('');
  }
  function renderBomTable_(){
    const tbody = el('menu-bom-table')?.querySelector('tbody');
    if (!tbody) return;
    const kw = String(el('menu-bom-filter')?.value || '').trim().toLowerCase();
    const rows = (state.bomRows || []).filter(row => {
      if (!kw) return true;
      const hay = [row.dish_name, row.product_name, row.display_product_label, row.category, row.qty_unit, row.note].join(' ').toLowerCase();
      return hay.includes(kw);
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="menu-mapping-empty">查無對應資料</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr>
        <td>${safeText(row.dish_name || '')}</td>
        <td>${safeText(row.display_product_label || row.product_name || '')}<div class="menu-mapping-muted">${safeText(row.spec || '')}</div></td>
        <td>${safeText(row.category || '')}</td>
        <td>${safeText(row.per_person_qty || '')}</td>
        <td>${safeText(row.loss_rate || '')}</td>
        <td>${safeText(row.qty_unit || '')}</td>
        <td>${safeText(row.sort_no || '')}</td>
        <td>${String(row.enabled || '1') === '0' ? '停用' : '啟用'}</td>
        <td>
          <button type="button" class="btn-mini" data-map-type="bom" data-act="edit" data-row="${safeText(row.row_no)}">編輯</button>
          <button type="button" class="btn-mini btn-danger" data-map-type="bom" data-act="delete" data-row="${safeText(row.row_no)}">刪除</button>
        </td>
      </tr>
    `).join('');
  }
  function sortRows_(rows){
    return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
      const da = String(a.dish_name || '');
      const db = String(b.dish_name || '');
      if (da !== db) return da.localeCompare(db, 'zh-Hant');
      const sa = Number(a.sort_no || 0);
      const sb = Number(b.sort_no || 0);
      if (sa !== sb) return sa - sb;
      return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'zh-Hant');
    });
  }
  function loadMenuMappingSectionData_(forceProducts){
    if (state.loading) return;
    state.loading = true;
    setStatus_('載入中…');
    const needProducts = forceProducts || !productList_().length;
    const ready = (needProducts && typeof loadAdminProducts === 'function') ? loadAdminProducts(true, null, { skipProductRender: true, skipCategoryRender: true }) : Promise.resolve();
    Promise.resolve(ready).then(() => {
      gas({ type: 'menuMappingConfig' }, res => {
        state.loading = false;
        if (!res || res.status !== 'ok') {
          setStatus_(res?.message || '菜單對應資料載入失敗', true);
          return;
        }
        state.loaded = true;
        state.ingredientRows = sortRows_(res.ingredient_rows || []);
        state.bomRows = sortRows_(res.bom_rows || []);
        state.dishOptions = Array.isArray(res.dish_options) ? res.dish_options : [];
        updateDishOptions_();
        renderIngredientTable_();
        renderBomTable_();
        setStatus_(`已載入 ${state.ingredientRows.length} 筆食材對應 / ${state.bomRows.length} 筆 BOM`);
      });
    }).catch(err => {
      state.loading = false;
      setStatus_(String(err || '載入失敗'), true);
    });
  }
  function saveIngredient_(){
    const payload = ingredientFormPayload_();
    if (!payload.dish_name) return alert('請先輸入菜色');
    if (!payload.product_id) return alert('請先選擇商品');
    const btn = el('menu-ingredient-save');
    if (btn) btn.disabled = true;
    gas({
      type: 'manageMenuMapping',
      mode: 'ingredient',
      action: state.ingredientEditing ? 'update' : 'add',
      payload: encodeURIComponent(JSON.stringify(payload))
    }, res => {
      if (btn) btn.disabled = false;
      if (!res || res.status !== 'ok') return alert(res?.message || '儲存失敗');
      resetIngredientForm_();
      loadMenuMappingSectionData_(false);
    });
  }
  function saveBom_(){
    const payload = bomFormPayload_();
    if (!payload.dish_name) return alert('請先輸入菜色');
    if (!payload.product_id) return alert('請先選擇商品');
    if (!payload.per_person_qty) return alert('請先輸入每人用量');
    const btn = el('menu-bom-save');
    if (btn) btn.disabled = true;
    gas({
      type: 'manageMenuMapping',
      mode: 'bom',
      action: state.bomEditing ? 'update' : 'add',
      payload: encodeURIComponent(JSON.stringify(payload))
    }, res => {
      if (btn) btn.disabled = false;
      if (!res || res.status !== 'ok') return alert(res?.message || '儲存失敗');
      resetBomForm_();
      loadMenuMappingSectionData_(false);
    });
  }
  function deleteRow_(mode, rowNo){
    if (!rowNo) return;
    const label = mode === 'bom' ? 'BOM 對應' : '食材對應';
    if (!confirm(`確定要刪除這筆${label}嗎？`)) return;
    gas({
      type: 'manageMenuMapping',
      mode,
      action: 'delete',
      row_no: String(rowNo)
    }, res => {
      if (!res || res.status !== 'ok') return alert(res?.message || '刪除失敗');
      if (mode === 'bom') resetBomForm_(); else resetIngredientForm_();
      loadMenuMappingSectionData_(false);
    });
  }
  function handleTableAction_(e){
    const btn = e.target.closest('button[data-map-type][data-act][data-row]');
    if (!btn) return;
    const mode = btn.dataset.mapType;
    const act = btn.dataset.act;
    const rowNo = String(btn.dataset.row || '').trim();
    const list = mode === 'bom' ? state.bomRows : state.ingredientRows;
    const row = list.find(it => String(it.row_no || '') === rowNo);
    if (!row) return;
    if (act === 'edit') {
      if (mode === 'bom') fillBomForm_(row);
      else fillIngredientForm_(row);
      return;
    }
    if (act === 'delete') deleteRow_(mode, rowNo);
  }
  function bindQuickDishPills_(){
    el('menu-mapping-dish-pills')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-dish]');
      if (!btn) return;
      const dish = String(btn.dataset.dish || '').trim();
      if (!dish) return;
      const active = document.activeElement;
      if (active && active.id === 'menu-bom-dish') el('menu-bom-dish').value = dish;
      else if (active && active.id === 'menu-ingredient-dish') el('menu-ingredient-dish').value = dish;
      else {
        if (!String(el('menu-ingredient-dish')?.value || '').trim()) el('menu-ingredient-dish').value = dish;
        if (!String(el('menu-bom-dish')?.value || '').trim()) el('menu-bom-dish').value = dish;
      }
    });
  }
  function setupProductCombo_(kind){
    const inputEl = el(`menu-${kind}-product-combo`);
    const menuEl = el(`menu-${kind}-product-menu`);
    const hiddenEl = el(`menu-${kind}-product-id`);
    const chipId = `menu-${kind}-product-chip`;
    if (!inputEl || !menuEl || !hiddenEl || typeof setupCombo_ !== 'function') return;
    setupCombo_(inputEl, menuEl,
      kw => {
        if (typeof getProductOptions_ === 'function') return getProductOptions_(kw, '', false);
        const list = productList_();
        const q = String(kw || '').trim().toLowerCase();
        return list.filter(p => {
          const sku = String(p.sku || p.id || '').toLowerCase();
          const name = String(p.name || '').toLowerCase();
          return !q || sku.includes(q) || name.includes(q);
        }).slice(0, 80).map(p => ({ value: String(p.id), label: productLabel_(p) }));
      },
      picked => {
        const p = findProductById_(picked?.value);
        hiddenEl.value = String(picked?.value || '');
        inputEl.value = p ? productLabel_(p) : String(picked?.label || '');
        renderProductChip_(chipId, p, picked?.label || '尚未選擇商品');
        if (kind === 'bom' && p) {
          const qtyUnitEl = el('menu-bom-qty-unit');
          if (qtyUnitEl && !String(qtyUnitEl.value || '').trim()) qtyUnitEl.value = String(p.unit || '').trim();
        }
      },
      {
        portal: true,
        maxShow: 80,
        onInputClear: () => {
          hiddenEl.value = '';
          renderProductChip_(chipId, null);
        }
      }
    );
  }
  function bindMenuMappingEvents_(){
    el('menu-mapping-refresh')?.addEventListener('click', () => loadMenuMappingSectionData_(true));
    el('menu-ingredient-save')?.addEventListener('click', saveIngredient_);
    el('menu-bom-save')?.addEventListener('click', saveBom_);
    el('menu-ingredient-cancel')?.addEventListener('click', resetIngredientForm_);
    el('menu-bom-cancel')?.addEventListener('click', resetBomForm_);
    el('menu-ingredient-filter')?.addEventListener('input', renderIngredientTable_);
    el('menu-bom-filter')?.addEventListener('input', renderBomTable_);
    el('menu-ingredient-table')?.addEventListener('click', handleTableAction_);
    el('menu-bom-table')?.addEventListener('click', handleTableAction_);
    bindQuickDishPills_();
    setupProductCombo_('ingredient');
    setupProductCombo_('bom');
    document.querySelector('.sidebar a[data-target="menu-mapping-section"]')?.addEventListener('click', () => {
      setTimeout(() => loadMenuMappingSectionData_(false), 0);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!el('menu-mapping-section')) return;
    bindMenuMappingEvents_();
  });

  window.loadMenuMappingSectionData_ = loadMenuMappingSectionData_;
})();
