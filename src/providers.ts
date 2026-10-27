import {config} from "./config.js";
import type {ChatMessage,MediaAttachment} from "./types.js";

export interface ProviderResponse{text:string;provider:string;model:string}
export interface AIProvider{generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number},attachments?:MediaAttachment[]):Promise<ProviderResponse>}

async function jf(url:string,headers:Record<string,string>,body:unknown,timeoutMs=12000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body),signal:controller.signal});
  const raw=await r.text();
  if(!r.ok)throw new Error("provider HTTP "+r.status+": "+raw.slice(0,500));
  try{return JSON.parse(raw) as Record<string,any>}catch{throw new Error("provider returned invalid JSON")}
 }catch(e){
  if(e instanceof Error && e.name==="AbortError")throw new Error("provider timeout after "+timeoutMs+"ms");
  throw e;
 }finally{clearTimeout(timer);}
}

async function transcribeWithOpenAI(key: string, attachment: MediaAttachment): Promise<string> {
 const bytes = Uint8Array.from(Buffer.from(attachment.data, "base64"));
 const extension = attachment.mimeType === "audio/mpeg" ? "mp3"
  : attachment.mimeType === "audio/mp4" ? "m4a"
  : attachment.mimeType === "audio/wav" ? "wav"
  : attachment.mimeType === "audio/webm" ? "webm"
  : attachment.mimeType === "audio/aac" ? "aac"
  : attachment.mimeType === "audio/amr" ? "amr" : "ogg";
 const form = new FormData();
 form.append("model", "whisper-1");
 form.append("file", new Blob([bytes], { type: attachment.mimeType }), "incoming-audio." + extension);
 const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
  method: "POST",
  headers: { Authorization: "Bearer " + key },
  body: form,
  signal: AbortSignal.timeout(20000)
 });
 if (!response.ok) throw new Error("OpenAI audio transcription failed (HTTP " + response.status + ")");
 const data = await response.json() as Record<string, unknown>;
 const transcript = typeof data["text"] === "string" ? data["text"].trim() : "";
 if (!transcript) throw new Error("OpenAI returned an empty audio transcript");
 return transcript.slice(0, 20000);
}

class Compatible implements AIProvider{
 constructor(private name:string,private url:string,private key:string,private model:string,private keyHeader="Authorization"){}
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]){
  const effectiveMessages = m;
  const effectiveAttachments = attachments;
  if(effectiveAttachments.some(a=>a.type!=="image"))throw new Error(this.name+" não suporta este tipo de anexo; a tentar o próximo provedor");
  const headers:Record<string,string>={};
  headers[this.keyHeader]=this.keyHeader==="Authorization"?"Bearer "+this.key:this.key;
  const model=o.model.startsWith("gemini")||o.model.startsWith("google/")?this.model:o.model;
  const lastUserIndex=effectiveMessages.map(x=>x.role).lastIndexOf("user");
  const compatibleMessages=effectiveMessages.map((message,index)=>{
   if(index!==lastUserIndex||effectiveAttachments.length===0)return message;
   return {...message,content:[
    {type:"text",text:message.content},
    ...effectiveAttachments.map(a=>({type:"image_url",image_url:{url:"data:"+a.mimeType+";base64,"+a.data}}))
   ]};
  });
  const body:Record<string,unknown>={model,messages:compatibleMessages};
  if(this.name==="openai"){
   // Newer OpenAI models reject max_tokens; use the current Chat Completions field.
   body.max_completion_tokens=Math.min(o.maxTokens,4096);
   // Avoid sending temperature to reasoning models that may not support it.
  }else{
   body.max_tokens=Math.min(o.maxTokens,4096);
   body.temperature=o.temperature;
  }
  const d=await jf(this.url,headers,body,30000);
  const choice=d.choices?.[0];
  const finishReason=String(choice?.finish_reason??"");
  if(finishReason==="length")throw new Error("AI_RESPONSE_TRUNCATED: provider reached its output token limit");
  const t=choice?.message?.content;
  if(typeof t!=="string"||!t.trim())throw new Error("empty AI response");
  return {text:t.trim(),provider:this.name,model:String(d.model??model)};
 }
}

