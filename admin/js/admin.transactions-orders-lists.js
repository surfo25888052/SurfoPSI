let deliverySettingsState = LS.get("deliverySettings", {
  driver_name:"",
  driver_phone:"",
  sales_phone:"",
  sales_name:"",
  line_order_push_enabled:"0",
  line_order_channel_access_token:"",
  line_order_group_id:"",
  line_order_push_title:"電商訂單通知"
});
let currentOrderDocId = "";
let currentOrderPriceEditId = "";
let currentOrderPriceEditItems_ = [];
let currentOrderDateEditId = "";

const ORDER_CACHE_KEY_ = "orders";
const ORDER_CACHE_META_KEY_ = "orders_meta";
const ORDER_CACHE_FRESH_MS_ = 8000;
const ORDER_SYNC_POLL_MS_ = 15000;
let ordersFetchPending_ = null;
let ordersLastFetchedAt_ = 0;
let orderSyncTimer_ = 0;
let orderSyncBound_ = false;

const PURCHASE_CACHE_KEY_ = "purchases";
const PURCHASE_CACHE_META_KEY_ = "purchases_meta";
const PURCHASE_DETAIL_CACHE_KEY_ = "purchase_detail_cache";
const PURCHASE_CACHE_FRESH_MS_ = 10000;
const PURCHASE_DETAIL_TTL_MS_ = 180000;
const PURCHASE_SYNC_POLL_MS_ = 120000;
let purchasesFetchPending_ = null;
let purchasesLastFetchedAt_ = 0;
let purchasesLastFetchError_ = null;
let purchaseManualRefreshPending_ = false;
let purchasesFetchSeq_ = 0;
let purchaseSyncTimer_ = 0;
let purchaseSyncBound_ = false;

let purchaseDetailWarmTimer_ = 0;
const purchaseDetailPendingSet_ = new Set();
const purchaseDetailCallbackMap_ = Object.create(null);
let purchaseListPageInfoTimer_ = 0;
const purchaseListPageInfoQueue_ = [];
let purchaseListPageInfoRunning_ = false;

