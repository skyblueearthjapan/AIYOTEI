/**
 * Log.gs
 * ログ機能
 */

// ===========================================
// DB_Log カラム定義（0-indexed）
// ===========================================
const LOG_COLS = {
  LOG_ID: 0,          // A: log_id
  TIMESTAMP: 1,       // B: timestamp
  PAGE: 2,            // C: page
  TRANSCRIPT_RAW: 3,  // D: transcript_raw
  AI_OUTPUT: 4,       // E: ai_output
  ACTION: 5,          // F: action
  RESULT: 6,          // G: result
  ERROR_MESSAGE: 7,   // H: error_message
  NOTE: 8             // I: note
};

// ===========================================
// ログ書き込み
// ===========================================

/**
 * ログを書き込む
 * @param {string} page - ページ種別（"calendar" or "memo"）
 * @param {string} transcriptRaw - 入力テキスト
 * @param {string} aiOutput - AI出力
 * @param {string} action - アクション種別
 * @param {string} result - 結果（"success" or "fail"）
 * @param {string} errorMessage - エラーメッセージ（オプション）
 * @param {string} note - 備考（オプション）
 */
function writeLog(page, transcriptRaw, aiOutput, action, result, errorMessage = '', note = '') {
  try {
    const sheet = getSheet(SHEET_NAMES.DB_LOG);

    const newRow = new Array(9).fill('');

    newRow[LOG_COLS.LOG_ID] = newLogId();
    newRow[LOG_COLS.TIMESTAMP] = getCurrentDateTime();
    newRow[LOG_COLS.PAGE] = page;
    newRow[LOG_COLS.TRANSCRIPT_RAW] = truncateText(transcriptRaw, 500);
    newRow[LOG_COLS.AI_OUTPUT] = truncateText(aiOutput, 1000);
    newRow[LOG_COLS.ACTION] = action;
    newRow[LOG_COLS.RESULT] = result;
    newRow[LOG_COLS.ERROR_MESSAGE] = errorMessage;
    newRow[LOG_COLS.NOTE] = note;

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);

  } catch (e) {
    // ログ書き込み自体のエラーは無視（無限ループ防止）
    console.error('Log write failed:', e);
  }
}

/**
 * エラーログを書き込む
 * @param {string} page - ページ種別
 * @param {string} transcriptRaw - 入力テキスト
 * @param {string} action - アクション種別
 * @param {Error} error - エラーオブジェクト
 */
function writeErrorLog(page, transcriptRaw, action, error) {
  writeLog(
    page,
    transcriptRaw,
    '',
    action,
    'fail',
    error.message || String(error)
  );
}

// ===========================================
// ログ取得
// ===========================================

/**
 * 最近のログを取得
 * @param {number} limit - 取得件数
 * @returns {Array} ログオブジェクトの配列
 */
function getLogs(limit = 50) {
  const sheet = getSheet(SHEET_NAMES.DB_LOG);
  const data = sheet.getDataRange().getValues();
  const logs = [];

  // ヘッダー行をスキップして、最新のログから取得
  for (let i = data.length - 1; i >= 2 && logs.length < limit; i--) {
    const row = data[i];
    if (row[LOG_COLS.LOG_ID]) {
      logs.push({
        log_id: row[LOG_COLS.LOG_ID],
        timestamp: row[LOG_COLS.TIMESTAMP],
        page: row[LOG_COLS.PAGE],
        transcript_raw: row[LOG_COLS.TRANSCRIPT_RAW],
        ai_output: row[LOG_COLS.AI_OUTPUT],
        action: row[LOG_COLS.ACTION],
        result: row[LOG_COLS.RESULT],
        error_message: row[LOG_COLS.ERROR_MESSAGE],
        note: row[LOG_COLS.NOTE]
      });
    }
  }

  return logs;
}

/**
 * 指定ページのログを取得
 * @param {string} page - ページ種別
 * @param {number} limit - 取得件数
 * @returns {Array}
 */
function getLogsByPage(page, limit = 50) {
  const allLogs = getLogs(limit * 2); // 多めに取得してフィルタ
  return allLogs.filter(log => log.page === page).slice(0, limit);
}

// ===========================================
// ユーティリティ
// ===========================================

/**
 * テキストを指定長で切り詰める
 * @param {string} text - テキスト
 * @param {number} maxLength - 最大長
 * @returns {string}
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// ===========================================
// ログクリーンアップ（必要に応じて）
// ===========================================

/**
 * 古いログを削除（30日以上前）
 * ※ 手動実行 or トリガー設定で使用
 */
function cleanupOldLogs() {
  const sheet = getSheet(SHEET_NAMES.DB_LOG);
  const data = sheet.getDataRange().getValues();
  const tz = getSettings().timezone;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = Utilities.formatDate(thirtyDaysAgo, tz, 'yyyy-MM-dd');

  const rowsToDelete = [];

  // ヘッダー行をスキップ
  for (let i = 2; i < data.length; i++) {
    const timestamp = data[i][LOG_COLS.TIMESTAMP];
    if (timestamp) {
      const logDate = String(timestamp).substring(0, 10);
      if (logDate < cutoffDate) {
        rowsToDelete.push(i + 1); // 1-indexed
      }
    }
  }

  // 下から削除（インデックスずれ防止）
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }

  if (rowsToDelete.length > 0) {
    showToast(`${rowsToDelete.length}件の古いログを削除しました`);
  }
}
