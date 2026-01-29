/**
 * AI.gs
 * Gemini API呼び出し共通関数
 */

// ===========================================
// Gemini API共通
// ===========================================

/**
 * Gemini APIを呼び出す
 * @param {string} systemPrompt - システムプロンプト
 * @param {string} userMessage - ユーザーメッセージ
 * @param {string} model - 使用モデル
 * @param {boolean} jsonMode - JSONモードを有効にするか
 * @param {number} temperature - 温度設定（0.0-1.0、デフォルト0.3）
 * @returns {string} AIの応答テキスト
 */
function callGemini(systemPrompt, userMessage, model, jsonMode = false, temperature = 0.3) {
  const apiKey = getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: temperature
    }
  };

  // JSONモードの場合
  if (jsonMode) {
    payload.generationConfig.responseMimeType = 'application/json';
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    console.error('Gemini API Error:', responseText);
    throw new Error(`Gemini APIエラー (${responseCode}): ${parseGeminiError(responseText)}`);
  }

  const result = JSON.parse(responseText);

  // Geminiのレスポンス形式からテキストを抽出
  if (result.candidates && result.candidates[0] && result.candidates[0].content) {
    return result.candidates[0].content.parts[0].text;
  }

  throw new Error('Gemini APIから有効なレスポンスが返されませんでした');
}

/**
 * Geminiエラーレスポンスをパース
 * @param {string} responseText - レスポンステキスト
 * @returns {string} エラーメッセージ
 */
function parseGeminiError(responseText) {
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

## titleについて（最重要）
- titleは必須。絶対に空にしない
- titleには「何をするか」「どこに行くか」など主な予定内容を入れる
- 入力テキストの中心となる行動・イベント名をtitleにする
- 日付・曜日・時刻・助詞（に/で/から 等）は基本入れない
- 文章ではなく短いラベル（名詞句）にする（目安：2〜20文字）

### titleの禁止ルール（重要）
- 次の汎用語だけのtitleは禁止： "予定" "用事" "タスク" "イベント" "スケジュール"
- 例：titleが「予定」や「用事」だけになるのはNG

### titleフォールバック（必ず実行）
- もし明確な予定内容が抽出できない場合でも、入力文から内容が分かる短い名詞句を作ってtitleにする
- それでも難しい場合は、入力文の要約（先頭から20文字以内の短いラベル）をtitleにしてよい
- 最終手段としても title は必ず埋める（例："（内容不明）" は可。ただし "予定" は不可）

titleの例：
- 「明日前田製作所立ち会い」→ title: "前田製作所立ち会い"
- 「来週の金曜日に歯医者」→ title: "歯医者"
- 「1月20日10時から会議」→ title: "会議"
- 「明後日、田中さんとランチ」→ title: "田中さんとランチ"

## memoについて
- memoは補足的な情報のみを入れる
- 持ち物/準備/注意事項/補足説明があればmemoに入れる
- 主な予定内容はtitleに入れ、memoには入れない
- 補足情報がなければ null

## その他ルール
1. 時間が曖昧な場合は start_time/end_time を null
2. 単日予定は start_date = end_date
3. 期間予定（「◯日から◯日まで」等）は end_date を適切に設定
4. 終日予定の場合は all_day: true
5. 今日の日付は {{TODAY}} として参照可能
6. color_keyは内容から最も適切なカテゴリを1つ選ぶ

## 出力前の自己チェック（必須）
- titleが空ではないか？
- titleが禁止語だけになっていないか？（予定/用事/タスク/イベント/スケジュール）
- JSONが壊れていないか？
満たさない場合は、ルールに従って修正してから出力すること。

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

const MEMO_SYSTEM_PROMPT = `あなたは音声メモをクリエイティブに整理・まとめ直すAIアシスタントです。

## 目的
ユーザーが話した内容を深く理解し、より価値のある形にまとめ直す

## あなたの4つの役割

### 1. 深い理解
- 話の表面だけでなく、意図や背景を汲み取る
- ユーザーが本当に言いたかったことを理解する
- 文脈から重要なポイントを見抜く

### 2. クリエイティブな整理
- 論理的な構造で情報を整理する
- 必要に応じて箇条書きやカテゴリ分けを使う
- 関連する内容をグループ化する
- 時系列や優先度で並べ替える

### 3. 註釈の追加
- 【補足】として関連情報や背景知識を追記
- 【注意】として気をつけるべき点を明示
- 【ヒント】として役立つアドバイスを提案
- 註釈は控えめに、本当に有用なものだけ追加

### 4. まとめ直し
- 冗長な部分を簡潔にまとめる
- ポイントを明確に抽出する
- 読みやすく、後で見返しやすい形式にする

## フォーマット例

【要点】
・ポイント1
・ポイント2

【詳細】
整理された本文...

【補足】
関連する追加情報...

## 処理ルール
- フィラー（「えー」「あのー」等）は自然に除去
- 元の情報は漏らさず含める（削除しない）
- 追加する註釈は【】で明示して区別する
- 出力はまとめたテキストのみ（説明文は付けない）
- 内容が短い場合は簡潔にまとめる（無理に長くしない）`;


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

  const response = callGemini(systemPrompt, text, model, true);

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
 * Memo用のテキスト整形（クリエイティブAIまとめ）
 * @param {string} rawText - 音声入力の生テキスト
 * @returns {string} 整理・まとめ直されたテキスト
 */
function cleanMemoText(rawText) {
  const model = getMemoModel();

  // クリエイティブな出力のためtemperature 0.7を使用
  const response = callGemini(MEMO_SYSTEM_PROMPT, rawText, model, false, 0.7);

  // 余分な空白を整理
  return response.trim();
}

// ===========================================
// 音声文字起こし整形（Webアプリから呼び出し）
// ===========================================

const AI_CLEAN_TEXT_PROMPT = `次の音声書き起こしを、クリエイティブに整理してまとめ直してください。

## あなたの役割
1. 深い理解: 話の意図や背景を汲み取る
2. クリエイティブな整理: 論理的な構造化・箇条書き・カテゴリ分け
3. 註釈追加: 【補足】【注意】【ヒント】として有用な情報を追記
4. まとめ直し: 要約やポイント抽出

## 処理ルール
- フィラー（「えー」「あのー」等）は除去
- 元の情報は漏らさず含める
- 追加する註釈は【】で明示
- 内容が短い場合は簡潔に

テキスト:`;

/**
 * 音声文字起こしテキストを整形（Webアプリから呼び出し）
 * クリエイティブAIまとめ機能
 * @param {string} rawText - 音声入力の生テキスト
 * @returns {Object} { success: boolean, cleanedText: string, error?: string }
 */
function aiCleanText(rawText) {
  try {
    rawText = String(rawText || '').trim();
    if (!rawText) {
      return { success: true, cleanedText: '' };
    }

    const model = getMemoModel();
    const prompt = AI_CLEAN_TEXT_PROMPT + '\n' + rawText;

    // クリエイティブな出力のためtemperature 0.7を使用
    const response = callGemini('あなたは音声メモをクリエイティブに整理・まとめ直すAIアシスタントです。指示に従って整理・まとめ直したテキストのみを出力してください。', prompt, model, false, 0.7);

    return {
      success: true,
      cleanedText: (response || '').trim()
    };
  } catch (error) {
    console.error('aiCleanText error:', error);
    return {
      success: false,
      cleanedText: '',
      error: error.message
    };
  }
}
