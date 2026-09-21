export type Source = {
  heading: string;
  text: string;
  distance: number;
};

export type Turn = {
  role: "user" | "assistant";
  content: string;
};

export type StreamEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type Health = {
  status: string;
  chunks: number;
  embed_model: string;
  chat_model: string;
};

export type SourcesInfo = {
  headings: string[];
  examples: string[];
};

export async function getHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health check failed (${res.status})`);
  return res.json();
}

export async function getSources(): Promise<SourcesInfo> {
  const res = await fetch("/api/sources");
  if (!res.ok) throw new Error(`sources request failed (${res.status})`);
  return res.json();
}

/**
 * POST a question and yield server-sent events as they arrive.
 *
 * EventSource cannot be used here because it only issues GET requests, so the
 * SSE framing is parsed by hand off the response body stream.
 */
export async function* streamChat(
  question: string,
  history: Turn[],
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // response had no JSON body; keep the status-based message
    }
    yield { type: "error", message };
    return;
  }
  if (!res.body) {
    yield { type: "error", message: "The server sent an empty response." };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE separates events with a blank line. A chunk can split an event in
    // half, so anything after the last blank line stays buffered.
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseBlock(block);
      if (event) yield event;
    }
  }
}

function parseBlock(block: string): StreamEvent | null {
  let name = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!name) return null;

  let payload: Record<string, unknown> = {};
  if (data) {
    try {
      payload = JSON.parse(data);
    } catch {
      return null;
    }
  }

  switch (name) {
    case "sources":
      return { type: "sources", sources: (payload.sources as Source[]) ?? [] };
    case "token":
      return { type: "token", text: String(payload.text ?? "") };
    case "done":
      return { type: "done" };
    case "error":
      return {
        type: "error",
        message: String(payload.message ?? "Something went wrong."),
      };
    default:
      return null;
  }
}
