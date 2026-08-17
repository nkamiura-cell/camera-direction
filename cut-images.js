import { openaiJson, parseJson } from './_lib/openai.js';

function promptFor(body, variant='') {
  return `
あなたは採用クリエイティブのアートディレクターです。
これは撮影前の「参考ビジュアル」です。広告完成素材ではありません。

案件情報:
${body.projectContext || ''}

カット:
${body.cutContext || ''}

ディレクターの追加指示:
${body.query || ''}

AIが整理した撮影意図:
${JSON.stringify(body.cutIntent || {}, null, 2)}

バリエーション:
${variant}

実写撮影で再現可能な、自然で上質な採用広報写真を作ってください。
人物・場所・構図・画角・光・余白を優先し、文字・ロゴ・透かしは入れないでください。
`;
}

async function generateOne(prompt, title) {
  const data = await openaiJson('/images/generations', {
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    prompt,
    size: '1536x1024',
    quality: 'high',
    output_format: 'png'
  });
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('画像生成結果を取得できませんでした。');
  return {
    src: `data:image/png;base64,${b64}`,
    title,
    source: 'AI生成',
    reason: '案件情報・台割・カット条件から生成した撮影参考ビジュアル'
  };
}

async function bingImages(query) {
  const key = process.env.BING_IMAGE_SEARCH_KEY;
  if (!key) return [];
  const url = new URL('https://api.bing.microsoft.com/v7.0/images/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '6');
  url.searchParams.set('safeSearch', 'Strict');
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Bing Image Search error: ${res.status}`);
  return (data.value || []).map((x, i) => ({
    src: x.contentUrl || x.thumbnailUrl,
    title: x.name || `Web参考 ${i + 1}`,
    source: 'Web参考',
    reason: `${x.hostPageDisplayUrl || x.displayUrl || 'Web'}｜実在する参考画像`,
    sourceUrl: x.hostPageUrl || x.hostPageDisplayUrl || '',
    provider: 'Bing Images'
  })).filter(x => x.src);
}


async function pinterestWebImages(query) {
  const key = process.env.BING_IMAGE_SEARCH_KEY;
  if (!key) return [];
  const pinterestQuery = `site:pinterest.com/pin/ ${query}`;
  const url = new URL('https://api.bing.microsoft.com/v7.0/images/search');
  url.searchParams.set('q', pinterestQuery);
  url.searchParams.set('count', '8');
  url.searchParams.set('safeSearch', 'Strict');
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Pinterest reference search error: ${res.status}`);
  return (data.value || []).map((x, i) => ({
    src: x.contentUrl || x.thumbnailUrl,
    title: `Pinterest｜${x.name || `参考画像 ${i + 1}`}`,
    source: 'Pinterest',
    reason: 'Pinterest上の参考ビジュアル',
    sourceUrl: x.hostPageUrl || x.displayUrl || '',
    provider: 'Bing Images → Pinterest限定検索',
    pinterestSearchUrl: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`
  })).filter(x => x.src);
}

async function makeWebQuery(body) {
  const data = await openaiJson('/responses', {
    model: process.env.OPENAI_TEXT_MODEL || 'gpt-5.6',
    input: `次の撮影カットを探すための日本語Web画像検索クエリを1つだけ作ってください。\n案件:${body.projectContext || ''}\nカット:${body.cutContext || ''}\n追加指示:${body.query || ''}\n条件:人物属性、職場、構図、写真トーンを含め、固有名詞や著作権作品名は必要な場合だけ。JSONのみ: {"query":"..."}`
  });
  return parseJson(data.output_text)?.query || body.query || '採用サイト 社員 仕事風景 オフィス';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = req.body || {};
    const mode = body.mode || 'mix';
    const candidates = [];
    if (mode === 'ai' || mode === 'mix') {
      const variants = [
        ['AI｜標準構図', 'balanced commercial composition'],
        ['AI｜引きの構図', 'wider environmental composition showing the workplace'],
        ['AI｜演出強め', 'stronger light and atmosphere while remaining realistic']
      ];
      const generated = await Promise.all(variants.map(([title, variant]) => generateOne(promptFor(body, variant), title)));
      candidates.push(...generated);
    }
    if (mode === 'web' || mode === 'mix') {
      const q = await makeWebQuery(body);
      // Pinterest is a preferred visual-reference source, not a user-facing mode.
      candidates.push(...await pinterestWebImages(q));
      candidates.push(...await bingImages(q));
    }
    return res.status(200).json({ candidates });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'image provider failed' });
  }
}