function makePurchaseFetchBustToken_() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${purchasesFetchSeq_}`;
}


function purchaseHasDetail_(po) {
  return !!(po && Number(po.items_loaded || 0) && Array.isArray(po.items));
}

function getPurchasePageSize_() {
  return (typeof PURCHASE_TEMPLATE_MAX_ROWS_ !== "undefined" ? Number(PURCHASE_TEMPLATE_MAX_ROWS_) : 16) || 16;
}

function getPurchaseItemCount_(po) {
  if (purchaseHasDetail_(po)) return Array.isArray(po.items) ? po.items.length : 0;
  const count = Number(po?.item_count || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function getPurchasePageCount_(po) {
  const itemCount = getPurchaseItemCount_(po);
  if (!(itemCount > 0)) return null;
  return Math.max(1, Math.ceil(itemCount / getPurchasePageSize_()));
}

function getPurchasePageInfo_(po) {
  const itemCount = getPurchaseItemCount_(po);
  const pageCount = getPurchasePageCount_(po);
  const known = !!(pageCount && itemCount > 0);
  if (!known) {
    return {
      known: false,
      pageCount: null,
      itemCount: 0,
      text: "判定中",
      cls: "unknown",
      title: "正在補抓此張採購驗收單的明細，以判定是否需要分頁"
    };
  }
  if (pageCount > 1) {
    return {
      known: true,
      pageCount,
      itemCount,
      text: `分 ${pageCount} 張`,
      cls: "multipage",
      title: `此張採購驗收單共有 ${itemCount} 項商品，已拆成 ${pageCount} 張驗收單`
    };
  }
  return {
    known: true,
    pageCount,
    itemCount,
    text: "單張",
    cls: "singlepage",
    title: `此張採購驗收單共有 ${itemCount} 項商品，單張顯示即可`
  };
}

function purchasePageIndicatorHtml_(po) {
  const info = getPurchasePageInfo_(po);
  const extra = info.known && info.pageCount > 1 ? `<span class="purchase-page-chip-count">共 ${info.pageCount} 張</span>` : '';
  return `<span class="purchase-page-chip ${info.cls}" title="${escapeHtml_(info.title || '')}">${escapeHtml_(info.text || '單張')}${extra}</span>`;
}

function getPurchaseFilteredListForRender_() {
  const keyword = (document.getElementById("po-search")?.value || "").trim().toLowerCase();
  const list = Array.isArray(purchases) ? purchases : [];
  if (!keyword) return list;
  return list.filter(po =>
    String(po?.po_id || "").toLowerCase().includes(keyword) ||
    String(po?.source_order_id || "").toLowerCase().includes(keyword) ||
    String(po?.status || "").toLowerCase().includes(keyword)
  );
}

function rerenderPurchasesKeepState_() {
  renderPurchases(getPurchaseFilteredListForRender_(), purchasePage || 1);
}

function ensurePurchasePageInfoForList_(pageList) {
  // 已停用列表「單張／多張」自動檢測。
  // 原因：列表停留時不應背景補抓每張 detail，避免 timeout 後畫面被干擾。
  return;
}

function runPurchasePageInfoQueue_() {
  if (purchaseListPageInfoRunning_) return;
  const nextId = purchaseListPageInfoQueue_.shift();
  if (!nextId) return;
  purchaseListPageInfoRunning_ = true;
  fetchPurchaseDetail_(nextId, () => {
    purchaseListPageInfoRunning_ = false;
    if (isSectionActive_("purchase-section")) rerenderPurchasesKeepState_();
    window.setTimeout(runPurchasePageInfoQueue_, 220);
  }, { timeout: 20000, useCached: true, allowStaleCached: true });
}

function purchaseListSignature_(list) {
  const arr = Array.isArray(list) ? list : [];
  try {
    return JSON.stringify(arr.map(po => [
      String(po?.po_id || ""),
      String(po?.date || ""),
      String(po?.arrival_date || ""),
      String(po?.status || ""),
      Number(po?.total || 0),
      Number(po?.stock_applied || 0) ? 1 : 0,
      Number(po?.item_count || (Array.isArray(po?.items) ? po.items.length : 0) || 0),
      String(po?.source_order_id || ""),
      String(po?.completed_at || "")
    ]));
  } catch (e) {
    return String(arr.length);
  }
}

function stripPurchaseDetailForSummaryCache_(po) {
  const base = { ...(po || {}) };
  if (Array.isArray(base.items)) {
    base.item_count = Number(base.item_count || base.items.length || 0);
  }
  base.items = [];
  base.items_loaded = 0;
  return base;
}

function persistPurchasesSummaryCache_(list, options = {}) {
  const arr = (Array.isArray(list) ? list : []).map(stripPurchaseDetailForSummaryCache_);
  const prevMeta = LS.get(PURCHASE_CACHE_META_KEY_, null);
  const nextFetchedAt = options.refreshMeta ? Date.now() : Number(prevMeta?.fetched_at || 0);
  LS.set(PURCHASE_CACHE_KEY_, arr);
  LS.set(PURCHASE_CACHE_META_KEY_, { fetched_at: nextFetchedAt, sig: purchaseListSignature_(arr) });
}
window.persistPurchasesSummaryCache_ = persistPurchasesSummaryCache_;

function isPurchasesCacheFresh_() {
  const meta = LS.get(PURCHASE_CACHE_META_KEY_, null);
  const fetchedAt = Number(meta?.fetched_at || 0);
  return !!(fetchedAt && (Date.now() - fetchedAt < PURCHASE_CACHE_FRESH_MS_));
}

function getPurchaseDetailCacheMap_() {
  const raw = LS.get(PURCHASE_DETAIL_CACHE_KEY_, null);
  return raw && typeof raw === "object" ? raw : {};
}

function setPurchaseDetailCache_(po) {
  if (!purchaseHasDetail_(po) || !String(po?.po_id || "").trim()) return;
  const cache = getPurchaseDetailCacheMap_();
  const poId = String(po.po_id || "").trim();
  const sortedItems = sortPurchaseItemsBySupplier_(po.items);
  cache[poId] = {
    fetched_at: Date.now(),
    data: {
      ...po,
      items: sortedItems,
      items_loaded: 1,
      item_count: sortedItems.length
    }
  };
  LS.set(PURCHASE_DETAIL_CACHE_KEY_, cache);
}

function getCachedPurchaseDetail_(poId, options = {}) {
  const targetId = String(poId || "").trim();
  if (!targetId) return null;
  const cache = getPurchaseDetailCacheMap_();
  const entry = cache[targetId];
  if (!entry || !entry.data) return null;
  const fetchedAt = Number(entry.fetched_at || 0);
  const expired = !fetchedAt || (Date.now() - fetchedAt > PURCHASE_DETAIL_TTL_MS_);
  if (expired && !options.ignoreTtl) return null;
  const data = entry.data;
  if (!purchaseHasDetail_(data)) return null;
  const sortedItems = sortPurchaseItemsBySupplier_(data.items);
  return {
    ...data,
    items: sortedItems,
    items_loaded: 1,
    item_count: sortedItems.length || Number(data.item_count || 0)
  };
}

function getFreshPurchaseDetailCacheMap_() {
  const cache = getPurchaseDetailCacheMap_();
  const out = {};
  const next = {};
  let changed = false;
  Object.keys(cache).forEach(poId => {
    const entry = cache[poId];
    const detail = getCachedPurchaseDetail_(poId);
    if (detail) {
      out[poId] = detail;
      next[poId] = entry;
    } else {
      changed = true;
    }
  });
  if (changed) LS.set(PURCHASE_DETAIL_CACHE_KEY_, next);
  return out;
}

function deleteCachedPurchaseDetail_(poId) {
  const targetId = String(poId || "").trim();
  if (!targetId) return;
  const cache = getPurchaseDetailCacheMap_();
  if (!Object.prototype.hasOwnProperty.call(cache, targetId)) return;
  delete cache[targetId];
  LS.set(PURCHASE_DETAIL_CACHE_KEY_, cache);
}


function clearPurchaseCaches_(options = {}) {
  const clearDetail = options.clearDetail !== false;
  try { LS.del(PURCHASE_CACHE_KEY_); } catch (e) {}
  try { LS.del(PURCHASE_CACHE_META_KEY_); } catch (e) {}
  if (clearDetail) {
    try { LS.del(PURCHASE_DETAIL_CACHE_KEY_); } catch (e) {}
  }
  purchasesLastFetchedAt_ = 0;
  clearTimeout(purchaseListPageInfoTimer_);
  purchaseListPageInfoQueue_.length = 0;
  purchaseListPageInfoRunning_ = false;
}
window.clearPurchaseCaches_ = clearPurchaseCaches_;

function setPurchaseRefreshUi_(loading, message) {
  const manualBtn = document.getElementById("po-manual-refresh");
  const statusEl = document.getElementById("po-refresh-status");
  [manualBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.classList.toggle("is-loading", !!loading);
  });
  if (manualBtn) manualBtn.textContent = loading ? "更新中…" : "手動更新";
  if (statusEl) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-loading", !!loading);
  }
}

function manualRefreshPurchases_() {
  if (purchaseManualRefreshPending_) return;
  purchaseManualRefreshPending_ = true;
  setPurchaseRefreshUi_(true, "正在清除本機快取，並從資料庫重新載入…");
  // Manual refresh must always drop local list/detail cache before the network request.
  clearPurchaseCaches_({ clearDetail: true });

  fetchPurchasesLatest_({ force: true, bypassPending: true, keepPage: false, forceRender: true, silent: false }).then(list => {
    if (purchasesLastFetchError_) throw new Error(purchasesLastFetchError_);
    const count = Array.isArray(list) ? list.length : 0;
    setPurchaseRefreshUi_(false, count ? `已手動更新完成，共 ${count} 張進貨單` : "手動更新完成，目前沒有進貨單資料");
  }).catch(err => {
    console.error("manualRefreshPurchases_ failed", err);
    setPurchaseRefreshUi_(false, "手動更新失敗，請稍後再試");
    alert("進貨資料手動更新失敗：" + (err && err.message ? err.message : err || "未知錯誤"));
  }).finally(() => {
    purchaseManualRefreshPending_ = false;
    window.setTimeout(() => {
      const statusEl = document.getElementById("po-refresh-status");
      if (statusEl && !purchaseManualRefreshPending_) statusEl.textContent = "";
    }, 3500);
  });
}
window.manualRefreshPurchases_ = manualRefreshPurchases_;

function mergePurchaseSummariesWithCache_(list, cacheList, detailMap) {
  const detailSourceMap = {};
  (Array.isArray(cacheList) ? cacheList : []).forEach(po => {
    const poId = String(po?.po_id || "").trim();
    if (!poId || !purchaseHasDetail_(po)) return;
    const sortedItems = sortPurchaseItemsBySupplier_(po.items);
    detailSourceMap[poId] = {
      ...po,
      items: sortedItems,
      items_loaded: 1,
      item_count: sortedItems.length || Number(po.item_count || 0)
    };
  });
  const extraMap = (detailMap && typeof detailMap === 'object') ? detailMap : {};
  Object.keys(extraMap).forEach(poId => {
    if (purchaseHasDetail_(extraMap[poId])) detailSourceMap[poId] = extraMap[poId];
  });
  return (Array.isArray(list) ? list : []).map(po => {
    const poId = String(po?.po_id || "").trim();
    const hit = detailSourceMap[poId];
    return hit ? { ...po, items: sortPurchaseItemsBySupplier_(hit.items), items_loaded: 1, item_count: Array.isArray(hit.items) ? hit.items.length : Number(po.item_count || 0) } : po;
  });
}

function applyPurchasesList_(list, opts = {}) {
  const arr = Array.isArray(list) ? list : [];
  const sig = purchaseListSignature_(arr);
  const changed = sig !== purchaseListSignature_(purchases);
  purchases = arr;
  persistPurchasesSummaryCache_(arr, { refreshMeta: !!opts.refreshMeta });

  if (isSectionActive_("purchase-section") && (changed || opts.forceRender)) {
    const keepPage = !!opts.keepPage;
    renderPurchases(arr, keepPage ? (purchasePage || 1) : 1);
  }
  scheduleDashboardRefresh_();
  return changed;
}

function upsertPurchaseLocal_(po) {
  if (!po || !String(po.po_id || "").trim()) return null;
  const next = { ...po };
  if (Array.isArray(next.items)) {
    next.items = sortPurchaseItemsBySupplier_(next.items);
    next.items_loaded = 1;
    next.item_count = next.items.length;
    setPurchaseDetailCache_(next);
  }

  const list = Array.isArray(purchases) ? [...purchases] : [];
  const idx = list.findIndex(x => String(x?.po_id || "") === String(next.po_id || ""));
  if (idx >= 0) list[idx] = { ...list[idx], ...next };
  else list.unshift(next);

  applyPurchasesList_(list, { keepPage: true, forceRender: isSectionActive_("purchase-section") });
  return next;
}
window.upsertPurchaseLocal_ = upsertPurchaseLocal_;

function fetchPurchaseDetail_(poId, done, options = {}) {
  const targetId = String(poId || "").trim();
  const preferCached = options?.useCached !== false;
  const cached = (purchases || []).find(p => String(p?.po_id || "") === targetId) || null;
  const cachedDetail = purchaseHasDetail_(cached) ? cached : getCachedPurchaseDetail_(targetId, { ignoreTtl: !!options?.ignoreDetailTtl });
  if (preferCached && purchaseHasDetail_(cachedDetail)) {
    upsertPurchaseLocal_(cachedDetail);
    if (typeof done === "function") done(cachedDetail, { status: "ok", cached: 1 });
    return;
  }
  if (!targetId) {
    if (typeof done === "function") done(null, { status: "error", message: "缺少採購單編號" });
    return;
  }
  if (typeof done === "function") {
    purchaseDetailCallbackMap_[targetId] = purchaseDetailCallbackMap_[targetId] || [];
    purchaseDetailCallbackMap_[targetId].push(done);
  }
  if (purchaseDetailPendingSet_.has(targetId)) return;
  purchaseDetailPendingSet_.add(targetId);

  gas({ type: "purchases", po_id: targetId, detail: 1, _rid: makePurchaseFetchBustToken_(), _fresh: Date.now() }, res => {
    purchaseDetailPendingSet_.delete(targetId);
    const list = normalizeList(res);
    const fetched = (Array.isArray(list) ? list : []).find(p => String(p?.po_id || "") === targetId) || null;
    const latestCached = (purchases || []).find(p => String(p?.po_id || "") === targetId) || null;
    const fallbackDetail = purchaseHasDetail_(latestCached) ? latestCached : getCachedPurchaseDetail_(targetId, { ignoreTtl: true });
    const po = (fetched && Array.isArray(fetched.items)) ? fetched : ((preferCached || options?.allowStaleCached) && purchaseHasDetail_(fallbackDetail) ? fallbackDetail : null);
    if (po && Array.isArray(po.items)) {
      po.items = sortPurchaseItemsBySupplier_(po.items);
      po.items_loaded = 1;
      po.item_count = po.items.length;
      upsertPurchaseLocal_(po);
    }
    const callbacks = Array.isArray(purchaseDetailCallbackMap_[targetId]) ? [...purchaseDetailCallbackMap_[targetId]] : [];
    delete purchaseDetailCallbackMap_[targetId];
    callbacks.forEach(fn => {
      try { fn(po, res); } catch (e) { console.error('fetchPurchaseDetail_ callback failed', e); }
    });
  }, Number(options?.timeout || 45000));
}
window.fetchPurchaseDetail_ = fetchPurchaseDetail_;
function prefetchPurchaseDetail_(poId) {
  const targetId = String(poId || "").trim();
  if (!targetId) return;
  const cached = (purchases || []).find(p => String(p?.po_id || "") === targetId) || null;
  if (purchaseHasDetail_(cached) || purchaseDetailPendingSet_.has(targetId)) return;
  fetchPurchaseDetail_(targetId, null, { timeout: 25000, useCached: false });
}

function warmPurchasePageDetails_(list) {
  // 停用背景預抓：避免進貨列表剛載入或點查看時，同時觸發多筆 detail API 導致 Apps Script 壓力過高。
  return;
}



function productSkuTextForStockCache_(p){
  return String(p?.sku ?? p?.part_no ?? p?.code ?? p?.["料號"] ?? "").trim();
}

function productIdTextForStockCache_(p){
  return String(p?.id ?? p?.product_id ?? p?.raw_id ?? "").trim();
}

function findProductIndexForStockCache_(plist, item){
  const it = item || {};
  const candidates = [it.sku, it.SKU, it.product_sku, it.item_sku, it.part_no, it.code, it["料號"], it.product_id, it.product_internal_id, it.raw_id, it.id]
    .map(v => String(v ?? "").trim())
    .filter(Boolean);
  for (const key of candidates) {
    const idx = (plist || []).findIndex(p => productSkuTextForStockCache_(p) === key);
    if (idx >= 0) return idx;
  }
  for (const key of candidates) {
    const idx = (plist || []).findIndex(p => productIdTextForStockCache_(p) === key);
    if (idx >= 0) return idx;
  }
  return -1;
}

function applyPurchaseToLocalStock(purchase) {
  // 1) 產品庫存加回；若驗收單有輸入單價，同步本地快取的進價與售價，避免畫面短時間顯示舊售價。
  // 後端 GAS 仍是最終來源；這裡只做前端立即顯示用的快取更新。
  const plist = LS.get("products", adminProducts);
  const calcSalePriceFromCost_ = (cost) => {
    if (typeof salePriceFromCost25_ === "function") return salePriceFromCost25_(cost);
    const n = nonNegativeNum(cost, NaN);
    if (!Number.isFinite(n) || n <= 0) return "";
    return typeof round2Num === "function" ? round2Num(n * 1.25, 0) : Math.floor(n * 125) / 100;
  };

  purchase.items.forEach(it => {
    const qty = (typeof roundPurchaseQtyNumber_ === "function" ? roundPurchaseQtyNumber_(it.qty) : safeNum(it.qty));
    if (!(qty > 0)) return;
    const idx = findProductIndexForStockCache_(plist, it);
    if (idx >= 0) {
      plist[idx].stock = safeNum(plist[idx].stock) + qty;
      const unitCost = nonNegativeNum((it.cost_raw !== undefined && it.cost_raw !== "") ? it.cost_raw : it.cost, NaN);
      if (Number.isFinite(unitCost) && unitCost > 0) {
        plist[idx].cost = unitCost;
        plist[idx].price = calcSalePriceFromCost_(unitCost);
        plist[idx].date = nowISO();
      }
      // 同步最近進貨日 / 有效日期（本地快取）
      const arrivalDate = String(purchase.arrival_date || purchase.date || "").slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)) {
        const oldD = String(plist[idx].last_purchase_date || "").slice(0,10);
        if (!oldD || oldD < arrivalDate) plist[idx].last_purchase_date = arrivalDate;
      }
      const expD = String(it.expiry_date || "").slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(expD)) plist[idx].expiry_date = expD;
    }
  });

  LS.set("products", plist);
  adminProducts = plist;

  // 2) 流水
  const led = LS.get("stockLedger", []);
  purchase.items.forEach(it => {
    const qty = (typeof roundPurchaseQtyNumber_ === "function" ? roundPurchaseQtyNumber_(it.qty) : it.qty);
    if (!(safeNum(qty, 0) > 0)) return;
    led.unshift({
      ts: nowISO(),
      type: "IN",
      ref: purchase.po_id,
      product_id: it.product_id,
      product_name: it.product_name,
      sku: it.sku || "",
      unit: it.unit || "",
      qty,
      cost: it.cost,
      note: `${it.supplier_name || purchase.supplier_name || ""} 進貨`
    });
  });
  LS.set("stockLedger", led);
}

function fetchPurchasesLatest_(opts = {}) {
  const force = !!opts.force;
  if (purchasesFetchPending_ && !(force && opts.bypassPending)) return purchasesFetchPending_;
  if (!force && purchasesLastFetchedAt_ && (Date.now() - purchasesLastFetchedAt_ < 1200)) {
    return Promise.resolve(Array.isArray(purchases) ? purchases : []);
  }

  const requestSeq = ++purchasesFetchSeq_;
  const requestToken = makePurchaseFetchBustToken_();
  const currentPromise = new Promise(resolve => {
    const previousList = Array.isArray(purchases) ? [...purchases] : [];
    const cachedSummary = LS.get(PURCHASE_CACHE_KEY_, []);
    const detailMap = getFreshPurchaseDetailCacheMap_();

    const timeoutMs = force ? 60000 : 45000;
    gas({ type: "purchases", summary: 1, _rid: requestToken, _fresh: Date.now(), __timeoutMs: timeoutMs }, res => {
      if (requestSeq !== purchasesFetchSeq_) {
        resolve(Array.isArray(purchases) ? purchases : []);
        return;
      }
      purchasesLastFetchedAt_ = Date.now();
      purchasesLastFetchError_ = null;
      const status = String(res?.status || "").toLowerCase();
      const hasExplicitList = Array.isArray(res) || Array.isArray(res?.data) || Array.isArray(res?.items) || Array.isArray(res?.list) || Array.isArray(res?.purchases);
      const ok = status === "ok" || (hasExplicitList && status !== "timeout" && status !== "error");
      const list = ok ? normalizeList(res) : [];

      if (ok) {
        const merged = mergePurchaseSummariesWithCache_(list, previousList, detailMap);
        applyPurchasesList_(merged, {
          keepPage: !!opts.keepPage,
          forceRender: !Array.isArray(previousList) || !previousList.length || !!opts.forceRender,
          refreshMeta: true
        });
      } else {
        const message = res?.message || "API 無回應";
        purchasesLastFetchError_ = message;
        // 背景同步/timeout 不可把既有清單覆蓋成空白。
        // 只有目前畫面完全沒有資料時，才退回 localStorage 快取顯示。
        if (!Array.isArray(purchases) || !purchases.length) {
          const fallback = mergePurchaseSummariesWithCache_(Array.isArray(cachedSummary) ? cachedSummary : [], previousList, detailMap);
          if (Array.isArray(fallback) && fallback.length) {
            applyPurchasesList_(fallback, { keepPage: true, forceRender: true });
          }
        }
        if (!opts.silent) {
          console.warn("進貨資料載入失敗，保留既有清單：", message, res);
          alert(`進貨資料載入失敗：${message}`);
        }
      }

      const done = Array.isArray(purchases) ? purchases : [];
      if (purchasesFetchPending_ === currentPromise) purchasesFetchPending_ = null;
      resolve(done);
    }, timeoutMs);
  });

  purchasesFetchPending_ = currentPromise;
  return currentPromise;
}

function loadPurchases(force = false, opts = {}) {
  const cachedSummary = LS.get(PURCHASE_CACHE_KEY_, null);
  const hasCached = Array.isArray(cachedSummary);
  const detailMap = getFreshPurchaseDetailCacheMap_();

  if (hasCached) {
    const mergedCached = mergePurchaseSummariesWithCache_(cachedSummary, purchases, detailMap);
    applyPurchasesList_(mergedCached, {
      keepPage: !force,
      forceRender: !!opts.forceRender || (!Array.isArray(purchases) || !purchases.length)
    });
  }

  const shouldFetch = !!force || !hasCached || !isPurchasesCacheFresh_();
  if (!shouldFetch) return Promise.resolve(Array.isArray(purchases) ? purchases : []);

  return fetchPurchasesLatest_({
    force,
    keepPage: hasCached || !!opts.keepPage,
    forceRender: !hasCached,
    silent: !!opts.silent
  });
}


function initPurchaseSyncWatch_() {
  if (purchaseSyncBound_) return;
  purchaseSyncBound_ = true;

  const refreshIfNeeded = (force = false) => {
    if (document.hidden) return;
    if (!isSectionActive_("purchase-section") && !isSectionActive_("dashboard-section") && !isSectionActive_("report-section")) return;
    loadPurchases(!!force, { keepPage: true, silent: true, background: true });
  };

  window.addEventListener("focus", () => refreshIfNeeded(false));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfNeeded(false);
  });

  purchaseSyncTimer_ = window.setInterval(() => refreshIfNeeded(false), PURCHASE_SYNC_POLL_MS_);
}

initPurchaseSyncWatch_();

function ensureRecordMobileList_(listId, tableSelector) {
  let el = document.getElementById(listId);
  if (el) return el;
  const table = document.querySelector(tableSelector);
  if (!table || !table.parentNode) return null;
  el = document.createElement("div");
  el.id = listId;
  el.className = "record-mobile-list";
  table.insertAdjacentElement("afterend", el);
  return el;
}

function recordMobileBadgeHtml_(text, cls = "") {
  return `<span class="record-mobile-badge ${cls}">${escapeHtml_(text || "—")}</span>`;
}

function purchaseStatusClass_(status) {
  const s = String(status || "").trim();
  if (s === "已入庫" || s === "已完成") return "done";
  if (s === "已取消") return "cancelled";
  return "pending";
}

function purchaseFormText_(po) {
  const formNo = String(po?.form_no || "").trim();
  if (!formNo) return "未指定表格";
  const formName = (typeof getPurchaseFormName_ === "function" ? getPurchaseFormName_(formNo) : "") || String(po?.form_name || "").trim();
  return `${formNo} ${formName}`.trim();
}

function renderPurchaseMobileCards_(pageList) {
  const wrap = ensureRecordMobileList_("purchase-mobile-list", "#po-table");
  if (!wrap) return;
  const list = Array.isArray(pageList) ? pageList : [];
  if (!list.length) {
    wrap.innerHTML = '<div class="record-mobile-empty">目前沒有進貨單資料</div>';
    return;
  }
  wrap.innerHTML = list.map(po => {
    const poId = String(po?.po_id || "");
    const formText = purchaseFormText_(po);
    const statusText = String(po?.status || "待驗收").trim() || "待驗收";
    const statusCls = purchaseStatusClass_(statusText);
    const sourceText = String(po?.source_order_id || "").trim() || "—";
    return `
      <div class="record-mobile-card">
        <div class="record-mobile-head">
          <div class="record-mobile-main">
            <div class="record-mobile-id">${escapeHtml_(poId || "進貨單")}</div>
            <div class="record-mobile-title">${escapeHtml_(formText)}</div>
            <div class="record-mobile-sub">採購日期：${escapeHtml_(dateOnly(po?.date) || "—")}　｜　到貨日期：${escapeHtml_(dateOnly(po?.arrival_date) || "—")}</div>
          </div>
          <div class="record-mobile-status">${recordMobileBadgeHtml_(statusText, statusCls)}</div>
        </div>
        <div class="record-mobile-grid">
          <div class="record-mobile-field">
            <div class="record-mobile-label">來源訂單</div>
            <div class="record-mobile-value">${escapeHtml_(sourceText)}</div>
          </div>
          <div class="record-mobile-field">
            <div class="record-mobile-label">金額</div>
            <div class="record-mobile-value money">$${money(po?.total)}</div>
          </div>
          <div class="record-mobile-field wide">
            <div class="record-mobile-label">表格編號</div>
            <div class="record-mobile-value">${escapeHtml_(formText)}</div>
          </div>
        </div>
        <div class="record-mobile-actions">
          <div class="span-2">${buildPurchaseActionMenuHtml_(poId)}</div>
        </div>
      </div>`;
  }).join("");
}

function renderOrderMobileCards_(pageOrders) {
  const wrap = ensureRecordMobileList_("order-mobile-list", "#admin-order-table");
  if (!wrap) return;
  const list = Array.isArray(pageOrders) ? pageOrders : [];
  if (!list.length) {
    wrap.innerHTML = '<div class="record-mobile-empty">目前沒有銷貨單資料</div>';
    return;
  }
  wrap.innerHTML = list.map(o => {
    const statusInfo = orderStatusInfo_(o?.status);
    const orderId = String(o?.order_id || "");
    const customerName = String(o?.name || "").trim() || "未指定客戶";
    const phoneText = String(o?.phone || "").trim() || "—";
    return `
      <div class="record-mobile-card">
        <div class="record-mobile-head">
          <div class="record-mobile-main">
            <div class="record-mobile-id">${escapeHtml_(orderId || "銷貨單")}</div>
            <div class="record-mobile-title">${escapeHtml_(customerName)}</div>
            <div class="record-mobile-sub">出貨日期：${escapeHtml_(getOrderDeliveryDate_(o) || "—")}</div>
          </div>
          <div class="record-mobile-status"><span class="status-chip ${statusInfo.cls}">${escapeHtml_(statusInfo.text)}</span></div>
        </div>
        <div class="record-mobile-grid">
          <div class="record-mobile-field wide">
            <div class="record-mobile-label">訂單日期</div>
            <div class="record-mobile-value">${escapeHtml_(getOrderCreatedDateTime_(o) || "—")}</div>
          </div>
          <div class="record-mobile-field">
            <div class="record-mobile-label">電話</div>
            <div class="record-mobile-value">${escapeHtml_(phoneText)}</div>
          </div>
          <div class="record-mobile-field">
            <div class="record-mobile-label">金額</div>
            <div class="record-mobile-value money">$${money(o?.total)}</div>
          </div>
        </div>
        <div class="record-mobile-actions">
          <button class="order-doc-btn" type="button" onclick="showOrderDoc('${orderId}')">查看</button>
          <button class="order-doc-btn" type="button" onclick="printOrderDoc('${orderId}')">列印</button>
          <div class="span-2">${buildOrderActionMenuHtml_(orderId, statusInfo.text)}</div>
        </div>
      </div>`;
  }).join("");
}

function getPurchaseDocDate_(po) {
  return dateOnly(po?.date || "") || dateOnly(po?.created_at || po?.createdAt || "") || "";
}

function renderPurchases(list, page = 1) {
  const sortedList = [...(list || [])].sort((a,b) => {
    const da = String(getPurchaseDocDate_(a) || "");
    const db = String(getPurchaseDocDate_(b) || "");
    if (da !== db) return db.localeCompare(da);
    const ia = String(a?.po_id || a?.purchase_id || "");
    const ib = String(b?.po_id || b?.purchase_id || "");
    return ib.localeCompare(ia);
  });
  purchasePage = page;
  const tbody = document.querySelector("#po-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(sortedList.length / purchasesPerPage));
  purchasePage = Math.min(purchasePage, totalPages);

  const start = (purchasePage - 1) * purchasesPerPage;
  const end = start + purchasesPerPage;

  const pageList = sortedList.slice(start, end);

  tbody.innerHTML = "";
  pageList.forEach(po => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(po.po_id ?? "")}</td>
      <td>${dateOnly(po.date) || ""}</td>
      <td>${dateOnly(po.arrival_date) || ""}</td>
      <td>${escapeHtml_(purchaseFormText_(po) === "未指定表格" ? "" : purchaseFormText_(po))}</td>
      <td>${po.status ?? "待驗收"}</td>
      <td>${po.source_order_id ?? ""}</td>
      <td>$${money(po.total)}</td>
      <td class="row-actions">${buildPurchaseActionMenuHtml_(po.po_id)}</td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("po-pagination", totalPages, i => renderPurchases(sortedList, i), purchasePage);
  renderPurchaseMobileCards_(pageList);
}

function buildPurchaseActionMenuHtml_(poId) {
  const options = [
    '<option value="">請選擇</option>',
    '<option value="view">查看</option>',
    '<option value="edit">編輯</option>',
    '<option value="print">驗收單下載</option>',
    '<option value="delete">刪除</option>'
  ].join('');
  return `<select class="admin-select purchase-action-select" onchange="handlePurchaseRowAction(this, '${poId}')">${options}</select>`;
}

function handlePurchaseRowAction(el, poId) {
  const value = String(el?.value || '').trim();
  if (!value) return;
  if (value === 'view') viewPurchase(poId);
  else if (value === 'edit') editPurchase(poId);
  else if (value === 'print') printPurchase(poId);
  else if (value === 'delete') deletePurchase(poId);
  if (el) el.value = '';
}
window.handlePurchaseRowAction = handlePurchaseRowAction;

function searchPurchases() {
  renderPurchases(getPurchaseFilteredListForRender_(), 1);
}

let purchasePreviewState_ = { po: null, pageIndex: 1, pageCount: 1 };

function renderPurchasePreviewBody_(po, pageIndex = 1) {
  const items = sortPurchaseItemsBySupplier_(Array.isArray(po?.items) ? po.items : []);
  po = po ? { ...po, items } : po;
  const perPage = (typeof PURCHASE_TEMPLATE_MAX_ROWS_ !== "undefined" ? Number(PURCHASE_TEMPLATE_MAX_ROWS_) : 16) || 16;
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const safePageIndex = Math.min(pageCount, Math.max(1, Number(pageIndex || 1)));
  purchasePreviewState_ = { po, pageIndex: safePageIndex, pageCount };

  if (typeof buildPurchaseDocHtml_ !== "function") {
    return `<pre>${JSON.stringify(po, null, 2)}</pre>`;
  }

  const pageItems = items.slice((safePageIndex - 1) * perPage, safePageIndex * perPage);
  const navButtons = Array.from({ length: pageCount }, (_, idx) => {
    const pageNo = idx + 1;
    const activeClass = pageNo === safePageIndex ? ' is-active' : '';
    return `<button type="button" class="purchase-preview-page-btn${activeClass}" onclick="showPurchasePreviewPage_(${pageNo})">第 ${pageNo} 張</button>`;
  }).join('');

  const pager = pageCount > 1 ? `
    <div class="purchase-preview-toolbar is-multipage">
      <div class="purchase-preview-summary-wrap">
        <div class="purchase-preview-multipage-alert">
          <span class="purchase-preview-multipage-badge">已分頁</span>
          <span class="purchase-preview-multipage-text">本張採購驗收單已拆成 <strong>${pageCount}</strong> 張，請逐張確認內容。</span>
        </div>
        <div class="purchase-preview-summary">本單共 <strong>${pageCount}</strong> 張驗收單，目前顯示第 <strong>${safePageIndex}</strong> 張。</div>
      </div>
      <div class="purchase-preview-actions">
        <button type="button" class="purchase-preview-nav-btn" onclick="showPurchasePreviewPage_(${safePageIndex - 1})" ${safePageIndex <= 1 ? 'disabled' : ''}>上一張</button>
        <div class="purchase-preview-page-list">${navButtons}</div>
        <button type="button" class="purchase-preview-nav-btn" onclick="showPurchasePreviewPage_(${safePageIndex + 1})" ${safePageIndex >= pageCount ? 'disabled' : ''}>下一張</button>
      </div>
    </div>` : `
    <div class="purchase-preview-toolbar is-single">
      <div class="purchase-preview-summary">本單共 <strong>1</strong> 張驗收單。</div>
    </div>`;

  const sheetClass = pageCount > 1 ? 'purchase-preview-sheet is-multipage' : 'purchase-preview-sheet';
  return `${pager}<div class="${sheetClass}">${buildPurchaseDocHtml_(po, { pageIndex: safePageIndex, pageCount, items: pageItems, rowCount: perPage })}</div>`;
}

function showPurchasePreviewPage_(pageIndex) {
  const po = purchasePreviewState_?.po;
  if (!po) return;
  const bodyEl = document.getElementById('poModalBody');
  if (!bodyEl) return;
  bodyEl.innerHTML = renderPurchasePreviewBody_(po, pageIndex);
}
window.showPurchasePreviewPage_ = showPurchasePreviewPage_;

function viewPurchase(poId) {
  openPoModal(`採購驗收單查看`, `<div class="purchase-preview-loading">載入中…</div>`);
  fetchPurchaseDetail_(poId, (po, res) => {
    if (!po) return alert(res?.message || "找不到進貨單");

    const totalItems = Array.isArray(po?.items) ? po.items.length : 0;
    const perPage = (typeof PURCHASE_TEMPLATE_MAX_ROWS_ !== "undefined" ? Number(PURCHASE_TEMPLATE_MAX_ROWS_) : 16) || 16;
    const pageCount = Math.max(1, Math.ceil(totalItems / perPage));
    const titleText = pageCount > 1 ? `採購驗收單查看（共 ${pageCount} 張）` : `採購驗收單查看`;
    const body = renderPurchasePreviewBody_(po, 1);
    const titleEl = document.getElementById('poModalTitle');
    if (titleEl) titleEl.textContent = titleText;
    const bodyEl = document.getElementById('poModalBody');
    if (bodyEl) bodyEl.innerHTML = body;
    else openPoModal(titleText, body);
  });
}

function deletePurchase(poId) {
  if (!confirm(`確定刪除進貨單 ${poId}？\n（注意：刪除僅移除單據，不回滾庫存；如需回沖請用「庫存調整」或做沖銷單）`)) return;

  gas({ type: "managePurchase", action: "delete", po_id: poId }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "刪除失敗（後端未成功）");
      return;
    }
    alert(res?.message || "刪除完成");
    try { deleteCachedPurchaseDetail_(poId); } catch (e) {}
    try { applyPurchasesList_((Array.isArray(purchases) ? purchases : []).filter(x => String(x?.po_id || "").trim() !== String(poId || "").trim()), { keepPage: true, forceRender: true }); } catch (e) {}
    LS.del("stockLedger");
    loadPurchases(true);
    loadLedger(true);
    refreshDashboard();
  });
}

// ------------------ 銷貨（沿用訂單） ------------------
function initCustomerCombo_(){
  const inputEl = document.getElementById("so-customer-combo");
  const menuEl = document.getElementById("so-customer-menu");
  const hiddenId = document.getElementById("so-customer-id");
  const phoneEl = document.getElementById("so-phone");
  const addressEl = document.getElementById("so-address");
  if (!inputEl || !menuEl || !hiddenId) return;

  const getOptions = (kw) => {
    const list = customers.length ? customers : LS.get("customers", []);
    const key = String(kw || "").trim().toLowerCase();
    if (!key) {
      // 不輸入就不展開，避免太長
      return { items: [], hint: "請輸入關鍵字搜尋" };
    }
    const items = (list || [])
      .filter(c => {
        const id = String(c.id || "").toLowerCase();
        const name = String(c.name || "").toLowerCase();
        return id.includes(key) || name.includes(key);
      })
      .slice(0, 40)
      .map(c => ({ value: String(c.id || ""), label: `${c.id} - ${c.name}` }));
    return items;
  };

  setupCombo_(inputEl, menuEl, getOptions, (picked) => {
    const list = customers.length ? customers : LS.get("customers", []);
    const c = (list || []).find(x => String(x.id) === String(picked.value));
    hiddenId.value = String(picked.value || "");
    inputEl.value = String(c?.name || "");
    if (phoneEl && c) phoneEl.value = c.phone || "";
    if (addressEl && c) addressEl.value = c.address || "";
  }, {
    minChars: 1,
    maxShow: 40,
    onInputClear: () => {
      hiddenId.value = "";
    }
  });
}

function bindOrderEvents() {
  document.getElementById("order-search")?.addEventListener("input", searchOrders);
  document.getElementById("status-filter")?.addEventListener("change", searchOrders);
  document.getElementById("reload-orders")?.addEventListener("click", () => {
    LS.del("orders");
    loadOrders(true);
  });

  // ---- 新增銷貨單（後台出庫）----
  initCustomerCombo_();
  initOrderDocModal_();
  initOrderPriceEditModal_();
  initOrderDateEditModal_();

  document.getElementById("so-add-row")?.addEventListener("click", addSaleRow);
  document.getElementById("so-submit")?.addEventListener("click", submitSale);

}

function bindSettingEvents(){
  document.getElementById("setting-save-delivery")?.addEventListener("click", saveSystemSettings_);
  document.getElementById("setting-reload-delivery")?.addEventListener("click", () => loadSystemSettings_(true));
  loadSystemSettings_();
}

function getSettingInputValue_(id){
  return String(document.getElementById(id)?.value || "").trim();
}

function fillSystemSettingsForm_(map){
  const driverName = document.getElementById("setting-driver-name");
  const driverPhone = document.getElementById("setting-driver-phone");
  const salesPhone = document.getElementById("setting-sales-phone");
  const salesName = document.getElementById("setting-sales-name");
  const lineEnabled = document.getElementById("setting-line-order-push-enabled");
  const lineToken = document.getElementById("setting-line-order-token");
  const lineGroup = document.getElementById("setting-line-order-group");
  const lineTitle = document.getElementById("setting-line-order-title");
  if (driverName) driverName.value = String(map?.driver_name || "");
  if (driverPhone) driverPhone.value = String(map?.driver_phone || "");
  if (salesPhone) salesPhone.value = String(map?.sales_phone || "");
  if (salesName) salesName.value = String(map?.sales_name || "");
  if (lineEnabled) lineEnabled.checked = String(map?.line_order_push_enabled || "0") === "1";
  if (lineToken) lineToken.value = String(map?.line_order_channel_access_token || "");
  if (lineGroup) lineGroup.value = String(map?.line_order_group_id || "");
  if (lineTitle) lineTitle.value = String(map?.line_order_push_title || "電商訂單通知");
}

function loadSystemSettings_(force = false){
  const cached = LS.get("deliverySettings", null);
  if (!force && cached && typeof cached === "object") {
    deliverySettingsState = { ...deliverySettingsState, ...cached };
    fillSystemSettingsForm_(deliverySettingsState);
  }
  gas({ type: "systemSettings" }, res => {
    if (res?.status && String(res.status).toLowerCase() === "error") {
      if (!cached) fillSystemSettingsForm_(deliverySettingsState || {});
      return;
    }
    const data = (res && (res.settings || res.data || res.map)) || {};
    deliverySettingsState = {
      driver_name: String(data.driver_name || ""),
      driver_phone: String(data.driver_phone || ""),
      sales_phone: String(data.sales_phone || ""),
      sales_name: String(data.sales_name || ""),
      line_order_push_enabled: String(data.line_order_push_enabled || "0"),
      line_order_channel_access_token: String(data.line_order_channel_access_token || ""),
      line_order_group_id: String(data.line_order_group_id || ""),
      line_order_push_title: String(data.line_order_push_title || "電商訂單通知")
    };
    LS.set("deliverySettings", deliverySettingsState);
    fillSystemSettingsForm_(deliverySettingsState);
    if (currentOrderDocId) {
      const preview = document.getElementById("orderDocPreview");
      const order = findOrderById_(currentOrderDocId);
      if (preview && order) preview.innerHTML = buildOrderDocHtml_(order, deliverySettingsState);
    }
  });
}

function saveSystemSettings_(){
  const payload = {
    driver_name: getSettingInputValue_("setting-driver-name"),
    driver_phone: getSettingInputValue_("setting-driver-phone"),
    sales_phone: getSettingInputValue_("setting-sales-phone"),
    sales_name: getSettingInputValue_("setting-sales-name"),
    line_order_push_enabled: document.getElementById("setting-line-order-push-enabled")?.checked ? "1" : "0",
    line_order_channel_access_token: getSettingInputValue_("setting-line-order-token"),
    line_order_group_id: getSettingInputValue_("setting-line-order-group"),
    line_order_push_title: getSettingInputValue_("setting-line-order-title") || "電商訂單通知"
  };
  gas({ type: "manageSystemSettings", action: "save", settings: JSON.stringify(payload) }, res => {
    if (res?.status && String(res.status).toLowerCase() === "error") {
      alert(res?.message || "儲存設定失敗");
      return;
    }
    deliverySettingsState = { ...payload };
    LS.set("deliverySettings", deliverySettingsState);
    fillSystemSettingsForm_(deliverySettingsState);
    alert(res?.message || "系統設定已儲存");
  });
}

function initOrderDocModal_(){
  const modal = document.getElementById("orderDocModal");
  if (!modal || modal.dataset.bound === "1") return;
  modal.dataset.bound = "1";
  const close = () => closeOrderDocModal_();
  document.getElementById("orderDocModalClose")?.addEventListener("click", close);
  document.getElementById("orderDocCloseBtn")?.addEventListener("click", close);
  document.getElementById("orderDocPrintBtn")?.addEventListener("click", () => {
    if (currentOrderDocId) printOrderDoc(currentOrderDocId);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) close();
  });
}

function openOrderDocModal_(){
  const modal = document.getElementById("orderDocModal");
  if (!modal) return;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeOrderDocModal_(){
  const modal = document.getElementById("orderDocModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}

function orderListSignature_(list) {
  const arr = Array.isArray(list) ? list : [];
  try {
    return JSON.stringify(arr.map(o => [
      String(o?.order_id || ""),
      String(o?.shipping_date || ""),
      String(o?.date || ""),
      String(o?.created_at || o?.createdAt || ""),
      String(o?.status || ""),
      Number(o?.total || 0),
      Number(o?.stock_applied || 0) ? 1 : 0,
      Array.isArray(o?.items) ? o.items.length : 0,
      String(o?.operator || "")
    ]));
  } catch (e) {
    return String(arr.length);
  }
}

function persistOrdersCache_(list) {
  const arr = Array.isArray(list) ? list : [];
  LS.set(ORDER_CACHE_KEY_, arr);
  LS.set(ORDER_CACHE_META_KEY_, { fetched_at: Date.now(), sig: orderListSignature_(arr) });
}

function isOrdersCacheFresh_() {
  const meta = LS.get(ORDER_CACHE_META_KEY_, null);
  const fetchedAt = Number(meta?.fetched_at || 0);
  return !!(fetchedAt && (Date.now() - fetchedAt < ORDER_CACHE_FRESH_MS_));
}

function applyOrdersList_(list, opts = {}) {
  const arr = Array.isArray(list) ? list : [];
  const sig = orderListSignature_(arr);
  const changed = sig !== orderListSignature_(ordersState);
  ordersState = arr;
  persistOrdersCache_(arr);

  if (isSectionActive_("order-section") && (changed || opts.forceRender)) {
    const keepPage = !!opts.keepPage;
    renderOrders(arr, keepPage ? (orderPage || 1) : 1);
  }
  scheduleDashboardRefresh_();
  return changed;
}

function fetchOrdersLatest_(opts = {}) {
  const force = !!opts.force;
  if (ordersFetchPending_ && !force) return ordersFetchPending_;
  if (!force && ordersLastFetchedAt_ && (Date.now() - ordersLastFetchedAt_ < 1200)) {
    return Promise.resolve(Array.isArray(ordersState) ? ordersState : []);
  }

  ordersFetchPending_ = new Promise(resolve => {
    gas({ type: "orders" }, res => {
      ordersLastFetchedAt_ = Date.now();
      const list = normalizeList(res);
      const ok = Array.isArray(list);
      const status = String(res?.status || "").toLowerCase();

      if (ok) {
        applyOrdersList_(list, { keepPage: opts.keepPage, forceRender: !Array.isArray(ordersState) || !ordersState.length || !!opts.forceRender });
      } else if (!Array.isArray(ordersState) || !ordersState.length) {
        const cached = LS.get(ORDER_CACHE_KEY_, []);
        applyOrdersList_(Array.isArray(cached) ? cached : [], { keepPage: true, forceRender: true });
        if ((status === "timeout" || status === "error") && !cached.length && !opts.silent) {
          alert(`銷貨單資料載入失敗：${res?.message || "API 無回應"}`);
        }
      }

      const done = Array.isArray(ordersState) ? ordersState : [];
      ordersFetchPending_ = null;
      resolve(done);
    }, force ? 60000 : 45000);
  });

  return ordersFetchPending_;
}

function loadOrders(force = false, opts = {}) {
  const cached = LS.get(ORDER_CACHE_KEY_, null);
  const hasCached = Array.isArray(cached);

  if (hasCached) {
    applyOrdersList_(cached, {
      keepPage: !force,
      forceRender: !!opts.forceRender || (!Array.isArray(ordersState) || !ordersState.length)
    });
  }

  const shouldFetch = !!force || !hasCached || !isOrdersCacheFresh_() || !!opts.background || isSectionActive_("order-section") || isSectionActive_("dashboard-section") || isSectionActive_("report-section");
  if (!shouldFetch) return Promise.resolve(Array.isArray(ordersState) ? ordersState : []);

  return fetchOrdersLatest_({
    force,
    keepPage: hasCached || !!opts.keepPage,
    forceRender: !hasCached,
    silent: !!opts.silent
  });
}

function initOrderSyncWatch_() {
  if (orderSyncBound_) return;
  orderSyncBound_ = true;

  const refreshIfNeeded = (force = false) => {
    if (document.hidden) return;
    if (!isSectionActive_("order-section") && !isSectionActive_("dashboard-section") && !isSectionActive_("report-section")) return;
    loadOrders(!!force, { keepPage: true, silent: true });
  };

  window.addEventListener("focus", () => refreshIfNeeded(false));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfNeeded(false);
  });

  orderSyncTimer_ = window.setInterval(() => refreshIfNeeded(false), ORDER_SYNC_POLL_MS_);
}

initOrderSyncWatch_();

function orderStatusInfo_(status){
  const s = String(status || '').trim() || '待出貨';
  if (s === '待出貨') return { text:s, cls:'pending' };
  if (s === '已出貨') return { text:s, cls:'shipped' };
  if (s === '已完成') return { text:s, cls:'done' };
  if (s === '已取消') return { text:s, cls:'cancelled' };
  return { text:s, cls:'default' };
}

function buildOrderActionMenuHtml_(orderId, currentStatus) {
  const status = String(currentStatus || '').trim() || '待出貨';
  const deleteLocked = status === '已完成';
  const options = [
    '<option value="">請選擇</option>',
    '<option value="editOrder">編輯訂單</option>',
    `<option value="status:已出貨"${status === '已出貨' ? ' disabled' : ''}>標記為已出貨</option>`,
    `<option value="status:已完成"${status === '已完成' ? ' disabled' : ''}>標記為已完成（不扣庫存）</option>`,
    `<option value="status:已取消"${status === '已取消' ? ' disabled' : ''}>標記為已取消</option>`,
    `<option value="delete"${deleteLocked ? ' disabled' : ''}>${deleteLocked ? '已完成不可刪除' : '刪除訂單'}</option>`
  ].join('');
  return `<select class="admin-select order-action-select" onchange="handleOrderRowAction(this, '${orderId}')">${options}</select>`;
}

function handleOrderRowAction(el, orderId) {
  const value = String(el?.value || '').trim();
  if (!value) return;
  if (value === 'delete') {
    deleteOrder(orderId);
  } else if (value === 'editOrder') {
    openOrderEditModal_(orderId);
  } else if (value.indexOf('status:') === 0) {
    updateOrder(orderId, value.slice(7));
  }
  if (el) el.value = '';
}
window.handleOrderRowAction = handleOrderRowAction;

function renderOrders(orders, page = 1) {
  const sortedOrders = [...(orders || [])].sort((a,b) => {
    const da = String(getOrderCreatedDateTime_(a) || getOrderDeliveryDate_(a) || dateOnly(a?.date || "") || "");
    const db = String(getOrderCreatedDateTime_(b) || getOrderDeliveryDate_(b) || dateOnly(b?.date || "") || "");
    if (da !== db) return db.localeCompare(da);
    const ia = String(a?.order_id || "");
    const ib = String(b?.order_id || "");
    return ib.localeCompare(ia);
  });
  const tbody = document.querySelector("#admin-order-table tbody");
  if (!tbody) return;

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / ordersPerPage));
  orderPage = Math.min(page, totalPages);

  const start = (orderPage - 1) * ordersPerPage;
  const end = start + ordersPerPage;

  const pageOrders = sortedOrders.slice(start, end);

  tbody.innerHTML = pageOrders.map(o => {
    const statusInfo = orderStatusInfo_(o?.status);
    const orderId = String(o?.order_id || '');
    const customerName = String(o?.name || '').trim();
    const phoneText = String(o?.phone || '').trim();
    return `
    <tr>
      <td class="order-col-id">${escapeHtml_(orderId)}</td>
      <td class="order-col-created">${escapeHtml_(getOrderCreatedDateTime_(o) || "—")}</td>
      <td class="order-col-date">${escapeHtml_(getOrderDeliveryDate_(o) || "—")}</td>
      <td class="order-col-customer" title="${escapeHtml_(customerName)}"><div class="order-customer-name">${escapeHtml_(customerName)}</div></td>
      <td class="order-col-phone">${escapeHtml_(phoneText)}</td>
      <td class="order-col-status"><span class="status-chip ${statusInfo.cls}">${statusInfo.text}</span></td>
      <td class="order-col-total">$${money(o.total)}</td>
      <td class="order-col-doc">
        <div class="order-doc-actions">
          <button class="order-doc-btn" onclick="showOrderDoc('${orderId}')">查看</button>
          <button class="order-doc-btn" onclick="printOrderDoc('${orderId}')">列印</button>
        </div>
      </td>
      <td class="order-col-actions">${buildOrderActionMenuHtml_(orderId, statusInfo.text)}</td>
    </tr>
  `;
  }).join("");

  renderPagination("order-pagination", totalPages, i => {
    const list = LS.get("orders", orders);
    renderOrders(list, i);
  }, orderPage);
  renderOrderMobileCards_(pageOrders);
}

function findOrderById_(orderId){
  const orders = (Array.isArray(ordersState) && ordersState.length) ? ordersState : LS.get("orders", []);
  return (orders || []).find(x => String(x.order_id) === String(orderId)) || null;
}

function parseOrderItems_(order){
  let items = order?.items;
  if (typeof items === "string" && items.trim()) {
    try { items = JSON.parse(items); } catch(e) {}
  }
  if (!Array.isArray(items)) items = [];
  return items;
}

function getAdminProductsForOrderPrint_(){
  const local = (typeof adminProducts !== "undefined" && Array.isArray(adminProducts) && adminProducts.length)
    ? adminProducts
    : LS.get("products", []);
  return Array.isArray(local) ? local : [];
}

function findProductForOrderItem_(it){
  const products = getAdminProductsForOrderPrint_();
  const pid = String(it?.product_id ?? it?.id ?? "").trim();
  const sku = String(it?.sku ?? it?.SKU ?? it?.item_no ?? it?.part_no ?? it?.code ?? it?.product_code ?? "").trim();
  const name = String(it?.product_name ?? it?.name ?? it?.ProductName ?? it?.product ?? "").trim();
  if (pid) {
    const byId = products.find(p => String(p?.id ?? "").trim() === pid);
    if (byId) return byId;
  }
  if (sku) {
    const bySku = products.find(p => String(p?.sku ?? p?.part_no ?? p?.code ?? p?.['料號'] ?? "").trim() === sku);
    if (bySku) return bySku;
  }
  if (name) {
    const byName = products.find(p => String(p?.name ?? p?.product_name ?? "").trim() === name);
    if (byName) return byName;
  }
  return null;
}

function deriveOrderItemSku_(it){
  const direct = String(it?.sku ?? it?.SKU ?? it?.item_no ?? it?.part_no ?? it?.code ?? it?.product_code ?? it?.product_id ?? "").trim();
  if (direct) return direct;
  const p = findProductForOrderItem_(it);
  return String(p?.sku ?? p?.part_no ?? p?.code ?? p?.['料號'] ?? p?.product_id ?? p?.id ?? "").trim();
}

function deriveOrderItemUnit_(it){
  const direct = String(it?.unit ?? it?.Unit ?? "").trim();
  if (direct) return direct;
  const p = findProductForOrderItem_(it);
  return String(p?.unit ?? "").trim();
}

function formatDeliveryDate_(v){
  const s = dateOnly(v || "");
  if (!s) return "";
  return s.replace(/-/g, ".");
}

function formatOrderDateTimeToMinute_(v){
  if (!v) return "";
  const toText = dt => {
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}`;
  };
  if (v instanceof Date) return toText(v);
  if (typeof v === "number") return toText(new Date(v));
  const s = String(v).trim();
  if (!s) return "";

  const apm = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T]|,\s*)(上午|下午|AM|PM|am|pm)?\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/i);
  if (apm) {
    const y = Number(apm[1]);
    const mo = Number(apm[2]) - 1;
    const d = Number(apm[3]);
    let hh = Number(apm[5] || 0);
    const mm = Number(apm[6] || 0);
    const ss = Number(apm[7] || 0);
    const mer = String(apm[4] || '').toLowerCase();
    const isPM = mer === '下午' || mer === 'pm';
    const isAM = mer === '上午' || mer === 'am';
    if (isPM && hh < 12) hh += 12;
    if (isAM && hh === 12) hh = 0;
    return toText(new Date(y, mo, d, hh, mm, ss));
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dtIso = new Date(s);
    if (!isNaN(dtIso.getTime())) return toText(dtIso);
  }

  const local = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (local) {
    const y = Number(local[1]);
    const mo = Number(local[2]) - 1;
    const d = Number(local[3]);
    const hh = Number(local[4] || 0);
    const mm = Number(local[5] || 0);
    const ss = Number(local[6] || 0);
    return toText(new Date(y, mo, d, hh, mm, ss));
  }

  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return toText(dt);
  return dateOnly(s) || s;
}

