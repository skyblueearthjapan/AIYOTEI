/**
 * GoogleCalendar.gs
 * Googleカレンダーとの同期処理
 */

// ===========================================
// 設定
// ===========================================

/**
 * 同期先のGoogleカレンダーを取得
 * デフォルトはユーザーのメインカレンダー
 * @returns {GoogleAppsScript.Calendar.Calendar}
 */
function getTargetCalendar_() {
  // 将来的にSettingsシートから選択可能にする場合はここを拡張
  return CalendarApp.getDefaultCalendar();
}

// ===========================================
// Googleカレンダー作成
// ===========================================

/**
 * Googleカレンダーにイベントを作成
 * @param {Object} eventObj - イベントデータ
 * @returns {string} GoogleカレンダーのイベントID
 */
function createGoogleCalendarEvent_(eventObj) {
  const cal = getTargetCalendar_();
  let gEvent;

  if (eventObj.all_day || !eventObj.start_time) {
    // 終日イベント or 時間指定なし
    const start = parseLocalDate(eventObj.start_date);
    const end = parseLocalDate(eventObj.end_date);
    // Googleカレンダーの終日イベントは終了日を+1日する必要がある
    end.setDate(end.getDate() + 1);

    gEvent = cal.createAllDayEvent(
      eventObj.title,
      start,
      end,
      { description: eventObj.memo || '' }
    );
  } else {
    // 時間指定あり
    const startDateTime = new Date(`${eventObj.start_date}T${eventObj.start_time}:00`);
    let endDateTime;

    if (eventObj.end_time) {
      endDateTime = new Date(`${eventObj.end_date}T${eventObj.end_time}:00`);
    } else {
      // 終了時刻がなければ1時間後
      endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
    }

    gEvent = cal.createEvent(
      eventObj.title,
      startDateTime,
      endDateTime,
      { description: eventObj.memo || '' }
    );
  }

  return gEvent.getId();
}

// ===========================================
// Googleカレンダー取得・更新・削除
// ===========================================

/**
 * GoogleカレンダーイベントをIDで取得
 * @param {string} googleEventId - GoogleイベントID
 * @returns {GoogleAppsScript.Calendar.CalendarEvent|null}
 */
function getGoogleEventById_(googleEventId) {
  if (!googleEventId) return null;
  const cal = getTargetCalendar_();
  try {
    return cal.getEventById(googleEventId);
  } catch (e) {
    console.warn('getGoogleEventById_ failed:', e);
    return null;
  }
}

/**
 * Googleカレンダーイベントを更新（削除→再作成方式）
 * 終日⇄時間ありの変更にも確実に対応するため再作成方式を採用
 * @param {Object} eventObj - イベントデータ
 * @param {string} existingGoogleId - 既存のGoogleイベントID
 * @returns {string} 新しいGoogleイベントID
 */
function upsertGoogleCalendarEvent_(eventObj, existingGoogleId) {
  // 既存があれば削除
  if (existingGoogleId) {
    const ev = getGoogleEventById_(existingGoogleId);
    if (ev) {
      ev.deleteEvent();
    }
  }
  // 新しく作成
  return createGoogleCalendarEvent_(eventObj);
}

/**
 * Googleカレンダーイベントを削除
 * @param {string} googleEventId - GoogleイベントID
 */
function deleteGoogleCalendarEvent_(googleEventId) {
  const ev = getGoogleEventById_(googleEventId);
  if (ev) {
    ev.deleteEvent();
  }
}

// ===========================================
// DB連携：新規作成時の同期
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
    // 同期失敗
    console.error('syncNewEventToGoogle error:', e);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));

    return { success: false, error: String(e) };
  }
}

// ===========================================
// DB連携：更新時の同期
// ===========================================

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
    // 同期失敗
    console.error('syncUpdatedEventToGoogle error:', e);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));

    return { success: false, error: String(e) };
  }
}

// ===========================================
// DB連携：削除時の同期
// ===========================================

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
    // 同期失敗
    console.error('syncDeletedEventToGoogle error:', e);
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIndex, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));

    return { success: false, error: String(e) };
  }
}
