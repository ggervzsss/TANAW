import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { ArrowUpRight, Bot, Brain, Send, X } from "lucide-react";
import { ASSISTANT_LAUNCHER_ID } from "../stores/assistant-store";
import { DEFAULT_ML_SERVICE_BASE_URL, getEstablishmentHourly, getEstablishmentLive, getEstablishmentSummary, getMlServiceStatus } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import type { ReportRecord } from "../../../types/enterprise";
import type { TrendFilter } from "../types/dashboard";
import { compose, dataNeeds, loadAssistantData, PERIOD_FOR_FILTER, SUGGESTIONS, understand, type AssistantDataSource, type Language, type LanguagePreference, type Reply } from "../assistant";
import "../tanaw-assistant.css";

const LANGUAGE_STORAGE_KEY = "tanaw:assistant-language";
const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguagePreference; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "Reply in the language of the question" },
  { value: "en", label: "English", hint: "Always reply in English" },
  { value: "tl", label: "Tagalog", hint: "Always reply in Tagalog" },
];

const COPY: Record<Language, { greeting: string; intro: string; prompt: string; tryAsking: string; checking: string; disclosure: string; placeholder: string }> = {
  en: {
    greeting: "Hello! I'm TANAW Insights.",
    intro: "I answer questions about your visitor activity using the counts recorded on this computer. Ask in English or Tagalog.",
    prompt: "How can I help you?",
    tryAsking: "Try asking",
    checking: "Checking your counts…",
    disclosure: "Answers come only from this computer's counts · Works offline",
    placeholder: "Ask about your visitors…",
  },
  tl: {
    greeting: "Kumusta! Ako ang TANAW Insights.",
    intro: "Sinasagot ko ang mga tanong tungkol sa mga bisita gamit ang mga bilang na naitala sa computer na ito. Magtanong sa Tagalog o English.",
    prompt: "Ano ang maitutulong ko?",
    tryAsking: "Subukang itanong",
    checking: "Tinitingnan ang mga bilang…",
    disclosure: "Galing lang sa mga bilang ng computer na ito · Gumagana kahit offline",
    placeholder: "Magtanong tungkol sa mga bisita…",
  },
};

type Message = { id: number; question: string; reply: Reply | null };

function readLanguagePreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "auto" || stored === "en" || stored === "tl") return stored;
  } catch {
    // Storage can be unavailable; Auto still works.
  }
  return "auto";
}

function writeLanguagePreference(value: LanguagePreference) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // The choice still applies until the dashboard closes.
  }
}

