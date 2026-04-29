/**
 * HermesAPI.gs
 * Hermes Agent 等の外部システムから JSON API でアクセスするためのエンドポイント
 *
 * セットアップ:
 *   1. このファイルを Apps Script プロジェクトに追加
 *   2. setupHermesApiToken() を一度だけ手動実行 → トークンが Script Properties に保存される
 *   3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      - 次のユーザーとして実行: 自分
 *      - アクセスできるユーザー: 全員
 *   4. デプロイURL ( /exec で終わるもの ) と トークンを Hermes 側に設定
 */

// ===========================================
// 認可: 共有トークン
// ===========================================
const HERMES_TOKEN_KEY = 'HERMES_API_TOKEN';

/**
 * 初回セットアップ: ランダムなAPIトークンを生成して Script Properties に保存
 * Apps Script エディタで一度実行してください
 */
function setupHermesApiToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(HERMES_TOKEN_KEY);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(HERMES_TOKEN_KEY, token);
  }
  console.log('=== Hermes API Token ===');
  console.log(token);
  console.log('========================');
  console.log('このトークンを Hermes 側の HERMES_GAS_TOKEN env に設定してください');
  return token;
}

/**
 * トークンを再生成したい場合
 */
function regenerateHermesApiToken() {
  PropertiesService.getScriptProperties().deleteProperty(HERMES_TOKEN_KEY);
  return setupHermesApiToken();
}

