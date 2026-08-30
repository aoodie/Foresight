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

async function callLuxAlgo<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
  });
  if (!response.ok) throw new Error(`LuxAlgo MCP returned ${response.status}.`);
  const body = await response.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
  const envelope = JSON.parse(dataLine ? dataLine.slice(5).trim() : body) as McpEnvelope;
  if (envelope.error) throw new Error(envelope.error.message || "LuxAlgo MCP request failed.");
  const toolText = envelope.result?.content?.find((item) => item.type === "text")?.text;
  if (!toolText) throw new Error("LuxAlgo MCP returned no research content.");
  return JSON.parse(toolText) as T;
}

// These are independent confirmation families. If a newer library does not
// expose one of the optional concepts, the MCP call is safely ignored while
// the core liquidity, momentum and volatility checks remain available.
const concepts = ["price-action-concepts", "liquidity-sweep", "order-blocks", "imbalances", "support-resistance", "rsi", "atr-based-stop-distance"];

export async function getLuxAlgoGrounding(): Promise<LuxAlgoGrounding[]> {
  const settled = await Promise.allSettled(concepts.map((slug) => callLuxAlgo<{
    slug: string;
    name: string;
    family: string;
    url: string;
    content_markdown: string;
  }>("library_get_concept", { slug })));
  const grounding = settled.flatMap((result) => result.status === "fulfilled" ? [{
    slug: result.value.slug,
    name: result.value.name,
    family: result.value.family,
    url: result.value.url,
    excerpt: result.value.content_markdown.slice(0, 3600),
  }] : []);
  if (!grounding.length) throw new Error("LuxAlgo MCP is temporarily unavailable; no ungrounded strategy was generated.");
  return grounding;
}
