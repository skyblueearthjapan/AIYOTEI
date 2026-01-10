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
  COLOR_KEY: 14     // O: color_key (health, work, family, finance, travel, fun, school, other)
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

  // 最終行の次に追加
  const lastRow = sheet.getLastRow();
  const targetRow = lastRow + 1;

  sheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);

  // ログ記録
  try {
    writeLog('calendar', rawText, JSON.stringify(eventData), 'insert_event', 'success');
  } catch (e) {
    console.error('Log write error:', e);
  }
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
  const row = new Array(15).fill('');

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
 * @param {string} tz - タイムゾーン
 * @returns {string|null} HH:mm形式、または null
 */
function formatTimeValue(value, tz) {
  if (value == null || value === '') return null;

  // Date オブジェクトの場合
  if (value instanceof Date) {
    return Utilities.formatDate(value, tz, 'HH:mm');
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

      let current = new Date(eventStart);
      const end = new Date(eventEnd);

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
 * イベントを削除（論理削除）
 * @param {string} eventId - イベントID
 */
function deleteEvent(eventId) {
  return updateEventStatus(eventId, 'deleted');
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
