export interface Evaluation{score:number;flags:string[]}
export function evaluateResponse(input:string,output:string,knowledgeUsed:number):Evaluation{
 const flags:string[]=[];
 if(!output.trim())flags.push("empty");
 if(output.length>1800)flags.push("too_long_for_whatsapp");
 if(/(api[_ -]?key|service[_ -]?role|bridge[_ -]?secret|system prompt)/i.test(output))flags.push("possible_secret_or_internal_disclosure");
 if(knowledgeUsed===0&&/(preço|preco|valor|horário|horario|endereço|endereco)/i.test(input))flags.push("business_fact_without_retrieved_knowledge");
 let score=1;
 score-=flags.includes("empty")?.8:0;
 score-=flags.includes("too_long_for_whatsapp")?.15:0;
 score-=flags.includes("possible_secret_or_internal_disclosure")?.8:0;
 score-=flags.includes("business_fact_without_retrieved_knowledge")?.2:0;
 return {score:Math.max(0,Number(score.toFixed(3))),flags};
}
