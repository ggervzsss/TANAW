import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { Bot, Brain, ArrowUpRight, Send, X } from "lucide-react";
import type { EstablishmentLive, EstablishmentSummary } from "../../camera/services/ml-service";
import type { ReportRecord } from "../../../types/enterprise";
import type { TrendFilter } from "../types/dashboard";

const prompts = ["Analyze visitor trends", "When are our busiest hours?", "Explain my latest visitor report", "What insights can you give me?"];
type Message = { id: number; question: string; answer: string };
export function TanawAssistant({
  open,
  onToggle,
  summary,
  live,
  report,
  filter,
}: {
  open: boolean;
  onToggle: () => void;
  summary: EstablishmentSummary | null;
  live: EstablishmentLive | null;
  report: ReportRecord | null;
  filter: TrendFilter;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const reduceMotion = useReducedMotion();
  const conversation = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const nextMessageId = useRef(messages.length);
  const savedScroll = useRef(0);
  const followLatest = useRef(false);
  const wasOpen = useRef(open);
  const seenMessage = useRef<number | undefined>(messages[messages.length - 1]?.id);
  const [latestMessageId, setLatestMessageId] = useState<number | null>(null);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) launcher.current?.focus({ preventScroll: true });
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    composer.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    const container = conversation.current;
    if (!open || !container) return;
    const newMessage = seenMessage.current !== lastId;
    seenMessage.current = lastId;
    if (newMessage) followLatest.current = true;
    const frame = requestAnimationFrame(() =>
      container.scrollTo({
        top: followLatest.current ? container.scrollHeight : savedScroll.current,
        behavior: newMessage && !reduceMotion ? "smooth" : "instant",
      }),
    );
    const observer = new ResizeObserver(() => {
      if (followLatest.current) container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, lastId, reduceMotion]);
  const appendMessage = (question: string, answer: string) => {
    const id = nextMessageId.current++;
    followLatest.current = true;
    setLatestMessageId(id);
    setMessages((current) => [...current.slice(-19), { id, question, answer }]);
    setInput("");
  };
  const ask = (question: string) => {
    const query = question.trim();
    if (!query) return;
    const period = filter === "Today" ? "today" : filter === "Week" ? "the past 7 days" : "the past 30 days";
    const observed = summary?.days.filter((day) => day.covered_ms > 0 || day.qualified_observations > 0) ?? [];
    const peak = observed.filter((day) => day.peak_occupancy != null).sort((a, b) => b.peak_occupancy! - a.peak_occupancy!)[0];
    let answer: string;
    if (/report|monthly|submission/i.test(query))
      answer = report
        ? `Your latest saved report covers ${report.period ?? report.date}. It records ${report.unique.toLocaleString()} estimated unique visitors. Status: ${report.status}. Open Recent Reports or View All to inspect the saved counts, demographic allocation, and submission history.`
        : "There are no saved reports available. Open Reports to review the current reporting period.";
    else if (/busy|busiest|hour|peak/i.test(query))
      answer = peak
        ? `The highest observed occupancy for ${period} was ${peak.peak_occupancy!.toLocaleString()} people on ${peak.business_date}. Hourly establishment data is not available, so I cannot identify a busiest hour. Gaps in observation may affect this peak.`
        : "No observed occupancy data is available for this period. Start your configured cameras to collect activity.";
    else if (/trend|insight|visitor|occupancy|entr|exit|count/i.test(query))
      answer =
        summary && !["not_collected", "configuration_required"].includes(summary.reconciliation_state)
          ? `For ${period}, ${summary.identification_state === "unavailable" ? "unique visitor estimates are unavailable" : `TANAW recorded ${summary.unique_count.toLocaleString()} estimated unique visitors`}. ${summary.movement_state === "unavailable" ? "Boundary entries and exits are not measured." : `Observed entries: ${summary.entries.toLocaleString()}; exits: ${summary.exits.toLocaleString()}.`} Current occupancy: ${live?.occupancy == null ? "unavailable" : `${live.occupancy.toLocaleString()} people`}. Observation coverage: ${Math.round(summary.coverage_ratio * 100)}%. ${summary.reconciliation_state === "partial" ? "These figures are partial estimates." : "Unique counts are daily estimates; multiple days add those estimates together."}`
          : "Visitor data is unavailable or counting setup is incomplete. Check Camera Setup and start monitoring to collect observations.";
    else
      answer =
        "I can summarize your visitor counts, observed peaks, and latest saved report. Free-form AI analysis is not connected in this application yet. Choose a suggestion to review the available data.";
    appendMessage(query, answer);
  };
  return (
    <AnimatePresence initial={false}>
      {!open ? (
        <motion.button
          key="assistant-launcher"
          ref={launcher}
          type="button"
          className="assistant-launcher"
          aria-label="Open TANAW AI Assistant"
          aria-controls="tanaw-assistant-panel"
          aria-expanded={false}
          onClick={onToggle}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
        >
          <Bot size={48} />
        </motion.button>
      ) : null}
      {open ? (
        <AssistantPanel key="assistant-panel" reduceMotion={Boolean(reduceMotion)}>
          <header>
            <Bot size={43} />
            <div>
              <h2>TANAW AI Assistant</h2>
              <p>Your Smart Tourism Insights Assistant</p>
            </div>
            <button className="design-icon-button" type="button" aria-label="Collapse TANAW AI Assistant" aria-expanded={true} onClick={onToggle}>
              <X size={18} />
            </button>
          </header>
          <div
            ref={conversation}
            className="assistant-conversation"
            role="log"
            aria-label="Assistant conversation"
            aria-live="polite"
            onScroll={(event) => {
              savedScroll.current = event.currentTarget.scrollTop;
              if (event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24) followLatest.current = true;
            }}
            onWheel={() => {
              followLatest.current = false;
            }}
            onPointerDown={() => {
              followLatest.current = false;
            }}
            onKeyDown={(event) => {
              if (["PageUp", "Home", "ArrowUp"].includes(event.key)) followLatest.current = false;
            }}
          >
            <div className="assistant-message">
              <Brain />
              <div>
                Hello! I’m TANAW, your assistant for understanding visitor activity and tourism reports.
                <br />
                <br />I can summarize your available counts and explain how your reports were prepared.
              </div>
            </div>
            <div className="assistant-message">
              <Brain />
              <div>
                <strong>How can I help you?</strong>
                <p>Explore your visitor data and reports.</p>
                <strong className="assistant-try">Try asking</strong>
                {prompts.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => ask(prompt)}>
                    {prompt}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
            {messages.map((message) => (
              <motion.div
                className="assistant-exchange"
                key={message.id}
                initial={!reduceMotion && message.id === latestMessageId ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="assistant-question">{message.question}</p>
                <div className="assistant-message">
                  <Brain />
                  <div>{message.answer}</div>
                </div>
              </motion.div>
            ))}
          </div>
          <p className="assistant-disclosure">{"Data summaries \u00b7 AI service not connected"}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              ask(input);
            }}
          >
            <input
              ref={composer}
              aria-label="Ask TANAW about your visitor data"
              placeholder="Ask TANAW about your visitor data…"
              value={input}
              maxLength={1000}
              onChange={(event) => setInput(event.target.value)}
            />
            <button type="submit" aria-label="Send message" disabled={!input.trim()}>
              <Send size={23} />
            </button>
          </form>
        </AssistantPanel>
      ) : null}
    </AnimatePresence>
  );
}

function AssistantPanel({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean }) {
  const present = useIsPresent();
  return (
    <motion.aside
      id="tanaw-assistant-panel"
      className="design-card tanaw-assistant"
      aria-label="TANAW AI Assistant"
      aria-hidden={!present}
      {...(!present ? { inert: "" } : {})}
      initial={{ opacity: 0, x: 10, scale: 0.99 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 8, scale: 0.99 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.aside>
  );
}
