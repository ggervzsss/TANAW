import { createContext, useContext, useEffect } from "react";

export type PersistentIssueTone = "error" | "warning";

export type PersistentIssue = {
  id: string;
  message: string;
  title: string;
  tone: PersistentIssueTone;
};

export type PersistentIssueContextValue = {
  removeIssue: (id: string) => void;
  upsertIssue: (issue: PersistentIssue) => void;
};

const emptyIssueContext: PersistentIssueContextValue = {
  removeIssue: () => undefined,
  upsertIssue: () => undefined,
};

export const PersistentIssueContext =
  createContext<PersistentIssueContextValue>(emptyIssueContext);

export function usePersistentIssue({
  id,
  message,
  title,
  tone,
}: {
  id: string;
  message: string | null | undefined;
  title: string;
  tone: PersistentIssueTone;
}) {
  const { removeIssue, upsertIssue } = useContext(PersistentIssueContext);
  const userFacingMessage = message ? getUserFacingIssueMessage(message) : null;

  useEffect(() => {
    if (!userFacingMessage) {
      removeIssue(id);
      return;
    }
    upsertIssue({ id, message: userFacingMessage, title, tone });
  }, [id, removeIssue, title, tone, upsertIssue, userFacingMessage]);

  useEffect(() => () => removeIssue(id), [id, removeIssue]);
}

export function getUserFacingIssueMessage(message: string) {
  const normalized = message.trim();
  const lowerMessage = normalized.toLowerCase();

  if (lowerMessage.includes("did not expose the required camera runtime api")) {
    return "The local camera service is not ready yet. TANAW will keep checking automatically.";
  }
  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return "The local camera service is taking longer than expected. TANAW will keep checking automatically.";
  }
  if (
    lowerMessage.includes("network error") ||
    lowerMessage.includes("failed to fetch") ||
    lowerMessage.includes("service bridge is unavailable")
  ) {
    return "TANAW cannot reach the local camera service. It will keep trying automatically.";
  }
  return normalized;
}