function getOrderCreatedDateTime_(order){
  return formatOrderDateTimeToMinute_(order?.created_at || order?.createdAt || "") || dateOnly(order?.created_at || order?.createdAt || order?.date || "") || "";
}

function getOrderDeliveryDate_(order){
  return dateOnly(order?.shipping_date || "") || "";
}

function getDeliverySettings_(){
  return deliverySettingsState || LS.get("deliverySettings", {}) || {};
}

function deliveryDocPrintStyles_(){
  return `
  <style>
    @page{ size:A4 portrait; margin:0; }
    html,body{ margin:0; padding:0; background:#fff; width:210mm; height:297mm; overflow:hidden; }
    body{ color:#111; font-family:"Noto Sans TC","Microsoft JhengHei","微軟正黑體","PingFang TC",sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .print-sheet{ box-sizing:border-box; width:210mm; height:297mm; padding:6mm 7mm; display:grid; grid-template-rows:138mm 5mm 138mm; overflow:hidden; }
    .print-copy-frame{ position:relative; min-height:0; overflow:hidden; }
    .print-copy-boundary{ position:relative; width:100%; height:100%; overflow:hidden; border:none !important; outline:none !important; }
    .print-copy-box{ position:absolute; left:0; top:0; transform-origin:top left; will-change:transform; }
    .print-separator{ position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .print-separator::before{ content:""; display:block; width:100%; border-top:1px dashed #888; }

    .delivery-copy,
    .delivery-copy::before,
    .delivery-copy::after{ border:none !important; outline:none !important; box-shadow:none !important; }
    .delivery-copy{ box-sizing:border-box; width:196mm; min-height:136mm; padding:0.8mm 1.2mm 1.2mm; color:#111; background:#fff; display:flex; flex-direction:column; }
    .delivery-copy-head{ position:relative; text-align:center; margin-bottom:2mm; }
    .delivery-copy-title{ font-size:15.8px; font-weight:700; letter-spacing:.4px; }
    .delivery-copy-copytag{ position:absolute; right:0; top:0; font-size:8.8px; font-weight:700; text-align:right; line-height:1.22; }
    .delivery-copy-copytag .copy-main{ display:block; }
    .delivery-copy-copytag .copy-sub{ display:block; font-size:7.9px; }

    .delivery-copy-meta{ display:grid; grid-template-columns:1fr 1fr; gap:1mm 7mm; margin-bottom:1.4mm; font-size:9.8px; }
    .delivery-copy-meta.full{ grid-template-columns:1fr; margin-bottom:1.8mm; }
    .delivery-copy-line{ display:flex; gap:3px; min-width:0; }
    .delivery-copy-label{ white-space:nowrap; font-weight:700; }
    .delivery-copy-value{ flex:1; min-width:0; word-break:break-word; }

    .delivery-copy-main{ flex:0 0 auto; }
    .delivery-copy-table{ width:100%; border-collapse:collapse; table-layout:fixed; font-size:12.4px; }
    .delivery-copy-table th,.delivery-copy-table td{ border:1px solid #6d69d7; padding:2px 3px; text-align:center; vertical-align:middle; word-break:break-word; line-height:1.32; background:#fff; }
    .delivery-copy-table th{ font-weight:700; }
    .delivery-copy-table td.left{ text-align:left; padding-left:3.4px; }
    .delivery-copy-table td.num{ text-align:right; white-space:nowrap; padding-right:3.4px; }
    .delivery-copy-table .col-sku{ width:12%; }
    .delivery-copy-table .col-name{ width:31%; }
    .delivery-copy-table .col-qty{ width:10%; }
    .delivery-copy-table .col-unit{ width:7%; }
    .delivery-copy-table .col-price{ width:13%; }
    .delivery-copy-table .col-subtotal{ width:14%; }
    .delivery-copy-table .col-note{ width:13%; }
    .delivery-copy-empty td{ height:20px; }

    .delivery-copy-bottom{ display:grid; grid-template-columns:60% 40%; gap:0; align-items:stretch; margin-top:2.1mm; }
    .delivery-copy-remark{ min-height:23mm; border:1px solid #6d69d7; border-right:none; padding:2.1mm 2.4mm; font-size:10.2px; line-height:1.5; white-space:pre-wrap; box-sizing:border-box; }
    .delivery-copy-total{ min-height:23mm; border:1px solid #6d69d7; padding:2.1mm 2.8mm; display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-end; text-align:right; box-sizing:border-box; }
    .delivery-copy-total-label{ font-size:10.4px; font-weight:700; line-height:1.2; }
    .delivery-copy-total-amount{ margin-top:1.2mm; font-size:16.8px; font-weight:800; line-height:1.05; letter-spacing:.5px; }

    .delivery-copy-sign{ display:grid; grid-template-columns:1.2fr 1.2fr 1.2fr 1.2fr 1.2fr 1.2fr 2.2fr; gap:3.4mm; margin-top:3mm; font-size:11.9px; }
    .delivery-copy-sign div{ white-space:nowrap; min-width:0; }

    @media print{
      html,body{ width:210mm; height:297mm; overflow:hidden; }
      .print-sheet{ page-break-after:avoid; break-after:avoid-page; }
      .print-copy-frame,.print-copy-boundary,.print-separator{ page-break-inside:avoid; break-inside:avoid-page; }
    }
  </style>`;
}

