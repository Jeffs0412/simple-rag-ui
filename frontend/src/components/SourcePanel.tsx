import type { Source } from "../lib/api";

/**
 * The retrieved chunks, collapsed by default.
 *
 * This is the point of the whole UI: when a RAG answer is wrong, the cause is
 * usually retrieval rather than generation, and you cannot tell which unless
 * you can see what was actually retrieved. `<details>` gives keyboard support
 * and correct semantics for free.
 */
export function SourcePanel({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;

  const headings = sources.map((s) => s.heading).join(", ");
  const label = `${sources.length} source${sources.length === 1 ? "" : "s"}`;

  return (
    <details className="sources">
      <summary>
        <span className="sources-count">{label}</span>
        <span className="sources-headings">{headings}</span>
      </summary>
      <ol className="source-list">
        {sources.map((source, i) => (
          <li key={`${source.heading}-${i}`} className="source">
            <div className="source-head">
              <span className="source-heading">{source.heading}</span>
              <span className="source-distance" title="Embedding distance: lower is a closer match">
                {source.distance.toFixed(3)}
              </span>
            </div>
            <Relevance distance={source.distance} />
            <p className="source-text">{stripHeading(source.text)}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Distance as a bar. Cosine distances from text-embedding-3-small land roughly
 * in 0.3-1.8 for this kind of corpus, so that range is mapped to the bar rather
 * than a theoretical 0-2.
 */
function Relevance({ distance }: { distance: number }) {
  const closeness = Math.max(0, Math.min(1, (1.8 - distance) / 1.5));
  return (
    <div className="relevance" aria-hidden="true">
      <div className="relevance-fill" style={{ width: `${closeness * 100}%` }} />
    </div>
  );
}

/** The heading is already shown in the panel header; drop the markdown line. */
function stripHeading(text: string): string {
  return text.replace(/^##\s+.+\n+/, "");
}
