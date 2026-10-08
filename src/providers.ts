import {config} from "./config.js";
import type {ChatMessage} from "./types.js";

export interface ProviderResponse{text:string;provider:string;model:string}
export interface AIProvider{generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}):Promise<ProviderResponse>}

async function jf(url:string,headers:Record<string,string>,body:unknown){
 const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
 const raw=await r.text();
 if(!r.ok)throw new Error("provider HTTP "+r.status+": "+raw.slice(0,400));
 try{return JSON.parse(raw) as Record<string,any>}catch{throw new Error("provider returned invalid JSON")}
}

class Compatible implements AIProvider{
 constructor(private name:string,private url:string,private key:string,private keyHeader="Authorization"){}
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  const headers:Record<string,string>={};
  headers[this.keyHeader]=this.keyHeader==="Authorization"?"Bearer "+this.key:this.key;
  const d=await jf(this.url,headers,{model:o.model,messages:m,temperature:o.temperature,max_tokens:o.maxTokens});
  const t=d.choices?.[0]?.message?.content;
  if(typeof t!=="string"||!t.trim())throw new Error("empty AI response");
  return {text:t.trim(),provider:this.name,model:String(d.model??o.model)};
 }
}

class Gemini implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  if(!config.GEMINI_API_KEY)throw new Error("GEMINI_API_KEY ausente");
  const requested=o.model.replace(/^google\//,"").replace(/^gemini\//,"");
  const fallbackModels=["gemini-3.7-flash","gemini-3.6-flash","gemini-3.5-flash-lite"];
  const models=[...new Set([requested,...fallbackModels])];
  const system=m.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
  const contents=m.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:x.content}]}));

  let lastError:unknown=null;
  for(const model of models){
   try{
    const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(config.GEMINI_API_KEY);
    const d=await jf(url,{}, {
      systemInstruction:{parts:[{text:system}]},
      contents,
      generationConfig:{maxOutputTokens:o.maxTokens}
    });
    const t=d.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("").trim();
    if(!t)throw new Error("Gemini empty response");
    if(model!==requested)console.warn("Gemini fallback ativo:",requested,"->",model);
    return {text:t,provider:"gemini",model};
   }catch(e){
    lastError=e;
    const msg=e instanceof Error?e.message:String(e);
    const retryable=/provider HTTP (404|429|500|502|503|504):/.test(msg)||/UNAVAILABLE|high demand|temporarily/i.test(msg);
    if(!retryable)throw e;
   }
  }
  throw lastError instanceof Error?lastError:new Error("Gemini generation failed");
 }
}

class Anthropic implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  if(!config.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY ausente");
  const system=m.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
  const d=await jf("https://api.anthropic.com/v1/messages",{"x-api-key":config.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},{model:o.model,max_tokens:o.maxTokens,temperature:o.temperature,system,messages:m.filter(x=>x.role!=="system")});
  const t=d.content?.filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("").trim();
  if(!t)throw new Error("Anthropic empty response");
  return {text:t,provider:"anthropic",model:o.model};
 }
}

export function createProvider():AIProvider{
 switch(config.AI_PROVIDER){
  case "lovable":
   if(!config.LOVABLE_API_KEY)throw new Error("LOVABLE_API_KEY ausente");
   return new Compatible("lovable","https://ai.gateway.lovable.dev/v1/chat/completions",config.LOVABLE_API_KEY,"Lovable-API-Key");
  case "openai":
   if(!config.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY ausente");
   return new Compatible("openai","https://api.openai.com/v1/chat/completions",config.OPENAI_API_KEY);
  case "gemini":return new Gemini();
  case "anthropic":return new Anthropic();
 }
}
