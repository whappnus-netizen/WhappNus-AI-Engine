import {config} from "./config.js";
import type {ChatMessage} from "./types.js";

export interface ProviderResponse{text:string;provider:string;model:string}
export interface AIProvider{generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}):Promise<ProviderResponse>}

async function jf(url:string,headers:Record<string,string>,body:unknown,timeoutMs=7000){
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

class Compatible implements AIProvider{
 constructor(private name:string,private url:string,private key:string,private model:string,private keyHeader="Authorization"){}
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  const headers:Record<string,string>={};
  headers[this.keyHeader]=this.keyHeader==="Authorization"?"Bearer "+this.key:this.key;
  const model=o.model.startsWith("gemini")||o.model.startsWith("google/")?this.model:o.model;
  const d=await jf(this.url,headers,{model,messages:m,temperature:o.temperature,max_tokens:Math.min(o.maxTokens,1024)},6000);
  const t=d.choices?.[0]?.message?.content;
  if(typeof t!=="string"||!t.trim())throw new Error("empty AI response");
  return {text:t.trim(),provider:this.name,model:String(d.model??model)};
 }
}

class Gemini implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  if(!config.GEMINI_API_KEY)throw new Error("GEMINI_API_KEY ausente");
  const requested=o.model.replace(/^google\//,"").replace(/^gemini\//,"");
  const models=[...new Set([requested,"gemini-3.5-flash-lite","gemini-3.1-flash-lite"])];
  const system=m.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
  const contents=m.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:x.content}]}));
  let lastError:unknown=null;
  for(const model of models){
   try{
    const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(config.GEMINI_API_KEY);
    const d=await jf(url,{},{
      systemInstruction:{parts:[{text:system}]},contents,
      generationConfig:{maxOutputTokens:Math.min(o.maxTokens,1024),thinkingConfig:{thinkingLevel:"low"}}
    },6000);
    const t=d.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("").trim();
    if(!t)throw new Error("Gemini empty response");
    if(model!==requested)console.warn("Gemini fallback ativo:",requested,"->",model);
    return {text:t,provider:"gemini",model};
   }catch(e){lastError=e;console.warn("Gemini tentativa falhou:",model,e instanceof Error?e.message:String(e));}
  }
  throw lastError instanceof Error?lastError:new Error("Gemini generation failed");
 }
}

class Anthropic implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  if(!config.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY ausente");
  const system=m.filter(x=>x.role==="system").map(x=>x.content).join("\n\n");
  const d=await jf("https://api.anthropic.com/v1/messages",{"x-api-key":config.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
   {model:o.model,max_tokens:Math.min(o.maxTokens,1024),temperature:o.temperature,system,messages:m.filter(x=>x.role!=="system")},6000);
  const t=d.content?.filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("").trim();
  if(!t)throw new Error("Anthropic empty response");
  return {text:t,provider:"anthropic",model:o.model};
 }
}

class Resilient implements AIProvider{
 async generate(m:ChatMessage[],o:{model:string;temperature:number;maxTokens:number}){
  const attempts:AIProvider[]=[];
  if(config.AI_PROVIDER==="gemini"&&config.GEMINI_API_KEY)attempts.push(new Gemini());
  if(config.OPENAI_API_KEY)attempts.push(new Compatible("openai","https://api.openai.com/v1/chat/completions",config.OPENAI_API_KEY,"gpt-6-luna"));
  if(config.LOVABLE_API_KEY)attempts.push(new Compatible("lovable","https://ai.gateway.lovable.dev/v1/chat/completions",config.LOVABLE_API_KEY,"google/gemini-3.5-flash-lite","Lovable-API-Key"));
  if(config.ANTHROPIC_API_KEY)attempts.push(new Anthropic());
  if(config.AI_PROVIDER!=="gemini"&&config.GEMINI_API_KEY)attempts.push(new Gemini());
  if(!attempts.length)throw new Error("Nenhum provedor de IA configurado");
  let lastError:unknown=null;
  for(const provider of attempts){
   try{const result=await provider.generate(m,o);console.log("AI provider selecionado:",result.provider,result.model);return result;}
   catch(e){lastError=e;console.error("AI provider falhou; tentando próximo:",e instanceof Error?e.message:String(e));}
  }
  throw lastError instanceof Error?lastError:new Error("Todos os provedores de IA falharam");
 }
}
export function createProvider():AIProvider{return new Resilient();}
