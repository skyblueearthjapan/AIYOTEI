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
  console.log(`[callGemini] model=${model} keyTail=...${String(apiKey).slice(-6)} jsonMode=${jsonMode}`);
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

  // リトライ設定：429/500/503は指数バックオフで最大4回試行
  const MAX_ATTEMPTS = 4;
  const RETRY_STATUSES = [429, 500, 502, 503, 504];
  let lastResponseCode = 0;
  let lastResponseText = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      const result = JSON.parse(responseText);
      if (result.candidates && result.candidates[0] && result.candidates[0].content) {
        return result.candidates[0].content.parts[0].text;
      }
      throw new Error('Gemini APIから有効なレスポンスが返されませんでした');
    }

    lastResponseCode = responseCode;
    lastResponseText = responseText;

    // リトライ可能なエラーかつ最終試行でない場合は待機して再試行
    if (RETRY_STATUSES.indexOf(responseCode) >= 0 && attempt < MAX_ATTEMPTS) {
      const waitMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      console.warn(`Gemini API ${responseCode} (attempt ${attempt}/${MAX_ATTEMPTS}) - retry in ${waitMs}ms`);
      Utilities.sleep(waitMs);
      continue;
    }

    // リトライ不可エラー、または最終試行失敗
    break;
  }

  console.error('Gemini API Error:', lastResponseText);
  throw new Error(`Gemini APIエラー (${lastResponseCode}): ${parseGeminiError(lastResponseText)}`);
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
5. 【年の決定（最重要）】今日は {{TODAY}}（YYYY-MM-DD形式）。
   - ユーザーが西暦・年を明示していない場合は、必ず「今日以降で最も近い日付」を選ぶこと。過去の年（昨年・一昨年など）には絶対にしない。
   - 例: 今日が 2026-05-30 で入力が「6月2日」なら start_date は 2026-06-02。2024-06-02 や 2025-06-02 にしてはいけない。
   - 「来年」「再来年」など年を示す語がある場合のみ、その年にする。
   - 出力する start_date / end_date の年は、必ず {{TODAY}} の年以上にすること。
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

  // 年の保険補正：AIが年を誤解釈して過去日になった場合、今日以降の最も近い年に補正する
  // （MyCalendarは未来の予定を入力する用途のため、過去日は年の取り違えとみなす）
  correctEventYearIfPast(data);

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
 * 年の取り違え保険：start_dateが今日より過去なら、同じ月日で今日以降の最も近い年に補正する。
 * end_dateにも同じ年差を適用して期間（連泊など）を保つ。
 * AIが年なし入力（「6月2日」等）を過去年に解釈する誤りへの安全網。
 * @param {Object} data - start_date / end_date を持つ解析データ
 */
