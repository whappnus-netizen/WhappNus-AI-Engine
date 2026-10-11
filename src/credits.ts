import { randomUUID } from "node:crypto";
import { supabase } from "./db.js";

/** Count a billable AI conversation once per subscription period. */
export async function consumeCredit(organizationId: string, conversationId?: string | null) {
  const billableConversationId = conversationId ?? randomUUID();
  const result = await supabase.rpc("consume_ai_conversation", {
    p_organization_id: organizationId,
    p_conversation_id: billableConversationId,
  });
  if (result.error) throw new Error("AI_CONVERSATION_LIMIT_CHECK_FAILED");
  const row = (result.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>;
  if (row.allowed === false) throw new Error(typeof row.reason === "string" ? row.reason : "AI_CONVERSATION_LIMIT_REACHED");
  return {
    enabled: true,
    remaining: typeof row.remaining === "number" ? row.remaining : null,
    limit: typeof row.limit === "number" ? row.limit : null,
    used: typeof row.used === "number" ? row.used : null,
  };
}