function buildOrderDocHtml_(order, settings = {}, printMode = false){
  if (!order) return '<div class="muted">查無出貨單資料</div>';
  const items = parseOrderItems_(order);
  const rows = items.map((it, idx) => {
    const name = String(it.product_name || it.name || it.ProductName || it.product || `品項${idx + 1}`);
    const seqNo = String(idx + 1);
    const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity ?? 0, 0);
    const unit = deriveOrderItemUnit_(it);
    const price = safeNum(it.price ?? it.UnitPrice ?? it.unit_price ?? 0, 0);
    const subtotal = safeNum(it.subtotal ?? it.Subtotal ?? (qty * price), 0);
    const note = String(it.note || it.memo || "");
    return `
      <tr>
        <td class="center">${escapeHtml_(seqNo)}</td>
        <td>${escapeHtml_(name)}</td>
        <td class="num">${qty ? money(qty) : ""}</td>
        <td class="center">${escapeHtml_(unit)}</td>
        <td class="num">${price ? money(price) : ""}</td>
        <td class="num">${subtotal ? money(subtotal) : ""}</td>
        <td>${escapeHtml_(note)}</td>
      </tr>`;
  });
  const minRows = 9;
  while (rows.length < minRows) {
    rows.push('<tr class="delivery-doc-empty"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  }
  const total = getOrderTotal(order);
  return `
    <div class="delivery-doc-sheet">
      <div class="delivery-doc-head">
        <div class="delivery-doc-org">社團法人屏東縣社會福利聯盟</div>
        <div class="delivery-doc-title">出貨單</div>
      </div>
      <div class="delivery-doc-top">
        <div class="delivery-doc-lines">
          <div class="delivery-doc-line"><span class="delivery-doc-label">客戶名稱：</span><span class="delivery-doc-value">${escapeHtml_(order.name || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">公司電話：</span><span class="delivery-doc-value">${escapeHtml_(order.phone || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">送貨地址：</span><span class="delivery-doc-value">${escapeHtml_(order.address || "")}</span></div>
        </div>
        <div class="delivery-doc-side">
          <div class="delivery-doc-line"><span class="delivery-doc-label">司機姓名：</span><span class="delivery-doc-value">${escapeHtml_(settings.driver_name || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">司機電話：</span><span class="delivery-doc-value">${escapeHtml_(settings.driver_phone || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">業務手機：</span><span class="delivery-doc-value">${escapeHtml_(settings.sales_phone || "")}</span></div>
        </div>
        <div class="delivery-doc-side right">
          <div class="delivery-doc-line"><span class="delivery-doc-label">出貨日期：</span><span class="delivery-doc-value">${escapeHtml_(formatDeliveryDate_(getOrderDeliveryDate_(order)))}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">出貨單號：</span><span class="delivery-doc-value">${escapeHtml_(order.order_id || "")}</span></div>
          <div class="delivery-doc-line"><span class="delivery-doc-label">業務姓名：</span><span class="delivery-doc-value">${escapeHtml_(settings.sales_name || "")}</span></div>
        </div>
      </div>
      <table class="delivery-doc-table">
        <thead>
          <tr>
            <th class="col-sku">物品編號</th>
            <th class="col-name">物品名稱</th>
            <th class="col-qty">數量</th>
            <th class="col-unit">單位</th>
            <th class="col-price">單價</th>
            <th class="col-subtotal">小計</th>
            <th class="col-note">備註</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <div class="delivery-doc-foot">
        <div class="delivery-doc-remark">
          備註：<br>
          1. 本單資料供出貨與對帳確認使用。<br>
          2. 收貨後如有數量或品項疑問，請盡速與本單位聯繫。<br>
          3. 簽收後請妥善留存，以維護雙方權益。
        </div>
        <div class="delivery-doc-totalbox">
          <div class="delivery-doc-sumline"><span>合計：</span><span>${money(total)}</span></div>
          <div class="delivery-doc-sumline total"><span>總金額：</span><span>${money(total)}</span></div>
        </div>
      </div>
      <div class="delivery-doc-sign">
        <div><b>主管：</b></div>
        <div><b>會計：</b></div>
        <div><b>庫管：</b></div>
        <div><b>配送：</b>${escapeHtml_(settings.driver_name || "")}</div>
        <div><b>客戶：</b></div>
      </div>
    </div>`;
}


function buildOrderPrintCopyHtml_(order, settings = {}, copyLabel = "", copySubLabel = ""){
  if (!order) return '<div class="muted">查無出貨單資料</div>';
  const items = parseOrderItems_(order);
  const rows = items.map((it, idx) => {
    const name = String(it.product_name || it.name || it.ProductName || it.product || `品項${idx + 1}`);
    const seqNo = String(idx + 1);
    const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity ?? 0, 0);
    const unit = deriveOrderItemUnit_(it);
    const price = safeNum(it.price ?? it.UnitPrice ?? it.unit_price ?? 0, 0);
    const subtotal = safeNum(it.subtotal ?? it.Subtotal ?? (qty * price), 0);
    const note = String(it.note || it.memo || "");
    return `
      <tr>
        <td>${escapeHtml_(seqNo)}</td>
        <td class="left">${escapeHtml_(name)}</td>
        <td class="num">${qty ? money(qty) : ""}</td>
        <td>${escapeHtml_(unit)}</td>
        <td class="num">${price ? money(price) : ""}</td>
        <td class="num">${subtotal ? money(subtotal) : ""}</td>
        <td class="left">${escapeHtml_(note)}</td>
      </tr>`;
  });
  const minRows = 11;
  while (rows.length < minRows) {
    rows.push('<tr class="delivery-copy-empty"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  }
  const total = getOrderTotal(order);
  const remark = String(order.remark || order.note || order.memo || "").trim();
  const notice = "本單所載如有疑義，需於五日內提出，否則視同接受無誤。";
  const remarkLines = [];
  if (remark) remarkLines.push(remark);
  remarkLines.push(notice);
  const remarkText = '備註：\n' + remarkLines.map((line, idx) => `${idx + 1}. ${line}`).join('\n');
  return `
    <div class="delivery-copy">
      <div class="delivery-copy-head">
        <div class="delivery-copy-title">社團法人屏東縣社會福利聯盟【出貨單】</div>
        <div class="delivery-copy-copytag"><span class="copy-main">${escapeHtml_(copyLabel || "")}</span>${copySubLabel ? `<span class="copy-sub">${escapeHtml_(copySubLabel)}</span>` : ""}</div>
      </div>
      <div class="delivery-copy-meta">
        <div class="delivery-copy-line"><span class="delivery-copy-label">出貨日期：</span><span class="delivery-copy-value">${escapeHtml_(formatDeliveryDate_(getOrderDeliveryDate_(order)))}</span></div>
        <div class="delivery-copy-line"><span class="delivery-copy-label">出貨單號：</span><span class="delivery-copy-value">${escapeHtml_(order.order_id || "")}</span></div>
        <div class="delivery-copy-line"><span class="delivery-copy-label">客戶名稱：</span><span class="delivery-copy-value">${escapeHtml_(order.name || "")}</span></div>
        <div class="delivery-copy-line"><span class="delivery-copy-label">公司電話：</span><span class="delivery-copy-value">${escapeHtml_(order.phone || "")}</span></div>
      </div>
      <div class="delivery-copy-meta full">
        <div class="delivery-copy-line"><span class="delivery-copy-label">送貨地址：</span><span class="delivery-copy-value">${escapeHtml_(order.address || "")}</span></div>
      </div>
      <div class="delivery-copy-main">
        <table class="delivery-copy-table">
          <thead>
            <tr>
              <th class="col-sku">物品編號</th>
              <th class="col-name">物品名稱</th>
              <th class="col-qty">數量</th>
              <th class="col-unit">單位</th>
              <th class="col-price">單價</th>
              <th class="col-subtotal">小計</th>
              <th class="col-note">備註</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
      <div class="delivery-copy-bottom">
        <div class="delivery-copy-remark">${escapeHtml_(remarkText || "")}</div>
        <div class="delivery-copy-total">
          <div class="delivery-copy-total-label">未收款總金額：</div>
          <div class="delivery-copy-total-amount">${money(total)}</div>
        </div>
      </div>
      <div class="delivery-copy-sign">
        <div>製表：</div>
        <div>審核：</div>
        <div>倉管：</div>
        <div>會計：</div>
        <div>採購：</div>
        <div>配送：</div>
        <div>客戶簽收：</div>
      </div>
    </div>`;
}


function showOrderDoc(orderId){
  const order = findOrderById_(orderId);
  if (!order) return alert("找不到該銷貨單");
  currentOrderDocId = String(orderId || "");
  const preview = document.getElementById("orderDocPreview");
  if (!preview) return;
  preview.innerHTML = buildOrderDocHtml_(order, getDeliverySettings_());
  openOrderDocModal_();
}

function initOrderPriceEditModal_(){
  const modal = document.getElementById('orderPriceEditModal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  const close = () => closeOrderPriceEditModal_();
  document.getElementById('orderPriceEditModalClose')?.addEventListener('click', close);
  document.getElementById('orderPriceEditCancelBtn')?.addEventListener('click', close);
  document.getElementById('orderPriceEditSaveBtn')?.addEventListener('click', saveOrderEdit_);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) close();
  });
}

