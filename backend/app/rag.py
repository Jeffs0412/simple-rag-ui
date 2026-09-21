"""The RAG pipeline, adapted from the simple-rag CLI for server use.

Two differences from the CLI version, both of which matter once there is a server:

* the index is built once and reused, not rebuilt per question
* embeddings are persisted and keyed by a corpus hash, so a restart re-embeds
  only when the documents actually changed
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import chromadb
from openai import AsyncOpenAI

from .config import Settings

COLLECTION_NAME = "docs"

SYSTEM_PROMPT = """You are a question-answering assistant restricted to the CONTEXT below.

Rules:
1. Answer ONLY using facts stated in the CONTEXT. Do not use outside knowledge.
2. If the CONTEXT does not contain the answer, reply with exactly: I don't know
3. Do not guess, infer beyond the text, or pad the answer with caveats.
4. Keep the answer short and cite the section heading(s) you used."""


@dataclass
class Chunk:
    heading: str
    text: str


@dataclass
class Hit:
    heading: str
    text: str
    distance: float


def chunk_markdown(path: Path) -> list[Chunk]:
    """Split a markdown file on `##` headers, keeping each heading with its body."""
    raw = path.read_text(encoding="utf-8")
    parts = re.split(r"^##\s+(.+)$", raw, flags=re.MULTILINE)

    chunks: list[Chunk] = []
    preamble = parts[0].strip()
    if preamble:
        chunks.append(Chunk("Introduction", preamble))

    for heading, body in zip(parts[1::2], parts[2::2]):
        heading, body = heading.strip(), body.strip()
        if body:
            chunks.append(Chunk(heading, f"## {heading}\n\n{body}"))

    return chunks


def corpus_hash(chunks: list[Chunk], embed_model: str) -> str:
    """Identity of the indexed content. Changing the model invalidates it too."""
    digest = hashlib.sha256(embed_model.encode("utf-8"))
    for chunk in chunks:
        digest.update(chunk.text.encode("utf-8"))
    return digest.hexdigest()


class RagIndex:
    """Holds the Chroma collection and serves retrieval queries."""

    def __init__(self, settings: Settings, client: AsyncOpenAI):
        self.settings = settings
        self.client = client
        self.collection: chromadb.api.models.Collection.Collection | None = None
        self.headings: list[str] = []

    async def build(self) -> None:
        settings = self.settings
        chunks = chunk_markdown(settings.docs_path)
        if not chunks:
            raise RuntimeError(f"No content found in {settings.docs_path}")

        self.headings = [c.heading for c in chunks]
        want_hash = corpus_hash(chunks, settings.embed_model)

        settings.chroma_path.mkdir(parents=True, exist_ok=True)
        chroma = chromadb.PersistentClient(path=str(settings.chroma_path))

        existing = {c.name for c in chroma.list_collections()}
        if COLLECTION_NAME in existing:
            collection = chroma.get_collection(COLLECTION_NAME)
            have_hash = (collection.metadata or {}).get("corpus_hash")
            if have_hash == want_hash and collection.count() == len(chunks):
                self.collection = collection
                return  # documents unchanged; reuse the stored embeddings
            chroma.delete_collection(COLLECTION_NAME)

        collection = chroma.create_collection(
            name=COLLECTION_NAME, metadata={"corpus_hash": want_hash}
        )
        response = await self.client.embeddings.create(
            model=settings.embed_model, input=[c.text for c in chunks]
        )
        collection.add(
            ids=[f"chunk-{i}" for i in range(len(chunks))],
            documents=[c.text for c in chunks],
            embeddings=[item.embedding for item in response.data],
            metadatas=[{"heading": c.heading} for c in chunks],
        )
        self.collection = collection

    @property
    def chunk_count(self) -> int:
        """Never raises: /api/health must be able to report a broken index."""
        if self.collection is None:
            return 0
        try:
            return self.collection.count()
        except Exception:  # collection dropped or store unreadable
            return 0

    async def retrieve(self, query: str) -> list[Hit]:
        if self.collection is None:
            raise RuntimeError("index not built")

        embedding = (
            await self.client.embeddings.create(
                model=self.settings.embed_model, input=[query]
            )
        ).data[0].embedding

        result = self.collection.query(
            query_embeddings=[embedding],
            n_results=min(self.settings.top_k, self.collection.count()),
        )
        return [
            Hit(heading=meta["heading"], text=doc, distance=dist)
            for doc, meta, dist in zip(
                result["documents"][0], result["metadatas"][0], result["distances"][0]
            )
        ]


def retrieval_query(question: str, history: list[dict[str, str]]) -> str:
    """Build the text to embed for retrieval.

    A bare follow-up ("what about Fridays?") embeds into nothing useful on its own,
    so the previous user turn is prepended to give it subject matter. A dedicated
    query-rewriting LLM call would do this better; this costs nothing.
    """
    previous = [m["content"] for m in history if m.get("role") == "user"]
    if not previous:
        return question
    return f"{previous[-1]}\n{question}"


def build_messages(
    question: str, hits: list[Hit], history: list[dict[str, str]]
) -> list[dict[str, str]]:
    context = "\n\n---\n\n".join(hit.text for hit in hits)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append(
        {"role": "user", "content": f"CONTEXT:\n{context}\n\nQUESTION: {question}"}
    )
    return messages
