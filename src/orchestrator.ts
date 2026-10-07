import {config} from "./config.js";
import {getAgentContext,getHistory,getSettings,writeAiLog,supabase} from "./db.js";
import {consumeCredit} from "./credits.js";
import {evaluateResponse} from "./evaluation.js";
import {classifyIntent} from "./intent.js";
import {formatExamples,formatKnowledge,rankKnowledge} from "./knowledge.js";
import {buildMessages} from "./prompt.js";
import {createProvider} from "./providers.js";
import type {AgentConfig,GenerateRequest,GeneratedResponse} from "./types.js";

export async function generateReply(input:GenerateRequest):Promise<GeneratedResponse>{
 const started=Date.now();
 const [settings,ctx,history]=await Promise.all([
  getSettings(input.organizationId),getAgentContext(input.organizationId),getHistory(input.conversationId)
 ]);
 if(settings?.autoreply_enabled===false)throw new Error("AUTO_REPLY_DISABLED");
 if(!ctx.agent)throw new Error("NO_ACTIVE_AGENT");
 await consumeCredit(input.organizationId,1);

 const row=ctx.agent;
 const a:AgentConfig={
  id:String(row.id),name:String(row.name??row.display_name??"Mia"),
  personality:String(row.personality??row.tone??""),
  instructions:String(row.instructions??row.system_prompt??""),
  objective:String(row.objective??row.goal??""),
  model:typeof row.model==="string"?row.model:undefined,
  temperature:typeof row.temperature==="number"?row.temperature:undefined,
  maxTokens:typeof row.max_tokens==="number"?row.max_tokens:undefined,
  company_name:row.company_name,company_description:row.company_description,
  products_services:row.products_services,business_hours:row.business_hours,
  location:row.location,payment_methods:row.payment_methods,faq:row.faq,
  tone:row.tone,service_rules:row.service_rules,can_do:row.can_do,
  cannot_do:row.cannot_do,handoff_instructions:row.handoff_instructions,
  greeting_message:row.greeting_message,extra_instructions:row.extra_instructions,
  language:row.language
 };
 const intent=classifyIntent(input.text);
 const ranked=rankKnowledge(input.text,ctx.knowledge);
 const messages=buildMessages(a,history,formatKnowledge(ranked),formatExamples(ctx.examples),intent.intent,input.profileName??null,input.text);
 const response=await createProvider().generate(messages,{
  model:a.model??config.AI_MODEL,temperature:a.temperature??config.AI_TEMPERATURE,maxTokens:a.maxTokens??config.AI_MAX_OUTPUT_TOKENS
 });
 const result={text:response.text,provider:response.provider,model:response.model,latencyMs:Date.now()-started,intent:intent.intent,confidence:intent.confidence,usedKnowledge:ranked.length,agentId:a.id};
 const evaluation=evaluateResponse(input.text,response.text,ranked.length);

 await writeAiLog({
  organization_id:input.organizationId,conversation_id:input.conversationId??null,message_id:input.messageId??null,
  agent_id:a.id,event_type:"generation",status:"success",provider:response.provider,model:response.model,
  intent:intent.intent,latency_ms:result.latencyMs,metadata:{confidence:intent.confidence,usedKnowledge:ranked.length,evaluation}
 });

 const ev=await supabase.from("ai_evaluations").insert({
  organization_id:input.organizationId,conversation_id:input.conversationId??null,message_id:input.messageId??null,
  agent_id:a.id,score:evaluation.score,flags:evaluation.flags
 });
 if(ev.error && !ev.error.message.includes("relation") && !ev.error.message.includes("column"))console.error("ai_evaluations:",ev.error.message);
 return result;
}
