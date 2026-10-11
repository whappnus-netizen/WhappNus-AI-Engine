import {config} from "./config.js";
import {getAgentContext,getHistory,getSettings,writeAiLog,supabase} from "./db.js";
import {consumeCredit} from "./credits.js";
import {evaluateResponse} from "./evaluation.js";
import {classifyIntent} from "./intent.js";
import {formatExamples,formatKnowledge,rankKnowledge} from "./knowledge.js";
import {buildMessages} from "./prompt.js";
import {createProvider} from "./providers.js";
import type {AgentConfig,GenerateRequest,GeneratedResponse,MediaAttachment} from "./types.js";

async function loadInboundAttachment(input: GenerateRequest): Promise<MediaAttachment | null> {
 if (!input.mediaPath || !input.messageType || input.messageType === "text" || input.messageType === "system") return null;
 // Only fetch paths inside this tenant's own WhatsApp media folder.
 const expectedPrefix = input.organizationId + "/" + input.whatsappNumberId + "/";
 if (!input.mediaPath.startsWith(expectedPrefix) || input.mediaPath.includes("..")) {
  throw new Error("INVALID_MEDIA_PATH");
 }
 const allowed = new Set(["image/jpeg","image/png","image/webp","image/gif","audio/ogg","audio/mpeg","audio/mp4","audio/aac","audio/amr","audio/wav","application/pdf","video/mp4","video/3gpp"]);
 const extensionMime: Record<string,string> = {
  jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",
  ogg:"audio/ogg",mp3:"audio/mpeg",m4a:"audio/mp4",aac:"audio/aac",amr:"audio/amr",wav:"audio/wav",
  pdf:"application/pdf",mp4:"video/mp4","3gp":"video/3gpp"
 };
 const ext = input.mediaPath.split(".").pop()?.toLowerCase() ?? "";
 const mimeType = input.mediaMimeType && allowed.has(input.mediaMimeType)
  ? input.mediaMimeType
  : extensionMime[ext];
 if (!mimeType || !allowed.has(mimeType)) throw new Error("UNSUPPORTED_MEDIA_TYPE");
 const { data, error } = await supabase.storage.from("whatsapp-incoming-media").download(input.mediaPath);
 if (error || !data) throw new Error("MEDIA_DOWNLOAD_FAILED");
 const bytes = Buffer.from(await data.arrayBuffer());
 if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("MEDIA_TOO_LARGE_FOR_AI");
 return { type: input.messageType, mimeType, data: bytes.toString("base64") };
}