function correctEventYearIfPast(data) {
  const pad2 = (n) => String(n).padStart(2, '0');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.start_date)) return;

  const today = getTodayDate(); // YYYY-MM-DD（Asia/Tokyo）
  if (data.start_date >= today) return; // 過去でなければ補正不要

  const todayYear = parseInt(today.slice(0, 4), 10);
  const [sy, sm, sd] = data.start_date.split('-').map(Number);

  // start_dateの月日を、今日以降になる最小の年に割り当てる
  let newYear = todayYear;
  if (`${newYear}-${pad2(sm)}-${pad2(sd)}` < today) {
    newYear = todayYear + 1;
  }

  const yearDelta = newYear - sy;
  if (yearDelta <= 0) return;

  console.warn(`[correctEventYearIfPast] 過去日を補正: ${data.start_date} -> 年+${yearDelta}`);
  data.start_date = `${sy + yearDelta}-${pad2(sm)}-${pad2(sd)}`;

  if (/^\d{4}-\d{2}-\d{2}$/.test(data.end_date)) {
    const [ey, em, ed] = data.end_date.split('-').map(Number);
    data.end_date = `${ey + yearDelta}-${pad2(em)}-${pad2(ed)}`;
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

// ===========================================
// ノート用 3段階AIパイプライン
// ===========================================

// --- Stage 1: 文字起こしクリーンアップ ---
const NOTE_STAGE1_PROMPT = `あなたは文字起こし校正者です。

## 目的
音声認識テキストを、意味を変えずに読みやすく整える。
忠実性を最優先し、要約・再構成・情報追加はしない。

## 処理内容
1. フィラーの除去（「えー」「あー」「えっと」「まあ」「なんか」「あのー」「うーん」等）
2. 音声認識による明らかな誤変換のみ修正する
3. 句読点を適切に補う
4. 文法を最小限だけ整える
5. 不自然な重複や言い直しを整理する
6. 原文の文順は基本的に維持する

## 保持すべき情報（必ず残す）
- 人名・固有名詞
- 日付・時刻
- 数量・金額
- 期限
- 否定表現（〜しない、〜ではない）
- 不確実表現(たぶん、かも、未定、検討中)
- 比較表現(増えた、減った、前回より)

## 禁止事項
- 情報の追加（原文にない内容を足さない）
- 情報の削除（原文にある内容を消さない）
- 意味の言い換え（口語接続を綺麗にしすぎない）
- 構造化(箇条書き化、見出し化をしない)
- 原文にない断定表現への変更
- 文の意味・因果・時制・主語を推測して補わない
- 曖昧な表現は曖昧なまま残す
- 要約しない、段落を再編しない

## 出力
校正後テキストのみを返す（説明文は付けない）`;

// --- Stage 2: 構造化・まとめ ---
const NOTE_STAGE2_PROMPT = `あなたは編集者です。

## 目的
校正済みテキストを読み、内容に最も適した形式に整理する。
原文の情報を過不足なく整理し、推測で補完しない。

## 分類ルール（上から順に判定）
1. 実行すべき項目の列挙が中心 → A: TODO・タスク系
2. 複数人の議論・決定・相談が中心 → B: 会議・相談系
3. 発想・提案・構想・改善案が中心 → C: アイデア・企画系
4. 出来事・状況説明・経過報告が中心 → D: 報告・記録系
5. 短い覚書・断片的メモ・分類困難な短文 → E: メモ・雑記

## AとEの違い
- A: 実行すべき項目が中心（例：「牛乳、洗剤、電球買う」）
- E: 単なる覚書・感想・参照情報（例：「駅前のパン屋、火曜休み」）

## 混在時の優先ルール
- 会議内容の中にタスクが含まれる → Bを優先
- アイデアの中に実行項目がある → Cを優先し、補足にアクションを記載
- 判定が難しい短文 → E

## 出力形式

### A: TODO・タスク系
□ タスク1
□ タスク2
□ タスク3

### B: 会議・相談系
【要点】
・ポイント

【決定事項】
・決まったこと

【アクション】
・動詞で始める（原文に根拠があるもののみ）

【課題】
・未解決事項のみ

### C: アイデア・企画系
【概要】
一言でまとめ

【ポイント】
1. ポイント

【補足】
追加情報

### D: 報告・記録系
【状況】
何が起きたか

【対応】
何をしたか／すべきか

【備考】
補足情報

### E: メモ・雑記
・内容1
・内容2

## 共通ルール
- 原文にない情報を追加しない
- 期限・担当者・数値を推測で補わない
- 原文にない期限は書かない（「来月まで」を「来月末」にしない等）
- 決定事項と推測を混同しない
- アクションは原文に根拠があるものだけ抽出する
- 空になるセクションは無理に作らず省略する
- 各項目は簡潔に1行ずつ記載する
- 内容が短い場合は無理に構造化せず簡潔にまとめる

## 出力
最適な1パターンのみで構造化した結果を返す（説明文は付けない）`;

// --- Stage 3: タイトル生成 ---
const NOTE_STAGE3_PROMPT = `あなたはタイトル生成者です。

## 目的
内容の主題を短く表すタイトルを1つ生成する。
本文の要約ではなく、主題のラベル化を行う。

## ルール
- できるだけ10文字以内にする
- 必要な場合のみ15文字以内まで可
- 内容の本質を表す名詞句にする
- 日付や時刻は含めない
- 「メモ」「ノート」「記録」単独は禁止
- ただし「会議メモ」「買い物メモ」など内容語を含む複合語は可

## 例
- 買い物リストの内容 → 「買い物リスト」
- プロジェクト会議の内容 → 「PJ会議メモ」
- 引越しの準備タスク → 「引越し準備」
- 新サービスのアイデア → 「新サービス案」
- 体調についてのメモ → 「体調メモ」
- 見積提出の確認 → 「見積提出確認」
- 訪問看護シフトの修正 → 「訪看シフト修正」

## 出力
タイトルのみを返す（説明文・引用符・括弧は付けない）`;

/**
 * ノート用3段階AIパイプライン
 * Stage 1: クリーンアップ → Stage 2: 構造化 → Stage 3: タイトル生成
 * @param {string} rawText - 音声入力の生テキスト
 * @param {string} currentTabName - 現在のタブ名（デフォルト名判定用）
 * @param {number} noteId - ノートID（デフォルト名判定用）
 * @returns {Object} { success, cleanedText, structuredText, title, autoTitle }
 */
function processNoteAI(rawText, currentTabName, noteId) {
  try {
    rawText = String(rawText || '').trim();
    if (!rawText) {
      return { success: true, cleanedText: '', structuredText: '', title: '', autoTitle: false };
    }

    const model = getMemoModel();

    // --- Stage 1: クリーンアップ ---
    console.log('Note AI Stage 1: Cleanup');
    const stage1Result = callGemini(NOTE_STAGE1_PROMPT, rawText, model, false, 0.1);
    const cleanedText = (stage1Result || '').trim();

    // --- Stage 2: 構造化 ---
    console.log('Note AI Stage 2: Structure');
    const stage2Result = callGemini(NOTE_STAGE2_PROMPT, cleanedText, model, false, 0.5);
    const structuredText = (stage2Result || '').trim();

    // --- Stage 3: タイトル生成（デフォルト名の場合のみ） ---
    let title = '';
    let autoTitle = false;
    const defaultNames = getDefaultNoteNames();
    const isDefaultName = defaultNames.indexOf(currentTabName) >= 0;

    if (isDefaultName && structuredText) {
      console.log('Note AI Stage 3: Title generation');
      const stage3Result = callGemini(NOTE_STAGE3_PROMPT, structuredText, model, false, 0.3);
      title = (stage3Result || '').trim().substring(0, 20);
      autoTitle = !!title;
    }

    return {
      success: true,
      cleanedText: cleanedText,
      structuredText: structuredText,
      title: title,
      autoTitle: autoTitle
    };
  } catch (error) {
    console.error('processNoteAI error:', error);
    return {
      success: false,
      cleanedText: '',
      structuredText: '',
      title: '',
      autoTitle: false,
      error: error.message
    };
  }
}
