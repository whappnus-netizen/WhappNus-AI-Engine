import {config} from "./config.js";
import {getAgent,getHistory,getKnowledge,getSettings,getTrainingExamples,writeAiLog} from "./db.js";
import {classifyIntent} from "./intent.js";
import {formatExamples,formatKnowledge,rankKnowledge} from "./knowledge.js";
import {buildMessages} from "./prompt.js";
import {createProvider} from "./providers.js";
import type {AgentConfig,GenerateRequest,GeneratedResponse} from "./types.js";

export async function generateReply(input:GenerateRequest):Promise<GeneratedResponse>{
 const started=Date.now();
 const [settings,agentRow,history,knowledge,examples]=await Promise.all([
  getSettings(input.organizationId),getAgent(input.organizationId),getHistory(input.conversationId),
  getKnowledge(input.organizationId),getTrainingExamples(input.organizationId)
 ]);
 if(settings?.autoreply_enabled===false)throw new Error("AUTO_REPLY_DISABLED");
 if(!agentRow)throw new Error("NO_ACTIVE_AGENT");
 const a:AgentConfig={
  id:String(agentRow.id),name:String(agentRow.name??agentRow.display_name??"Mia"),
  personality:String(agentRow.personality??agentRow.tone??""),
  instructions:String(agentRow.instructions??agentRow.system_prompt??""),
  objective:String(agentRow.objective??agentRow.goal??""),
  model:typeof agentRow.model==="string"?agentRow.model:undefined,
  temperature:typeof agentRow.temperature==="number"?agentRow.temperature:undefined,
  maxTokens:typeof agentRow.max_tokens==="number"?agentRow.max_tokens:undefined
 };
 const intent=classifyIntent(input.text);
 const ranked=rankKnowledge(input.text,knowledge);
 const messages=buildMessages(a,history,formatKnowledge(ranked),formatExamples(examples),intent.intent,input.profileName??null,input.text);
 const response=await createProvider().generate(messages,{model:a.model??config.AI_MODEL,temperature:a.temperature??config.AI_TEMPERATURE,maxTokens:a.maxTokens??config.AI_MAX_OUTPUT_TOKENS});
 const result={text:response.text,provider:response.provider,model:response.model,latencyMs:Date.now()-started,intent:intent.intent,confidence:intent.confidence,usedKnowledge:ranked.length,agentId:a.id};
 await writeAiLog({organization_id:input.organizationId,conversation_id:input.conversationId??null,message_id:input.messageId??null,agent_id:a.id,event_type:"generation",status:"success",provider:response.provider,model:response.model,intent:intent.intent,latency_ms:result.latencyMs,metadata:{confidence:intent.confidence,usedKnowledge:ranked.length}});
 return result;
}
