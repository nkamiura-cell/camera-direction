import Busboy from 'busboy';
import { openaiJson, uploadOpenAIFile, parseJson } from './_lib/openai.js';

function ext(name=''){ return (name.split('.').pop()||'').toLowerCase(); }
function isImage(mime='',name=''){ return mime.startsWith('image/') || ['jpg','jpeg','png','webp','gif'].includes(ext(name)); }
function isSupported(name,mime=''){ return isImage(mime,name) || ['pdf','ppt','pptx','doc','docx','txt','md'].includes(ext(name)); }

function parseMultipart(req){
  return new Promise((resolve,reject)=>{
    let bb;
    try{ bb=Busboy({headers:req.headers, limits:{files:1, fileSize:3.2*1024*1024}}); }
    catch(e){ reject(e); return; }
    const files=[]; const fields={};
    bb.on('field',(n,v)=>{ if(!fields[n])fields[n]=[]; fields[n].push(v); });
    bb.on('file',(name,file,info)=>{
      const chunks=[]; let tooLarge=false;
      file.on('data',d=>chunks.push(d));
      file.on('limit',()=>{tooLarge=true;});
      file.on('end',()=>files.push({field:name,filename:info.filename,mimeType:info.mimeType,buffer:Buffer.concat(chunks),tooLarge}));
    });
    bb.on('error',reject); bb.on('close',()=>resolve({fields,files})); req.pipe(bb);
  });
}

function contentForFiles(uploaded){
  return uploaded.flatMap(f=>[
    {type:'input_text',text:`\n--- FILE: ${f.filename} | ROLE HINT: ${f.role==='auto'?'AIで判定':f.role} ---\n`},
    isImage(f.mimeType,f.filename)
      ? {type:'input_image',file_id:f.fileId,detail:'high'}
      : {type:'input_file',file_id:f.fileId}
  ]);
}


function flattenLayoutMaps(parsed){
  if(!parsed || !Array.isArray(parsed.layoutMaps)) return parsed;
  const out=[];
  for(const lm of parsed.layoutMaps){
    for(const pg of (lm.pages||[])){
      const b=pg.bbox||{x:0,y:0,width:1,height:1};
      for(const r of (pg.regions||[])){
        if(!['photo','video','diagram'].includes(r.type)) continue;
        const pr={x:Number(r.x)||0,y:Number(r.y)||0,width:Number(r.width)||0,height:Number(r.height)||0};
        out.push({
          source:lm.filename||'', page:pg.page||1, type:r.type, name:r.name||'', purpose:r.purpose||'',
          confidence:Number(r.confidence)||0, note:r.note||'', pageRelative:pr,
          x:(Number(b.x)||0)+(pr.x*(Number(b.width)||1)),
          y:(Number(b.y)||0)+(pr.y*(Number(b.height)||1)),
          width:pr.width*(Number(b.width)||1), height:pr.height*(Number(b.height)||1)
        });
      }
    }
  }
  if(out.length) parsed.regions=out;
  return parsed;
}

