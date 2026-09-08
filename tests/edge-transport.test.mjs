import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

// Exercise Request construction in workerd: Node's fetch accepts redirect:error,
// while the deployed edge runtime rejects it before making a network request.
test('edge transports accept normal responses and never follow redirects', { timeout: 20000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { outputFiles } = await build({
    stdin: { resolveDir: root, contents: `
      import { fetchOandaAccountId } from './lib/oanda-api.ts';
      import { llmFetch } from './lib/llm-provider.ts';
      export default { async fetch() {
        const original = globalThis.fetch;
        const results = [];
        try {
          for (const status of [200, 302]) {
            let calls = 0;
            globalThis.fetch = async (url, init) => {
              const request = new Request(url, init);
              if (request.redirect !== 'manual') throw new Error('Redirects must not be followed');
              calls++;
              return Response.json({accounts:[{id:'example'}],status:'completed',output:[]}, {
                status, headers: status === 302 ? {Location:'https://other.example'} : {}
              });
            };
            let brokerAccepted = false;
            try { brokerAccepted = await fetchOandaAccountId('fake', 'practice') === 'example'; } catch {}
            const model = await llmFetch('https://api.example.com/responses', {
              method:'POST',headers:{Authorization:'Bearer fake'},body:JSON.stringify({model:'test'})
            });
            results.push({status,brokerAccepted,modelAccepted:model.ok,calls});
          }
          return Response.json(results);
        } finally { globalThis.fetch = original; }
      }};
    ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'esnext',
  });
  const mf = new Miniflare({ workers: [{ config: {
    name: 'transport-test', type: 'worker', compatibilityDate: '2026-09-03',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: outputFiles[0].text } } },
  } }] });
  try {
    const response = await mf.dispatchFetch('http://localhost/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      { status: 200, brokerAccepted: true, modelAccepted: true, calls: 2 },
      { status: 302, brokerAccepted: false, modelAccepted: false, calls: 2 },
    ]);
  } finally { await mf.dispose(); }
});
