/**
 * Memo.gs
 * メモのDB操作
 */

// ===========================================
// DB_Memos カラム定義（0-indexed）
// ===========================================
const MEMO_COLS = {
  MEMO_ID: 0,         // A: memo_id
  DATE: 1,            // B: date
  MEMO_TEXT: 2,       // C: memo_text
  RAW_TRANSCRIPT: 3,  // D: raw_transcript
  CLEANED_TEXT: 4,    // E: cleaned_text
  SOURCE: 5,          // F: source
  CREATED_AT: 6,      // G: created_at
  UPDATED_AT: 7,      // H: updated_at
  LAST_AI_MODEL: 8    // I: last_ai_model
};

// ===========================================
// メモ追記
// ===========================================

/**
 * 指定日のメモに追記
 * @param {string} dateStr - YYYY-MM-DD形式
 * @param {string} cleanedText - AI整形済みテキスト
 * @param {string} rawText - 元の入力テキスト
 * @param {string} source - 入力ソース（"voice" or "text"）
 */
function appendMemo(dateStr, cleanedText, rawText, source = 'text') {
  const sheet = getSheet(SHEET_NAMES.DB_MEMOS);
  const model = getMemoModel();
  const tz = getSettings().timezone;

  // 既存の行を探す
  const data = sheet.getDataRange().getValues();
  let existingRowIndex = -1;

  for (let i = 2; i < data.length; i++) {
    const rowDate = data[i][MEMO_COLS.DATE];
    let dateValue;

    if (rowDate instanceof Date) {
      dateValue = Utilities.formatDate(rowDate, tz, 'yyyy-MM-dd');
    } else {
      dateValue = String(rowDate);
    }

    if (dateValue === dateStr) {
      existingRowIndex = i;
      break;
    }
  }

  if (existingRowIndex >= 0) {
    // 既存行に追記
    updateMemoRow(sheet, existingRowIndex, data[existingRowIndex], cleanedText, rawText, source, model);
  } else {
    // 新規行を追加
    insertMemoRow(sheet, dateStr, cleanedText, rawText, source, model);
  }

  // ログ記録
  try {
    writeLog('memo', rawText, cleanedText, 'append_memo', 'success');
  } catch (e) {
    console.error('Log write error:', e);
  }
}

/**
 * 既存のメモ行を更新（追記）
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - シート
 * @param {number} rowIndex - 行インデックス（0-indexed）
 * @param {Array} existingRow - 既存の行データ
 * @param {string} cleanedText - 整形済みテキスト
 * @param {string} rawText - 元テキスト
 * @param {string} source - ソース
 * @param {string} model - AIモデル名
 */
function updateMemoRow(sheet, rowIndex, existingRow, cleanedText, rawText, source, model) {
  const currentMemoText = existingRow[MEMO_COLS.MEMO_TEXT] || '';

  // 追記ルール：既存末尾に \n\n で追記
  const newMemoText = currentMemoText
    ? currentMemoText + '\n\n' + cleanedText
    : cleanedText;

  const rowNum = rowIndex + 1; // 1-indexed

  // memo_text を更新
  sheet.getRange(rowNum, MEMO_COLS.MEMO_TEXT + 1).setValue(newMemoText);

  // 最後の入力情報を更新
  sheet.getRange(rowNum, MEMO_COLS.RAW_TRANSCRIPT + 1).setValue(rawText);
  sheet.getRange(rowNum, MEMO_COLS.CLEANED_TEXT + 1).setValue(cleanedText);
  sheet.getRange(rowNum, MEMO_COLS.SOURCE + 1).setValue(source);
  sheet.getRange(rowNum, MEMO_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());
  sheet.getRange(rowNum, MEMO_COLS.LAST_AI_MODEL + 1).setValue(model);
}

/**
 * 新規メモ行を挿入
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - シート
 * @param {string} dateStr - 日付
 * @param {string} cleanedText - 整形済みテキスト
 * @param {string} rawText - 元テキスト
 * @param {string} source - ソース
 * @param {string} model - AIモデル名
 */
function insertMemoRow(sheet, dateStr, cleanedText, rawText, source, model) {
  const newRow = new Array(9).fill('');

  newRow[MEMO_COLS.MEMO_ID] = newMemoId();
  newRow[MEMO_COLS.DATE] = dateStr;
  newRow[MEMO_COLS.MEMO_TEXT] = cleanedText;
  newRow[MEMO_COLS.RAW_TRANSCRIPT] = rawText;
  newRow[MEMO_COLS.CLEANED_TEXT] = cleanedText;
  newRow[MEMO_COLS.SOURCE] = source;
  newRow[MEMO_COLS.CREATED_AT] = getCurrentDateTime();
  newRow[MEMO_COLS.UPDATED_AT] = '';
  newRow[MEMO_COLS.LAST_AI_MODEL] = model;

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
}

// ===========================================
// メモ取得
// ===========================================

/**
 * 指定日のメモを取得
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {Object|null} メモオブジェクト
 */
function getMemoByDate(dateStr) {
  const sheet = getSheet(SHEET_NAMES.DB_MEMOS);
  const data = sheet.getDataRange().getValues();
  const tz = getSettings().timezone;

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[MEMO_COLS.DATE];

    let dateValue;
    if (rowDate instanceof Date) {
      dateValue = Utilities.formatDate(rowDate, tz, 'yyyy-MM-dd');
    } else {
      dateValue = String(rowDate);
    }

    if (dateValue === dateStr) {
      return {
        memo_id: row[MEMO_COLS.MEMO_ID],
        date: dateValue,
        memo_text: row[MEMO_COLS.MEMO_TEXT] || '',
        raw_transcript: row[MEMO_COLS.RAW_TRANSCRIPT] || '',
        cleaned_text: row[MEMO_COLS.CLEANED_TEXT] || '',
        source: row[MEMO_COLS.SOURCE] || '',
        created_at: row[MEMO_COLS.CREATED_AT] || '',
        updated_at: row[MEMO_COLS.UPDATED_AT] || ''
      };
    }
  }

  return null;
}

/**
 * 指定日のメモ本文のみを取得
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {string} メモ本文
 */
function getMemoText(dateStr) {
  const memo = getMemoByDate(dateStr);
  return memo ? memo.memo_text : '';
}

// ===========================================
// メモ上書き（追記ではなく置換）
// ===========================================

/**
 * 指定日のメモを上書き
 * @param {string} dateStr - YYYY-MM-DD形式
 * @param {string} newText - 新しいテキスト
 */
function overwriteMemo(dateStr, newText) {
  const sheet = getSheet(SHEET_NAMES.DB_MEMOS);
  const data = sheet.getDataRange().getValues();
  const tz = getSettings().timezone;

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[MEMO_COLS.DATE];

    let dateValue;
    if (rowDate instanceof Date) {
      dateValue = Utilities.formatDate(rowDate, tz, 'yyyy-MM-dd');
    } else {
      dateValue = String(rowDate);
    }

    if (dateValue === dateStr) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, MEMO_COLS.MEMO_TEXT + 1).setValue(newText);
      sheet.getRange(rowNum, MEMO_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());
      return true;
    }
  }

  return false;
}

// ===========================================
// メモ削除
// ===========================================

/**
 * 指定日のメモをクリア
 * @param {string} dateStr - YYYY-MM-DD形式
 */
function clearMemo(dateStr) {
  return overwriteMemo(dateStr, '');
}
