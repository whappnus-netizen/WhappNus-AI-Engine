import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});

export async function getSettings(organizationId:string){
 const r=await supabase.from("ai_settings").select("*").eq("organization_id",organizationId).maybeSingle();
 if(r.error)throw new Error("ai_settings: "+r.error.message); return r.data;
}
export async function getAgent(organizationId:string){
 const r=await supabase.from("ai_agents").select("*").eq("organization_id",organizationId).limit(20);
 if(r.error)throw new Error("ai_agents: "+r.error.message);
 const rows=(r.data??[]) as Array<Record<string,unknown>>;
 return rows.find(x=>x.is_active!==false&&x.status!=="inactive")??rows[0]??null;
}
export async function getAgentContext(organizationId:string){
 const r=await supabase.rpc("ai_agent_context",{_organization_id:organizationId});
 if(!r.error&&r.data&&typeof r.data==="object"){
  const d=r.data as Record<string,unknown>;
  const agent=(d.agent&&typeof d.agent==="object"?d.agent:null) as Record<string,unknown>|null;
  const knowledge=Array.isArray(d.knowledge)?d.knowledge as Array<Record<string,unknown>>:[];
  const examples=Array.isArray(d.examples)?d.examples as Array<Record<string,unknown>>:[];
  if(agent)return {agent,knowledge,examples};
 }
 const [agent,knowledge,examples]=await Promise.all([
  getAgent(organizationId),getKnowledge(organizationId),getTrainingExamples(organizationId)
 ]);
 return {agent,knowledge,examples};
}
export async function getHistory(conversationId:string|null|undefined){
 if(!conversationId)return [] as Array<Record<string,unknown>>;
 const r=await supabase.from("messages").select("*").eq("conversation_id",conversationId).order("created_at",{ascending:false}).limit(config.AI_HISTORY_LIMIT);
 if(r.error)throw new Error("messages: "+r.error.message);
 return ((r.data??[]) as Array<Record<string,unknown>>).reverse();
}
export async function getKnowledge(organizationId:string){
 const r=await supabase.from("ai_knowledge").select("*").eq("organization_id",organizationId).limit(config.AI_KNOWLEDGE_LIMIT);
 if(r.error)throw new Error("ai_knowledge: "+r.error.message);
 return (r.data??[]) as Array<Record<string,unknown>>;
}
export async function getTrainingExamples(organizationId:string){
 const r=await supabase.from("ai_training_examples").select("*").eq("organization_id",organizationId).limit(20);
 if(r.error)throw new Error("ai_training_examples: "+r.error.message);
 return (r.data??[]) as Array<Record<string,unknown>>;
}
export async function writeAiLog(payload:Record<string,unknown>){
 const r=await supabase.from("ai_logs").insert(payload);
 if(r.error)console.error("ai_logs:",r.error.message);
}