function openOrderEditModal_(orderId){
  const modal = document.getElementById('orderPriceEditModal');
  const body = document.getElementById('orderPriceEditBody');
  if (!modal || !body) return;
  const order = findOrderById_(orderId);
  if (!order) return alert('找不到該銷貨單');

  const items = parseOrderItems_(order);
  if (!items.length) return alert('此銷貨單沒有可編輯的品項');

  currentOrderPriceEditId = String(orderId || '');
  currentOrderPriceEditItems_ = items.map(it => ({ ...it }));
  const shippingDate = getOrderDeliveryDate_(order) || '';

  const rows = currentOrderPriceEditItems_.map((it, idx) => {
    const qty = safeNum(it.qty ?? it.Quantity ?? it.quantity ?? 0, 0);
    const price = safeNum(it.price ?? it.UnitPrice ?? it.unit_price ?? 0, 0);
    const subtotal = safeNum(it.subtotal ?? it.Subtotal ?? (qty * price), 0);
    const name = String(it.product_name || it.name || it.ProductName || it.product || `品項${idx + 1}`);
    const sku = deriveOrderItemSku_(it);
    const unit = deriveOrderItemUnit_(it) || String(it.unit || '').trim();
    return `
      <tr data-index="${idx}" data-qty="${escapeAttr_(qty)}">
        <td class="order-price-edit-item-cell">
          <div class="order-price-edit-name">${escapeHtml_(name)}</div>
          <div class="hint">${escapeHtml_(sku || '未設定料號')}${unit ? `／${escapeHtml_(unit)}` : ''}</div>
        </td>
        <td class="num">${money(qty)}</td>
        <td><input type="number" class="admin-input order-price-edit-input" value="${escapeAttr_(price)}" min="0" step="0.01" inputmode="decimal"></td>
        <td class="order-price-edit-subtotal num">${money(subtotal)}</td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="order-price-edit-meta">
      <div><b>訂單編號：</b>${escapeHtml_(String(order.order_id || ''))}</div>
      <div><b>客戶：</b>${escapeHtml_(String(order.name || '').trim() || '未指定客戶')}</div>
      <div><b>訂單日期：</b>${escapeHtml_(getOrderCreatedDateTime_(order) || '—')}</div>
      <div><b>狀態：</b>${escapeHtml_(String(order.status || '').trim() || '待出貨')}</div>
    </div>
    <div style="max-width:320px;display:grid;gap:8px;margin:12px 0 16px;">
      <label for="orderEditShippingDateInput"><b>出貨日期</b></label>
      <input id="orderEditShippingDateInput" class="admin-input" type="date" value="${escapeAttr_(shippingDate)}" />
    </div>
    <div class="hint order-price-edit-hint">可在同一視窗一起修改這張銷貨單的出貨日期、單價與總金額；商品主檔售價不會反向覆蓋銷貨單。</div>
    <div class="order-price-edit-table-wrap">
      <table class="admin-table order-price-edit-table">
        <thead>
          <tr>
            <th>商品</th>
            <th>數量</th>
            <th>單價</th>
            <th>小計</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="order-price-edit-total">合計：<span id="orderPriceEditTotal">${money(getOrderTotal(order))}</span></div>
  `;

  body.querySelectorAll('.order-price-edit-input').forEach(input => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      if (tr) recalcOrderPriceEditRow_(tr);
    });
  });
  recalcOrderPriceEditTotal_();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function openOrderPriceEditModal_(orderId){
  return openOrderEditModal_(orderId);
}

