import express from "express";
import {config} from "./config.js";
import {generateReply} from "./orchestrator.js";
import {allow} from "./rate-limit.js";
import type {GenerateRequest} from "./types.js";

const app=express();app.disable("x-powered-by");app.use(express.json({limit:"256kb"}));
app.get("/health",(_req,res)=>res.json({ok:true,service:"whappnus-ai-engine",provider:config.AI_PROVIDER,model:config.AI_MODEL}));
function authorized(req:express.Request){return req.header("authorization")==="Bearer "+config.AI_INTERNAL_SECRET;}

app.post("/v1/generate",async(req,res)=>{
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const b=req.body as Partial<GenerateRequest>;
 if(!b.organizationId||!b.whatsappNumberId||typeof b.text!=="string"||!b.text.trim())return res.status(400).json({ok:false,error:"organizationId, whatsappNumberId and text are required"});
 const key=String(b.organizationId)+":"+String(b.fromWaId??"unknown");
 if(!allow(key,config.AI_RATE_LIMIT_PER_MINUTE))return res.status(429).json({ok:false,error:"rate_limited"});
 try{return res.json({ok:true,...await generateReply({...b,text:b.text.trim()} as GenerateRequest)});}
 catch(e){const m=e instanceof Error?e.message:"unknown";if(m==="AUTO_REPLY_DISABLED"||m==="NO_ACTIVE_AGENT")return res.status(409).json({ok:false,error:m});console.error("generation:",m);return res.status(500).json({ok:false,error:"ai_generation_failed"});}
});
app.get("/v1/capabilities",(_req,res)=>res.json({ok:true,providers:["lovable","openai","gemini","anthropic"],capabilities:["intent-classification","agent-selection","prompt-orchestration","conversation-context","knowledge-ranking","training-examples","provider-abstraction","rate-limiting","ai-logs","future-tools","future-memory","future-rag","future-credits","future-evaluation"]}));
app.listen(config.PORT,()=>console.log("WhappNus AI Engine listening on :"+config.PORT));
