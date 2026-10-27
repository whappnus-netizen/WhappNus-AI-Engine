import { randomUUID } from "node:crypto";
import { supabase } from "./db.js";

/** Count one AI reply per unique inbound message during the current subscription period. */
export async function consumeCredit(
  organizationId: string,
  messageKey?: string | null,
  conversationId?: string | null,
) {
  const result = await supabase.rpc("consume_ai_message", {
    p_organization_id: organizationId,
    p_message_key: messageKey ?? randomUUID(),
    p_conversation_id: conversationId ?? null,
  });
  if (result.error) throw new Error("AI_MESSAGE_LIMIT_CHECK_FAILED");
  const row = (result.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>;
  if (row.allowed === false) throw new Error(typeof row.reason === "string" ? row.reason : "AI_MESSAGE_LIMIT_REACHED");
  return {
    enabled: true,
    remaining: typeof row.remaining === "number" ? row.remaining : null,
    limit: typeof row.limit === "number" ? row.limit : null,
    used: typeof row.used === "number" ? row.used : null,
  };
}