function openOrderDateEditModal_(orderId){
  return openOrderEditModal_(orderId);
}

function closeOrderPriceEditModal_(){
  const modal = document.getElementById('orderPriceEditModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
  currentOrderPriceEditId = '';
  currentOrderPriceEditItems_ = [];
}

function initOrderDateEditModal_(){
  return;
}

function applyOrderEditToLocal_(orderId, shippingDate, items, total){
  const targetId = String(orderId || '').trim();
  if (!targetId) return;
  const current = Array.isArray(ordersState) && ordersState.length ? ordersState : LS.get(ORDER_CACHE_KEY_, []);
  const list = Array.isArray(current) ? current.map(order => {
    if (String(order?.order_id || '').trim() !== targetId) return order;
    return {
      ...order,
      shipping_date: shippingDate || String(order?.shipping_date || '').trim(),
      items: Array.isArray(items) ? items.map(it => ({ ...it })) : [],
      total: safeNum(total, 0)
    };
  }) : [];
  applyOrdersList_(list, { keepPage: true, forceRender: true });
}

function saveOrderEdit_(){
  const orderId = String(currentOrderPriceEditId || '').trim();
  if (!orderId) return;

  const shippingDate = String(document.getElementById('orderEditShippingDateInput')?.value || '').trim();
  if (!shippingDate) return alert('請先選擇出貨日期');

  const items = collectEditedOrderItems_();
  if (!items.length) return alert('沒有可儲存的品項');
  const total = items.reduce((sum, it) => sum + safeNum(it.subtotal ?? (safeNum(it.qty, 0) * safeNum(it.price, 0)), 0), 0);
  const compactPayload = {
    sd: shippingDate,
    pr: items.map(it => safeNum(it?.price ?? 0, 0))
  };

  gas({
    type: 'manageOrder',
    action: 'updatePrices',
    order_id: orderId,
    payload_compact: encodeURIComponent(JSON.stringify(compactPayload)),
    __timeoutMs: 65000
  }, res => {
    if (res?.status && res.status !== 'ok') {
      alert(res?.message || '更新訂單失敗');
      return;
    }

    applyOrderEditToLocal_(orderId, shippingDate, items, total);
    alert('訂單已更新');
    closeOrderPriceEditModal_();
    loadOrders(true).then(() => {
      if (currentOrderDocId && String(currentOrderDocId) === orderId) showOrderDoc(orderId);
      refreshDashboard();
    });
  }, 60000);
}

window.openOrderDateEditModal_ = openOrderDateEditModal_;
window.openOrderEditModal_ = openOrderEditModal_;

function recalcOrderPriceEditRow_(tr){
  const qty = safeNum(tr?.dataset?.qty || 0, 0);
  const price = safeNum(tr?.querySelector('.order-price-edit-input')?.value || 0, 0);
  const subtotal = qty * price;
  const subEl = tr?.querySelector('.order-price-edit-subtotal');
  if (subEl) subEl.textContent = money(subtotal);
  recalcOrderPriceEditTotal_();
}

function recalcOrderPriceEditTotal_(){
  const total = Array.from(document.querySelectorAll('#orderPriceEditBody .order-price-edit-subtotal')).reduce((sum, el) => sum + safeNum(el?.textContent || 0, 0), 0);
  const totalEl = document.getElementById('orderPriceEditTotal');
  if (totalEl) totalEl.textContent = money(total);
  return total;
}

function collectEditedOrderItems_(){
  return currentOrderPriceEditItems_.map((base, idx) => {
    const row = document.querySelector(`#orderPriceEditBody tr[data-index="${idx}"]`);
    const qty = safeNum(base.qty ?? base.Quantity ?? base.quantity ?? 0, 0);
    const price = safeNum(row?.querySelector('.order-price-edit-input')?.value || 0, 0);
    const subtotal = qty * price;
    return {
      ...base,
      qty,
      price,
      subtotal
    };
  });
}

function saveOrderPriceEdit_(){
  return saveOrderEdit_();
}

function printOrderDoc(orderId){
  const order = findOrderById_(orderId);
  if (!order) return alert("找不到該銷貨單");
  const settings = getDeliverySettings_();
  const topCopy = buildOrderPrintCopyHtml_(order, settings, "第一聯", "公司聯");
  const bottomCopy = buildOrderPrintCopyHtml_(order, settings, "第二聯", "客戶聯");
  const w = window.open("about:blank", "_blank", "width=1100,height=900");
  if (!w || w.closed) return alert("請允許瀏覽器開啟列印視窗");
  const fitScript = `<script>(function(){function measure(el){if(!el)return {w:1,h:1};var r=el.getBoundingClientRect();return {w:Math.max(Math.ceil(r.width||el.scrollWidth||el.offsetWidth||1),1),h:Math.max(Math.ceil(r.height||el.scrollHeight||el.offsetHeight||1),1)};}function fitCopies(){var frames=document.querySelectorAll('.print-copy-frame');frames.forEach(function(frame){var boundary=frame.querySelector('.print-copy-boundary');var box=frame.querySelector('.print-copy-box');var content=box&&box.firstElementChild;if(!boundary||!box||!content)return;box.style.transform='scale(1)';box.style.left='0px';box.style.top='0px';box.style.width='auto';box.style.height='auto';var availableW=Math.max(boundary.clientWidth-1,1);var availableH=Math.max(boundary.clientHeight-1,1);var natural=measure(content);var scale=Math.min(1,availableW/natural.w,availableH/natural.h);scale=Math.max(Math.min(scale*0.999,1),0.6);box.style.width=natural.w+'px';box.style.height=natural.h+'px';box.style.transform='scale('+scale+')';var renderedW=Math.round(natural.w*scale);box.style.left=Math.max(Math.floor((availableW-renderedW)/2),0)+'px';box.style.top='0px';});}window.addEventListener('resize',fitCopies);window.addEventListener('beforeprint',fitCopies);window.addEventListener('load',function(){setTimeout(function(){fitCopies();setTimeout(function(){fitCopies();setTimeout(function(){try{window.focus();window.print();}catch(e){}},260);},120);},120);});})();<\/script>`;
  const docHtml = `<!doctype html><html><head><meta charset="utf-8"><title>出貨單 ${escapeHtml_(order.order_id || "")}</title>${deliveryDocPrintStyles_()}</head><body><div class="print-sheet"><div class="print-copy-frame"><div class="print-copy-boundary"><div class="print-copy-box">${topCopy}</div></div></div><div class="print-separator" aria-hidden="true"></div><div class="print-copy-frame"><div class="print-copy-boundary"><div class="print-copy-box">${bottomCopy}</div></div></div></div>${fitScript}</body></html>`;
  try {
    w.document.open();
    w.document.write(docHtml);
    w.document.close();
  } catch (err) {
    try { w.close(); } catch(e) {}
    alert("請允許瀏覽器開啟列印視窗");
  }
}


function showOrderItems(orderId) {
  return showOrderDoc(orderId);
}

window.showOrderDoc = showOrderDoc;
window.printOrderDoc = printOrderDoc;
window.showOrderItems = showOrderItems;
window.openOrderPriceEditModal_ = openOrderPriceEditModal_;

function searchOrders() {
  const keyword = (document.getElementById("order-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("status-filter")?.value || "";
  const orders = LS.get("orders", []);

  const filtered = orders.filter(o => {
    const okKeyword =
      String(o.order_id || "").toLowerCase().includes(keyword) ||
      String(o.name || "").toLowerCase().includes(keyword) ||
      String(o.phone || "").toLowerCase().includes(keyword);

    const currentStatus = String(o?.status || "").trim() || "待出貨";
    const okStatus = status ? currentStatus === status : true;
    return okKeyword && okStatus;
  });

  renderOrders(filtered, 1);
}

function updateOrder(orderId, status) {
  if (!confirm(`確定將訂單 ${orderId} 設為「${status}」？`)) return;

  const member = (typeof getMember === "function") ? getMember() : null;
  const operator = member ? `${member.id}|${member.name}` : "";

  gas({ type: "manageOrder", action: "update", order_id: orderId, status, operator }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "更新失敗（後端未成功）");
      return;
    }
    alert(res?.message || "更新成功");
    LS.del("orders");
    loadOrders(true);
  });
}

