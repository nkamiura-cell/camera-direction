# KOBAN AI v35

撮影設計AIのブラウザ版＋Vercel Functions実装です。

## 今回実装した実AI機能

1. **OpenAIによる画像生成**
   - `/api/cut-images`
   - GPT Image 2 を使用
   - 標準／引き／演出強めの3候補
   - 案件情報・台割・撮影意図・ディレクター指示をプロンプトへ統合

2. **資料アップロード＋AI解析**
   - `/api/project-materials`
   - PDF / PPTX / DOCX / TXT / 画像を受け付け
   - OpenAI Files APIへアップロード
   - Responses APIで案件前提と台割の素材領域を抽出
   - 写真／動画／図版、ページ、正規化座標、用途、信頼度をJSONで返す
   - ブラウザ上の台割プレビューへ領域をオーバーレイ表示

3. **台割の画像領域解析**
   - AIがページ上の素材領域を `x / y / width / height` の正規化座標で返す
   - ディレクターが既存UI上で領域をクリックして種類を修正できる
   - Figma `.fig` は直接解析対象にせず、PDF / PNG等に書き出して追加する運用

4. **Web画像検索**
   - `/api/cut-images` の `mode=web|mix`
   - Bing Image Search APIを任意接続
   - 検索クエリはAIがカット条件から生成
   - 画像URL・出典ページURL・プロバイダー情報を保持
   - `BING_IMAGE_SEARCH_KEY` が未設定ならAI生成のみで動作

5. **AIによる撮影順最適化**
   - `/api/shooting-order`
   - 共通の最優先条件を固定：
     - 出演者の拘束時間を最小化
     - 撮影場所の移動を最小化
   - A：出演者拘束をさらに優先
   - B：移動をさらに優先
   - C：バランス
   - 「Aさんは11時まで」「役員は13時以降」などの現場メモをハード制約として扱う
   - 3案をポップアップへ返し、既存UIで選択・手動調整可能

## Vercel設定

Vercelの Project Settings → Environment Variables に以下を設定します。

- `OPENAI_API_KEY` = OpenAI API key
- `OPENAI_TEXT_MODEL` = `gpt-5.6`
- `OPENAI_IMAGE_MODEL` = `gpt-image-2`
- `BING_IMAGE_SEARCH_KEY` = 任意（Web画像検索を使う場合）

**APIキーをHTMLやGitHubへ書かないでください。** VercelのEnvironment Variablesに設定します。

## GitHub → Vercel

このフォルダをGitHubリポジトリのルートへ配置してVercelからImportします。

- `index.html` がルート
- `api/*.js` がVercel Functions
- `package.json` は必要な `busboy` のみ
- `vercel.json` でFunctionsの実行時間を設定

## 注意

- VercelのプランによってFunctionの実行時間・リクエストサイズ上限が異なります。大容量PDFは後でブラウザ→ストレージ→解析APIの分離を検討します。
- Web画像は権利処理済み素材ではありません。候補選定用の参考画像として扱い、実制作で利用する場合は出典・ライセンスを確認してください。
- AIによる台割領域検出は候補生成です。座標は正規化された推定値なので、最終的な領域確定はディレクターが行う設計です。


## v36 変更：Pinterestを優先参照ソースとして強化
- ③の画像候補で「Pinterestを優先」検索を独立ボタン化
- AIが整理した撮影意図から検索クエリを作り、Pinterest限定検索（`site:pinterest.com/pin/`）を実行
- Pinterest候補は `source=Pinterest` とPinterest検索ページURLを保持
- 「AI＋Web」でもPinterest候補を先に取得してから一般Web候補を追加
- Pinterest APIについては、現行の公式APIドキュメントで確認できる読み取り機能がアカウント／Pin中心であるため、公開Pinの一般検索はAPIであると偽装せず、画像検索プロバイダーのPinterest限定検索として実装
- Pinterest API v5自体は公式に提供されており、アプリ接続・承認とアクセストークンが必要。必要になれば「自社アカウントのボード／Pin参照」を別機能として追加できる


## v37 変更：PinterestをUIから隠し、検索ロジックで優先
- 「Pinterestを優先」などの独立ボタンを削除
- ディレクターは従来どおり通常の「AI＋Web / Web」検索を使うだけ
- Web画像を探す際、バックエンドがPinterest限定検索を先に実行し、その後に一般Web検索を実行
- Pinterestは「選択肢」ではなく「AIが積極的に参照するソース」という位置付け
