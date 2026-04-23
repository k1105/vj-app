# vj-app — Claude 作業ガイド

このファイルは、次のセッションの Claude が前提知識ゼロで開発を継続するためのガイド。

## このアプリは何か

DJ Hata × 山岸の VJ パフォーマンス用 Electron アプリ。4/29 White Space Lab（渋谷）イベントが直近の本番。

- 仕様書: [`../drafts/2026-04-04_system-spec-v1.md`](../drafts/2026-04-04_system-spec-v1.md) — これが正。迷ったら読む
- 設計の全体像: [`./ARCHITECTURE.md`](./ARCHITECTURE.md)
- プロジェクト状況: [`../status.md`](../status.md)
- UI プロトタイプ（参照用）: [`../drafts/controller-ui-v6.html`](../drafts/controller-ui-v6.html) + `controller-ui-v6.css`
- 過去の決定事項: [`../drafts/2026-04-04_system-spec-v1.md`](../drafts/2026-04-04_system-spec-v1.md) 内の未決事項セクションと status.md の決定事項ログ

## スタック

- Electron + electron-vite（HMR）
- TypeScript（strict）
- Controller: React 18 + zustand
- Output: Three.js（素の WebGLRenderer、React 使わない）
- electron-store（設定永続化）
- yt-dlp（外部バイナリ。`brew install yt-dlp`、同梱しない）

## プロセス・ウィンドウ構成

```
Main ───┬── Controller Window (React UI)     … 操作用
        └── Output Window (Three.js Composer) … セカンダリモニター/プロジェクター
```

- Controller が state の source of truth（zustand）
- 状態変更は `window.vj.sendStateUpdate(state)` で Main へ → Main が Output に broadcast
- Output は状態を受信して Composer.updateState() に渡す
- IPC チャネル名は `src/shared/types.ts` の `IPC` 定数で一元管理

## ディレクトリ

```
vj-app/
├── ARCHITECTURE.md
├── CLAUDE.md                    ← このファイル
├── README.md
├── package.json
├── electron.vite.config.ts
├── tsconfig.{json,node,web}.json
├── .gitignore
├── src/
│   ├── main/                    ← Main process
│   │   ├── index.ts             ← app entry
│   │   ├── windows.ts           ← Controller + Output ウィンドウ生成
│   │   ├── ipc.ts               ← ipcMain.handle/on
│   │   ├── pluginLoader.ts      ← plugins/postfx/transitions を scan + fs.watch
│   │   ├── videoDownloader.ts   ← yt-dlp spawn
│   │   └── store.ts             ← electron-store
│   ├── preload/
│   │   ├── index.ts             ← contextBridge で window.vj API 公開
│   │   └── index.d.ts
│   ├── renderer/                ← Controller (React)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/          ← TopBar / AssetsPanel / LayerStack / AssetParamsPanel / TransportBar
│   │   ├── state/vjStore.ts     ← zustand
│   │   └── styles/app.css       ← v6 テーマ（蛍光コンソール配色、flat）
│   ├── output/                  ← Output (Three.js)
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── Composer.ts          ← WebGLRenderer + レンダリングループ
│   ├── core/                    ← プラグインから import される共通ユーティリティ
│   │   ├── rhythm.ts            ← beatPosition / barPosition / beatSync / beatPulse / easeByBeat
│   │   ├── dispose.ts           ← disposeObject3D / disposeMaterial / disposeVideo
│   │   ├── easing.ts
│   │   └── texture.ts           ← createRenderTarget / createVideoTexture
│   └── shared/
│       └── types.ts             ← IPC定数 / VJState / PluginMeta / LayerState / DownloadResult
├── plugins/                     ← 素材プラグイン（自動スキャン対象）
│   └── example-particles/       ← 参考実装
├── postfx/                      ← ポスト FX シェーダー
├── transitions/                 ← トランジションシェーダー
└── materials/videos/            ← yt-dlp ダウンロード先（.gitignore 済）
```

## 開発フロー

```bash
cd projects/hatakanata-vj/vj-app
npm install            # 初回のみ
npm run dev            # Controller + Output の 2 ウィンドウが起動
npm run typecheck      # 型だけ確認（main と renderer を別々に）
npm run build          # 本番ビルド
```

**npm install はまだ実行していない**（2026-04-11 時点）。初めて `npm run dev` する前に必ず実行する。

## プラグインシステム（仕様書 v1.2 準拠）

3 種類すべて `manifest.json + 実装` の統一パターン。`src/main/pluginLoader.ts` が `plugins/` `postfx/` `transitions/` をスキャンして `PluginMeta[]` を返す。Controller が IPC 経由で取得。

### 素材プラグイン（plugins/）

