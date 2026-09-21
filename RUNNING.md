# Running the app

The app is two processes that must both be running: a **backend** (FastAPI, port 8000) that
holds the index and the OpenAI key, and a **frontend** (Vite dev server, port 5173) that the
browser loads. They need separate terminals.

Commands below are PowerShell on Windows. In bash, replace `;` with `&&`.

---

## Quick start

**Terminal 1 — backend**

```powershell
cd C:\JEFF_FILES\JEFF_PROJECTS\AI\simple-rag-ui\backend
python -m uvicorn app.main:app --port 8000
```

Wait for `Application startup complete.` before moving on.

**Terminal 2 — frontend**

```powershell
cd C:\JEFF_FILES\JEFF_PROJECTS\AI\simple-rag-ui\frontend
npm run dev
```

Then open **http://localhost:5173**.

> `cd` into `backend` is required — `app.main:app` resolves relative to that directory, so
> running uvicorn from the repo root fails with `ModuleNotFoundError: No module named 'app'`.

> Start the backend first. If the frontend loads with no API behind it, the page shows a
> red banner and does **not** retry automatically — reload once the backend is up.

---

## Stopping

**Normally:** `Ctrl-C` in each terminal.

**If a process is orphaned** (terminal closed, or a port is still in use):

```powershell
# backend
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# frontend
Get-NetTCPConnection -LocalPort 5173 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

To look before killing:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object Id, ProcessName }
```

The backend shows as `python`, the frontend as `node`.

---

## First-time setup

Only needed on a fresh machine, or after moving the project.

```powershell
cd C:\JEFF_FILES\JEFF_PROJECTS\AI\simple-rag-ui\backend
pip install -r requirements.txt
Copy-Item .env.example .env        # then edit .env and paste your OpenAI key

cd ..\frontend
npm install
```

`backend/.env` must contain:

```
OPENAI_API_KEY=sk-...
```

It is gitignored and never leaves the backend process. The browser never receives it.

---

## Checking it works

Is the backend up and is the index built?

```powershell
curl.exe http://127.0.0.1:8000/api/health
```

A healthy backend returns:

```json
{"status":"ok","chunks":6,"embed_model":"text-embedding-3-small","chat_model":"gpt-4o-mini"}
```

`chunks: 0` means the index is empty or broken — check `docs/sample_docs.md` exists and has
`##` headers.

Does the full pipeline answer? In **PowerShell**, use `Invoke-RestMethod`:

```powershell
$body = @{ question = "what is the daily meal limit?"; history = @() } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/chat" -Method Post -ContentType "application/json" -Body $body
```

It prints the raw SSE stream: a `sources` event, then one `token` event per fragment, then
`done`. (It buffers the whole response rather than showing tokens live, which is fine for a
smoke test.)

In **bash / Git Bash**, curl handles the JSON body directly and does stream live:

```bash
curl -N -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"what is the daily meal limit?","history":[]}'
```

> Two PowerShell gotchas, both verified the hard way. Bare `curl` is an alias for
> `Invoke-WebRequest` and will not accept these flags, so GET requests need `curl.exe`.
> And PowerShell 5.1 mangles double quotes when passing a JSON string to a native
> executable — `curl.exe -d '{\"question\":...}'` fails with a JSON decode error whether the
> quotes are backslash-escaped or held in a variable. Use `Invoke-RestMethod` for POSTs
> instead of fighting it.

---

## The index

Embeddings are cached in `backend/.chroma` and keyed by a SHA-256 hash of the corpus plus
the embedding model name.

- **Unchanged documents:** startup loads from disk, no embedding calls, no cost.
- **Changed documents:** the hash no longer matches, so the next startup re-embeds
  automatically. Nothing to do by hand.
- **Force a rebuild:** delete the cache and restart the backend.

  ```powershell
  Remove-Item -Recurse -Force C:\JEFF_FILES\JEFF_PROJECTS\AI\simple-rag-ui\backend\.chroma
  ```

To use your own documents, replace `docs/sample_docs.md` or point `DOCS_PATH` at another
markdown file. Each `##` section becomes one chunk.

---

## Ports

| Port | Process | Purpose |
|---|---|---|
| 8000 | `python` (uvicorn) | API: `/api/chat`, `/api/sources`, `/api/health` |
| 5173 | `node` (vite) | the web UI; proxies `/api` to port 8000 |

The Vite proxy is why the browser stays same-origin and CORS never comes up in development.
To change the backend port you must change it in **both** places: the uvicorn `--port` flag
and the `proxy` target in `frontend/vite.config.ts`.

Interactive API docs are at http://127.0.0.1:8000/docs while the backend runs.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ModuleNotFoundError: No module named 'app'` | uvicorn started from the wrong directory. `cd backend` first. |
| Red banner: "Cannot reach the API" | Backend not running, or started after the page loaded. Start it, then reload the page. |
| `ValidationError: openai_api_key Field required` | `backend/.env` is missing or has no key. Copy `.env.example` and fill it in. |
| `OpenAI API error: ... insufficient_quota` | The OpenAI account is out of credits. Top up at platform.openai.com billing. |
| `[Errno 10048] address already in use` | An old process still holds the port. Kill it with the commands under **Stopping**. |
| Answers are `I don't know` for things the docs cover | Retrieval problem, not generation. Expand the sources panel under the answer to see which chunks came back and their distances. |
| Frontend loads but styling is broken | Stop `npm run dev` and restart it; Vite occasionally holds a stale module graph after edits to `index.css`. |

---

## Cost

Every question costs two OpenAI calls: one embedding of the question and one chat
completion. With this six-chunk corpus that is a small fraction of a cent per question.
Indexing happens once per document change, not per question.

---

## Before exposing this beyond localhost

This configuration is for local use only. There is no rate limiting, no authentication, and
no spend ceiling — anyone who can reach port 8000 can spend your OpenAI credits. Making it
public needs, at minimum: per-IP rate limiting, a daily question cap, a request size limit,
authentication, and a hard budget limit set on the OpenAI key itself.
