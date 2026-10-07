function textOf(r:Record<string,unknown>):string{
 return ["title","name","question","answer","content","text","body","description"].map(k=>typeof r[k]==="string"?String(r[k]):"").filter(Boolean).join("\n");
}
function score(q:string,c:string){const a=new Set(q.toLowerCase().split(/\W+/).filter(x=>x.length>2));const b=c.toLowerCase().split(/\W+/).filter(x=>x.length>2);if(!a.size||!b.length)return 0;let h=0;for(const w of a)if(b.includes(w))h++;return h/a.size;}
export function rankKnowledge(q:string,rows:Array<Record<string,unknown>>){
 return rows.map(row=>({row,score:score(q,textOf(row))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8);
}
export function formatKnowledge(rows:Array<{row:Record<string,unknown>;score:number}>){
 return rows.map(x=>"[relevancia "+x.score.toFixed(2)+"]\n"+textOf(x.row)).join("\n\n");
}
export function formatExamples(rows:Array<Record<string,unknown>>){
 return rows.map(r=>{
  const i=String(r.input??r.question??r.user_message??"");
  const o=String(r.expected_output??r.output??r.answer??r.assistant_message??"");
  const type=String(r.example_type??r.type??"exemplo");
  return i&&o?"Tipo: "+type+"\nCliente: "+i+"\nResposta ideal: "+o:"";
 }).filter(Boolean).slice(0,8).join("\n\n");
}
