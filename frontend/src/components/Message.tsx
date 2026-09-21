import { SourcePanel } from "./SourcePanel";
import type { Source } from "../lib/api";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  streaming?: boolean;
  error?: boolean;
};

const DONT_KNOW = "i don't know";

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="turn turn-user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }

  // A refusal is the pipeline working, not failing, so it gets its own
  // treatment rather than looking like a broken answer.
  const refused =
    !message.streaming &&
    message.content.trim().toLowerCase().replace(/[.]$/, "") === DONT_KNOW;

  return (
    <div className="turn turn-assistant">
      {message.error ? (
        <p className="answer-error" role="alert">
          {message.content}
        </p>
      ) : refused ? (
        <div className="answer-refusal">
          <p className="answer">I don't know</p>
          <p className="refusal-hint">
            That isn't covered by the indexed documents. The assistant only answers
            from the handbook, so it declines rather than guessing.
          </p>
        </div>
      ) : (
        <p className="answer" aria-live="polite" aria-busy={message.streaming}>
          {message.content}
          {message.streaming && <span className="cursor" aria-hidden="true" />}
        </p>
      )}
      {message.sources && <SourcePanel sources={message.sources} />}
    </div>
  );
}
