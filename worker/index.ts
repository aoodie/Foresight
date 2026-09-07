/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { boundedBody, privateResponse, requestProblem } from '../lib/request-security';

interface Env {
  FORESIGHT_OWNER_EMAIL?: string;
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.startsWith('/api/') && decoded !== url.pathname) return privateResponse(Response.json({ error: 'Use the canonical API path.' }, { status: 400 }));
    } catch { return privateResponse(Response.json({ error: 'Invalid request path.' }, { status: 400 })); }
    if (url.pathname.startsWith('/api/')) {
      const problem = requestProblem(request, env.FORESIGHT_OWNER_EMAIL);
      if (problem) return privateResponse(Response.json({ error: problem.error }, { status: problem.status }));
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        try {
          const body = await boundedBody(request, url.pathname === '/api/quant' ? 2 * 1024 * 1024 : 128 * 1024);
          JSON.parse(new TextDecoder().decode(body));
          request = new Request(request.url, { method: request.method, headers: request.headers, body });
        } catch (error) {
          const oversized = error instanceof Error && error.message === 'Request is too large.';
          return privateResponse(Response.json({ error: oversized ? 'Request is too large.' : 'Send valid JSON.' }, { status: oversized ? 413 : 400 }));
        }
      }
    }
    // Existing authenticated worker heartbeats also drive due research when the
    // website is closed. The route validates the worker secret before success.
    if(url.pathname === '/api/autotrader/events' && request.method === 'POST') {
      const body=await request.clone().json().catch(()=>null) as {type?:string;payload?:{event?:string}}|null;
      const response=await handler.fetch(request,env,ctx);
      if(response.ok&&body?.type==='log'&&body.payload?.event==='worker.heartbeat') {
        ctx.waitUntil(import('../lib/quant/automatic').then(m=>m.runAutomaticResearch()).then(()=>undefined).catch(()=>undefined));
      }
      return privateResponse(response);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    return url.pathname.startsWith('/api/') ? privateResponse(response) : response;
  },
};

export default worker;
