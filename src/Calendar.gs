/**
 * Calendar.gs
 * カレンダー予定のDB操作
 */

// ===========================================
// DB_Events カラム定義（0-indexed）
// ===========================================
const EVENT_COLS = {
  EVENT_ID: 0,      // A: event_id
  CREATED_AT: 1,    // B: created_at
  UPDATED_AT: 2,    // C: updated_at
  SOURCE: 3,        // D: source
  RAW_TEXT: 4,      // E: raw_text
  TITLE: 5,         // F: title
  START_DATE: 6,    // G: start_date
  END_DATE: 7,      // H: end_date
  START_TIME: 8,    // I: start_time
  END_TIME: 9,      // J: end_time
  ALL_DAY: 10,      // K: all_day
  MEMO: 11,         // L: memo
  STATUS: 12,       // M: status
  LAST_AI_MODEL: 13,// N: last_ai_model
  COLOR_KEY: 14,    // O: color_key
  // Google Calendar 同期用
  GOOGLE_EVENT_ID: 15,   // P: google_event_id
  GCAL_SYNC_STATUS: 16,  // Q: gcal_sync_status (pending/synced/failed/disabled)
  GCAL_SYNCED_AT: 17,    // R: gcal_synced_at
  GCAL_ERROR: 18         // S: gcal_error
};

// ===========================================
// イベント登録
// ===========================================

/**
 * 予定をDB_Eventsに登録
 * @param {Object} eventData - AI解析済みの予定データ
 * @param {string} rawText - 元の入力テキスト
 * @param {string} source - 入力ソース（"voice" or "text"）
 */
function insertEventToDB(eventData, rawText, source = 'text') {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const model = getCalendarModel();

  // 新しい行データを作成
  const newRow = createEventRow(eventData, rawText, source, model);
  const eventId = newRow[EVENT_COLS.EVENT_ID]; // 生成されたevent_idを取得

  // 最終行の次に追加
  const lastRow = sheet.getLastRow();
  const targetRow = lastRow + 1;

  sheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);

  // Googleカレンダーへ同期
  try {
    syncNewEventToGoogle(targetRow, eventData);
  } catch (e) {
    console.error('Google Calendar sync error:', e);
    // 同期失敗してもDB保存は成功扱い
  }

  // ログ記録
  try {
    writeLog('calendar', rawText, JSON.stringify(eventData), 'insert_event', 'success');
  } catch (e) {
    console.error('Log write error:', e);
  }

  // 生成されたevent_idを返す
  return eventId;
}

/**
 * イベント行データを作成
 * @param {Object} eventData - イベントデータ
 * @param {string} rawText - 元テキスト
 * @param {string} source - ソース
 * @param {string} model - AIモデル名
 * @returns {Array} 行データ配列
 */
function createEventRow(eventData, rawText, source, model) {
  const row = new Array(19).fill('');

  row[EVENT_COLS.EVENT_ID] = newEventId();
  row[EVENT_COLS.CREATED_AT] = getCurrentDateTime();
  row[EVENT_COLS.UPDATED_AT] = '';
  row[EVENT_COLS.SOURCE] = source;
  row[EVENT_COLS.RAW_TEXT] = rawText;
  row[EVENT_COLS.TITLE] = eventData.title;
  row[EVENT_COLS.START_DATE] = eventData.start_date;
  row[EVENT_COLS.END_DATE] = eventData.end_date;
  row[EVENT_COLS.START_TIME] = eventData.start_time || '';
  row[EVENT_COLS.END_TIME] = eventData.end_time || '';
  row[EVENT_COLS.ALL_DAY] = eventData.all_day ? 'TRUE' : 'FALSE';
  row[EVENT_COLS.MEMO] = eventData.memo || '';
  row[EVENT_COLS.STATUS] = 'active';
  row[EVENT_COLS.LAST_AI_MODEL] = model;
  row[EVENT_COLS.COLOR_KEY] = eventData.color_key || 'other';
  // Google Calendar 同期用（初期値は空）
  row[EVENT_COLS.GOOGLE_EVENT_ID] = '';
  row[EVENT_COLS.GCAL_SYNC_STATUS] = 'pending';
  row[EVENT_COLS.GCAL_SYNCED_AT] = '';
  row[EVENT_COLS.GCAL_ERROR] = '';

  return row;
}

