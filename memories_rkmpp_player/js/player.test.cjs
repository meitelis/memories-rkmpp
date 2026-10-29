'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { qualityText, updateQualityText, initialLevel, manifestURL } = require('./player.js');

test('portrait and landscape quality labels use displayed short edge', () => {
  const portrait = [{ width: 480, height: 854 }, { width: 720, height: 1280 }, { width: 1080, height: 1920 }];
  assert.equal(qualityText('Auto (1920p)', portrait[2]), 'Auto (1080p)');
  assert.equal(qualityText('854p', portrait[0]), '480p');
  assert.equal(qualityText('1080p', { width: 1920, height: 1080 }), '1080p');
  assert.equal(qualityText('Auto', null), 'Auto');
  // Repeated DOM updates must not turn 1080p into 720p on a 2:3 ladder.
  const level = { width: 1080, height: 1620 };
  assert.equal(qualityText(qualityText('Auto (1620p)', level), level), 'Auto (1080p)');
  assert.equal(initialLevel(portrait), 2);
  assert.equal(initialLevel([{ width: 3840, height: 2160 }, ...portrait]), 3);
});

test('label updates preserve reactive comment anchors and child nodes', () => {
  const start = { nodeType: 8, data: 'start' };
  const end = { nodeType: 8, data: 'end' };
  const text = { nodeType: 3, data: 'Auto (1920p)' };
  const inner = { nodeType: 1, childNodes: [start, text, end] };
  const hint = { childNodes: [inner] };
  updateQualityText(hint, { width: 1080, height: 1920 });
  assert.equal(text.data, 'Auto (1080p)');
  assert.strictEqual(inner.childNodes[0], start);
  assert.strictEqual(inner.childNodes[2], end);
  // The original text node remains available to the player's next render.
  text.data = 'Auto (1280p)';
  updateQualityText(hint, { width: 720, height: 1280 });
  assert.equal(text.data, 'Auto (720p)');
});

test('the playlist loader handles both provider load orders and browser module shims', () => {
  for (const supported of [true, false]) {
    for (const late of [true, false]) {
    const listeners = new Map();
    const events = new Map();
    // Markup contract observed in Vidstack's default quality menu.
    const labelText = { nodeType: 3, data: '1920p' };
    const hintText = { nodeType: 3, data: 'Auto (1920p)' };
    const menu = {
      querySelectorAll(selector) {
        if (selector === 'media-radio') return [{
          getAttribute: () => '1920_1000000',
          querySelector: () => ({ childNodes: [labelText] }),
        }];
        if (selector === '[data-part="hint"]') return [{ childNodes: [hintText] }];
        return [];
      },
    };
    const player = { isConnected: true, currentTime: 0, paused: false, qualities: { switch: 'current' }, addEventListener() {} };
    class Loader {
      load(context) { this.url = context.url; }
    }
    class Hls {
      static DefaultConfig = { loader: Loader };
      static Events = Object.fromEntries(['MANIFEST_PARSED', 'LEVEL_SWITCHING', 'LEVEL_SWITCHED', 'DESTROYING', 'ERROR'].map((name) => [name, name]));
      config = {};
      levels = [{ width: 1080, height: 1920, bitrate: 1000000 }];
      url = 'https://cloud.example/apps/memories/api/video/transcode/abc/123/index.m3u8';
      once(name, fn) { events.set(name, fn); }
      on(name, fn) { events.set(name, fn); }
      startLoad() { this.started = true; }
      stopLoad() { this.stopped = true; }
      loadSource(url) { this.url = url; }
    }
    const hls = new Hls();
    if (late) player.provider = { type: 'hls', onInstance: (callback) => callback(hls) };
    const context = {
      URL, WeakSet, Symbol, console, queueMicrotask: (fn) => fn(),
      // Some browser hosts expose a CommonJS shim. It must not disable setup.
      module: { exports: {} },
      window: { MediaSource: { isTypeSupported: () => supported } },
      location: { pathname: '/apps/memories/', href: 'https://cloud.example/apps/memories/' },
      document: {
        documentElement: {},
        querySelectorAll: (selector) => selector === 'media-player' && late ? [player] : selector === '.vds-quality-menu' ? [menu] : [],
        addEventListener: (name, fn) => listeners.set(name, fn),
      },
      MutationObserver: class { observe() {} },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('./player.js'), 'utf8'), context);
    if (!late) listeners.get('hls-instance')({ detail: hls, target: { closest: () => player } });
    const loader = new hls.config.pLoader();
    assert.equal(player.qualities.switch, 'load');
    loader.load({ url: hls.url }, {}, {});
    assert.equal(new URL(loader.url).searchParams.get('codecs'), supported ? 'h264,hevc' : 'h264');
    events.get('MANIFEST_PARSED')();
    assert.equal(hls.started, true);
    assert.equal(hls.startLevel, 0);
    events.get('LEVEL_SWITCHED')(null, { level: 0 });
    assert.equal(labelText.data, '1080p');
    assert.equal(hintText.data, 'Auto (1080p)');
    player.currentTime = 12;
    events.get('ERROR')(null, { fatal: true, details: 'bufferAddCodecError' });
    assert.equal(new URL(player.src.src).searchParams.get('codecs'), 'h264');
    player.src = null;
    events.get('ERROR')(null, { fatal: true, details: 'bufferAddCodecError' });
    assert.equal(player.src, null);
    }
  }
});

test('codec negotiation preserves auth and touches only Memories masters', () => {
  const origin = 'https://cloud.example/apps/memories/';
  const path = '/apps/memories/api/video/transcode/abc/123/index.m3u8?token=keep';
  const hevc = new URL(manifestURL(path, origin, true));
  assert.equal(hevc.searchParams.get('codecs'), 'h264,hevc');
  assert.equal(hevc.searchParams.get('token'), 'keep');
  assert.equal(new URL(manifestURL(hevc.href, origin, false)).searchParams.get('codecs'), 'h264');
  assert.equal(manifestURL('https://other.example' + path, origin, true), 'https://other.example' + path);
  assert.equal(manifestURL('/video/123.mp4', origin, true), '/video/123.mp4');
});
