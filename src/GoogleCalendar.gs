/**
 * GoogleCalendar.gs
 * Googleカレンダーとの同期処理（純粋なAPI関数のみ）
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
    const start = new Date(eventObj.start_date + 'T00:00:00');
    const end = new Date(eventObj.end_date + 'T00:00:00');
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
    const startDateTime = new Date(eventObj.start_date + 'T' + eventObj.start_time + ':00');
    let endDateTime;

    if (eventObj.end_time) {
      endDateTime = new Date(eventObj.end_date + 'T' + eventObj.end_time + ':00');
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