// ===========================================
// イベント取得
// ===========================================

/**
 * 指定日のイベント一覧を取得
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {Array} イベントオブジェクトの配列
 */
function getEventsByDate(dateStr) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();
  const events = [];
  const tz = getSettings().timezone;

  // ヘッダー行をスキップ（1行目はタイトル、2行目がヘッダー）
  for (let i = 2; i < data.length; i++) {
    const row = data[i];

    // statusがactive以外はスキップ
    if (row[EVENT_COLS.STATUS] !== 'active') continue;

    const startDate = formatDateValue(row[EVENT_COLS.START_DATE], tz);
    const endDate = formatDateValue(row[EVENT_COLS.END_DATE], tz);

    // 指定日が期間内かチェック
    if (isDateInRange(dateStr, startDate, endDate)) {
      events.push({
        event_id: row[EVENT_COLS.EVENT_ID],
        title: row[EVENT_COLS.TITLE],
        start_date: startDate,
        end_date: endDate,
        start_time: formatTimeValue(row[EVENT_COLS.START_TIME], tz),
        end_time: formatTimeValue(row[EVENT_COLS.END_TIME], tz),
        all_day: row[EVENT_COLS.ALL_DAY] === 'TRUE' || row[EVENT_COLS.ALL_DAY] === true,
        memo: row[EVENT_COLS.MEMO] || null,
        color_key: row[EVENT_COLS.COLOR_KEY] || 'other'
      });
    }
  }

  return events;
}

/**
 * 日付値をフォーマット
 * @param {Date|string} value - 日付値
 * @param {string} tz - タイムゾーン
 * @returns {string} YYYY-MM-DD形式
 */
function formatDateValue(value, tz) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  return String(value);
}

/**
 * 時刻値をフォーマット（Date/文字列 → "HH:mm" 文字列）
 * @param {Date|string|null} value - 時刻値
 * @param {string} tz - タイムゾーン（未使用、互換性のため残す）
 * @returns {string|null} HH:mm形式、または null
 */
function formatTimeValue(value, tz) {
  if (value == null || value === '') return null;

  // Date オブジェクトの場合
  // スプレッドシートの時刻値はUTCベースで保存されるため、GMTで取得
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'GMT', 'HH:mm');
  }

  // 文字列の場合
  const s = String(value).trim();
  if (!s) return null;

  // "HH:mm" または "H:mm" 形式を正規化
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    return String(m[1]).padStart(2, '0') + ':' + m[2];
  }

  // その他（そのまま返す）
  return s;
}

/**
 * 日付が範囲内かチェック
 * @param {string} targetDate - チェック対象日
 * @param {string} startDate - 開始日
 * @param {string} endDate - 終了日
 * @returns {boolean}
 */
function isDateInRange(targetDate, startDate, endDate) {
  return targetDate >= startDate && targetDate <= endDate;
}

/**
 * YYYY-MM-DD文字列をローカルDateに変換（UTC解釈を防ぐ）
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {Date} ローカル日付オブジェクト
 */
function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

/**
 * 指定月のイベント一覧を取得
 * @param {number} year - 年
 * @param {number} month - 月（1-12）
 * @returns {Object} 日付をキーとしたイベント配列のマップ
 */
function getEventsByMonth(year, month) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();
  const eventMap = {};
  const tz = getSettings().timezone;

  // 月の範囲を計算
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // ヘッダー行をスキップ
  for (let i = 2; i < data.length; i++) {
    const row = data[i];

    if (row[EVENT_COLS.STATUS] !== 'active') continue;

    const startDate = formatDateValue(row[EVENT_COLS.START_DATE], tz);
    const endDate = formatDateValue(row[EVENT_COLS.END_DATE], tz);

    // イベント期間と月の範囲が重なるかチェック
    if (startDate <= monthEnd && endDate >= monthStart) {
      const event = {
        event_id: row[EVENT_COLS.EVENT_ID],
        title: row[EVENT_COLS.TITLE],
        start_date: startDate,
        end_date: endDate,
        start_time: formatTimeValue(row[EVENT_COLS.START_TIME], tz),
        color_key: row[EVENT_COLS.COLOR_KEY] || 'other'
      };

      // イベントが含まれる各日に追加
      const eventStart = startDate < monthStart ? monthStart : startDate;
      const eventEnd = endDate > monthEnd ? monthEnd : endDate;

      // parseLocalDateでUTC解釈を防ぐ
      let current = parseLocalDate(eventStart);
      const end = parseLocalDate(eventEnd);

      while (current <= end) {
        const dateKey = Utilities.formatDate(current, tz, 'yyyy-MM-dd');
        if (!eventMap[dateKey]) {
          eventMap[dateKey] = [];
        }
        eventMap[dateKey].push(event);
        current.setDate(current.getDate() + 1);
      }
    }
  }

  return eventMap;
}

