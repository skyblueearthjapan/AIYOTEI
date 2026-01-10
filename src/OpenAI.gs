/**
 * OpenAI.gs
 * OpenAI API呼び出し共通関数
 */

// ===========================================
// OpenAI API共通
// ===========================================

/**
 * OpenAI Chat Completion APIを呼び出す
 * @param {string} systemPrompt - システムプロンプト
 * @param {string} userMessage - ユーザーメッセージ
 * @param {string} model - 使用モデル
 * @param {boolean} jsonMode - JSONモードを有効にするか
 * @returns {string} AIの応答テキスト
 */
function callOpenAI(systemPrompt, userMessage, model, jsonMode = false) {
  const apiKey = getOpenAIApiKey();
  const url = 'https://api.openai.com/v1/chat/completions';

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3
  };

  // JSONモードの場合
  if (jsonMode) {
    payload.response_format = { type: 'json_object' };
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    console.error('OpenAI API Error:', responseText);
    throw new Error(`OpenAI APIエラー (${responseCode}): ${parseOpenAIError(responseText)}`);
  }

  const result = JSON.parse(responseText);
  return result.choices[0].message.content;
}

/**
 * OpenAIエラーレスポンスをパース
 * @param {string} responseText - レスポンステキスト
 * @returns {string} エラーメッセージ
 */
function parseOpenAIError(responseText) {
  try {
    const error = JSON.parse(responseText);
    return error.error?.message || 'Unknown error';
  } catch (e) {
    return responseText.substring(0, 200);
  }
}

// ===========================================
// Calendar用プロンプト
// ===========================================

const CALENDAR_SYSTEM_PROMPT = `あなたは日本語の音声入力テキストから予定情報を抽出するアシスタントです。

## 入力
ユーザーが話した自然言語テキスト

## 出力
必ず以下のJSONスキーマに従って出力してください：

{
  "title": "予定のタイトル（必須・空にしない）",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "start_time": "HH:MM または null",
  "end_time": "HH:MM または null",
  "all_day": true または false,
  "memo": "補足情報 または null",
  "color_key": "カテゴリ（下記参照）"
}

## color_key カテゴリ一覧（必ずこの中から1つ選ぶ）
- health: 医療・健康（病院、歯医者、検診、薬局、ジム、運動、美容院など）
- work: 仕事（会議、打ち合わせ、出張、面接、仕事関連全般）
- family: 家族・人付き合い（家族行事、友人、デート、結婚式、お見舞いなど）
- finance: お金・手続き（銀行、役所、保険、税金、契約、支払いなど）
- travel: 旅行・移動（旅行、帰省、引越し、送迎など）
- fun: 趣味・娯楽（映画、コンサート、スポーツ観戦、飲み会、イベント、ライブなど）
- school: 学校・学習（授業、試験、塾、習い事、PTA、学校行事など）
- other: その他（上記に当てはまらない場合）

## ルール
1. titleは必ず抽出する。不明な場合は「予定」などの代替を入れる
2. 時間が曖昧な場合は start_time/end_time を null にする
3. 単日予定は start_date = end_date
4. 期間予定（「◯日から◯日まで」等）は end_date を適切に設定
5. 終日予定の場合は all_day: true
6. 「持っていく」「準備する」などの補足はmemoに入れる
7. 今日の日付は {{TODAY}} として参照可能
8. color_keyは内容から最も適切なカテゴリを1つ選ぶ

## 注意
- JSONのみを出力し、説明文は付けない
- 日本の日付形式（◯月◯日）を正しくYYYY-MM-DD形式に変換する`;

/**
 * Calendar解析用のシステムプロンプトを取得（日付を埋め込み）
 * @returns {string}
 */
function getCalendarSystemPrompt() {
  const today = getTodayDate();
  return CALENDAR_SYSTEM_PROMPT.replace('{{TODAY}}', today);
}

// ===========================================
// Memo用プロンプト
// ===========================================

const MEMO_SYSTEM_PROMPT = `あなたは音声入力テキストを自然な文章に整形するアシスタントです。

## 目的
音声メモに含まれる雑音を除去し、自然な文章に整える

## やること
- フィラーの削除（「えー」「あのー」「そのー」「えっと」等）
- 言い直しの整理
- 句読点・改行を最小限補正
- 文末を自然に整える

## やらないこと（厳守）
- 要約しない
- 箇条書きにしない
- 意味を変えない
- 情報を追加しない
- フォーマットを変えない

## 出力
整形済みのテキストのみを出力（説明文は付けない）`;

// ===========================================
// API呼び出しラッパー
// ===========================================

/**
 * Calendar用のテキスト解析
 * @param {string} text - ユーザー入力テキスト
 * @returns {Object} 解析結果のJSONオブジェクト
 */
function parseCalendarText(text) {
  const model = getCalendarModel();
  const systemPrompt = getCalendarSystemPrompt();

  const response = callOpenAI(systemPrompt, text, model, true);

  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch (e) {
    console.error('JSON parse error:', response);
    throw new Error('AIの応答をJSONとしてパースできませんでした');
  }

  // バリデーション（rawTextをフォールバック用に渡す）
  validateCalendarData(parsed, text);

  return parsed;
}

/**
 * Calendar解析結果のバリデーション（フォールバック付き）
 * @param {Object} data - 解析データ
 * @param {string} rawText - 元の入力テキスト（フォールバック用）
 */
function validateCalendarData(data, rawText) {
  // titleのフォールバック（空禁止）
  if (!data.title || data.title.trim() === '') {
    // 1. memoから先頭20文字を仮タイトルに
    if (data.memo && data.memo.trim()) {
      data.title = data.memo.trim().substring(0, 20);
    }
    // 2. rawTextから先頭20文字を仮タイトルに
    else if (rawText && rawText.trim()) {
      data.title = rawText.trim().substring(0, 20);
    }
    // 3. それでも無理なら「予定」
    else {
      data.title = '予定';
    }
  }

  // start_dateのフォールバック（今日）
  if (!data.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.start_date)) {
    data.start_date = getTodayDate();
  }

  // end_dateのフォールバック（start_dateと同じ）
  if (!data.end_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.end_date)) {
    data.end_date = data.start_date;
  }

  // 時間のフォーマット検証
  if (data.start_time && !/^\d{2}:\d{2}$/.test(data.start_time)) {
    data.start_time = null;
  }
  if (data.end_time && !/^\d{2}:\d{2}$/.test(data.end_time)) {
    data.end_time = null;
  }

  // all_dayのデフォルト
  if (typeof data.all_day !== 'boolean') {
    data.all_day = !data.start_time;
  }

  // color_keyのバリデーション（許可されたカテゴリのみ）
  const validColorKeys = ['health', 'work', 'family', 'finance', 'travel', 'fun', 'school', 'other'];
  if (!data.color_key || !validColorKeys.includes(data.color_key)) {
    data.color_key = 'other';
  }
}

/**
 * Memo用のテキスト整形
 * @param {string} rawText - 音声入力の生テキスト
 * @returns {string} 整形済みテキスト
 */
function cleanMemoText(rawText) {
  const model = getMemoModel();

  const response = callOpenAI(MEMO_SYSTEM_PROMPT, rawText, model, false);

  // 余分な空白を整理
  return response.trim();
}