function deleteOrder(orderId) {
  const order = findOrderById_(orderId);
  const status = String(order?.status || '').trim() || '待出貨';
  if (status === '已完成') {
    alert('已完成的訂單不可刪除');
    return;
  }
  if (!confirm(`確定刪除訂單 ${orderId}？`)) return;

  gas({ type: "manageOrder", action: "delete", order_id: orderId }, res => {
    if (res?.status && res.status !== "ok") {
      alert(res?.message || "刪除失敗（後端未成功）");
      return;
    }
    alert(res?.message || "刪除成功");
    LS.del("orders");
    loadOrders(true);
  });
}

// ------------------ 庫存流水 ------------------
function bindLedgerEvents() {
  document.getElementById("ledger-type")?.addEventListener("change", filterLedger);
  document.getElementById("ledger-search")?.addEventListener("input", filterLedger);
  document.getElementById("ledger-reload")?.addEventListener("click", () => {
    LS.del("stockLedger");
    loadLedger(true);
  });
}

function loadLedger(force = false) {
  return new Promise(resolve => {
    const cached = LS.get("stockLedger", null);
    if (!force && Array.isArray(cached) && cached.length) {
      ledger = cached;
      if (isSectionActive_("ledger-section")) renderLedger(ledger, 1);
      resolve(ledger);
      return;
    }

    gas({ type: "stockLedger" }, res => {
      const list = normalizeList(res);
      if (!list.length) ledger = LS.get("stockLedger", []);
      else {
        ledger = list;
        LS.set("stockLedger", list);
      }

      if (isSectionActive_("ledger-section")) renderLedger(ledger, 1);
      resolve(ledger);
    });
  });
}

