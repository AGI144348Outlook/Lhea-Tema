import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/lhea-tema-kernel.js';

test('exports a default object with a fetch handler', () => {
  assert.equal(typeof worker.fetch, 'function');
});

test('OPTIONS request returns a CORS preflight response', async () => {
  const req = new Request('https://example.com/health', { method: 'OPTIONS' });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
});

test('GET /health reports kernel status without needing any D1/AI bindings', async () => {
  const req = new Request('https://example.com/health', { method: 'GET' });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.status, 'online');
  assert.equal(body.system, 'LHEA-TEMA Kernel v2');
  assert.equal(body.ai, 'unbound');
  assert.deepEqual(body.databases, {
    stamp_registry: 'mashet-stamp-registry',
    world_state: 'mashet-world-state',
    tema_substrate: 'mashet-tema-substrate',
  });
});

test('GET /health reports ai as "bound" when an AI binding is present', async () => {
  const req = new Request('https://example.com/health', { method: 'GET' });
  const res = await worker.fetch(req, { AI: {} });
  const body = await res.json();
  assert.equal(body.ai, 'bound');
});

test('unknown route returns a 404 with the path echoed back', async () => {
  const req = new Request('https://example.com/does-not-exist');
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 404);

  const body = await res.json();
  assert.equal(body.error, 'Route not found');
  assert.equal(body.path, '/does-not-exist');
});
