import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { Message, type ChatMessage } from "./components/Message";
import {
  getHealth,
  getSources,
  streamChat,
  type Health,
  type SourcesInfo,
  type Turn,
} from "./lib/api";

const MAX_CHARS = 500;
const HISTORY_TURNS = 6;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [info, setInfo] = useState<SourcesInfo | null>(null);
  const [offline, setOffline] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([getHealth(), getSources()])
      .then(([h, s]) => {
        setHealth(h);
        setInfo(s);
      })
      .catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      const history: Turn[] = messages
        .filter((m) => !m.error)
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));

      const answerId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: trimmed },
        { id: answerId, role: "assistant", content: "", streaming: true },
      ]);
      setDraft("");
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fields: Partial<ChatMessage>) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === answerId ? { ...m, ...fields } : m)),
        );

      try {
        for await (const event of streamChat(trimmed, history, controller.signal)) {
          if (event.type === "sources") {
            patch({ sources: event.sources });
          } else if (event.type === "token") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === answerId ? { ...m, content: m.content + event.text } : m,
              ),
            );
          } else if (event.type === "error") {
            patch({ content: event.message, error: true, streaming: false });
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          patch({
            content: "Could not reach the server. Is the backend running?",
            error: true,
          });
        }
      } finally {
        patch({ streaming: false });
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages],
  );

  const stop = () => abortRef.current?.abort();

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1>Handbook Assistant</h1>
            <p className="tagline">
              Answers only from the indexed documents, with its sources shown.
            </p>
          </div>
          {health && (
            <div className="badges">
              <span className="badge">{health.chunks} chunks</span>
              <span className="badge">{health.chat_model}</span>
            </div>
          )}
        </div>
      </header>

      <main className="thread">
        {offline && (
          <p className="banner" role="alert">
            Cannot reach the API. Start the backend with{" "}
            <code>uvicorn app.main:app --port 8000</code> and reload.
          </p>
        )}

        {messages.length === 0 && !offline && (
          <div className="empty">
            <h2>Ask about the handbook</h2>
            <p>
              It knows about{" "}
              {info?.headings
                .filter((h) => h !== "Introduction")
                .join(", ")
                .toLowerCase() || "the indexed documents"}
              . Anything else and it will say so rather than guess.
            </p>
            <div className="chips">
              {info?.examples.map((example) => (
                <button key={example} className="chip" onClick={() => ask(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="footer">
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => ask(draft)}
          onStop={stop}
          busy={busy}
          maxChars={MAX_CHARS}
        />
      </footer>
    </div>
  );
}