export async function generateReply(input:GenerateRequest):Promise<GeneratedResponse>{
 const started=Date.now();
 const safeMessageId=typeof input.messageId==="string"&&/^[0-9a-fA-F-]{36}$/.test(input.messageId)?input.messageId:null;
 const [settings,ctx,history,attachment]=await Promise.all([
  getSettings(input.organizationId),
  getAgentContext(input.organizationId,input.whatsappNumberId,input.agentId),
  getHistory(input.conversationId),
  loadInboundAttachment(input)
 ]);
 if(settings?.autoreply_enabled===false)throw new Error("AUTO_REPLY_DISABLED");
 if(!ctx.agent)throw new Error("NO_ACTIVE_AGENT");
 await consumeCredit(input.organizationId,1);

 const row=ctx.agent;
 const featureConfig = row.config && typeof row.config === "object"
  ? row.config as Record<string, unknown>
  : {};
 const imageEnabled = featureConfig["imageUnderstanding"] !== false;
 const audioEnabled = featureConfig["audioUnderstanding"] !== false;
 const effectiveAttachment = attachment && (
  (attachment.type === "image" && imageEnabled) ||
  (attachment.type === "audio" && audioEnabled) ||
  !["image","audio"].includes(attachment.type)
 ) ? attachment : null;
 if (input.messageType && input.messageType !== "text" && input.messageType !== "system") {
  console.info("[ai] inbound attachment", {
   type: input.messageType,
   mediaPathProvided: Boolean(input.mediaPath),
   attachmentLoaded: Boolean(attachment),
   attachmentEnabled: Boolean(effectiveAttachment),
   mimeType: attachment?.mimeType ?? input.mediaMimeType ?? null,
   bytes: attachment ? Math.floor(Buffer.from(attachment.data, "base64").length) : 0,
  });
 }
 const attachmentText = typeof input.text === "string" ? input.text.trim() : "";
 const messageText = input.messageType === "image" && !imageEnabled
  ? "[O cliente enviou uma imagem, mas a análise de imagens está desactivada. Pede ao cliente que descreva o conteúdo.]"
  : input.messageType === "audio" && !audioEnabled
   ? "[O cliente enviou um áudio, mas a compreensão de áudio está desactivada. Pede ao cliente que escreva a mensagem.]"
  : input.messageType === "image"
   ? "[ANEXO DE IMAGEM RECEBIDO] Analisa visualmente a imagem anexada antes de responder. Identifica apenas elementos que consigas realmente observar. Se a imagem não estiver legível ou acessível, diz isso com naturalidade e pede uma nova imagem ou esclarecimento. Não inventes o conteúdo. " + (attachmentText ? "\nLegenda/texto enviado pelo cliente: " + attachmentText : "O cliente enviou uma imagem sem legenda.")
  : input.messageType === "audio"
   ? "[ANEXO DE ÁUDIO RECEBIDO] Escuta/interpreta o áudio anexado e responde ao que a pessoa disse. Se não conseguires compreender o áudio, pede para repetir ou escrever a mensagem; nunca inventes uma transcrição. " + (attachmentText && !attachmentText.toLowerCase().startsWith("[o cliente enviou um áudio") && !attachmentText.toLowerCase().startsWith("[o cliente enviou áudio") ? "\nTexto/legenda adicional do cliente: " + attachmentText : "")
  : input.text;
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
 const intent=classifyIntent(messageText);
 const ranked=rankKnowledge(messageText,ctx.knowledge);
 const messages=buildMessages(a,history,formatKnowledge(ranked),formatExamples(ctx.examples),intent.intent,input.profileName??null,messageText);
 const response=await createProvider().generate(messages,{
  model:a.model??String((settings as Record<string,unknown>|null)?.default_model??config.AI_MODEL),temperature:a.temperature??config.AI_TEMPERATURE,maxTokens:a.maxTokens??config.AI_MAX_OUTPUT_TOKENS
 }, effectiveAttachment ? [effectiveAttachment] : []);
 const reactionText = input.text.toLowerCase();
 const reactionEligible = featureConfig["reactionsEnabled"] === true &&
  !["image","audio","video","document"].includes(input.messageType ?? "") &&
  /(obrigad[oa]s?|gostei|adorei|amei|perfeito|perfeita|excelente|muito bom|muito boa|top|tenho interesse|quero comprar|quero esse|quero este|vou levar|pode reservar|pode marcar|fechado|aceito)/i.test(reactionText);
 const reactionEmoji = reactionEligible
  ? (/(adorei|amei|❤️|muito bom|muito boa)/i.test(reactionText) ? "❤️" : "👍")
  : null;
 const result={text:response.text,provider:response.provider,model:response.model,latencyMs:Date.now()-started,intent:intent.intent,confidence:intent.confidence,usedKnowledge:ranked.length,agentId:a.id,reactionEmoji};
 const evaluation=evaluateResponse(input.text,response.text,ranked.length);

 await writeAiLog({
  organization_id:input.organizationId,conversation_id:input.conversationId??null,message_id:safeMessageId,
  agent_id:a.id,event_type:"generation",status:"success",provider:response.provider,model:response.model,
  intent:intent.intent,latency_ms:result.latencyMs,metadata:{confidence:intent.confidence,usedKnowledge:ranked.length,evaluation,messageType:input.messageType??"text",attachmentLoaded:Boolean(attachment),attachmentEnabled:Boolean(effectiveAttachment)}
 });

 const ev=await supabase.from("ai_evaluations").insert({
  organization_id:input.organizationId,conversation_id:input.conversationId??null,message_id:safeMessageId,
  agent_id:a.id,score:evaluation.score,flags:evaluation.flags
 });
 if(ev.error && !ev.error.message.includes("relation") && !ev.error.message.includes("column"))console.error("ai_evaluations:",ev.error.message);
 return result;
}
