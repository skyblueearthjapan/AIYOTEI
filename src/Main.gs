/**
 * Main.gs
 * メインエントリーポイント・カスタムメニュー
 */

// ===========================================
// onOpen - カスタムメニュー
// ===========================================

/**
 * スプレッドシートを開いたときにメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('AIカレンダー')
    .addItem('予定：テキストから登録', 'showCalendarInputDialog')
    .addItem('メモ：テキストから追記', 'showMemoInputDialog')
    .addSeparator()
    .addItem('メモ：前日へ', 'moveMemoToPreviousDay')
    .addItem('メモ：翌日へ', 'moveMemoToNextDay')
    .addItem('メモ：今日に戻す', 'moveMemoToToday')
    .addSeparator()
    .addItem('メモをコピー（サイドバー）', 'showCopySidebar')
    .addSeparator()
    .addItem('選択日を今日に戻す（カレンダー）', 'resetCalendarSelectedDate')
    .addItem('ログを表示', 'showLogSidebar')
    .toMenu();

  showToast('メニューが読み込まれました', 'AIカレンダー', 2);
}

// ===========================================
// カレンダー入力ダイアログ
// ===========================================

/**
 * 予定登録用のテキスト入力ダイアログを表示
 */
function showCalendarInputDialog() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    '予定を登録',
    '予定を自然な言葉で入力してください\n（例：来週の火曜15時に歯医者 保険証を持っていく）',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const inputText = response.getResponseText().trim();
  if (!inputText) {
    showAlert('テキストが入力されていません');
    return;
  }

  try {
    showToast('AIで解析中...', 'AIカレンダー', 10);

    // AI解析
    const eventData = parseCalendarText(inputText);

    // 確認ダイアログ
    const confirmMessage = formatEventConfirmMessage(eventData);
    if (!showConfirm(confirmMessage)) {
      showToast('キャンセルしました');
      return;
    }

    // DB登録
    insertEventToDB(eventData, inputText);

    showToast(`予定「${eventData.title}」を登録しました`, 'AIカレンダー', 5);

  } catch (error) {
    console.error('Calendar input error:', error);
    showAlert(`エラーが発生しました:\n${error.message}`);
  }
}

/**
 * 確認用メッセージをフォーマット
 * @param {Object} eventData - イベントデータ
 * @returns {string}
 */
function formatEventConfirmMessage(eventData) {
  let message = `以下の内容で登録しますか？\n\n`;
  message += `タイトル: ${eventData.title}\n`;
  message += `日付: ${eventData.start_date}`;

  if (eventData.start_date !== eventData.end_date) {
    message += ` 〜 ${eventData.end_date}`;
  }
  message += '\n';

  if (eventData.start_time) {
    message += `時間: ${eventData.start_time}`;
    if (eventData.end_time) {
      message += ` 〜 ${eventData.end_time}`;
    }
    message += '\n';
  } else if (eventData.all_day) {
    message += `終日: はい\n`;
  }

  if (eventData.memo) {
    message += `メモ: ${eventData.memo}\n`;
  }

  return message;
}

// ===========================================
// メモ入力ダイアログ
// ===========================================

/**
 * メモ追記用のテキスト入力ダイアログを表示
 */
