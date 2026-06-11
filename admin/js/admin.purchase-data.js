// Purchase section reference-data orchestration.
// Keeps purchase list loading independent from slower Products/Suppliers refresh.
let __purchaseDataPromise__ = null;
let __purchaseReferenceRefreshTimer__ = 0;

function hydratePurchaseReferenceDataFromCache_(){
  let hasProducts = false;
  let hasSuppliers = false;

  try {
    const cachedProducts = LS.get("products", null);
    if (Array.isArray(cachedProducts) && cachedProducts.length) {
      adminProducts = (typeof normalizeProductPricingCache_ === "function")
        ? normalizeProductPricingCache_(cachedProducts)
        : cachedProducts;
      hasProducts = adminProducts.length > 0;
      try { LS.set("products", adminProducts); } catch(e) {}
    }

    const cachedSuppliers = LS.get("suppliers", null);
    if (Array.isArray(cachedSuppliers) && cachedSuppliers.length) {
      suppliers = cachedSuppliers;
      hasSuppliers = suppliers.length > 0;
    }

    if (hasProducts || hasSuppliers) refreshPurchaseReferenceControls_();
  } catch (err) {
    console.error("hydrate purchase reference data failed", err);
  }

  return { hasProducts, hasSuppliers, ready: hasProducts && hasSuppliers };
}

function refreshPurchaseReferenceControls_(){
  try { buildSupplierProductIndex_(true); } catch(e) {}
  try { if (typeof fillSupplierSelect === "function") fillSupplierSelect(); } catch(e) {}
  try { if (typeof fillProductSupplierCheckboxes === "function") fillProductSupplierCheckboxes(document.getElementById("new-product-suppliers-box")); } catch(e) {}
  if (isSectionActive_("purchase-section")) {
    try { refreshAllPurchaseRows_(); } catch(e) {}
  }
}

function refreshPurchaseReferenceData_(force = false){
  return Promise.all([
    loadSuppliers(!!force),
    loadAdminProducts(!!force, null, { skipProductRender: true, skipCategoryRender: true })
  ]).then(() => {
    refreshPurchaseReferenceControls_();
    return true;
  });
}

function schedulePurchaseReferenceRefresh_(force = false, delayMs = 600){
  if (__purchaseReferenceRefreshTimer__) clearTimeout(__purchaseReferenceRefreshTimer__);
  __purchaseReferenceRefreshTimer__ = window.setTimeout(() => {
    __purchaseReferenceRefreshTimer__ = 0;
    refreshPurchaseReferenceData_(!!force).catch(err => {
      console.warn("purchase reference refresh failed", err);
    });
  }, Math.max(0, Number(delayMs || 0)));
}

function ensurePurchaseDataReady_(force = false){
  if (__purchaseDataPromise__ && !force) return __purchaseDataPromise__;

  if (!force) {
    const cached = hydratePurchaseReferenceDataFromCache_();
    if (cached.ready) {
      schedulePurchaseReferenceRefresh_(false, 800);
      return Promise.resolve(true);
    }
  }

  __purchaseDataPromise__ = refreshPurchaseReferenceData_(!!force)
    .then(() => true)
    .catch(err => {
      console.error(err);
      __purchaseDataPromise__ = null;
      return false;
    });
  return __purchaseDataPromise__;
}

function loadPurchaseSectionData_(opts = {}){
  const referencePromise = ensurePurchaseDataReady_(!!opts.forceReference);

  try { initPurchaseForm(); } catch(err) { console.error("initPurchaseForm failed", err); }

  const purchasePromise = (typeof loadPurchases === "function")
    ? loadPurchases(!!opts.forcePurchases, { keepPage: true, forceRender: !!opts.forceRender })
    : Promise.resolve([]);

  referencePromise.then(ok => {
    if (!ok) {
      const cached = hydratePurchaseReferenceDataFromCache_();
      if (!cached.ready) alert("進貨管理載入失敗：供應商/商品資料未就緒，請稍後重試");
      return;
    }
    refreshPurchaseReferenceControls_();
  });

  return Promise.all([referencePromise, purchasePromise]).then(() => true);
}
