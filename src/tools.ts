export interface ToolDefinition{name:string;description:string;enabled:boolean}
const tools:ToolDefinition[]=[
 {name:"knowledge_search",description:"Pesquisa conhecimento da organização antes de responder.",enabled:true},
 {name:"conversation_context",description:"Obtém contexto da conversa atual.",enabled:true},
 {name:"handoff_to_human",description:"Futuro: encaminha a conversa para atendimento humano.",enabled:false},
 {name:"catalog_lookup",description:"Futuro: consulta produtos, preços e stock.",enabled:false},
 {name:"order_create",description:"Futuro: cria pedidos após confirmação e autorização.",enabled:false}
];
export function listTools(){return tools.filter(x=>x.enabled);}
