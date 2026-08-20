# KOBAN ブラウザ確認版 v34

このフォルダは **index.html をそのままブラウザで開いてUIを確認できる版**です。

## 使い方
- `index.html` をChrome / Edgeで開く
- GitHub Pages / Netlify / Cloudflare Pages等の静的ホスティングにも、そのまま配置可能
- APIキーはブラウザ版には入れていません
- AI生成・AI解析は現在「ブラウザデモ用の仮レスポンス」です

## 本番接続
実AI生成まで行う場合は、v33の `server.mjs` をバックエンドとして併設し、
`index.html` の接続先をバックエンドの `/api/cut-images` に変更します。

## 注意
デモ画像はUI確認用の外部画像参照です。本番の参考画像検索は、利用規約・ライセンスを管理できる検索プロバイダーへ接続する前提です。


## v49
大容量資料のAI解析は同期処理ではなく、OpenAI Responses APIのBackground modeを使った非同期ジョブ方式です。ブラウザは小さな資料単位で解析ジョブを開始し、完了までポーリングします。