function showMemoInputDialog() {
  const ui = SpreadsheetApp.getUi();

  // 現在選択中の日付を取得
  const currentDate = getMemoCurrentDate();

  const response = ui.prompt(
    `メモを追記（${currentDate}）`,
    'メモを入力してください\n（音声入力のような自然な文でOK）',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const inputText = response.getResponseText().trim();
  if (!inputText) {
    showAlert('テキストが入力されていません');
    return;
  }

  try {
    showToast('AIで整形中...', 'AIカレンダー', 10);

    // AI整形
    const cleanedText = cleanMemoText(inputText);

    // 確認ダイアログ
    const confirmMessage = `以下の内容で追記しますか？\n\n【整形後】\n${cleanedText}`;
    if (!showConfirm(confirmMessage)) {
      showToast('キャンセルしました');
      return;
    }

    // DB追記
    appendMemo(currentDate, cleanedText, inputText);

    showToast('メモを追記しました', 'AIカレンダー', 5);

    // UI_Memoを更新
    refreshMemoUI(currentDate);

  } catch (error) {
    console.error('Memo input error:', error);
    showAlert(`エラーが発生しました:\n${error.message}`);
  }
}

// ===========================================
// 日付移動
// ===========================================

/**
 * UI_Memoの現在の日付を取得
 * @returns {string} YYYY-MM-DD形式
 */
function getMemoCurrentDate() {
  const sheet = getSheet(SHEET_NAMES.UI_MEMO);
  const dateValue = sheet.getRange('C3').getValue();

  if (dateValue instanceof Date) {
    return Utilities.formatDate(dateValue, getSettings().timezone, 'yyyy-MM-dd');
  }

  // 文字列の場合はそのまま返す
  return String(dateValue);
}

/**
 * UI_Memoの日付を設定
 * @param {string} dateStr - YYYY-MM-DD形式
 */
function setMemoCurrentDate(dateStr) {
  const sheet = getSheet(SHEET_NAMES.UI_MEMO);
  sheet.getRange('C3').setValue(dateStr);
}

/**
 * メモを前日に移動
 */
function moveMemoToPreviousDay() {
  const currentDate = getMemoCurrentDate();
  const date = new Date(currentDate);
  date.setDate(date.getDate() - 1);
  const newDate = Utilities.formatDate(date, getSettings().timezone, 'yyyy-MM-dd');
  setMemoCurrentDate(newDate);
  refreshMemoUI(newDate);
  showToast(`${newDate} に移動しました`);
}

/**
 * メモを翌日に移動
 */
function moveMemoToNextDay() {
  const currentDate = getMemoCurrentDate();
  const date = new Date(currentDate);
  date.setDate(date.getDate() + 1);
  const newDate = Utilities.formatDate(date, getSettings().timezone, 'yyyy-MM-dd');
  setMemoCurrentDate(newDate);
  refreshMemoUI(newDate);
  showToast(`${newDate} に移動しました`);
}

/**
 * メモを今日に移動
 */
function moveMemoToToday() {
  const today = getTodayDate();
  setMemoCurrentDate(today);
  refreshMemoUI(today);
  showToast(`今日（${today}）に移動しました`);
}

/**
 * カレンダーの選択日を今日に戻す
 */
function resetCalendarSelectedDate() {
  const sheet = getSheet(SHEET_NAMES.UI_CALENDAR);
  const today = getTodayDate();
  sheet.getRange('J13').setValue(today);
  showToast(`選択日を今日（${today}）に戻しました`);
}

// ===========================================
// UI更新
// ===========================================

/**
 * UI_Memoのメモ表示を更新
 * @param {string} dateStr - YYYY-MM-DD形式
 */
function refreshMemoUI(dateStr) {
  const sheet = getSheet(SHEET_NAMES.UI_MEMO);
  const memoText = getMemoTextByDate(dateStr);

  // メモ本文エリア（A6:H16あたり）に表示
  // 実際のセル位置はスプレッドシート構造に合わせて調整
  sheet.getRange('A6').setValue(memoText || '');
}

/**
 * 指定日のメモ本文を取得
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {string}
 */
function getMemoTextByDate(dateStr) {
  const sheet = getSheet(SHEET_NAMES.DB_MEMOS);
  const data = sheet.getDataRange().getValues();

  // ヘッダー行をスキップ（1行目はタイトル、2行目がヘッダー）
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[1]; // B列: date

    let dateValue;
    if (rowDate instanceof Date) {
      dateValue = Utilities.formatDate(rowDate, getSettings().timezone, 'yyyy-MM-dd');
    } else {
      dateValue = String(rowDate);
    }

    if (dateValue === dateStr) {
      return row[2] || ''; // C列: memo_text
    }
  }

  return '';
}
