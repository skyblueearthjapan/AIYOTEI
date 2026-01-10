/**
 * Sidebar.gs
 * サイドバー関連の関数
 */

// ===========================================
// コピー用サイドバー
// ===========================================

/**
 * メモコピー用サイドバーを表示
 */
function showCopySidebar() {
  const html = HtmlService.createHtmlOutputFromFile('CopySidebar')
    .setTitle('メモをコピー')
    .setWidth(350);

  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * 現在のメモデータを取得（サイドバーから呼び出し）
 * @returns {Object} メモデータ
 */
function getCurrentMemoForSidebar() {
  const currentDate = getMemoCurrentDate();
  const memoText = getMemoText(currentDate);

  return {
    date: currentDate,
    text: memoText
  };
}

// ===========================================
// ログ表示用サイドバー
// ===========================================

/**
 * ログ表示用サイドバーを表示
 */
function showLogSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('LogSidebar')
    .setTitle('操作ログ')
    .setWidth(400);

  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * 最近のログを取得（サイドバーから呼び出し）
 * @param {number} limit - 取得件数
 * @returns {Array} ログデータの配列
 */
function getRecentLogs(limit = 20) {
  try {
    const sheet = getSheet(SHEET_NAMES.DB_LOG);
    const data = sheet.getDataRange().getValues();
    const logs = [];

    // ヘッダー行をスキップして、最新のログから取得
    for (let i = data.length - 1; i >= 2 && logs.length < limit; i--) {
      const row = data[i];
      if (row[0]) { // log_idがあるもののみ
        logs.push({
          log_id: row[0],
          timestamp: row[1],
          page: row[2],
          action: row[5],
          result: row[6],
          error_message: row[7] || ''
        });
      }
    }

    return logs;
  } catch (e) {
    console.error('Get logs error:', e);
    return [];
  }
}
