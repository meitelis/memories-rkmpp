'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DEFAULTS, STORAGE_KEY, normalizePreferences, createPreferencesStore, recommendConnection, testConnection } = require('./settings.js');

test('corrupt, missing and invalid stored preferences return validated defaults', () => {
  for (const saved of ['{broken', 'null', '[]', '"hevc"', '{"codec":"unsupported","buffer":"huge","customSeconds":999}']) {
    const store = createPreferencesStore({ getItem: () => saved, setItem() {} });
    assert.deepEqual(store.getPreferences(), DEFAULTS);
  }
  assert.deepEqual(normalizePreferences({ codec: 'h264', buffer: 'custom', customSeconds: 17.8 }),
    { codec: 'h264', buffer: 'custom', customSeconds: 18 });
  assert.equal(normalizePreferences({ customSeconds: '30' }).customSeconds, 12);
  assert.equal(normalizePreferences({ customSeconds: Infinity }).customSeconds, 12);
});

test('blocked storage keeps preferences in memory, notifies once and supports unsubscribe', () => {
  const storage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  const store = createPreferencesStore(storage);
  let calls = 0;
  const unsubscribe = store.subscribe((value) => { calls++; assert.equal(value.buffer, 'smooth'); });
  store.setPreferences({ buffer: 'smooth' });
  store.setPreferences({ buffer: 'smooth' });
  assert.equal(calls, 1);
  assert.equal(store.persistent, false);
  const copy = store.getPreferences(); copy.codec = 'h264';
  assert.equal(store.getPreferences().codec, 'auto');
  unsubscribe(); store.setPreferences({ buffer: 'responsive' });
  assert.equal(calls, 1);
});

test('saved values use the browser key and reset restores all Auto settings', () => {
  let saved;
  const store = createPreferencesStore({ getItem: () => '{"codec":"h264","buffer":"custom","customSeconds":30}',
    setItem(key, value) { assert.equal(key, STORAGE_KEY); saved = value; } });
  assert.equal(store.getPreferences().customSeconds, 30);
  store.setPreferences(DEFAULTS);
  assert.deepEqual(JSON.parse(saved), DEFAULTS);
  assert.equal(store.persistent, true);
});

test('recommendations distinguish fast, moderate, slow and unstable Nextcloud connections', () => {
  assert.equal(recommendConnection([35, 30]).preferences.buffer, 'responsive');
  assert.equal(recommendConnection([25, 22]).preferences.buffer, 'auto');
  assert.equal(recommendConnection([6, 8]).preferences.buffer, 'auto');
  assert.equal(recommendConnection([5.9, 7]).preferences.buffer, 'smooth');
  const unstable = recommendConnection([40, 15]);
  assert.equal(unstable.unstable, true);
  assert.equal(unstable.preferences.buffer, 'smooth');
  assert.equal(unstable.preferences.codec, 'auto');
  for (const invalid of [[], [10], [NaN, 2], [0, 20], [Infinity, 10]]) assert.throws(() => recommendConnection(invalid));
});

test('connection test warms up then measures two bounded authenticated same-origin downloads', async () => {
  const requests = [];
  const times = [0, 10, 20, 270, 280, 580];
  let nonce = 0;
  const result = await testConnection(async (address, options) => {
    const url = new URL(address);
    requests.push({ url, options });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(Number(url.searchParams.get('bytes'))) };
  }, '/nextcloud/apps/memories_rkmpp_player/connection-test', {
    origin: 'https://cloud.example', now: () => times.shift(), nonce: () => `${++nonce}`,
  });
  assert.deepEqual(requests.map(({ url }) => Number(url.searchParams.get('bytes'))), [131072, 1048576, 1048576]);
  assert.equal(result.bytes, 2228224);
  assert.ok(result.bytes < 3 * 1024 * 1024);
  assert.equal(new Set(requests.map(({ url }) => url.searchParams.get('nonce'))).size, 3);
  assert.ok(requests.every(({ url, options }) => url.origin === 'https://cloud.example' &&
    options.method === 'GET' && options.credentials === 'same-origin' && options.cache === 'no-store'));
  assert.equal(result.preferences.buffer, 'responsive');
  assert.ok(result.mbps > 25);
});

test('connection errors and unexpected bodies do not produce a recommendation', async () => {
  const options = { origin: 'https://cloud.example', now: (() => { let time = 0; return () => ++time; })(), nonce: () => 'test' };
  await assert.rejects(testConnection(async () => ({ ok: false }), '/test', options));
  await assert.rejects(testConnection(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(20) }), '/test', options));
  let calls = 0;
  await assert.rejects(testConnection(async () => { calls++; }, 'https://external.example/test', options));
  assert.equal(calls, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(testConnection(async (_url, { signal }) => {
    assert.equal(signal.aborted, true); throw new Error('Aborted');
  }, '/test', { ...options, signal: controller.signal }));
});