export const config={api:{bodyParser:false}};

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const {fields,files}=await parseMultipart(req);
    const roles=fields.roles||[];
    const usable=files.filter(f=>isSupported(f.filename,f.mimeType));
    const oversized=usable.filter(f=>f.tooLarge || f.buffer.length>3.2*1024*1024);
    if(oversized.length){
      return res.status(413).json({error:`ファイルサイズが大きすぎます: ${oversized.map(f=>f.filename).join(', ')}。ブラウザ側で大容量PDFはページ画像へ変換して分割送信する仕様です。送信途中で制限に達した場合は、ファイル形式またはサイズを確認してください。`});
    }
    const uploaded=[];
    for(let i=0;i<usable.length;i++){
      const f=usable[i];
      const file=await uploadOpenAIFile(f.buffer,f.filename,f.mimeType);
      uploaded.push({...f,fileId:file.id,role:roles[i]||'auto'});
    }
    if(!uploaded.length) return res.status(200).json({uploaded:[],fileRoles:[],summary:{note:'解析対象の資料がありません。'},regions:[]});

    const response=await openaiJson('/responses',{
      model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6',
      input:[{
        role:'user',
        content:[
          {type:'input_text',text:`あなたは採用クリエイティブのディレクター支援AIです。複数の案件資料をまとめて受け取っています。ユーザーは資料を分類せず、そのまま共有する前提です。あなたが各資料の役割を判定し、役割ごとに解析方法を変えてください。

【資料分類】各ファイルを次のいずれかに分類してください。
- overview: 企業・採用・案件の前提、ヒアリング、企画意図など
- layout: 台割、ワイヤーフレーム、完成デザイン、ページ構成、Figma書き出しなど。撮影設計にクリティカルな視覚資料
- reference: 上記以外の参考資料

【重要：layout専用解析】layoutに分類した資料は、単なる参考情報として扱わず、撮影カット抽出の主ソースとして解析してください。
- PDFが複数ページなら、ページをP1、P2…としてページ単位で解析してください。1つのPDFを1枚の台割として扱わず、必ずページ構造を保持してください。
- 画像1枚の中に複数ページが並んでいる台割（例：6Pを1枚に縮小配置、2列×3段、横一列、見開き）は、画像内のページ境界を推定してpageCountとpages[].bboxに分解してください。元画像を物理的に切り出す必要はありません。
- 特に1枚画像の台割では、均等なグリッドを仮定せず、ページ外周の罫線・余白・ページ番号・トンボ・見開きの連続性を総合して矩形領域を推定してください。ページラベルが同じ場合でも物理的に別領域なら別ページとして保持してください。
- ページ境界が明確でない場合も、ページ番号、罫線、余白、同一サイズの反復、見開き構成などを根拠に最も妥当な分割を推定し、confidenceを下げてください。推測であることをnotes/noteに明記してください。
- 見開きは、P2/P3のように別ページとして数えつつ、relationをspread-partにして関係性を保持してください。
- 各ページについて、写真・動画・図版・テキスト領域をpage-relative座標で抽出してください。座標は各ページ左上を(0,0)、右下を(1,1)とする正規化値です。
- pages[].bboxは元資料全体（画像なら画像全体、PDFページならそのページ）に対する正規化座標です。pages[].regionsの座標は必ずそのページ内の相対座標です。
- 実際の完成デザインに写真が入っていても、「既存写真」なのか「撮影を要求している写真領域」なのかを文脈から推定し、noteに根拠を書いてください。既存写真の可能性が高い領域も、撮影設計上重要ならnoteを付けて残してください。
- 複数のlayout資料がある場合は相互に照合し、同じページを重複計上しないでください。
- layoutMapを作った後、撮影設計に関係するphoto/video/diagramだけをregionsへ統合してください。regionsのx/y/width/heightは、元資料全体に対する座標へ変換してください。元資料全体の座標に変換できない場合でも、pageRelativeを必ず残してください。

【案件理解】overviewとreferenceを中心に、案件の目的、制作物、ターゲット、写真トーン、撮影条件を抽出してください。
【統合】案件前提とlayoutの要求を照合し、撮影設計に必要な素材領域だけをregionsに出してください。diagramは領域数の集計には含めてもよいですが、撮影カット候補としては優先しません。

JSONのみで返してください。
{
  "summary":{"project":"","work":"","target":"","concept":"","photoTone":"","constraints":""},
  "fileRoles":[{"filename":"","role":"overview|layout|reference","confidence":0.0,"reason":""}],
  "layoutMaps":[{
    "filename":"",
    "sourceType":"image|pdf|other",
    "layoutKind":"single_page|document_pages|multi_page_grid|multi_page_strip|spread|unknown",
    "pageCount":0,
    "confidence":0.0,
    "pages":[{
      "page":1,
      "label":"P1",
      "bbox":{"x":0,"y":0,"width":1,"height":1},
      "relation":"single|left|right|top|bottom|spread-part|unknown",
      "confidence":0.0,
      "regions":[{"type":"photo|video|diagram|text","name":"","x":0,"y":0,"width":0,"height":0,"purpose":"","confidence":0.0,"note":""}]
    }]
  }],
  "regions":[{"source":"","page":1,"type":"photo|video|diagram","name":"","x":0,"y":0,"width":0,"height":0,"purpose":"","confidence":0.0,"note":"","pageRelative":{"x":0,"y":0,"width":0,"height":0}}],
  "notes":""
}`},
          ...contentForFiles(uploaded)
        ]
      }]
    });
    const parsed=flattenLayoutMaps(parseJson(response.output_text)||{summary:{},fileRoles:[],layoutMaps:[],regions:[],notes:response.output_text||''});
    return res.status(200).json({uploaded:uploaded.map(f=>({filename:f.filename,mimeType:f.mimeType,role:f.role,fileId:f.fileId})),...parsed});
  }catch(e){
    console.error(e);
    const msg=e?.message||'material analysis failed';
    if(/request entity too large|payload too large|body.*large|413/i.test(msg)) return res.status(413).json({error:'資料ファイルが大きすぎます。ブラウザ側で大容量PDFはページ画像へ変換して分割送信する仕様です。送信途中で制限に達した場合は、ファイル形式またはサイズを確認してください。'});
    return res.status(500).json({error:msg});
  }
}
