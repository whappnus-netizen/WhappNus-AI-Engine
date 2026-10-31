export interface ToolDefinition{name:string;description:string;enabled:boolean}
const tools:ToolDefinition[]=[
 {name:"knowledge_search",description:"Pesquisa conhecimento da organização antes de responder.",enabled:true},
 {name:"conversation_context",description:"Obtém contexto da conversa atual.",enabled:true},
 {name:"handoff_to_human",description:"Futuro: encaminha a conversa para atendimento humano.",enabled:false},
 {name:"catalog_lookup",description:"Futuro: consulta produtos, preços e stock.",enabled:false},
 {name:"order_create",description:"Futuro: cria pedidos após confirmação e autorização.",enabled:false},
 {name:"booking_list_services",description:"Consulta serviços activos da organização.",enabled:true},
 {name:"booking_check_availability",description:"Consulta horários e profissionais realmente disponíveis.",enabled:true},
 {name:"booking_create",description:"Cria uma reserva após escolha do cliente e validação do backend.",enabled:true},
 {name:"booking_list_customer_bookings",description:"Consulta apenas reservas do contacto da conversa actual.",enabled:true},
 {name:"booking_cancel",description:"Cancela uma reserva do próprio cliente com permissão.",enabled:true},
 {name:"booking_reschedule",description:"Remarca uma reserva do próprio cliente para um horário disponível.",enabled:true}
];
export function listTools(){return tools.filter(x=>x.enabled);}
