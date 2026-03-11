// 全站共用設定
const SHEET_API = "https://script.google.com/macros/s/AKfycbw-ik1NMS_Aj_pe_7QkguaactftEKbqX2Db5NXCVuP0OVR017cE_fhzd8EyO11mGr75/exec";

// JSONP 呼叫 GAS 的通用函式
let __gasJsonpSeq = 0;
function callGAS(params, callback) {
  __gasJsonpSeq += 1;
  const cbName = `cb_${Date.now()}_${__gasJsonpSeq}_${Math.random().toString(36).slice(2,8)}`;
  const script = document.createElement("script");

  // 定義回調函式
  window[cbName] = function(res) {
    delete window[cbName];
    if (script && script.parentNode) script.parentNode.removeChild(script);

    // 🔹 如果登入回傳沒有 role，補上預設 'user'
    if (params.type === "members" && res.status === "ok" && !res.role) {
      res.role = res.role || "user";
    }

    callback(res);
  };

  const query = new URLSearchParams({ ...params, callback: cbName }).toString();
  script.src = `${SHEET_API}?${query}`;
  document.body.appendChild(script);
}
