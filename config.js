// 全站共用設定
const SHEET_API = "https://script.google.com/macros/s/AKfycbw-ik1NMS_Aj_pe_7QkguaactftEKbqX2Db5NXCVuP0OVR017cE_fhzd8EyO11mGr75/exec";

// JSONP 呼叫 GAS 的通用函式
function callGAS(params, callback) {
  const opts = (params && typeof params === "object" && params.__options) ? params.__options : {};
  const realParams = Object.assign({}, params || {});
  if (Object.prototype.hasOwnProperty.call(realParams, "__options")) delete realParams.__options;
  const cbName = `cb_${Date.now()}_${Math.floor(Math.random()*10000)}`;
  const script = document.createElement("script");
  const timeoutMs = Math.max(3000, Number(opts.timeoutMs || 15000));
  let finished = false;

  function cleanup() {
    if (finished) return;
    finished = true;
    if (window[cbName]) delete window[cbName];
    if (timeoutId) clearTimeout(timeoutId);
    if (script && script.parentNode) script.parentNode.removeChild(script);
  }

  const timeoutId = setTimeout(() => {
    cleanup();
    const timeoutRes = { status: "error", code: "TIMEOUT", message: "連線逾時，請稍後再試" };
    try {
      if (typeof opts.onTimeout === "function") return opts.onTimeout(timeoutRes);
    } catch (e) {}
    callback(timeoutRes);
  }, timeoutMs);

  // 定義回調函式
  window[cbName] = function(res) {
    cleanup();

    if (params.type === "members" && res && res.status === "ok" && !res.role) {
      res.role = "user";
    }
    if (params.type === "customerLogin" && res && res.status === "ok" && !res.role) {
      res.role = "customer";
    }

    callback(res || { status: "error", message: "系統回傳異常" });
  };

  script.onerror = function() {
    cleanup();
    callback({ status: "error", message: "無法連線到系統，請稍後再試" });
  };

  const query = new URLSearchParams({ ...realParams, _ts: Date.now(), callback: cbName }).toString();
  script.src = `${SHEET_API}?${query}`;
  document.body.appendChild(script);
}
