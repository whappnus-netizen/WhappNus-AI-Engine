export type ChatRole="system"|"user"|"assistant";
export interface ChatMessage { role:ChatRole; content:string; }
export interface GenerateRequest {
  organizationId:string; whatsappNumberId:string; conversationId?:string|null; contactId?:string|null;
  messageId?:string|null; fromWaId?:string|null; profileName?:string|null; text:string;
  metadata?:Record<string,unknown>;
}
export interface AgentConfig {
  id:string; name:string; personality:string; instructions:string; objective:string;
  model?:string; temperature?:number; maxTokens?:number; [key:string]:unknown;
}
export interface GeneratedResponse {
  text:string; provider:string; model:string; latencyMs:number; intent:string;
  confidence:number; usedKnowledge:number; agentId:string|null;
}
