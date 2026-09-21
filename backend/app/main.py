"""FastAPI server exposing the RAG pipeline as a streaming chat API.

The OpenAI key stays in this process. The browser never sees it, which is the
whole reason this backend exists rather than calling OpenAI from the frontend.

Runs on localhost only. If this is ever exposed publicly, it needs per-IP rate
limiting and a spend ceiling first -- see the README.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import APIError, AsyncOpenAI

from .config import get_settings
from .rag import RagIndex, build_messages, retrieval_query
from .schemas import ChatRequest, HealthOut, SourcesOut

log = logging.getLogger("ragui")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    index = RagIndex(settings, client)
    await index.build()
    log.info("index ready: %d chunks", index.chunk_count)

    app.state.client = client
    app.state.index = index
    yield
    await client.close()


app = FastAPI(title="simple-rag-ui API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def sse(event: str, payload: dict) -> str:
    """One Server-Sent Event. JSON encoding keeps newlines out of the wire format."""
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@app.get("/api/health", response_model=HealthOut)
async def health(request: Request) -> HealthOut:
    index: RagIndex = request.app.state.index
    return HealthOut(
        status="ok" if index.chunk_count else "empty",
        chunks=index.chunk_count,
        embed_model=settings.embed_model,
        chat_model=settings.chat_model,
    )


@app.get("/api/sources", response_model=SourcesOut)
async def sources(request: Request) -> SourcesOut:
    index: RagIndex = request.app.state.index
    topics = [h for h in index.headings if h != "Introduction"]
    return SourcesOut(
        headings=index.headings,
        examples=[f"What does the handbook say about {h.lower()}?" for h in topics[:4]],
    )


@app.post("/api/chat")
async def chat(request: Request, body: ChatRequest) -> StreamingResponse:
    index: RagIndex = request.app.state.index
    client: AsyncOpenAI = request.app.state.client

    history = [t.model_dump() for t in body.history][-settings.max_history_turns :]

    async def stream() -> AsyncIterator[str]:
        try:
            hits = await index.retrieve(retrieval_query(body.question, history))
            # Sources go out first so the UI can render citations while the model
            # is still generating.
            yield sse(
                "sources",
                {
                    "sources": [
                        {"heading": h.heading, "text": h.text, "distance": h.distance}
                        for h in hits
                    ]
                },
            )

            completion = await client.chat.completions.create(
                model=settings.chat_model,
                temperature=0,
                max_tokens=settings.max_output_tokens,
                messages=build_messages(body.question, hits, history),
                stream=True,
            )
            async for chunk in completion:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content
                if delta:
                    yield sse("token", {"text": delta})

            yield sse("done", {})
        except APIError as exc:
            log.exception("openai error")
            message = getattr(exc, "message", None) or "The language model is unavailable."
            yield sse("error", {"message": message})
        except Exception:
            log.exception("chat failed")
            yield sse("error", {"message": "Something went wrong answering that."})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
