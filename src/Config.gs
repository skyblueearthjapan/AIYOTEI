/**
 * Config.gs
 * 設定値・ヘルパー関数
 */

// ===========================================
// シート名定義（定数）
// ===========================================
const SHEET_NAMES = {
  UI_CALENDAR: 'UI_Calendar',
  UI_MEMO: 'UI_Memo',
  DB_EVENTS: 'DB_Events',
  DB_MEMOS: 'DB_Memos',
  DB_ROKUYO: 'DB_Rokuyo',
  DB_LOG: 'DB_Log',
  SETTINGS: 'Settings'
};

// ===========================================
// スクリプトプロパティキー
// ===========================================
const PROP_KEYS = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  OPENAI_MODEL_CALENDAR: 'OPENAI_MODEL_CALENDAR',
  OPENAI_MODEL_MEMO: 'OPENAI_MODEL_MEMO'
};

// ===========================================
// デフォルト値
// ===========================================
const DEFAULTS = {
  TIMEZONE: 'Asia/Tokyo',
  OPENAI_MODEL: 'gpt-4o-mini'
};

// ===========================================
// シート取得ヘルパー
// ===========================================

/**
 * シートを名前で取得
 * @param {string} name - シート名
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(`シート "${name}" が見つかりません`);
  }
  return sheet;
}

/**
 * Settingsシートから設定を読み込む
 * @returns {Object} 設定オブジェクト
 */
function getSettings() {
  const sheet = getSheet(SHEET_NAMES.SETTINGS);
  const data = sheet.getRange('A3:B10').getValues();

  const settings = {};
  for (const row of data) {
    if (row[0]) {
      settings[row[0]] = row[1];
    }
  }

  return {
    weekStart: settings['WeekStart'] || 'Sunday',
    showRokuyo: settings['ShowRokuyo'] === true || settings['ShowRokuyo'] === 'TRUE',
    timezone: settings['Timezone'] || DEFAULTS.TIMEZONE,
    theme: settings['Theme'] || 'Pastel'
  };
}

/**
 * スクリプトプロパティから値を取得
 * @param {string} key - プロパティキー
 * @param {string} defaultValue - デフォルト値
 * @returns {string}
 */
function getProperty(key, defaultValue = '') {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(key) || defaultValue;
}

/**
 * OpenAI APIキーを取得
 * @returns {string}
 */
function getOpenAIApiKey() {
  const key = getProperty(PROP_KEYS.OPENAI_API_KEY);
  if (!key) {
    throw new Error('OPENAI_API_KEY がスクリプトプロパティに設定されていません');
  }
  return key;
}

/**
 * Calendar用AIモデルを取得
 * @returns {string}
 */
function getCalendarModel() {
  return getProperty(PROP_KEYS.OPENAI_MODEL_CALENDAR, DEFAULTS.OPENAI_MODEL);
}

/**
 * Memo用AIモデルを取得
 * @returns {string}
 */
function getMemoModel() {
  return getProperty(PROP_KEYS.OPENAI_MODEL_MEMO, DEFAULTS.OPENAI_MODEL);
}

// ===========================================
// ID生成ヘルパー
// ===========================================

/**
 * ランダム文字列を生成
 * @param {number} length - 長さ
 * @returns {string}
 */
function randomString(length = 4) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 現在時刻のタイムスタンプ文字列を取得
 * @returns {string} YYYYMMDD_HHMMSS形式
 */
function getTimestampString() {
  const now = new Date();
  const settings = getSettings();
  const tz = settings.timezone;

  const formatted = Utilities.formatDate(now, tz, 'yyyyMMdd_HHmmss');
  return formatted;
}

/**
 * 現在時刻を取得（フォーマット済み）
 * @returns {string} YYYY-MM-DD HH:MM:SS形式
 */
function getCurrentDateTime() {
  const now = new Date();
  const settings = getSettings();
  const tz = settings.timezone;

  return Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * 今日の日付を取得
 * @returns {string} YYYY-MM-DD形式
 */
function getTodayDate() {
  const now = new Date();
  const settings = getSettings();
  const tz = settings.timezone;

  return Utilities.formatDate(now, tz, 'yyyy-MM-dd');
}

/**
 * イベントIDを生成
 * @returns {string} evt_YYYYMMDD_HHMMSS_xxxx
 */
function newEventId() {
  return `evt_${getTimestampString()}_${randomString(4)}`;
}

/**
 * メモIDを生成
 * @returns {string} mem_YYYYMMDD_HHMMSS_xxxx
 */
function newMemoId() {
  return `mem_${getTimestampString()}_${randomString(4)}`;
}

/**
 * ログIDを生成
 * @returns {string} log_YYYYMMDD_HHMMSS_xxxx
 */
function newLogId() {
  return `log_${getTimestampString()}_${randomString(4)}`;
}

// ===========================================
// ユーティリティ
// ===========================================

/**
 * トースト通知を表示
 * @param {string} message - メッセージ
 * @param {string} title - タイトル
 * @param {number} timeout - 表示秒数
 */
function showToast(message, title = 'AIカレンダー', timeout = 3) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout);
}

/**
 * アラートダイアログを表示
 * @param {string} message - メッセージ
 */
function showAlert(message) {
  SpreadsheetApp.getUi().alert(message);
}

/**
 * 確認ダイアログを表示
 * @param {string} message - メッセージ
 * @returns {boolean} OKが押されたらtrue
 */
function showConfirm(message) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('確認', message, ui.ButtonSet.OK_CANCEL);
  return response === ui.Button.OK;
}
