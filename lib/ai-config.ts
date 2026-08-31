export const defaultAiBaseUrl = "https://api.aoodie.xyz/v1";

export function normalizeAiBaseUrl(value?: string) {
  const raw = (value?.trim() || defaultAiBaseUrl).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Enter a valid LLM API base URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("LLM API base URL must be an HTTP(S) URL without credentials, query parameters, or fragments.");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function aiEndpoint(baseUrl: string, path: string) {
  return `${normalizeAiBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}