function filterLedger() {
  const type = document.getElementById("ledger-type")?.value || "";
  const keyword = (document.getElementById("ledger-search")?.value || "").trim().toLowerCase();

  const codeOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase_update") || r.includes("adjust") || String(x.ref_id || x.ref || "") === "ADJ") return "ADJ";
    if (code === "IN" || code === "OUT" || code === "ADJ") return code;
    if (r.includes("purchase")) return "IN";
    if (r.includes("sale")) return "OUT";
    return "";
  };

  const filtered = (ledger || []).filter(l => {
    if (type && codeOf(l) !== type) return false;
    if (!keyword) return true;

    const hay = [
      l.product_name, l.product, l.name,
      l.doc_no, l.ref, l.ref_id,
      l.operator, l.user, l.member_id,
      l.target, l.counterparty, l.note
    ].map(v => String(v || "").toLowerCase()).join(" ");
    return hay.includes(keyword);
  });

  renderLedger(filtered, 1);
}

function renderLedger(list, page = 1) {
  ledgerPage = page;
  const tbody = document.querySelector("#ledger-table tbody");
  if (!tbody) return;

const toTs = (v) => {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return 0;
  // yyyy-mm-dd or yyyy-mm-dd hh:mm:ss
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m){
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0);
    return new Date(y, mo, d, hh, mm, ss).getTime();
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? 0 : dt.getTime();
};

const sorted = [...(list || [])].sort((a,b) => {
  const at = toTs(a.ts ?? a.time ?? a.datetime ?? a.date ?? "");
  const bt = toTs(b.ts ?? b.time ?? b.datetime ?? b.date ?? "");
  return bt - at; // 新到舊
});

  const totalPages = Math.max(1, Math.ceil(sorted.length / ledgerPerPage));
  ledgerPage = Math.min(ledgerPage, totalPages);

  const start = (ledgerPage - 1) * ledgerPerPage;
  const end = start + ledgerPerPage;

  const labelOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase_update") || r.includes("adjust") || String(x.ref_id || x.ref || "") === "ADJ") return "調整";
    if (code === "IN") return "進貨";
    if (code === "OUT") return "出貨";
    if (code === "ADJ") return "調整";
    // fallback: reason
    if (r.includes("purchase")) return "進貨";
    if (r.includes("sale")) return "出貨";
    if (r.includes("pickup")) return "領貨";
    return code || "—";
  };

  const codeOf = (x) => {
    const code = String(x.type_code || x.type || x.direction || "").toUpperCase();
    const r = String(x.reason || "").toLowerCase();
    if (r.includes("purchase_update") || r.includes("adjust") || String(x.ref_id || x.ref || "") === "ADJ") return "ADJ";
    if (code === "IN" || code === "OUT" || code === "ADJ") return code;
    if (r.includes("purchase")) return "IN";
    if (r.includes("sale")) return "OUT";
    return "";
  };

  tbody.innerHTML = "";
  sorted.slice(start, end).forEach(l => {
    const qty = (l.qty !== undefined) ? l.qty : (l.change !== undefined ? l.change : 0);
    const qtyNum = safeNum(qty, 0);
    const qtyText = (qtyNum > 0 ? `+${money(qtyNum)}` : `${money(qtyNum)}`);
    const costRaw = (l.cost ?? l.unit_cost ?? l.cost_price ?? "");
    const costText = (costRaw === "" || costRaw === null || costRaw === undefined) ? "" : money(safeNum(costRaw, 0));

    const skuText = String(l.sku ?? l.product_sku ?? l.item_sku ?? l.part_no ?? l.code ?? "");
    const unitText = String(l.unit ?? l.unit_name ?? l.uom ?? "");

    const tr = document.createElement("tr");
    tr.dataset.type = codeOf(l);
    tr.innerHTML = `
      <td>${dateTimeText(l.ts ?? l.time ?? l.datetime ?? l.date ?? "")}</td>
      <td>${labelOf(l)}</td>
      <td>${skuText}</td>
      <td>${l.doc_no ?? l.ref ?? l.ref_id ?? ""}</td>
      <td>${l.product_name ?? ""}</td>
      <td>${qtyText}</td>
      <td>${unitText}</td>
      <td>${costText}</td>
      <td>${userNameOnly(l.operator ?? l.user ?? l.member_id ?? "")}</td>
      <td>${l.target ?? l.counterparty ?? l.note ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination("ledger-pagination", totalPages, i => renderLedger(sorted, i), ledgerPage);
}

// ------------------ 報表 ------------------
function bindReportEvents() {
  const fromEl = document.getElementById("report-from");
  const toEl = document.getElementById("report-to");
  if (fromEl && !fromEl.value) fromEl.value = todayISO();
  if (toEl && !toEl.value) toEl.value = todayISO();

  document.getElementById("report-run")?.addEventListener("click", runReport);
  document.getElementById("report-export-csv")?.addEventListener("click", exportInventoryCSV);
  document.getElementById("report-print-inventory")?.addEventListener("click", printInventoryReport);

  // 先用快取商品主檔渲染分類勾選（若稍後載入到最新商品，runReport 也會再更新一次）
  try {
    const list = (Array.isArray(adminProducts) && adminProducts.length) ? adminProducts : LS.get("products", []);
    if (typeof ensureReportCategoryUI_ === "function") ensureReportCategoryUI_(list);
  } catch(e) {}
}