// ===========================================
// doPost - JSON API エントリポイント
// ===========================================
function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');

    const expected = PropertiesService.getScriptProperties().getProperty(HERMES_TOKEN_KEY);
    if (!expected) return jsonResponse_({ ok: false, error: 'HERMES_API_TOKEN not configured. Run setupHermesApiToken() once.' });
    if (body.token !== expected) return jsonResponse_({ ok: false, error: 'unauthorized' });

    const action = body.action;
    const params = body.params || {};

    let result;
    switch (action) {
      case 'ping':   result = { ok: true, pong: new Date().toISOString() }; break;
      case 'create': result = handleHermesCreate_(params); break;
      case 'list':   result = handleHermesList_(params); break;
      case 'get':    result = handleHermesGet_(params); break;
      case 'update': result = handleHermesUpdate_(params); break;
      case 'delete': result = handleHermesDelete_(params); break;
      case 'parse':  result = handleHermesParse_(params); break;
      default: result = { ok: false, error: 'unknown action: ' + String(action) };
    }
    return jsonResponse_(result);
  } catch (err) {
    console.error('doPost error:', err && err.stack);
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===========================================
// 予定登録
// ===========================================
/**
 * params:
 *   構造化: { title, date | start_date, end_date?, start_time?, end_time?, all_day?, memo?, color_key? }
 *   自然言語: { text }  ← Gemini で解析
 *   共通: { source?, raw_text? }
 */
function handleHermesCreate_(params) {
  let eventData;
  let rawText = params.raw_text || '';
  const source = params.source || 'hermes';

  if (params.text && !params.title) {
    eventData = parseCalendarText(params.text);
    rawText = rawText || params.text;
  } else if (params.title) {
    const date = params.date || params.start_date;
    if (!date) return { ok: false, error: 'date or start_date required' };
    eventData = {
      title: params.title,
      start_date: date,
      end_date: params.end_date || date,
      start_time: params.start_time || '',
      end_time: params.end_time || '',
      all_day: params.all_day === true || params.all_day === 'TRUE',
      memo: params.memo || '',
      color_key: params.color_key || 'other'
    };
    rawText = rawText || (params.title + ' (via hermes)');
  } else {
    return { ok: false, error: 'title or text required' };
  }

  const eventId = insertEventToDB(eventData, rawText, source);
  return { ok: true, event_id: eventId, event: eventData };
}

// ===========================================
// 予定一覧取得
// ===========================================
/**
 * params のいずれか:
 *   { date: 'YYYY-MM-DD' }              → その日のイベント
 *   { from: 'YYYY-MM-DD', to: '...' }   → 期間内のイベント
 *   { year: 2026, month: 4 }            → その月のイベント (日付別マップ)
 *   {}                                  → 今日
 *   オプション: { limit: 50 }
 */
function handleHermesList_(params) {
  const limit = Number(params.limit) || 0;

  if (params.date) {
    return { ok: true, events: getEventsByDate(params.date) };
  }
  if (params.year && params.month) {
    return { ok: true, by_date: getEventsByMonth(params.year, params.month) };
  }
  if (params.from && params.to) {
    return { ok: true, events: hermesListInRange_(params.from, params.to, limit) };
  }
  return { ok: true, events: getEventsByDate(getTodayDate()) };
}

function hermesListInRange_(fromDate, toDate, limit) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();
  const tz = getSettings().timezone;
  const out = [];

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (row[EVENT_COLS.STATUS] !== 'active') continue;
    const sd = formatDateValue(row[EVENT_COLS.START_DATE], tz);
    const ed = formatDateValue(row[EVENT_COLS.END_DATE], tz);
    if (ed < fromDate || sd > toDate) continue;

    out.push({
      event_id: row[EVENT_COLS.EVENT_ID],
      title: row[EVENT_COLS.TITLE],
      start_date: sd,
      end_date: ed,
      start_time: formatTimeValue(row[EVENT_COLS.START_TIME], tz),
      end_time: formatTimeValue(row[EVENT_COLS.END_TIME], tz),
      all_day: row[EVENT_COLS.ALL_DAY] === 'TRUE' || row[EVENT_COLS.ALL_DAY] === true,
      memo: row[EVENT_COLS.MEMO] || null,
      color_key: row[EVENT_COLS.COLOR_KEY] || 'other'
    });
  }
  out.sort(function(a, b){
    var ka = a.start_date + (a.start_time || '00:00');
    var kb = b.start_date + (b.start_time || '00:00');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return limit > 0 ? out.slice(0, limit) : out;
}

// ===========================================
// 予定取得（単一）
// ===========================================
function handleHermesGet_(params) {
  if (!params.event_id) return { ok: false, error: 'event_id required' };
  const found = hermesFindRow_(params.event_id);
  if (!found) return { ok: false, error: 'event not found' };
  const tz = getSettings().timezone;
  const row = found.row;
  return {
    ok: true,
    event: {
      event_id: row[EVENT_COLS.EVENT_ID],
      title: row[EVENT_COLS.TITLE],
      start_date: formatDateValue(row[EVENT_COLS.START_DATE], tz),
      end_date: formatDateValue(row[EVENT_COLS.END_DATE], tz),
      start_time: formatTimeValue(row[EVENT_COLS.START_TIME], tz),
      end_time: formatTimeValue(row[EVENT_COLS.END_TIME], tz),
      all_day: row[EVENT_COLS.ALL_DAY] === 'TRUE' || row[EVENT_COLS.ALL_DAY] === true,
      memo: row[EVENT_COLS.MEMO] || null,
      status: row[EVENT_COLS.STATUS],
      color_key: row[EVENT_COLS.COLOR_KEY] || 'other',
      google_event_id: row[EVENT_COLS.GOOGLE_EVENT_ID] || null,
      gcal_sync_status: row[EVENT_COLS.GCAL_SYNC_STATUS] || null
    }
  };
}

function hermesFindRow_(eventId) {
  const sheet = getSheet(SHEET_NAMES.DB_EVENTS);
  const data = sheet.getDataRange().getValues();
  for (let i = 2; i < data.length; i++) {
    if (data[i][EVENT_COLS.EVENT_ID] === eventId) {
      return { sheet: sheet, rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

// ===========================================
// 予定更新
// ===========================================
function handleHermesUpdate_(params) {
  if (!params.event_id) return { ok: false, error: 'event_id required' };
  const found = hermesFindRow_(params.event_id);
  if (!found) return { ok: false, error: 'event not found' };

  const sheet = found.sheet;
  const rowIdx = found.rowIndex;
  const tz = getSettings().timezone;

  const setIf = function(key, col, transform){
    if (params[key] !== undefined) {
      sheet.getRange(rowIdx, col + 1).setValue(transform ? transform(params[key]) : params[key]);
    }
  };
  setIf('title', EVENT_COLS.TITLE);
  setIf('start_date', EVENT_COLS.START_DATE);
  setIf('end_date', EVENT_COLS.END_DATE);
  setIf('start_time', EVENT_COLS.START_TIME, function(v){ return v || ''; });
  setIf('end_time', EVENT_COLS.END_TIME, function(v){ return v || ''; });
  setIf('all_day', EVENT_COLS.ALL_DAY, function(v){ return (v === true || v === 'TRUE') ? 'TRUE' : 'FALSE'; });
  setIf('memo', EVENT_COLS.MEMO, function(v){ return v || ''; });
  setIf('color_key', EVENT_COLS.COLOR_KEY);
  sheet.getRange(rowIdx, EVENT_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());

  const updated = sheet.getRange(rowIdx, 1, 1, 19).getValues()[0];
  const eventData = {
    title: updated[EVENT_COLS.TITLE],
    start_date: formatDateValue(updated[EVENT_COLS.START_DATE], tz),
    end_date: formatDateValue(updated[EVENT_COLS.END_DATE], tz),
    start_time: formatTimeValue(updated[EVENT_COLS.START_TIME], tz) || '',
    end_time: formatTimeValue(updated[EVENT_COLS.END_TIME], tz) || '',
    all_day: updated[EVENT_COLS.ALL_DAY] === 'TRUE' || updated[EVENT_COLS.ALL_DAY] === true,
    memo: updated[EVENT_COLS.MEMO] || ''
  };
  try {
    const newGid = upsertGoogleCalendarEvent_(eventData, updated[EVENT_COLS.GOOGLE_EVENT_ID]);
    sheet.getRange(rowIdx, EVENT_COLS.GOOGLE_EVENT_ID + 1).setValue(newGid);
    sheet.getRange(rowIdx, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('synced');
    sheet.getRange(rowIdx, EVENT_COLS.GCAL_SYNCED_AT + 1).setValue(getCurrentDateTime());
    sheet.getRange(rowIdx, EVENT_COLS.GCAL_ERROR + 1).setValue('');
  } catch (e) {
    sheet.getRange(rowIdx, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
    sheet.getRange(rowIdx, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));
  }
  return { ok: true, event_id: params.event_id, event: eventData };
}

// ===========================================
// 予定削除（ソフト削除 + Google Calendar 削除）
// ===========================================
function handleHermesDelete_(params) {
  if (!params.event_id) return { ok: false, error: 'event_id required' };
  const found = hermesFindRow_(params.event_id);
  if (!found) return { ok: false, error: 'event not found' };

  const sheet = found.sheet;
  const rowIdx = found.rowIndex;
  const row = found.row;

  sheet.getRange(rowIdx, EVENT_COLS.STATUS + 1).setValue('deleted');
  sheet.getRange(rowIdx, EVENT_COLS.UPDATED_AT + 1).setValue(getCurrentDateTime());

  const gid = row[EVENT_COLS.GOOGLE_EVENT_ID];
  if (gid) {
    try {
      deleteGoogleCalendarEvent_(gid);
      sheet.getRange(rowIdx, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('synced');
      sheet.getRange(rowIdx, EVENT_COLS.GCAL_SYNCED_AT + 1).setValue(getCurrentDateTime());
    } catch (e) {
      sheet.getRange(rowIdx, EVENT_COLS.GCAL_SYNC_STATUS + 1).setValue('failed');
      sheet.getRange(rowIdx, EVENT_COLS.GCAL_ERROR + 1).setValue(String(e));
    }
  }
  return { ok: true, event_id: params.event_id };
}

// ===========================================
// 自然言語パースのみ（保存しない）
// ===========================================
function handleHermesParse_(params) {
  if (!params.text) return { ok: false, error: 'text required' };
  return { ok: true, event: parseCalendarText(params.text) };
}