// ===========================================
// イベント更新・削除
// ===========================================

/**
 * イベントのステータスを更新
 * @param {string} eventId - イベントID
 * @param {string} newStatus - 新しいステータス
 */
function updateEventStatus(eventId, newStatus) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();

  for (let i = 2; i < data.length; i++) {
    if (data[i][EVENT_COLS.EVENT_ID] === eventId) {
      sheet.getRange(i + 1, EVENT_COLS.STATUS + 1).setValue(newStatus);
      sheet.getRange(i + 1, EVENT_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());
      return true;
    }
  }

  return false;
}

/**
 * イベントを削除（論理削除）+ Googleカレンダーから削除
 * @param {string} eventId - イベントID
 * @returns {Object} 結果
 */
function deleteEvent(eventId) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();

  for (let i = 2; i < data.length; i++) {
    if (data[i][EVENT_COLS.EVENT_ID] === eventId) {
      const targetRow = i + 1;
      const googleEventId = data[i][EVENT_COLS.GOOGLE_EVENT_ID];

      // DBのステータスをdeletedに
      sheet.getRange(targetRow, EVENT_COLS.STATUS + 1).setValue('deleted');
      sheet.getRange(targetRow, EVENT_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());

      // Googleカレンダーから削除
      try {
        syncDeletedEventToGoogle(targetRow, googleEventId);
      } catch (e) {
        console.error('Google Calendar delete sync error:', e);
        // 同期失敗してもDB削除は成功扱い
      }

      return { success: true, message: '予定を削除しました' };
    }
  }

  return { success: false, error: '指定されたイベントが見つかりません' };
}

/**
 * イベントを更新 + Googleカレンダーに同期
 * @param {Object} payload - 更新データ
 * @returns {Object} 結果 { success: boolean, message?: string, error?: string }
 */