export function TanawAssistant({ open, onToggle, filter, report }: { open: boolean; onToggle: () => void; filter: TrendFilter; report: ReportRecord | null }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [language, setLanguage] = useState<LanguagePreference>(readLanguagePreference);
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const { timeFormat } = useSystemDisplayPreferences();
  const reduceMotion = useReducedMotion();
  const conversation = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const nextMessageId = useRef(0);
  const savedScroll = useRef(0);
  const followLatest = useRef(false);
  const wasOpen = useRef(open);
  const mounted = useRef(true);
  const seenMessage = useRef<number | undefined>(undefined);
  const [latestMessageId, setLatestMessageId] = useState<number | null>(null);
  const lastId = messages[messages.length - 1]?.id;
  const pending = messages.some((message) => message.reply == null);
  const lastReplyLanguage = [...messages].reverse().find((message) => message.reply)?.reply?.language;
  const shownLanguage: Language = language === "auto" ? (lastReplyLanguage ?? "en") : language;
  const copy = COPY[shownLanguage];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) document.getElementById(ASSISTANT_LAUNCHER_ID)?.focus({ preventScroll: true });
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

  const source = useMemo<AssistantDataSource>(
    () => ({
      baseUrl: async () => (await getMlServiceStatus()).baseUrl || DEFAULT_ML_SERVICE_BASE_URL,
      summary: getEstablishmentSummary,
      hourly: getEstablishmentHourly,
      live: getEstablishmentLive,
      enterpriseId,
      report,
    }),
    [enterpriseId, report],
  );

  const ask = useCallback(
    async (question: string) => {
      const query = question.trim();
      if (!query || pending) return;
      const id = nextMessageId.current++;
      followLatest.current = true;
      setLatestMessageId(id);
      setInput("");
      setMessages((current) => [...current.slice(-19), { id, question: query, reply: null }]);
      const now = new Date();
      const plan = understand(query, { defaultPeriod: PERIOD_FOR_FILTER[filter], language });
      const data = await loadAssistantData(dataNeeds(plan, now), source);
      const reply = compose(plan, data, { now, timeFormat });
      if (!mounted.current) return;
      setMessages((current) => current.map((message) => (message.id === id ? { ...message, reply } : message)));
    },
    [filter, language, pending, source, timeFormat],
  );

  const chooseLanguage = (value: LanguagePreference) => {
    setLanguage(value);
    writeLanguagePreference(value);
  };

  const suggestions = (replyLanguage: Language) => (
    <>
      <strong className="assistant-try">{COPY[replyLanguage].tryAsking}</strong>
      {SUGGESTIONS[replyLanguage].map((prompt) => (
        <button type="button" key={prompt} disabled={pending} onClick={() => void ask(prompt)}>
          {prompt}
          <ArrowUpRight size={13} />
        </button>
      ))}
    </>
  );

  return (
    <div className="tanaw-assistant-scope">
      <AnimatePresence initial={false}>
        {open ? (
          <AssistantPanel key="assistant-panel" reduceMotion={Boolean(reduceMotion)}>
            <header>
              <Bot size={43} />
              <div>
                <h2>TANAW Insights</h2>
                <p>Answers from your establishment's counts</p>
              </div>
              <button className="design-icon-button" type="button" aria-label="Collapse TANAW Insights" aria-expanded={true} onClick={onToggle}>
                <X size={18} />
              </button>
            </header>
            <div className="assistant-language" role="group" aria-label="Reply language">
              <span aria-hidden="true">Reply in</span>
              {LANGUAGE_OPTIONS.map((option) => (
                <button key={option.value} type="button" aria-pressed={language === option.value} title={option.hint} onClick={() => chooseLanguage(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div
              ref={conversation}
              className="assistant-conversation"
              role="log"
              aria-label="Insights conversation"
              aria-live="polite"
              aria-busy={pending}
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
              <div className="assistant-message" lang={shownLanguage}>
                <Brain />
                <div>
                  <strong>{copy.greeting}</strong>
                  <p>{copy.intro}</p>
                </div>
              </div>
              <div className="assistant-message" lang={shownLanguage}>
                <Brain />
                <div>
                  <strong>{copy.prompt}</strong>
                  {suggestions(shownLanguage)}
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
                  <div className="assistant-message" lang={message.reply?.language ?? shownLanguage}>
                    <Brain />
                    {message.reply ? <ReplyBody reply={message.reply} suggestions={suggestions} /> : <div className="assistant-pending">{copy.checking}</div>}
                  </div>
                </motion.div>
              ))}
            </div>
            <p className="assistant-disclosure">{copy.disclosure}</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask(input);
              }}
            >
              <input ref={composer} aria-label="Ask TANAW about your visitor data" placeholder={copy.placeholder} value={input} maxLength={1000} onChange={(event) => setInput(event.target.value)} />
              <button type="submit" aria-label="Send message" disabled={!input.trim() || pending}>
                <Send size={23} />
              </button>
            </form>
          </AssistantPanel>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ReplyBody({ reply, suggestions }: { reply: Reply; suggestions: (language: Language) => ReactNode }) {
  return (
    <div>
      <p>{reply.text}</p>
      {reply.details.length > 0 && (
        <ul className="assistant-details">
          {reply.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      {reply.notes.map((note) => (
        <p key={note} className="assistant-note">
          {note}
        </p>
      ))}
      {reply.basis && <p className="assistant-basis">{reply.basis}</p>}
      {reply.suggest && suggestions(reply.language)}
    </div>
  );
}

const PANEL_WIDTH_STORAGE_KEY = "tanaw:assistant-width";
const PANEL_MIN_WIDTH = 360;
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_KEY_STEP = 32;

function readPanelWidth() {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= PANEL_MIN_WIDTH ? stored : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

/** Space kept between the end of the Live Occupancy text and the panel's edge. */
const PANEL_TEXT_GAP = 20;

/** Where the text inside an element ends on screen, ignoring the empty part of its column. */
function textRight(element: Element) {
  let right = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    right = Math.max(right, range.getBoundingClientRect().right);
  }
  range.detach();
  return right;
}

/**
 * The widest the panel may grow: its left edge stops just past the end of the Live Occupancy text,
 * so Cameras, Total Entries and Live Occupancy always stay readable.
 */
function maxPanelWidth() {
  const occupancy = document.querySelector('[data-metric-segment="occupancy"]');
  const right = occupancy ? textRight(occupancy) : 0;
  const limit = right > 0 ? window.innerWidth - right - PANEL_TEXT_GAP : window.innerWidth * 0.4;
  return Math.max(PANEL_MIN_WIDTH, Math.round(limit));
}

/** Where the panel starts: just under the topbar. */
function topbarBottom() {
  const topbar = document.querySelector<HTMLElement>(".enterprise-topbar");
  return topbar ? Math.max(0, Math.round(topbar.getBoundingClientRect().bottom)) : 72;
}

/**
 * TANAW Insights docks to the right edge and floats over the dashboard, so opening or widening it
 * never reflows the page. Its left edge drags (or takes the arrow keys) between a readable minimum
 * and the start of Total Entries; the chosen width is remembered on this computer.
 */
function AssistantPanel({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean }) {
  const present = useIsPresent();
  const [width, setWidth] = useState(readPanelWidth);
  const [top, setTop] = useState(topbarBottom);
  const [maxWidth, setMaxWidth] = useState(maxPanelWidth);
  const [dragging, setDragging] = useState(false);
  const shown = Math.min(width, maxWidth);

  useEffect(() => {
    const update = () => {
      setTop(topbarBottom());
      setMaxWidth(maxPanelWidth());
    };
    update();
    window.addEventListener("resize", update);
    // The limit follows the Live Occupancy text, which arrives after loading and changes as it updates.
    const figures = document.querySelector("[data-unified-metrics-header]");
    const watcher = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    if (figures) watcher?.observe(figures, { childList: true, subtree: true, characterData: true });
    return () => {
      window.removeEventListener("resize", update);
      watcher?.disconnect();
    };
  }, []);

  const commit = (next: number) => {
    const limit = maxPanelWidth();
    setMaxWidth(limit);
    const clamped = Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(limit, next)));
    setWidth(clamped);
    try {
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // The width still applies until the app closes.
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging) commit(window.innerWidth - event.clientX);
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };
  const onHandleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: shown + PANEL_KEY_STEP, ArrowRight: shown - PANEL_KEY_STEP, Home: maxPanelWidth(), End: PANEL_MIN_WIDTH };
    if (!(event.key in moves)) return;
    event.preventDefault();
    commit(moves[event.key]);
  };

  return (
    <motion.aside
      id="tanaw-assistant-panel"
      className={`design-card tanaw-assistant tanaw-assistant-dock${dragging ? "is-resizing" : ""}`}
      aria-label="TANAW Insights"
      aria-hidden={!present}
      {...(!present ? { inert: "" } : {})}
      style={{ top, width: shown }}
      initial={{ opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 48 }}
      transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className="tanaw-assistant-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize TANAW Insights"
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => commit(PANEL_DEFAULT_WIDTH)}
        onKeyDown={onHandleKey}
      >
        <span aria-hidden="true" />
      </div>
      {children}
    </motion.aside>
  );
}
