// 全站共用設定
const SHEET_API = "https://script.google.com/macros/s/AKfycbw-ik1NMS_Aj_pe_7QkguaactftEKbqX2Db5NXCVuP0OVR017cE_fhzd8EyO11mGr75/exec";

// JSONP 呼叫 GAS 的通用函式
let __gasJsonpSeq = 0;
function callGAS(params, callback) {
  __gasJsonpSeq += 1;
  const cbName = `cb_${Date.now()}_${__gasJsonpSeq}_${Math.random().toString(36).slice(2,8)}`;
  const script = document.createElement("script");
  let finished = false;

  function cleanup() {
    if (finished) return;
    finished = true;
    try { if (window[cbName]) delete window[cbName]; } catch(_) {}
    try { if (timeoutId) clearTimeout(timeoutId); } catch(_) {}
    try { if (script && script.parentNode) script.parentNode.removeChild(script); } catch(_) {}
  }

  const timeoutId = setTimeout(() => {
    cleanup();
    callback({ status: "error", message: "連線逾時，請稍後再試" });
  }, 46000);

  window[cbName] = function(res) {
    cleanup();
    if (params.type === "members" && res && res.status === "ok" && !res.role) {
      res.role = "user";
    }
    callback(res || { status: "error", message: "系統回傳異常" });
  };

  script.onerror = function() {
    cleanup();
    callback({ status: "error", message: "無法連線到系統，請稍後再試" });
  };

  const query = new URLSearchParams({ ...params, _ts: Date.now(), callback: cbName }).toString();
  script.src = `${SHEET_API}?${query}`;
  document.body.appendChild(script);
}