function updateEvent(payload) {
  try {
    const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
    const data = sheet.getDataRange().getValues();
    const tz = getSettings().timezone;
    const eventId = payload.event_id;

    if (!eventId) {
      return { success: false, error: 'event_idが指定されていません' };
    }

    // event_idで行を検索
    let targetRow = -1;
    let rowData = null;
    for (let i = 2; i < data.length; i++) {
      if (data[i][EVENT_COLS.EVENT_ID] === eventId) {
        targetRow = i + 1; // 1-indexed for getRange
        rowData = data[i];
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, error: '指定されたイベントが見つかりません' };
    }

    // 既存のGoogleイベントIDを取得
    const existingGoogleId = rowData[EVENT_COLS.GOOGLE_EVENT_ID] || '';

    // 各フィールドを更新
    if (payload.title !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.TITLE + 1).setValue(payload.title);
    }
    if (payload.start_date !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.START_DATE + 1).setValue(payload.start_date);
    }
    if (payload.end_date !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.END_DATE + 1).setValue(payload.end_date);
    }
    if (payload.start_time !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.START_TIME + 1).setValue(payload.start_time || '');
    }
    if (payload.end_time !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.END_TIME + 1).setValue(payload.end_time || '');
    }
    if (payload.all_day !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.ALL_DAY + 1).setValue(payload.all_day ? 'TRUE' : 'FALSE');
    }
    if (payload.memo !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.MEMO + 1).setValue(payload.memo || '');
    }
    if (payload.color_key !== undefined) {
      sheet.getRange(targetRow, EVENT_COLS.COLOR_KEY + 1).setValue(payload.color_key || 'other');
    }

    // updated_atを更新
    sheet.getRange(targetRow, EVENT_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());

    // Googleカレンダーへ同期（更新後のデータを構築）
    try {
      const eventObj = {
        title: payload.title !== undefined ? payload.title : rowData[EVENT_COLS.TITLE],
        start_date: payload.start_date !== undefined ? payload.start_date : formatDateValue(rowData[EVENT_COLS.START_DATE], tz),
        end_date: payload.end_date !== undefined ? payload.end_date : formatDateValue(rowData[EVENT_COLS.END_DATE], tz),
        start_time: payload.start_time !== undefined ? payload.start_time : formatTimeValue(rowData[EVENT_COLS.START_TIME], tz),
        end_time: payload.end_time !== undefined ? payload.end_time : formatTimeValue(rowData[EVENT_COLS.END_TIME], tz),
        all_day: payload.all_day !== undefined ? payload.all_day : (rowData[EVENT_COLS.ALL_DAY] === 'TRUE' || rowData[EVENT_COLS.ALL_DAY] === true),
        memo: payload.memo !== undefined ? payload.memo : rowData[EVENT_COLS.MEMO]
      };

      syncUpdatedEventToGoogle(targetRow, eventObj, existingGoogleId);
    } catch (e) {
      console.error('Google Calendar update sync error:', e);
      // 同期失敗してもDB更新は成功扱い
    }

    return { success: true, message: '予定を更新しました' };

  } catch (e) {
    console.error('updateEvent error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * イベントIDからイベント詳細を取得
 * @param {string} eventId - イベントID
 * @returns {Object|null} イベントデータ
 */
function getEventById(eventId) {
  try {
    const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
    const data = sheet.getDataRange().getValues();
    const tz = getSettings().timezone;

    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      if (row[EVENT_COLS.EVENT_ID] === eventId && row[EVENT_COLS.STATUS] === 'active') {
        return {
          event_id: row[EVENT_COLS.EVENT_ID],
          title: row[EVENT_COLS.TITLE],
          start_date: formatDateValue(row[EVENT_COLS.START_DATE], tz),
          end_date: formatDateValue(row[EVENT_COLS.END_DATE], tz),
          start_time: formatTimeValue(row[EVENT_COLS.START_TIME], tz),
          end_time: formatTimeValue(row[EVENT_COLS.END_TIME], tz),
          all_day: row[EVENT_COLS.ALL_DAY] === 'TRUE' || row[EVENT_COLS.ALL_DAY] === true,
          memo: row[EVENT_COLS.MEMO] || null,
          color_key: row[EVENT_COLS.COLOR_KEY] || 'other'
        };
      }
    }

    return null;
  } catch (e) {
    console.error('getEventById error:', e);
    return null;
  }
}

// ===========================================
// 日本の祝日取得
// ===========================================

/**
 * 指定月の日本の祝日を取得
 * @param {number} year - 年
 * @param {number} month - 月（1-12）
 * @returns {Object} 日付をキーとした祝日名のマップ { "2026-01-01": "元日", ... }
 */
function getHolidaysByMonth(year, month) {
  const holidayMap = {};
  const tz = getSettings().timezone;

  try {
    // 日本の祝日カレンダーID
    const calendarId = 'ja.japanese#holiday@group.v.calendar.google.com';
    const calendar = CalendarApp.getCalendarById(calendarId);

    if (!calendar) {
      console.warn('Japanese holiday calendar not found');
      return holidayMap;
    }

    // 月の範囲
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // 祝日イベントを取得
    const events = calendar.getEvents(startDate, endDate);

    events.forEach(event => {
      const eventDate = event.getStartTime();
      const dateKey = Utilities.formatDate(eventDate, tz, 'yyyy-MM-dd');
      const title = event.getTitle();
      holidayMap[dateKey] = title;
    });

  } catch (e) {
    console.error('getHolidaysByMonth error:', e);
  }

  return holidayMap;
}

// ===========================================
// Googleカレンダー同期ヘルパー（EVENT_COLSを使用）
// ===========================================

/**
 * DB保存後にGoogleカレンダーへ同期
 * @param {number} rowIndex - シートの行番号（1-based）
 * @param {Object} eventObj - イベントデータ
 */
function syncNewEventToGoogle(rowIndex, eventObj) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);

  try {
    const googleEventId = createGoogleCalendarEvent_(eventObj);

    // 同期成功
    sheet.getRange(rowIndex, EVENT_COLS.GOOGLE_EVENT_ID + 1).setValue(googleEventId);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('synced');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNCED_AT + 1).setValue(new Date());
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue('');

    return { success: true, googleEventId: googleEventId };
  } catch (e) {
    console.error('syncNewEventToGoogle error:', e);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));

    return { success: false, error: String(e) };
  }
}

