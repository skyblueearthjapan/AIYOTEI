/**
 * Note.gs - 固定10タブノートシステム
 * DB_Notes シートを使用した固定ノート管理
 *
 * DB_Notes シート構造:
 *   Row 1: タイトル
 *   Row 2: ヘッダー (note_id, tab_name, note_text, created_at, updated_at)
 *   Row 3+: データ
 */

// カラム定義 (0-indexed)
var NOTE_COLS = {
  note_id:    0,
  tab_name:   1,
  note_text:  2,
  created_at: 3,
  updated_at: 4
};

/**
 * デフォルトのタブ名配列を返す (10個固定)
 * @return {string[]}
 */
function getDefaultNoteNames() {
  return [
    'メモ1', 'メモ2', 'メモ3', 'メモ4', 'メモ5',
    'メモ6', 'メモ7', 'メモ8', 'メモ9', 'メモ10'
  ];
}

/**
 * DB_Notes シートを作成し、10件のデフォルトノートを初期化する
 * シートが存在しない場合は自動作成、データが既に存在する場合は何もしない
 * GASエディタから手動実行可能
 */
function setupNotes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('DB_Notes');

  // シートが存在しなければ作成
  if (!sheet) {
    sheet = ss.insertSheet('DB_Notes');

    // Row 1: タイトル
    sheet.getRange('A1').setValue('DB_Notes');
    sheet.getRange('A1').setFontWeight('bold').setFontSize(12);

    // Row 2: ヘッダー
    var headers = ['note_id', 'tab_name', 'note_text', 'created_at', 'updated_at'];
    sheet.getRange(2, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eaf6');

    // 列幅を調整
    sheet.setColumnWidth(1, 80);   // note_id
    sheet.setColumnWidth(2, 120);  // tab_name
    sheet.setColumnWidth(3, 400);  // note_text
    sheet.setColumnWidth(4, 160);  // created_at
    sheet.setColumnWidth(5, 160);  // updated_at
  }

  // Row 3 以降にデータが存在すれば初期化済みとみなす
  if (sheet.getLastRow() >= 3) {
    try { ss.toast('DB_Notesは既に初期化されています', 'セットアップ', 3); } catch(e) {}
    return;
  }

  // 10件のデフォルトノートを作成
  var now = getCurrentDateTime();
  var defaultNames = getDefaultNoteNames();
  var rows = [];

  for (var i = 0; i < defaultNames.length; i++) {
    rows.push([
      i + 1,            // note_id (1-10)
      defaultNames[i],  // tab_name
      '',               // note_text (空)
      now,              // created_at
      now               // updated_at
    ]);
  }

  sheet.getRange(3, 1, rows.length, rows[0].length).setValues(rows);

  try { ss.toast('DB_Notesシートを作成し、10件のノートを初期化しました', 'セットアップ完了', 5); } catch(e) {}
}

/**
 * initializeNotes - WebアプリからのAPI呼び出し用
 * シートとデータの存在を確認し、なければ作成
 */
function initializeNotes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('DB_Notes');

  // シートもデータもあれば何もしない（高速パス）
  if (sheet && sheet.getLastRow() >= 3) {
    return;
  }

  // シートまたはデータがなければセットアップ実行
  setupNotes();
}

/**
 * 全10件のノートを取得する
 * @return {Object[]} ノートオブジェクトの配列
 */
function getAllNotes() {
  var sheet = getSheet('DB_Notes');
  var lastRow = sheet.getLastRow();

  if (lastRow < 3) {
    return [];
  }

  var numRows = lastRow - 2; // Row 3 から
  var data = sheet.getRange(3, 1, numRows, 5).getValues();
  var notes = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    notes.push({
      note_id:    Number(row[NOTE_COLS.note_id]),
      tab_name:   String(row[NOTE_COLS.tab_name] || ''),
      note_text:  String(row[NOTE_COLS.note_text] || ''),
      created_at: String(row[NOTE_COLS.created_at] || ''),
      updated_at: String(row[NOTE_COLS.updated_at] || '')
    });
  }

  return notes;
}

/**
 * 指定された note_id のノートを1件取得する
 * @param {number} noteId - ノートID (1-10)
 * @return {Object|null} ノートオブジェクト、見つからない場合は null
 */
function getNoteById(noteId) {
  var sheet = getSheet('DB_Notes');
  var lastRow = sheet.getLastRow();

  if (lastRow < 3) {
    return null;
  }

  var numRows = lastRow - 2;
  var data = sheet.getRange(3, 1, numRows, 5).getValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row[NOTE_COLS.note_id] == noteId) {
      return {
        note_id:    row[NOTE_COLS.note_id],
        tab_name:   row[NOTE_COLS.tab_name],
        note_text:  row[NOTE_COLS.note_text],
        created_at: row[NOTE_COLS.created_at],
        updated_at: row[NOTE_COLS.updated_at]
      };
    }
  }

  return null;
}

/**
 * 指定された note_id のノートテキストを保存する
 * @param {number} noteId - ノートID (1-10)
 * @param {string} text - 保存するテキスト
 */
function saveNoteText(noteId, text) {
  var sheet = getSheet('DB_Notes');
  var lastRow = sheet.getLastRow();

  if (lastRow < 3) {
    return;
  }

  var numRows = lastRow - 2;
  var data = sheet.getRange(3, 1, numRows, 1).getValues(); // note_id 列のみ取得

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] == noteId) {
      var rowIndex = i + 3; // シート上の実際の行番号
      sheet.getRange(rowIndex, NOTE_COLS.note_text + 1).setValue(text);
      sheet.getRange(rowIndex, NOTE_COLS.updated_at + 1).setValue(getCurrentDateTime());
      return;
    }
  }
}

/**
 * 指定された note_id のタブ名を変更する
 * @param {number} noteId - ノートID (1-10)
 * @param {string} newName - 新しいタブ名
 */
function saveNoteName(noteId, newName) {
  var sheet = getSheet('DB_Notes');
  var lastRow = sheet.getLastRow();

  if (lastRow < 3) {
    return;
  }

  var numRows = lastRow - 2;
  var data = sheet.getRange(3, 1, numRows, 1).getValues(); // note_id 列のみ取得

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] == noteId) {
      var rowIndex = i + 3; // シート上の実際の行番号
      sheet.getRange(rowIndex, NOTE_COLS.tab_name + 1).setValue(newName);
      sheet.getRange(rowIndex, NOTE_COLS.updated_at + 1).setValue(getCurrentDateTime());
      return;
    }
  }
}

/**
 * 指定された note_id のノートを削除（テキストクリア＋タブ名をデフォルトに戻す）
 * @param {number} noteId - ノートID (1-10)
 */
function clearNote(noteId) {
  var sheet = getSheet('DB_Notes');
  var lastRow = sheet.getLastRow();

  if (lastRow < 3) {
    return;
  }

  var numRows = lastRow - 2;
  var data = sheet.getRange(3, 1, numRows, 1).getValues();
  var defaultNames = getDefaultNoteNames();

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] == noteId) {
      var rowIndex = i + 3;
      var defaultName = defaultNames[noteId - 1] || ('メモ' + noteId);
      sheet.getRange(rowIndex, NOTE_COLS.tab_name + 1).setValue(defaultName);
      sheet.getRange(rowIndex, NOTE_COLS.note_text + 1).setValue('');
      sheet.getRange(rowIndex, NOTE_COLS.updated_at + 1).setValue(getCurrentDateTime());
      return;
    }
  }
}
