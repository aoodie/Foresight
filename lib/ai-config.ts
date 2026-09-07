export const defaultAiBaseUrl = "https://api.aoodie.xyz/v1";

export function normalizeAiBaseUrl(value?: string) {
  const raw = (value?.trim() || defaultAiBaseUrl).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Enter a valid LLM API base URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("LLM API base URL must use HTTPS without credentials, query parameters, or fragments.");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  // Hosted connections must use public DNS names. This also blocks alternate
  // IPv4 spellings after URL normalization and all IPv6 literal addresses.
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)) throw new Error('Use a public model-provider hostname.');
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function aiEndpoint(baseUrl: string, path: string) {
  return `${normalizeAiBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}
