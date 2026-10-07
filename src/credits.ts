import {supabase} from "./db.js";
export async function consumeCredit(organizationId:string,units=1){
 if(process.env.AI_CREDITS_ENABLED!=="true")return {enabled:false,remaining:null};
 const r=await supabase.rpc("consume_ai_credits",{p_organization_id:organizationId,p_units:units});
 if(r.error)throw new Error("AI credits: "+r.error.message);
 const row=(r.data&&typeof r.data==="object"?r.data:{}) as Record<string,unknown>;
 if(row.allowed===false)throw new Error("AI_CREDITS_EXHAUSTED");
 return {enabled:true,remaining:typeof row.remaining==="number"?row.remaining:null};
}