class Gemini implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]){
  if(!config.GEMINI_API_KEY)throw new Error("GEMINI_API_KEY ausente");
  const requested=o.model.replace(/^google\//,"").replace(/^gemini\//,"");
  // Keep within the WhatsApp webhook response window: use verified fast models first.
  // Avoid the retired gemini-2.5-flash and the currently timing-out gemini-3.8-flash.
  const models=["gemini-3.5-flash-lite","gemini-3.1-flash-lite"];
  const system=m.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
  const lastUserIndex=m.map(x=>x.role).lastIndexOf("user");
  const contents=m.filter(x=>x.role!=="system").map((x)=>{
   const originalIndex=m.indexOf(x);
   const parts:Array<Record<string,unknown>>=[{text:x.content}];
   if(originalIndex===lastUserIndex){
    for(const attachment of attachments)parts.push({inlineData:{mimeType:attachment.mimeType,data:attachment.data}});
   }
   return {role:x.role==="assistant"?"model":"user",parts};
  });
  let lastError:unknown=null;
  for(const model of models){
   try{
    const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(config.GEMINI_API_KEY);
    const d=await jf(url,{},{
      systemInstruction:{parts:[{text:system}]},contents,
      generationConfig:{maxOutputTokens:Math.min(o.maxTokens,4096),thinkingConfig:{thinkingLevel:"low"}}
    },10000);
    const candidate=d.candidates?.[0];
    if(String(candidate?.finishReason??"")==="MAX_TOKENS")throw new Error("AI_RESPONSE_TRUNCATED: Gemini reached its output token limit");
    const t=candidate?.content?.parts?.map((p:any)=>p.text??"").join("").trim();
    if(!t)throw new Error("Gemini empty response");
    if(model!==requested)console.warn("Gemini fallback ativo:",requested,"->",model);
    return {text:t,provider:"gemini",model};
   }catch(e){lastError=e;console.warn("Gemini tentativa falhou:",model,e instanceof Error?e.message:String(e));}
  }
  throw lastError instanceof Error?lastError:new Error("Gemini generation failed");
 }
}

class Anthropic implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]){
  if(!config.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY ausente");
  if(attachments.some(a=>a.type!=="image"))throw new Error("Anthropic não suporta este tipo de anexo neste adaptador; a tentar o próximo provedor");
  if(!process.env.ANTHROPIC_WORKSPACE_ID)throw new Error("ANTHROPIC_WORKSPACE_ID ausente; Anthropic fallback desativado");
  const system=m.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
  const model="claude-haiku-4-5";
  const d=await jf("https://api.anthropic.com/v1/messages",{
   "x-api-key":config.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01",
   "anthropic-workspace-id":process.env.ANTHROPIC_WORKSPACE_ID
  },{
   model,max_tokens:Math.min(o.maxTokens,4096),temperature:o.temperature,system,
   messages:m.filter(x=>x.role!=="system").map((message,index,array)=>{
    if(index!==array.length-1||attachments.length===0)return message;
    return {...message,content:[
     {type:"text",text:message.content},
     ...attachments.map(a=>({type:"image",source:{type:"base64",media_type:a.mimeType,data:a.data}}))
    ]};
   })
  },30000);
  if(String(d.stop_reason??"")==="max_tokens")throw new Error("AI_RESPONSE_TRUNCATED: Anthropic reached its output token limit");
  const t=d.content?.filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("").trim();
  if(!t)throw new Error("Anthropic empty response");
  return {text:t,provider:"anthropic",model};
 }
}

class Resilient implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]){
  let effectiveMessages = m;
  let effectiveAttachments = attachments;
  if (config.OPENAI_API_KEY && attachments.length > 0 && attachments.every(a => a.type === "audio")) {
   try {
    const transcripts = await Promise.all(attachments.map(a => transcribeWithOpenAI(config.OPENAI_API_KEY!, a)));
    const lastUserIndex = m.map(x => x.role).lastIndexOf("user");
    effectiveMessages = m.map((message,index) => index === lastUserIndex
     ? {...message, content: message.content + "\n\nTranscrição do áudio do cliente: " + transcripts.join("\n")}
     : message);
    effectiveAttachments = [];
   } catch (error) {
    console.warn("Transcrição prévia falhou; será tentada a compreensão nativa do provedor:", error instanceof Error ? error.message : String(error));
   }
  }
  const attempts:AIProvider[]=[];
  // Try the configured Gemini fallback first; recent production logs showed
  // OpenAI billing/TPM exhaustion. OpenAI remains available as a fallback.
  if(config.GEMINI_API_KEY)attempts.push(new Gemini());
  if(config.OPENAI_API_KEY){
   attempts.push(new Compatible("openai","https://api.openai.com/v1/chat/completions",config.OPENAI_API_KEY,"gpt-6-luna"));
   attempts.push(new Compatible("openai","https://api.openai.com/v1/chat/completions",config.OPENAI_API_KEY,"gpt-4o-mini"));
  }
  // Anthropic is only eligible when its required workspace scope is configured.
  if(config.ANTHROPIC_API_KEY&&process.env.ANTHROPIC_WORKSPACE_ID)attempts.push(new Anthropic());
  if(config.LOVABLE_API_KEY)attempts.push(new Compatible("lovable","https://ai.gateway.lovable.dev/v1/chat/completions",config.LOVABLE_API_KEY,"google/gemini-3.5-flash-lite","Lovable-API-Key"));
  if(!attempts.length)throw new Error("Nenhum provedor de IA funcional configurado: configure OPENAI_API_KEY, GEMINI_API_KEY ou LOVABLE_API_KEY; Anthropic requer ANTHROPIC_WORKSPACE_ID");
  let lastError:unknown=null;
  for(const provider of attempts){
   try{const result=await provider.generate(effectiveMessages,o,effectiveAttachments);console.log("AI provider selecionado:",result.provider,result.model);return result;}
   catch(e){lastError=e;console.error("AI provider falhou; tentando próximo:",e instanceof Error?e.message:String(e));}
  }
  throw lastError instanceof Error?lastError:new Error("Todos os provedores de IA falharam");
 }
}
export function createProvider():AIProvider{return new Resilient();}
