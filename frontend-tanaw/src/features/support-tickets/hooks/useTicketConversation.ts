import { useEffect, useRef, useState } from "react";
import type { SupportTicketDetail } from "@/shared/services/supportTickets";

export function useTicketConversation(ticket: SupportTicketDetail | undefined) {
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const previousMessageIdRef = useRef<string | null>(null);
  const latestMessage = ticket?.messages.at(-1);

  const scrollToLatest = () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    conversation.scrollTo({ top: conversation.scrollHeight, behavior });
    wasNearBottomRef.current = true;
    setHasNewMessage(false);
  };

  useEffect(() => {
    const messageId = latestMessage?.id ?? null;
    if (!ticket || messageId === previousMessageIdRef.current) return;

    const isInitialLoad = previousMessageIdRef.current === null;
    previousMessageIdRef.current = messageId;
    if (isInitialLoad || wasNearBottomRef.current) {
      window.requestAnimationFrame(scrollToLatest);
    } else {
      setHasNewMessage(true);
    }
    if (!isInitialLoad && latestMessage) {
      setAnnouncement(`New support ticket reply from ${latestMessage.authorName}`);
    }
  }, [latestMessage, ticket]);

  const handleScroll = () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    wasNearBottomRef.current = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 72;
    if (wasNearBottomRef.current) setHasNewMessage(false);
  };

  return { announcement, conversationRef, handleScroll, hasNewMessage, scrollToLatest };
}
