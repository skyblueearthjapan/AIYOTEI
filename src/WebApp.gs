/**
 * WebApp.gs
 * Webアプリ用エントリーポイント
 */

// ===========================================
// doGet - Webアプリのエントリーポイント
// ===========================================

/**
 * Webアプリにアクセスした時に呼ばれる
 * @param {Object} e - イベントオブジェクト
 * @returns {HtmlOutput}
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');

  return template.evaluate()
    .setTitle('AIカレンダー')
    .setFaviconUrl('https://www.gstatic.com/script/apps_script_1x_24dp.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTMLファイルをインクルードするヘルパー
 * @param {string} filename - ファイル名
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===========================================
// Webアプリ用API関数
// ===========================================

/**
 * 現在の年月を取得
 * @returns {Object}
 */
function getInitialData() {
  const today = getTodayDate();
  const parts = today.split('-');

  return {
    today: today,
    year: parseInt(parts[0]),
    month: parseInt(parts[1]),
    day: parseInt(parts[2])
  };
}

/**
 * 指定月のカレンダーデータを取得
 * @param {number} year - 年
 * @param {number} month - 月
 * @returns {Object}
 */
function getCalendarData(year, month) {
  const events = getEventsByMonth(year, month);
  const rokuyo = getRokuyoByMonth(year, month);

  return {
    year: year,
    month: month,
    events: events,
    rokuyo: rokuyo
  };
}

/**
 * 指定月の六曜データを取得
 * @param {number} year - 年
 * @param {number} month - 月
 * @returns {Object}
 */
function getRokuyoByMonth(year, month) {
  try {
    const settings = getSettings();
    if (!settings.showRokuyo) return {};

    const sheet = getSheet(SHEET_NAMES.DB_ROKUYO);
    const data = sheet.getDataRange().getValues();
    const rokuyoMap = {};
    const tz = settings.timezone;

    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}`;

    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      let dateValue;

      if (row[0] instanceof Date) {
        dateValue = Utilities.formatDate(row[0], tz, 'yyyy-MM-dd');
      } else {
        dateValue = String(row[0]);
      }

      if (dateValue.startsWith(prefix)) {
        rokuyoMap[dateValue] = row[1] || '';
      }
    }

    return rokuyoMap;
  } catch (e) {
    console.error('getRokuyoByMonth error:', e);
    return {};
  }
}

/**
 * 予定を登録（Webアプリから呼び出し）
 * @param {string} text - 入力テキスト
 * @param {string} source - ソース（"voice" or "text"）
 * @returns {Object}
 */
function registerEvent(text, source) {
  try {
    const eventData = parseCalendarText(text);
    insertEventToDB(eventData, text, source);

    return {
      success: true,
      data: eventData,
      message: `予定「${eventData.title}」を登録しました`
    };
  } catch (error) {
    writeErrorLog('calendar', text, 'insert_event', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * メモを追記（Webアプリから呼び出し）
 * @param {string} dateStr - 日付（YYYY-MM-DD）
 * @param {string} text - 入力テキスト
 * @param {string} source - ソース（"voice" or "text"）
 * @returns {Object}
 */
function addMemo(dateStr, text, source) {
  try {
    const cleanedText = cleanMemoText(text);
    appendMemo(dateStr, cleanedText, text, source);

    // 更新後のメモを取得
    const updatedMemo = getMemoText(dateStr);

    return {
      success: true,
      cleanedText: cleanedText,
      fullText: updatedMemo,
      message: 'メモを追記しました'
    };
  } catch (error) {
    writeErrorLog('memo', text, 'append_memo', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 指定日のメモを取得（Webアプリから呼び出し）
 * @param {string} dateStr - 日付（YYYY-MM-DD）
 * @returns {Object}
 */
function getMemoData(dateStr) {
  try {
    const memo = getMemoByDate(dateStr);
    return {
      success: true,
      date: dateStr,
      text: memo ? memo.memo_text : '',
      exists: !!memo
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 指定日の予定を取得（Webアプリから呼び出し）
 * @param {string} dateStr - 日付（YYYY-MM-DD）
 * @returns {Object}
 */
function getEventsData(dateStr) {
  try {
    const events = getEventsByDate(dateStr);
    return {
      success: true,
      date: dateStr,
      events: events
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * AI解析のプレビュー（確認用）
 * @param {string} text - 入力テキスト
 * @returns {Object}
 */
function previewCalendarParse(text) {
  try {
    const eventData = parseCalendarText(text);
    return {
      success: true,
      data: eventData
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * メモ整形のプレビュー（確認用）
 * @param {string} text - 入力テキスト
 * @returns {Object}
 */
function previewMemoCleaning(text) {
  try {
    const cleanedText = cleanMemoText(text);
    return {
      success: true,
      cleanedText: cleanedText
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
