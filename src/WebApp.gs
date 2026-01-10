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
  try {
    // 引数チェック
    const now = new Date();
    const tz = 'Asia/Tokyo';
    const y = year || Number(Utilities.formatDate(now, tz, 'yyyy'));
    const m = month || Number(Utilities.formatDate(now, tz, 'MM'));

    console.log('getCalendarData called:', y, m);

    // イベント取得（失敗したら空オブジェクト）
    let events = {};
    try {
      events = getEventsByMonth(y, m) || {};
    } catch (e) {
      console.error('getEventsByMonth error:', e);
    }

    // 六曜取得（失敗したら空オブジェクト）
    let rokuyo = {};
    try {
      rokuyo = getRokuyoByMonth(y, m) || {};
    } catch (e) {
      console.error('getRokuyoByMonth error:', e);
    }

    // 祝日取得（失敗したら空オブジェクト）
    let holidays = {};
    try {
      holidays = getHolidaysByMonth(y, m) || {};
    } catch (e) {
      console.error('getHolidaysByMonth error:', e);
    }

    console.log('getCalendarData returning events count:', Object.keys(events).length);

    // 必ず events/rokuyo/holidays キーで返す（nullは禁止）
    // JSON.parse(JSON.stringify()) で Date オブジェクトを確実に文字列化
    const result = {
      year: y,
      month: m,
      events: events,
      rokuyo: rokuyo,
      holidays: holidays
    };
    return JSON.parse(JSON.stringify(result));
  } catch (e) {
    console.error('getCalendarData error:', e);
    // エラーでも必ずオブジェクトを返す
    return {
      year: year || new Date().getFullYear(),
      month: month || new Date().getMonth() + 1,
      events: {},
      rokuyo: {},
      holidays: {}
    };
  }
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
 * 予定を登録（Webアプリから呼び出し・AI解析経由）
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
 * 予定を直接登録（フォームから編集済みデータを受け取る）
 * @param {Object} eventData - イベントデータ（title, start_date, end_date, start_time, end_time, memo, all_day）
 * @param {string} rawText - 元の入力テキスト
 * @returns {Object}
 */
function registerEventDirect(eventData, rawText) {
  try {
    // 最低限のバリデーション
    if (!eventData.title || !eventData.title.trim()) {
      throw new Error('タイトルが必要です');
    }
    if (!eventData.start_date) {
      throw new Error('日付が必要です');
    }

    // end_dateがなければstart_dateと同じに
    if (!eventData.end_date) {
      eventData.end_date = eventData.start_date;
    }

    // DBに登録
    insertEventToDB(eventData, rawText || '', 'text');

    return {
      success: true,
      data: eventData,
      message: `予定「${eventData.title}」を登録しました`
    };
  } catch (error) {
    writeErrorLog('calendar', rawText || '', 'insert_event', error);
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
 * 指定日のメモを保存（上書き）（Webアプリから呼び出し）
 * @param {string} dateStr - 日付（YYYY-MM-DD）
 * @param {string} text - メモテキスト
 * @returns {Object}
 */
function saveMemo(dateStr, text) {
  try {
    const sheet = getSheet(SHEET_NAMES.DB_MEMOS);
    const data = sheet.getDataRange().getValues();
    const tz = getSettings().timezone;

    // 既存の行を探す
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
      // 既存行を上書き
      const rowNum = existingRowIndex + 1;
      sheet.getRange(rowNum, MEMO_COLS.MEMO_TEXT + 1).setValue(text);
      sheet.getRange(rowNum, MEMO_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());
      return {
        success: true,
        mode: 'update',
        message: 'メモを保存しました'
      };
    } else if (text.trim()) {
      // 新規行を追加（空文字でなければ）
      const newRow = new Array(9).fill('');
      newRow[MEMO_COLS.MEMO_ID] = newMemoId();
      newRow[MEMO_COLS.DATE] = dateStr;
      newRow[MEMO_COLS.MEMO_TEXT] = text;
      newRow[MEMO_COLS.CREATED_AT] = getCurrentDateTime();
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
      return {
        success: true,
        mode: 'insert',
        message: 'メモを保存しました'
      };
    } else {
      // 新規で空文字の場合は何もしない
      return {
        success: true,
        mode: 'skip',
        message: '保存するメモがありません'
      };
    }
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
