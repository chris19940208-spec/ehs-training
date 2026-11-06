/**
 * 安全衛生闖關：接收過關成績並寫入這份試算表
 *
 * 設定方式
 * 1. 在成績試算表選「擴充功能 → Apps Script」，把預設內容全部刪掉，貼上本檔，按儲存。
 * 2. 選「部署 → 新增部署作業」，類型選「網頁應用程式」：
 *    執行身分「我」、誰可以存取「所有人」，按「部署」並完成授權。
 * 3. 複製「網頁應用程式」網址，填進遊戲的 src/config.js（SCORE_ENDPOINT）。
 */
const HEAD = ['送出時間', '姓名', '工號', '總分', '滿分', '星數',
  '第1關', '第2關', '第3關', '第4關', '第5關', '第6關', '第7關', '第8關', '第9關', '裝置', '完成時間'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sh.getLastRow() === 0) sh.appendRow(HEAD);
    const text = (v, n) => {                       // 去掉公式開頭符號，避免被當成公式
      const s = String(v == null ? '' : v).slice(0, n);
      return /^[=+\-@]/.test(s) ? "'" + s : s;
    };
    const num = v => (v === '' || v == null || !isFinite(+v)) ? '' : +v;
    const st = d.stages || {};
    sh.appendRow([new Date(), text(d.name, 40), text(d.empId, 20), num(d.total), num(d.max), num(d.stars),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => num(st[i])), text(d.device, 10), text(d.finishedAt, 40)]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
