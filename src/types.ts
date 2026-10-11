export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string; }
export type SupportedAttachmentType = "image" | "audio" | "document" | "video";
export interface MediaAttachment {
  type: SupportedAttachmentType;
  mimeType: string;
  data: string; // Base64-encoded bytes, only held in memory for one generation request.
}
export interface GenerateRequest {
  organizationId: string;
  whatsappNumberId: string;
  conversationId?: string | null;
  contactId?: string | null;
  messageId?: string | null;
  fromWaId?: string | null;
  profileName?: string | null;
  text: string;
  metadata?: Record<string, unknown>;
  agentId?: string | null;
  mediaPath?: string | null;
  mediaMimeType?: string | null;
  messageType?: SupportedAttachmentType | "text" | "system";
}
export interface AgentConfig {
  id: string; name: string; personality: string; instructions: string; objective: string;
  model?: string; temperature?: number; maxTokens?: number; [key: string]: unknown;
}
export interface GeneratedResponse {
  text: string; provider: string; model: string; latencyMs: number; intent: string;
  confidence: number; usedKnowledge: number; agentId: string | null;
}
