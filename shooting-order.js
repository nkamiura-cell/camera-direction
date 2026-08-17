import { openaiJson, parseJson } from './_lib/openai.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const b=req.body||{};
    const prompt=`あなたは撮影進行を設計するディレクターです。撮影順を3案作ってください。\n\n最優先の共通前提:\n1. 出演者の拘束時間をできるだけ短くする。待機・呼び戻しを最小化する。\n2. 撮影場所の移動をできるだけ少なくする。\n\nこれは「優先条件を選ぶ」のではなく、上記2条件を常に共通条件として3案を比較するものです。\n\n現場メモはハード制約として扱います。例「Aさんは11時まで」「役員は13時以降」「この場所は午前中しか使えない」。矛盾があれば無理に解決せず、矛盾を明記してください。\n\n3案の性格:\nA = 出演者拘束をさらに強く最小化\nB = 移動をさらに強く最小化\nC = A/Bの両方をバランス\n\nカット情報:\n${JSON.stringify(b.cuts||[],null,2)}\n\n現場メモ:\n${b.constraints||''}\n\nJSONのみ:\n{"plans":[{"title":"","desc":"","sequence":["cutId"],"reason":"","constraintHandling":"","estimatedMoveCount":0,"estimatedActorSwitchCount":0,"warnings":[]}]} `;
    const r=await openaiJson('/responses',{model:process.env.OPENAI_TEXT_MODEL||'gpt-5.6',input:prompt});
    const parsed=parseJson(r.output_text);
    if(!parsed?.plans) throw new Error('撮影順案のJSONを取得できませんでした。');
    const cuts=b.cuts||[];
    const mapped=parsed.plans.map(p=>({...p,seq:(p.sequence||[]).map(id=>cuts.find(c=>String(c.id)===String(id))?.title||id),score:{moves:p.estimatedMoveCount||0,actorSwitch:p.estimatedActorSwitchCount||0}}));
    return res.status(200).json({plans:mapped});
  }catch(e){console.error(e);return res.status(500).json({error:e.message||'shooting order failed'});}
}
