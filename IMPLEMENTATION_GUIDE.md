# 段階別 設計指示（Coding Agent向け）

本ドキュメントは `AI_CALENDAR_SPEC.md` およびスプレッドシートテンプレート構造に完全準拠した実装手順書である。

---

## Phase 0：前提固定（必ず守る）

1. **ページは2つのみ**
   - UI_Calendar と UI_Memo

2. **DBはこの2つが主**
   - DB_Events（予定）
   - DB_Memos（メモ）

3. **AIの役割**
   - Calendar：予定情報の抽出（JSON化）
   - Memo：自然文の整形（要約・箇条書き禁止）

4. **追記ルール（メモ）**
   - 既存末尾に `\n\n` で追記がデフォルト

---

## Phase 1：GAS基盤（動く骨組みを作る）

### 1-1. スクリプトプロパティ定義

- `OPENAI_API_KEY`
- `OPENAI_MODEL_CALENDAR`（例：gpt-4o-mini）
- `OPENAI_MODEL_MEMO`（例：gpt-4o-mini）
- `TIMEZONE`（Settings!B5 参照 or 直書きで Asia/Tokyo）
- `SHEET_ID`（必要なら）

### 1-2. シート取得ヘルパー

- `getSheet(name)`
- `getSettings()`（Settingsから値を読み込む）

### 1-3. ID生成ヘルパー

- `newEventId()` → `evt_YYYYMMDD_HHMMSS_rand`
- `newMemoId()` → `mem_YYYYMMDD_HHMMSS_rand`
- `newLogId()` → `log_...`

---

## Phase 2：UI操作の入口（ユーザーが押せる導線を作る）

※ スプレッドシート内の「ボタン風セル」はクリック検知が弱いので、まずは確実な導線にする

### 2-1. カスタムメニューを追加（必須）

`onOpen()` で以下を出す：

**AIカレンダー**
- 「予定：音声/テキストから登録」
- 「メモ：音声/テキストから追記」
- 「選択日を今日に戻す」
- 「ログを見る（任意）」

（後で余裕があればボタン風セルに寄せる）

### 2-2. 入力UIの形式（最初は確実に）

- `SpreadsheetApp.getUi().prompt()` でテキスト入力を受ける
- 音声は後でWebアプリ or サイドバーに実装でもOK
- ただし `UI_Calendar!I5` / `UI_Memo!A21` に raw を貼り付けて動作する形でもOK

---

## Phase 3：予定登録（Calendar）を先に完成させる

### 3-1. Calendar解析プロンプトを固定

- **入力**：ユーザー発話テキスト
- **出力**：必ずJSON（スキーマ固定）

#### 出力スキーマ（必須）

```json
{
  "title": "string",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "start_time": "HH:MM|null",
  "end_time": "HH:MM|null",
  "all_day": true|false,
  "memo": "string|null"
}
```

#### ルール

- titleが取れない → titleを空にせず、代替案を入れるか、エラー扱いして再入力要求
- 時間が曖昧 → null
- 単日予定は `start_date = end_date`
- 期間予定は `end_date` を延長

### 3-2. parseCalendarText(text) を作る

- OpenAI API呼び出し
- JSONパース
- バリデーション
  - start_date/end_date が妥当か
  - titleが空でないか

### 3-3. insertEventToDB(eventObj, rawText)

**書き込み先：DB_Events**

| カラム | 値 |
|--------|-----|
| event_id | 自動生成 |
| created_at | 現在時刻 |
| updated_at | 空でもOK |
| source | "voice" or "text" |
| raw_text | 元の入力 |
| title | AI抽出 |
| start_date | AI抽出 |
| end_date | AI抽出 |
| start_time | AI抽出 |
| end_time | AI抽出 |
| all_day | AI抽出 |
| memo | AI抽出 |
| status | active固定 |
| last_ai_model | 使用モデル |

**書き込み後にやること**
- UI_Calendar の表示月に該当するならユーザーに「登録完了」通知（toast）

---

## Phase 4：メモ（Memo）を完成させる

### 4-1. メモ整形AIのプロンプトを固定

- **入力**：raw_transcript（雑音入り）
- **出力**：整形済み自然文（テキスト）

#### 禁止事項を明文化

- 要約しない
- 箇条書きにしない
- 情報を追加しない
- 意味を変えない

### 4-2. cleanMemoText(raw) を作る

- OpenAI呼び出し
- 返却はプレーンテキスト

### 4-3. appendMemo(date, cleanedText, rawText)

**書き込み先：DB_Memos**

- 指定日が既にあるか確認
  - **ある**：memo_text に `\n\n` で追記
  - **ない**：新規行追加
- raw_transcript / cleaned_text は最後の入力を保存（ログ用途）
- updated_at 更新

**UI連動**
- UI_Memo!C3の日付で動いているので、そこに対して追記した結果が見える

---

## Phase 5：UIの"矢印日付移動"を実現する

### 5-1. 日付移動は最初はメニューで確実に

- 「メモ：前日へ」「メモ：翌日へ」
- → UI_Memo!C3 を ±1日する

### 5-2. 余裕があれば onEdit でセルクリック検知

- UI_Memo!A3 / D3 が編集されたら前日/翌日に動かす
- （ただし誤爆しやすいので後回しでもOK）

---

## Phase 6：コピー機能（設計通りに）

スプレッドシート単体で「クリップボードへコピー」は制約があるので、最短ルートを推奨：

### 推奨実装（迷わない）

1. サイドバー（HTML）を開き
2. メモ本文をHTML側に表示
3. 「コピー」ボタンで `navigator.clipboard.writeText()` 実行

### Phase 6ではまず

- メニュー「メモをコピー用に表示（サイドバー）」を作る
- サイドバーに本文＋コピーボタン

---

## Phase 7：ログ（任意だがデバッグに超効く）

**DB_Log に書き込む項目**

| カラム | 説明 |
|--------|------|
| timestamp | 実行時刻 |
| page | calendar / memo |
| transcript_raw | 入力テキスト |
| ai_output | AI出力 |
| action | insert_event / append_memo |
| result | success / fail |
| error_message | エラー時のメッセージ |

---

## 受け入れ基準（完成判定）

最低限これが通れば「MVP完成」

1. テキスト入力→AI解析→ DB_Events に登録できる
2. UI_Calendar の日付セルにタイトルが出る
3. テキスト入力→AI整形→ DB_Memos に追記できる
4. UI_Memo が日付でメモを切り替えて見られる
5. サイドバーでメモ全文コピーができる

---

## コーディングエージェントへの「最初のタスク割り当て」

**順番はこれで固定：**

1. onOpen メニュー
2. OpenAI呼び出し共通関数
3. Calendar解析→DB登録
4. Memo整形→DB追記
5. メモ日付移動（メニュー）
6. コピー（サイドバー）
7. ログ
