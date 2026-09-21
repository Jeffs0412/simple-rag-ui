import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  maxChars: number;
};

export function Composer({ value, onChange, onSubmit, onStop, busy, maxChars }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  const overLimit = value.length > maxChars;
  const canSend = value.trim().length > 0 && !busy && !overLimit;

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <textarea
        ref={ref}
        className="composer-input"
        value={value}
        rows={1}
        placeholder="Ask about the handbook..."
        aria-label="Your question"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter makes a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
      />
      <div className="composer-actions">
        {overLimit && (
          <span className="composer-count over">
            {value.length} / {maxChars}
          </span>
        )}
        {busy ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-send" disabled={!canSend}>
            Ask
          </button>
        )}
      </div>
    </form>
  );
}
