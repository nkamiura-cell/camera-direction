import Busboy from 'busboy';
import { openaiJson, uploadOpenAIFile, parseJson } from './_lib/openai.js';
import { MATERIAL_ANALYSIS_PROMPT } from './_lib/material-prompt.js';

function ext(name=''){ return (name.split('.').pop()||'').toLowerCase(); }
function isImage(mime='',name=''){ return mime.startsWith('image/') || ['jpg','jpeg','png','webp','gif'].includes(ext(name)); }
function isSupported(name,mime=''){ return isImage(mime,name) || ['pdf','ppt','pptx','doc','docx','txt','md'].includes(ext(name)); }

function parseMultipart(req){
  return new Promise((resolve,reject)=>{
    let bb;
    try{ bb=Busboy({headers:req.headers, limits:{files:2, fileSize:3.0*1024*1024}}); }
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

function contentForFile(f){
  return [
    {type:'input_text',text:`--- FILE: ${f.filename} | ROLE HINT: AIで判定${/__P\d{3}\.txt$/i.test(f.filename)?' | PPTX_SLIDE_COMPANION: このTXTは同名PPTXスライド画像の構造メタデータです。単独の資料として扱わず、画像解析の補助情報として使ってください':''} ---`},
    isImage(f.mimeType,f.filename) ? {type:'input_image',file_id:f.fileId,detail:'high'} : {type:'input_file',file_id:f.fileId}
  ];
}

export const config={api:{bodyParser:false}};

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const {files}=await parseMultipart(req);
    const usable=files.filter(f=>isSupported(f.filename,f.mimeType));
    if(!usable.length) return res.status(400).json({error:'解析対象の資料がありません。'});
    if(usable.some(f=>f.tooLarge || f.buffer.length>3.0*1024*1024)) return res.status(413).json({error:`「${usable.find(f=>f.tooLarge || f.buffer.length>3.0*1024*1024)?.filename||'資料'}」が1回の送信上限を超えています。ブラウザ側で圧縮・分割してから再送してください。`});

    // v49: 1回のVercel実行では「ファイル受領→OpenAI File登録→Background Response開始」まで。
    // companion TXTを含む場合は、同じBackground Responseへまとめて渡す。
    const uploaded=[];
    for(const f of usable){
      const file=await uploadOpenAIFile(f.buffer,f.filename,f.mimeType);
      uploaded.push({...f,fileId:file.id});
    }
    const content=uploaded.flatMap(f=>contentForFile(f));
    const response=await openaiJson('/responses',{
      model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6',
      background:true,
      input:[{role:'user',content:[
        {type:'input_text',text:MATERIAL_ANALYSIS_PROMPT},
        ...content
      ]}]
    });
    const primary=usable[0];
    const jobs=[{jobId:response.id,filename:primary.filename,sourceName:primary.sourceName||primary.filename,role:'auto',status:response.status||'queued'}];
    return res.status(202).json({jobs});
  }catch(e){
    console.error(e);
    const msg=e?.message||'material job start failed';
    if(/request entity too large|payload too large|body.*large|413/i.test(msg)) return res.status(413).json({error:'資料ファイルが大きすぎます。ブラウザ側で圧縮・分割してから再送してください。'});
    return res.status(500).json({error:msg});
  }
}
