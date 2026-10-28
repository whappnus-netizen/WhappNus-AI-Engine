import { randomUUID } from "node:crypto";
import { supabase } from "./db.js";

/**
 * One billable AI conversation is counted once per subscription period.
 * A test without a persisted conversation receives a unique ID and is counted
 * as a test conversation, so the test endpoint cannot bypass plan limits.
 */
export async function consumeCredit(organizationId: string, conversationId?: string | null) {
  const billableConversationId = conversationId ?? randomUUID();
  const result = await supabase.rpc("consume_ai_conversation", {
    p_organization_id: organizationId,
    p_conversation_id: billableConversationId,
  });

  if (result.error) throw new Error("AI_CONVERSATION_LIMIT_CHECK_FAILED");

  const row = (result.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>;
  if (row.allowed === false) {
    const reason = typeof row.reason === "string" ? row.reason : "AI_CONVERSATION_LIMIT_REACHED";
    throw new Error(reason);
  }

  return {
    enabled: true,
    remaining: typeof row.remaining === "number" ? row.remaining : null,
    limit: typeof row.limit === "number" ? row.limit : null,
    used: typeof row.used === "number" ? row.used : null,
  };
}
