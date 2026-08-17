import Busboy from 'busboy';
import { openaiJson, uploadOpenAIFile, parseJson } from './_lib/openai.js';

function ext(name=''){ return (name.split('.').pop()||'').toLowerCase(); }
function isImage(mime='',name=''){ return mime.startsWith('image/') || ['jpg','jpeg','png','webp','gif'].includes(ext(name)); }
function isSupported(name,mime=''){ return isImage(mime,name) || ['pdf','ppt','pptx','doc','docx','txt','md'].includes(ext(name)); }

function parseMultipart(req){
  return new Promise((resolve,reject)=>{
    const bb=Busboy({headers:req.headers}); const files=[]; const fields={};
    bb.on('field',(n,v)=>{ if(!fields[n]) fields[n]=[]; fields[n].push(v); });
    bb.on('file',(name,file,info)=>{
      const chunks=[]; file.on('data',d=>chunks.push(d));
      file.on('end',()=>files.push({field:name,filename:info.filename,mimeType:info.mimeType,buffer:Buffer.concat(chunks)}));
    });
    bb.on('error',reject); bb.on('close',()=>resolve({fields,files})); req.pipe(bb);
  });
}

function contentForFiles(uploaded){
  return uploaded.map(f=> isImage(f.mimeType,f.filename)
    ? {type:'input_image',file_id:f.fileId,detail:'high'}
    : {type:'input_file',file_id:f.fileId}
  );
}

export const config={api:{bodyParser:false}};

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const {fields,files}=await parseMultipart(req);
    const roles=fields.roles||[];
    const usable=files.filter(f=>isSupported(f.filename,f.mimeType));
    const uploaded=[];
    for(let i=0;i<usable.length;i++){
      const f=usable[i];
      const file=await uploadOpenAIFile(f.buffer,f.filename,f.mimeType);
      uploaded.push({...f,fileId:file.id,role:roles[i]||'overview'});
    }
    if(!uploaded.length) return res.status(200).json({uploaded:[],summary:{note:'解析対象の資料がありません。Figma .fig はPDF/画像で書き出して追加してください。'},regions:[]});

    const response=await openaiJson('/responses',{
      model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6',
      input:[{
        role:'user',
        content:[
          {type:'input_text',text:`あなたは採用クリエイティブのディレクター支援AIです。添付資料を読み、案件前提と撮影設計に必要なクリティカル情報を抽出してください。\n概要資料は「前提」、台割・デザイン資料は「クリティカル」として扱います。\n台割についてはページごとに写真・動画・図版などの素材領域を推定し、各領域をページ座標で返してください。座標はページ左上を(0,0)、右下を(1,1)とした正規化値です。資料がPDFならページ番号も必ず返してください。\nJSONのみ:\n{"summary":{"project":"","work":"","target":"","concept":"","photoTone":"","constraints":""},"regions":[{"page":1,"type":"photo|video|diagram","name":"","x":0,"y":0,"width":0,"height":0,"purpose":"","confidence":0.0,"note":""}],"notes":""}`},
          ...contentForFiles(uploaded)
        ]
      }]
    });
    const parsed=parseJson(response.output_text)||{summary:{},regions:[],notes:response.output_text||''};
    return res.status(200).json({uploaded:uploaded.map(f=>({filename:f.filename,mimeType:f.mimeType,role:f.role,fileId:f.fileId})),...parsed});
  }catch(e){ console.error(e); return res.status(500).json({error:e.message||'material analysis failed'}); }
}
