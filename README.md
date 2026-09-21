# simple-rag-ui

A chat interface for [simple-rag](https://github.com/Jeffs0412/simple-rag) — ask questions
about a markdown corpus and get answers grounded in it, with the retrieved sources shown
under every answer.

Runs locally: a FastAPI backend holds the index and the API key, a React frontend talks to
it over streaming HTTP.

```
browser ──/api/chat──> FastAPI ──embed──> ChromaDB (persisted)
                          │                    │
                          │<───top 2 chunks────┘
                          │
                          └──context + question──> gpt-4o-mini ──tokens──> browser
```

## Why a backend at all

The API key must never reach the browser. Anything the frontend can read, a visitor can
read, so all OpenAI calls happen server-side and the browser only ever sees chunks and
tokens.

## What the API adds over the CLI

The CLI version rebuilds its index on every run, which is correct for a one-shot script and
wrong for a server. This version:

- **builds the index once at startup** (`lifespan`), not per request — otherwise every
  question would re-embed the whole corpus
- **persists embeddings** in `backend/.chroma`, keyed by a SHA-256 hash of the corpus plus
  the embedding model name, so a restart re-embeds only when documents actually changed
- **streams the answer** as Server-Sent Events, sending the retrieved sources *first* so the
  UI can show citations while the model is still generating
- **handles follow-ups** by prepending the previous user turn to the retrieval query. Ask
  "when are deploys allowed?" then "what about Fridays?" and the second question still
  retrieves the deployment section, which it would not if embedded on its own

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `POST` | `/api/chat` | SSE stream: `sources` → `token`… → `done`, or `error` |
| `GET` | `/api/sources` | indexed section headings + example questions |
| `GET` | `/api/health` | index status, chunk count, models in use |

## Setup

Two processes. Backend first:

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # put your OpenAI key in .env
uvicorn app.main:app --port 8000
```

Then the frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Vite proxies `/api` to port 8000, so the browser stays same-origin and CORS never comes
into play in development.

## UI design

The interface is built around one idea: **make retrieval visible.** When a RAG answer is
wrong, the cause is usually retrieval rather than generation, and you cannot tell which
without seeing what was retrieved.

- **Sources panel under every answer**, collapsed to `2 sources · Expense Policy, Vacation
  and Leave`. Expanded, each chunk shows its text, its embedding distance, and a relevance
  bar. Built on `<details>`, so keyboard and screen-reader support come for free.
- **`I don't know` is styled as a correct outcome**, not a failure, with a note explaining
  that the question falls outside the indexed documents.
- **Empty state offers example questions** generated from the real section headings, so the
  corpus boundaries are visible before you type anything.
- Streaming cursor, `aria-live` on the answer, Enter to send / Shift+Enter for a newline,
  stop button to abort mid-stream, dark mode via `prefers-color-scheme`.

Styling is plain CSS with custom-property tokens — no Tailwind. For a single-page interface
this is fewer moving parts than a utility framework and no build configuration to keep
current.

## Layout

```
backend/
  app/
    main.py      FastAPI app, SSE streaming, lifespan index build
    rag.py       chunking, persistent index, retrieval, prompt assembly
    config.py    settings via pydantic-settings
    schemas.py   request/response models
  requirements.txt
frontend/
  src/
    App.tsx                   thread state, streaming, abort
    lib/api.ts                SSE client (parses the wire format by hand)
    components/
      Message.tsx             one turn; refusal styling
      SourcePanel.tsx         the collapsible citations
      Composer.tsx            auto-growing textarea
    index.css                 design tokens, light + dark
docs/sample_docs.md           the indexed corpus
```

## Using your own documents

Replace `docs/sample_docs.md`, or point `DOCS_PATH` at another file. Each `##` section
becomes one chunk. The corpus hash changes, so the next start re-embeds automatically.

## Not in this version

No auth, no accounts, no document upload, no chat persistence — the thread lives in React
state and is gone on reload. Retrieval is a fixed top 2 chunks with no re-ranking.

**This is a localhost app.** Before exposing it to the internet it needs, at minimum,
per-IP rate limiting, a request size cap, a daily question ceiling, and a hard spend limit
on the OpenAI key — otherwise anyone with the URL is spending your credits.

## License

MIT
