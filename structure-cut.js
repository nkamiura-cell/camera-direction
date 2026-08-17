import { openaiJson, parseJson } from './_lib/openai.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const b=req.body||{};
    const r=await openaiJson('/responses',{
      model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6',
      input:`あなたは採用クリエイティブのアートディレクターです。案件・台割・カット情報から撮影意図を整理してください。推測で固有名詞を作らないでください。\n案件:${b.projectContext||''}\nカット:${b.cutContext||''}\nJSONのみで返答:\n{"subject":"","people":"","location":"","framing":"","composition":"","light":"","negativeSpace":"","mood":"","shootingNote":""}`
    });
    return res.status(200).json(parseJson(r.output_text)||{shootingNote:r.output_text||''});
  }catch(e){return res.status(500).json({error:e.message||'structure failed'});}
}
