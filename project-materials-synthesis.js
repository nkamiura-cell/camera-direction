import { openaiJson } from './_lib/openai.js';
import { SYNTHESIS_PROMPT } from './_lib/material-prompt.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const results=Array.isArray(req.body?.results)?req.body.results:[];
    if(!results.length) return res.status(400).json({error:'解析結果がありません。'});
    const compact=results.map((r,i)=>`--- ANALYSIS ${i+1}: ${r.filename||''} ---\n${JSON.stringify(r.data||r)}`).join('\n');
    const response=await openaiJson('/responses',{
      model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6',
      background:true,
      input:[{role:'user',content:[{type:'input_text',text:`${SYNTHESIS_PROMPT}\n\n個別解析結果:\n${compact}` }]}]
    });
    return res.status(202).json({jobId:response.id,status:response.status||'queued'});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:e?.message||'synthesis job start failed'});
  }
}
