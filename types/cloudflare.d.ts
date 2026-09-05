// Import runtime types without merging Workers globals into browser DOM types.
type D1Database = import("@cloudflare/workers-types").D1Database;
type Fetcher = { fetch: typeof fetch };
declare module "cloudflare:workers" {
  export const env: { DB: D1Database; ASSETS?: Fetcher };
}