/**
 * DB更新後にGoogleカレンダーへ同期
 * @param {number} rowIndex - シートの行番号（1-based）
 * @param {Object} eventObj - イベントデータ
 * @param {string} existingGoogleId - 既存のGoogleイベントID
 */
function syncUpdatedEventToGoogle(rowIndex, eventObj, existingGoogleId) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);

  try {
    const newGoogleEventId = upsertGoogleCalendarEvent_(eventObj, existingGoogleId);

    // 同期成功
    sheet.getRange(rowIndex, EVENT_COLS.GOOGLE_EVENT_ID + 1).setValue(newGoogleEventId);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('synced');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNCED_AT + 1).setValue(new Date());
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue('');

    return { success: true, googleEventId: newGoogleEventId };
  } catch (e) {
    console.error('syncUpdatedEventToGoogle error:', e);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));

    return { success: false, error: String(e) };
  }
}

/**
 * DB削除後にGoogleカレンダーからも削除
 * @param {number} rowIndex - シートの行番号（1-based）
 * @param {string} googleEventId - GoogleイベントID
 */
function syncDeletedEventToGoogle(rowIndex, googleEventId) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);

  try {
    if (googleEventId) {
      deleteGoogleCalendarEvent_(googleEventId);
    }

    // 同期成功
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('synced');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNCED_AT + 1).setValue(new Date());
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue('');

    return { success: true };
  } catch (e) {
    console.error('syncDeletedEventToGoogle error:', e);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));

    return { success: false, error: String(e) };
  }
}

// ===========================================
// 既存イベント一括同期（初回セットアップ用）
// ===========================================

/**
 * 既存の全イベントをGoogleカレンダーに一括同期
 * google_event_idが空のactiveイベントのみ対象
 * GASエディタから手動で1回実行する
 */
function syncAllExistingEvents() {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();
  const tz = getSettings().timezone;

  let syncedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  console.log('=== 既存イベント一括同期開始 ===');

  // ヘッダー行をスキップ（1行目はタイトル、2行目がヘッダー）
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const rowIndex = i + 1; // 1-based

    // activeでないイベントはスキップ
    if (row[EVENT_COLS.STATUS] !== 'active') {
      continue;
    }

    // すでにgoogle_event_idがあるイベントはスキップ
    if (row[EVENT_COLS.GOOGLE_EVENT_ID]) {
      skippedCount++;
      continue;
    }

    // イベントデータを構築
    const eventObj = {
      title: row[EVENT_COLS.TITLE],
      start_date: formatDateValue(row[EVENT_COLS.START_DATE], tz),
      end_date: formatDateValue(row[EVENT_COLS.END_DATE], tz),
      start_time: formatTimeValue(row[EVENT_COLS.START_TIME], tz),
      end_time: formatTimeValue(row[EVENT_COLS.END_TIME], tz),
      all_day: row[EVENT_COLS.ALL_DAY] === 'TRUE' || row[EVENT_COLS.ALL_DAY] === true,
      memo: row[EVENT_COLS.MEMO] || null
    };

    // Googleカレンダーに同期
    const result = syncNewEventToGoogle(rowIndex, eventObj);

    if (result.success) {
      syncedCount++;
      console.log(`[成功] Row ${rowIndex}: ${eventObj.title}`);
    } else {
      failedCount++;
      console.log(`[失敗] Row ${rowIndex}: ${eventObj.title} - ${result.error}`);
    }

    // API制限対策：少し待機（100ms）
    Utilities.sleep(100);
  }

  const summary = `=== 一括同期完了 ===\n同期成功: ${syncedCount}件\n同期失敗: ${failedCount}件\nスキップ（同期済み）: ${skippedCount}件`;
  console.log(summary);

  // スプレッドシートにも通知
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `同期成功: ${syncedCount}件, 失敗: ${failedCount}件, スキップ: ${skippedCount}件`,
    '一括同期完了',
    10
  );

  return {
    synced: syncedCount,
    failed: failedCount,
    skipped: skippedCount
  };
}
