import { openaiGet, parseJson } from './_lib/openai.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const id=String(req.query?.id||'').trim();
  if(!id || !/^resp_[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({error:'response id is required'});
  try{
    const r=await openaiGet(`/responses/${encodeURIComponent(id)}`);
    const terminal=!['queued','in_progress'].includes(r.status);
    let data=null;
    if(terminal && r.output_text){ data=parseJson(r.output_text); }
    return res.status(200).json({id:r.id,status:r.status,output_text:r.output_text||'',data,error:r.error||null});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:e?.message||'status retrieval failed'});
  }
}
