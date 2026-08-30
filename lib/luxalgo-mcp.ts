const ENDPOINT = "https://mcp.luxalgo.com/mcp";

export type LuxAlgoGrounding = {
  slug: string;
  name: string;
  family: string;
  url: string;
  excerpt: string;
};

type McpEnvelope = {
  result?: { content?: Array<{ type?: string; text?: string }> };
  error?: { message?: string };
};

async function callLuxAlgo<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`LuxAlgo MCP returned ${response.status}.`);
  const body = await response.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
  const envelope = JSON.parse(
    dataLine ? dataLine.slice(5).trim() : body,
  ) as McpEnvelope;
  if (envelope.error)
    throw new Error(envelope.error.message || "LuxAlgo MCP request failed.");
  const toolText = envelope.result?.content?.find(
    (item) => item.type === "text",
  )?.text;
  if (!toolText) throw new Error("LuxAlgo MCP returned no research content.");
  return JSON.parse(toolText) as T;
}

// These are independent confirmation families. If a newer library does not
// expose one of the optional concepts, the MCP call is safely ignored while
// the core liquidity, momentum and volatility checks remain available.
const concepts = [
  "price-action-concepts",
  "liquidity-sweep",
  "order-blocks",
  "imbalances",
  "support-resistance",
  "rsi",
  "atr-based-stop-distance",
];

export async function getLuxAlgoGrounding(): Promise<LuxAlgoGrounding[]> {
  const settled = await Promise.allSettled(
    concepts.map((slug) =>
      callLuxAlgo<{
        slug?: unknown;
        name?: unknown;
        family?: unknown;
        url?: unknown;
        content_markdown?: unknown;
      }>("library_get_concept", { slug }),
    ),
  );
  const grounding = settled.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const value = result.value;
    if (
      typeof value.content_markdown !== "string" ||
      !value.content_markdown.trim()
    )
      return [];
    return [
      {
        slug: typeof value.slug === "string" ? value.slug : "unknown-concept",
        name:
          typeof value.name === "string"
            ? value.name
            : "LuxAlgo research concept",
        family:
          typeof value.family === "string" ? value.family : "LuxAlgo Library",
        url:
          typeof value.url === "string"
            ? value.url
            : "https://www.luxalgo.com/library/",
        excerpt: value.content_markdown.slice(0, 3600),
      },
    ];
  });
  if (!grounding.length)
    throw new Error(
      "LuxAlgo MCP is temporarily unavailable; no ungrounded strategy was generated.",
    );
  return grounding;
}
