# MyAthanor

個人用リソース・アイデア管理ツール（MVP）。

日々の思いつき（**アイデア**）と出来事（**ログ**）を記録し、そこから
**ミッション**を切り出して、消費する **タイム／ウォレット** を見積もる。
ミッションを完了するとログが自動生成され、見積もりが消費予定から消費済みへ移る。
ホームの縦型タンクで「消費済み・消費予定・残量」を常時把握できる。

## 起動

```bash
npm install
npm start          # http://0.0.0.0:3000
```

| 環境変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | `3000` | 待ち受けポート |
| `HOST` | `0.0.0.0` | 待ち受けアドレス |
| `DB_PATH` | `data/myathanor.db` | SQLite ファイルの場所 |

`npm run dev` はファイル変更で自動再起動する。

DB は初回起動時に自動作成される。バックアップは `data/` をコピーすれば足りる。

### スマホから使う

`0.0.0.0` で待ち受けているので、ホストPCの Tailscale アドレスに
`http://<tailscale-name>:3000` でアクセスする。認証は持たない
（要件どおり Tailscale のネットワーク層制限のみを前提とする）ので、
**Tailnet の外に公開しないこと**。

### 常時起動させる

ノートPC で常駐させる場合の systemd user unit の例:

```ini
# ~/.config/systemd/user/myathanor.service
[Service]
WorkingDirectory=/path/to/MyAthanor
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server.js
Restart=always

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now myathanor
loginctl enable-linger "$USER"   # ログアウト後も動かす
```

## 構成

```
server.js          Express アプリ（API + 静的配信 + SPA フォールバック）
src/db.js          SQLite 接続とスキーマ
src/period.js      週（月曜始まり）／月の集計期間
src/store.js       データアクセスと状態遷移
src/routes.js      REST API
public/            Web UI（ビルド不要の ES モジュール）
```

依存は Express のみ。SQLite は Node 22 標準の `node:sqlite` を使うため
ネイティブビルドは発生しない（Node 22.5 以上が必要）。

## 単位の扱い

- **タイム**: DB には**分**の整数で保持し、UI は**時間**で表示・入力する
- **ウォレット**: **円**の整数

## リソースの集計

| | 集計対象 | 期間 |
|---|---|---|
| 消費済み | `log.time_spent` / `log.money_spent` の合計 | タイムは今週（月曜始まり）、ウォレットは当月 |
| 消費予定 | 進行中ミッションの見積もりの合計 | 期間で絞らない（これからやることのため） |
| 残量 | 可処分 − 消費済み − 消費予定 | ＝「進行中ミッションを全て完了した場合の残量」 |

期間の境界はサーバのローカルタイムゾーンで判定する。

## API

| メソッド | パス | 内容 |
|---|---|---|
| `GET` | `/api/stream?type=all\|idea\|log` | アイデアとログの時系列 |
| `POST` | `/api/entries` | `{kind, title}` で新規追加 |
| `GET` `PATCH` | `/api/ideas/:id` | アイデア詳細／タイトル編集 |
| `GET` `PATCH` | `/api/logs/:id` | ログ詳細／タイトル・実消費の編集 |
| `GET` `POST` | `/api/missions` | 一覧（`?status=active\|abandoned\|done`）／作成 |
| `GET` `PATCH` | `/api/missions/:id` | 詳細／編集 |
| `POST` | `/api/missions/:id/complete` | 完了。ログを自動生成し見積もりを確定 |
| `POST` | `/api/missions/:id/abandon` | 断念。消費予定から除外 |
| `POST` | `/api/missions/:id/reopen` | 断念を取り消して進行中に戻す |
| `GET` `PUT` | `/api/settings` | 週あたりタイム／月あたりウォレット |
| `GET` | `/api/summary` | ホームのタンク用の集計 |

## MVP の範囲

要件定義の 6.1〜6.5 を実装している。

- ストリーム（種別フィルタ、＋からの追加）
- アイデア／ログ詳細（タイトル編集、ミッション追加、紐づくミッション一覧）
- ミッション（ステータス別フィルタ、元エントリへのリンク、完了／断念）
- ホーム（タイム／ウォレットの縦型タンク、全完了時の残量）
- 設定（週あたりの可処分タイム、月あたりの可処分ウォレット）

要件に無いが操作の行き止まりを避けるために足したもの:

- ログ詳細での実消費（タイム／ウォレット）の入力 — 「ログ直接入力で確定」する経路
- 断念したミッションを進行中に戻す操作

フェーズ2以降（タグ、アイデアの温度、ローカルLLM、収支登録など）は未実装。