- `manifest.json`: name, outputType (`three` | `canvas` | `video`), params, inputs?, entry
- 実装クラスに `setup(ctx)`, `update({global, params, inputTextures?})`, `dispose()` を実装
- **dispose() は必須**。メモリリーク対策（3/27 CIRCUS TOKYO で起きた事故の再発防止）
- 参考実装: `plugins/example-particles/`

### PostFX / Transitions

- `manifest.json + shader.frag`
- Composer の EffectComposer にパスとして挿入（今はまだ未実装）

## メモリリーク対策（**最優先**）

- 3/27 CIRCUS TOKYO 本番でメモリリークによる機材トラブルが発生。原因は特定済み
- **すべての素材プラグインで `dispose()` 実装を必須化**
- `src/core/dispose.ts` のヘルパを使う
- Video: `pause() → removeAttribute("src") → load()` の順（`disposeVideo` ヘルパ）
- Three.js: geometry / material / texture を個別に dispose
- 本番前に **30分連続稼働テスト必須**

## 状態モデル（`src/shared/types.ts`）

```ts
interface VJState {
  bpm: number
  beat: number   // 0-1
  bar: number    // 0-1
  audio: { volume, bass, mid, high }
  layers: LayerState[]        // 現状 4 枚
  selectedLayer: number
  transition: { type, progress }
  postfx: [...]
}
```

- Controller の zustand が唯一の source of truth
- 変更は 16ms debounce で Output に broadcast（`vjStore.broadcastState`）

## 実装の進捗

### 完了
- [x] scaffold（electron-vite + React + Three.js + TypeScript）
- [x] 2 ウィンドウ生成と IPC の配線
- [x] pluginLoader（scan + fs.watch）
- [x] videoDownloader（yt-dlp spawn + 進捗 IPC）
- [x] Controller UI の骨格（v6 テーマ適用）
- [x] Output の Composer 雛形（プレースホルダシェーダ）
- [x] core/ ユーティリティ
- [x] example-particles プラグイン

### 未着手（優先度順）
1. **Composer の PluginHost** — manifest → dynamic import → setup/update/dispose のライフサイクル管理
2. **レイヤーブレンド** — 各プラグインを renderTarget に描画 → カスタムシェーダでブレンド
3. **BPM tap + beat/bar 生成** — TopBar / TransportBar の TAP ボタンを実装、`core/rhythm.ts` を使う
4. **Web Audio 解析** — AnalyserNode で volume/bass/mid/high を算出して VJState.audio に流す
5. **Transitions** — crossfade / cut / wipe / dissolve
6. **PostFX チェーン** — bloom / glitch / rgb-shift 等
7. **Web MIDI** + MIDI ラーニング
8. **yt-dlp ボタンの配線**（Controller 側は UI だけある）
9. **dispose 検証** / 30分連続稼働テスト

## コード規約・作業ルール

- **依頼された範囲だけ修正する**。周辺コードの「改善」をしない（`work/CLAUDE.md` に従う）
- ファイル変更したら返答より先に `git add → commit → push`（`.claude/rules/push-first.md`）
- 外部ライブラリを使うときは Context7 MCP で公式ドキュメント確認
- UI は v6 の CSS（蛍光色コンソール配色、flat）を維持。グラデや inset shadow などの疑似3D表現は使わない
- TypeScript strict。`any` は避ける
- React コンポーネントは関数 + hooks
- zustand selector は必要最小限（`s.state.layers` のように部分選択してリレンダ抑制）

## 既知の注意点

- `electron.vite.config.ts` は `src/renderer/` を renderer root にしているが、`src/output/` も同じ rollup input に含めている。両 html が同じ dist に並ぶ
- Output は React を使わず素の Three.js。分離は意図的（パフォーマンスと disposability）
- `pluginLoader.ts` のプラグイン root は dev では `process.cwd()` 依存。プロダクションビルドでは `process.resourcesPath/app-plugins` を見る（electron-builder の extraResources 設定で配る想定、未設定）
- `@shared/*` `@core/*` alias は main/preload/renderer 全てで有効
- `src/preload/index.d.ts` の `window.vj` 型は preload が export する `VJApi` 型を参照。preload を編集したら型が自動追従する

## 参考になるドラフト

- `drafts/controller-ui-v6.html` + `.css` — UI プロトタイプ。配色・レイアウトはここが基準
- `drafts/video-plugin-spec.md` — Video プラグイン + yt-dlp 連携の仕様
- `drafts/2026-04-04_system-spec-v1.md` — システム全体仕様 v1.2

## わからないことがあったら

- 仕様の疑問 → `drafts/2026-04-04_system-spec-v1.md` を読む
- 進捗の確認 → `../status.md`
- 山岸さんに聞く（推測で進めない）
