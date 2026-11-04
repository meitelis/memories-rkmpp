'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { qualityText, updateQualityText, initialLevel, manifestURL } = require('./player.js');

function eventHub() {
  const listeners = new Map();
  const events = new Map();
  function remove(name, callback) {
    const current = listeners.get(name) || [];
    listeners.set(name, current.filter((entry) => entry.callback !== callback));
  }
  function add(name, callback, once = false) {
    const current = listeners.get(name) || [];
    current.push({ callback, once }); listeners.set(name, current);
    if (!events.has(name)) events.set(name, (...args) => {
      for (const entry of [...(listeners.get(name) || [])]) {
        if (entry.once) remove(name, entry.callback);
        entry.callback(...args);
      }
    });
  }
  return { events, add, remove, emit: (name, ...args) => events.get(name)?.(...args) };
}

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
      const hub = eventHub();
      const events = hub.events;
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
        levels = [
          { width: 1080, height: 1920, bitrate: 1000000 },
          { width: 720, height: 1280, bitrate: 750000 },
          { width: 480, height: 854, bitrate: 300000 },
        ];
        switches = [];
        get currentLevel() { return 0; }
        set currentLevel(level) { this.switches.push({ mode: 'immediate', level }); }
        set loadLevel(level) { this.switches.push({ mode: 'buffer-end', level }); }
        set nextLevel(level) { this.switches.push({ mode: 'fragment-boundary', level }); }
        url = 'https://cloud.example/apps/memories/api/video/transcode/abc/123/index.m3u8';
        once(name, fn) { hub.add(name, fn, true); }
        on(name, fn) { hub.add(name, fn); }
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
      // Vidstack routes a user selection through hls[qualities.switch + 'Level'].
      // Exercise that selection path, including switching up and down, rather
      // than merely checking the configuration string.
      player.currentTime = 12;
      for (const selectedIndex of [0, 2, 1]) {
        hls[player.qualities.switch + 'Level'] = selectedIndex;
      }
      assert.deepEqual(hls.switches, [0, 2, 1].map((level) => ({ mode: 'buffer-end', level })));
      assert.equal(player.currentTime, 12);
      assert.equal(player.src, undefined);
      player.currentTime = 0;
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

const { playbackPreferences, prefersHEVC, bufferSeconds } = require('./player.js');
const { createPreferencesStore, recommendConnection } = require('./settings.js');

test('buffer profiles and Auto adapt within the video byte budget', () => {
  const level = { bitrate: 8000000 };
  assert.equal(bufferSeconds(playbackPreferences(), level), 12);
  assert.equal(bufferSeconds(playbackPreferences({ buffer: 'responsive' }), level), 6);
  assert.equal(bufferSeconds(playbackPreferences({ buffer: 'smooth' }), level), 18);
  assert.equal(bufferSeconds(playbackPreferences({ buffer: 'custom', customSeconds: 30 }), level), 30);
  assert.equal(bufferSeconds(playbackPreferences(), level, 8000000), 18);
  assert.equal(bufferSeconds(playbackPreferences(), level, 40000000), 6);
  assert.equal(bufferSeconds(playbackPreferences({ buffer: 'custom', customSeconds: 30 }), { bitrate: 64000000 }), 4);
  assert.equal(prefersHEVC(playbackPreferences({ codec: 'hevc' }), false), false);
  assert.equal(prefersHEVC(playbackPreferences({ codec: 'hevc' }), true, true), false);
  assert.equal(prefersHEVC(playbackPreferences(), true), true);
  assert.equal(prefersHEVC(playbackPreferences({ codec: 'h264' }), true), false);
});

function preferencePlayer({ paused = false, supported = true, lateSettings = false, autoPlay = true, autoplay = true } = {}) {
  const playerHub = eventHub();
  const windowEvents = new Map();
  const hlsHub = eventHub();
  const hlsEvents = hlsHub.events;
  const store = createPreferencesStore({ getItem: () => null, setItem() {} });
  let playbackStatus;
  let started = true;
  const service = { ...store, updatePlaybackStatus: (value) => { playbackStatus = value; } };
  const player = {
    isConnected: true, currentTime: 45.25, paused, autoPlay, autoplay,
    qualities: {}, sources: [], playCalls: 0, pauseCalls: 0, autoplayAttempts: 0,
    addEventListener(name, callback, options) {
      playerHub.add(name, callback, !!options?.once);
    },
    removeEventListener(name, callback) { playerHub.remove(name, callback); },
    set src(value) {
      this.sources.push(value); this.currentTime = 0; this.paused = false; started = false;
      playerHub.emit('source-change', { detail: value });
      hls.loadSource(value.src);
    },
    play() {
      this.playCalls++; this.paused = false; started = true;
      playerHub.emit('play', { autoPlay: false });
      return Promise.resolve();
    },
    pause() { this.pauseCalls++; this.paused = true; },
  };
  class Hls {
    static DefaultConfig = { loader: class { load(context) { this.url = context.url; } } };
    static Events = Object.fromEntries(['MANIFEST_PARSED', 'LEVEL_SWITCHING', 'LEVEL_SWITCHED', 'DESTROYING', 'ERROR', 'FRAG_LOADED'].map((name) => [name, name]));
    config = {};
    levels = [{ width: 1920, height: 1080, bitrate: 8000000, videoCodec: supported ? 'hvc1.1.6.L120.B0' : 'avc1.640028' }];
    currentLevel = 0;
    url = `https://cloud.example/apps/memories/api/video/transcode/abc/123/index.m3u8?token=keep&codecs=${supported ? 'h264%2Chevc' : 'h264'}`;
    startCalls = [];
    on(name, callback) { hlsHub.add(name, callback); }
    once(name, callback) { hlsHub.add(name, callback, true); }
    startLoad(position) { this.startCalls.push(position); this.startedAt = position; }
    stopLoad() {} loadSource(url) { this.url = url; }
  }
  const hls = new Hls();
  player.provider = { type: 'hls', onInstance: (callback) => callback(hls) };
  const window = { MediaSource: { isTypeSupported: () => supported }, addEventListener: (name, callback) => windowEvents.set(name, callback) };
  if (!lateSettings) window[Symbol.for('memories-rkmpp-settings')] = service;
  vm.runInNewContext(fs.readFileSync(require.resolve('./player.js'), 'utf8'), {
    URL, WeakSet, WeakMap, Symbol, console, queueMicrotask: (callback) => callback(), window,
    location: { pathname: '/apps/memories/', href: 'https://cloud.example/apps/memories/' },
    document: { documentElement: {}, querySelectorAll: (selector) => selector === 'media-player' ? [player] : [], addEventListener() {} },
    MutationObserver: class { observe() {} },
  });
  // Model an already parsed playing source. A true once listener is consumed
  // here, before a codec change reloads a second manifest on this SAME instance.
  hlsHub.emit('MANIFEST_PARSED');
  return {
    player, hls, store, hlsEvents, status: () => playbackStatus,
    manifestParsed() { hlsHub.emit('MANIFEST_PARSED'); },
    async canPlay() {
      playerHub.emit('can-play');
      // Vidstack ready() awaits storage after can-play, then decides autoplay.
      // A synchronous pause inside can-play cannot prevent this later play.
      await Promise.resolve();
      if (!started && (player.autoPlay || player.autoplay)) {
        player.autoplayAttempts++; player.playCalls++; player.paused = false; started = true;
        playerHub.emit('play', { autoPlay: true });
      }
    },
    attachSettings() { window[Symbol.for('memories-rkmpp-settings')] = service; windowEvents.get('memories-rkmpp-settings-ready')(); },
  };
}

for (const paused of [false, true]) {
  test(`live preferences preserve ${paused ? 'paused' : 'playing'} position across codec changes`, async () => {
    const h = preferencePlayer({ paused });
    h.store.setPreferences({ buffer: 'smooth' });
    assert.equal(h.hls.config.maxBufferLength, 18);
    assert.equal(h.player.sources.length, 0);
    assert.equal(h.player.currentTime, 45.25);
    h.store.setPreferences({ codec: 'h264' });
    assert.equal(new URL(h.player.sources.at(-1).src).searchParams.get('codecs'), 'h264');
    assert.equal(new URL(h.player.sources.at(-1).src).searchParams.get('token'), 'keep');
    h.manifestParsed();
    assert.equal(h.hls.startedAt, 45.25);
    assert.deepEqual(h.hls.startCalls, [45.25]);
    // Rapid changes before the replacement can play retain the original position.
    h.store.setPreferences({ codec: 'auto' });
    h.manifestParsed();
    h.store.setPreferences({ codec: 'h264' });
    h.manifestParsed();
    assert.deepEqual(h.hls.startCalls, [45.25, 45.25, 45.25]);
    await h.canPlay();
    assert.equal(h.player.currentTime, 45.25);
    assert.equal(h.player.paused, paused);
    assert.equal(h.player.playCalls, paused ? 0 : 1);
    assert.equal(h.player.pauseCalls, paused ? 1 : 0);
    assert.equal(h.player.qualities.switch, 'load');
  });
}

for (const suffix of ['index.m3u8', 'original.mp4']) {
  test(`an unrelated ${suffix} source discards a pending codec restore`, async () => {
    const h = preferencePlayer({ paused: true });
    h.store.setPreferences({ codec: 'h264' });
    h.player.src = { src: `https://cloud.example/apps/memories/api/video/transcode/abc/456/${suffix}`, type: 'video/mp4' };
    assert.equal(h.player.autoPlay, true);
    assert.equal(h.player.autoplay, true);
    if (suffix === 'index.m3u8') {
      h.manifestParsed();
      assert.deepEqual(h.hls.startCalls, [undefined]);
    }
    await h.canPlay();
    assert.equal(h.player.currentTime, 0);
    assert.equal(h.player.pauseCalls, 0);
    assert.equal(h.player.playCalls, 1);
    assert.equal(h.player.autoplayAttempts, 1);
  });
}

test('query-only authentication refresh keeps the codec resume on the same asset', async () => {
  const h = preferencePlayer();
  h.store.setPreferences({ codec: 'h264' });
  const url = new URL(h.player.sources.at(-1).src);
  url.searchParams.set('token', 'refreshed-token');
  h.player.src = { src: url.href, type: 'application/x-mpegurl' };
  h.manifestParsed();
  await h.canPlay();
  assert.equal(h.hls.startedAt, 45.25);
  assert.equal(h.player.currentTime, 45.25);
  assert.equal(h.player.paused, false);
  assert.equal(new URL(h.hls.url).searchParams.get('token'), 'refreshed-token');
});

test('a separate audio track permits fast video-only switches and resets for muxed sources', () => {
  const h = preferencePlayer();
  h.hls.audioTracks = [{ url: 'https://cloud.example/audio.m3u8' }];
  h.manifestParsed();
  assert.equal(h.player.qualities.switch, 'next');
  h.hls.audioTracks = [];
  h.manifestParsed();
  assert.equal(h.player.qualities.switch, 'load');
});

test('a format change preserves a seek before reactive player time catches up', async () => {
  const h = preferencePlayer({ paused: true });
  h.player.querySelector = () => ({ readyState: 1, currentTime: 60.5 });
  h.store.setPreferences({ codec: 'h264' });
  h.manifestParsed();
  assert.equal(h.hls.startedAt, 60.5);
  await h.canPlay();
  assert.equal(h.player.currentTime, 60.5);
  assert.equal(h.player.paused, true);
});

test('HEVC preference respects unsupported browsers and one-time decoder fallback', async () => {
  const unsupported = preferencePlayer({ supported: false });
  unsupported.store.setPreferences({ codec: 'hevc' });
  assert.equal(unsupported.player.sources.length, 0);
  const loader = new unsupported.hls.config.pLoader();
  loader.load({ url: unsupported.hls.url });
  assert.equal(new URL(loader.url).searchParams.get('codecs'), 'h264');

  const h = preferencePlayer();
  h.hlsEvents.get('ERROR')(null, { fatal: true, details: 'bufferAddCodecError' });
  assert.equal(new URL(h.player.sources.at(-1).src).searchParams.get('codecs'), 'h264');
  await h.canPlay();
  const count = h.player.sources.length;
  h.store.setPreferences({ codec: 'hevc' });
  h.hlsEvents.get('ERROR')(null, { fatal: true, details: 'bufferAddCodecError' });
  assert.equal(h.player.sources.length, count);
});

for (const flags of [
  { autoPlay: true, autoplay: false },
  { autoPlay: false, autoplay: true },
  { autoPlay: true, autoplay: true },
  { autoPlay: false, autoplay: false },
]) {
  test(`paused codec reload suppresses delayed autoplay and restores both original flags on play: ${JSON.stringify(flags)}`, async () => {
    const h = preferencePlayer({ paused: true, ...flags });
    h.store.setPreferences({ codec: 'h264' });
    h.store.setPreferences({ codec: 'auto' });
    h.store.setPreferences({ codec: 'h264' });
    assert.equal(h.player.autoPlay, false);
    assert.equal(h.player.autoplay, false);
    h.manifestParsed();
    await h.canPlay();
    assert.equal(h.player.currentTime, 45.25);
    assert.equal(h.player.paused, true);
    assert.equal(h.player.autoplayAttempts, 0);
    assert.equal(h.player.autoPlay, false, 'can-play is too early to restore autoplay');
    assert.equal(h.player.autoplay, false);
    // A later paused replacement must retain the original, not suppressed, flags.
    h.player.currentTime = 70;
    h.store.setPreferences({ codec: 'auto' });
    h.manifestParsed();
    await h.canPlay();
    assert.equal(h.player.currentTime, 70);
    assert.equal(h.player.paused, true);
    await h.player.play();
    assert.equal(h.player.autoPlay, flags.autoPlay);
    assert.equal(h.player.autoplay, flags.autoplay);
    assert.equal(h.player.paused, false);
  });
}

test('connection recommendations and late settings apply without restarting the video', () => {
  const h = preferencePlayer({ lateSettings: true });
  h.attachSettings();
  h.store.setPreferences(recommendConnection([35, 32]).preferences);
  assert.equal(h.hls.config.maxBufferLength, 6);
  assert.equal(h.player.sources.length, 0);
  assert.equal(h.player.currentTime, 45.25);
  assert.equal(h.status().bufferSeconds, 6);
  h.store.setPreferences({ buffer: 'auto' });
  h.hls.bandwidthEstimate = 8000000;
  h.hlsEvents.get('FRAG_LOADED')();
  assert.equal(h.hls.config.maxBufferLength, 18);
});

const { initialLevelForThroughput } = require('./player.js');

test('initial rendition uses actual advertised bitrate, not fixed resolution', () => {
  const levels = [
    { width: 1920, height: 1080, bitrate: 9000000 },
    { width: 1280, height: 720, bitrate: 3000000 },
    { width: 2560, height: 1440, bitrate: 14000000 },
    { width: 854, height: 480, bitrate: 1200000 },
  ];
  assert.equal(initialLevelForThroughput(levels, 20000000), 2);
  assert.equal(initialLevelForThroughput(levels, 15000000), 0);
  assert.equal(initialLevelForThroughput(levels, 6000000), 1);
  assert.equal(initialLevelForThroughput(levels, 1000000), 3);
  assert.equal(initialLevelForThroughput(levels, 0), initialLevel(levels));
  assert.equal(initialLevelForThroughput([], 10000000), 0);
  assert.equal(initialLevelForThroughput([{ height: 720, bitrate: 3000000, maxBitrate: 7000000 },
    { height: 1080, bitrate: 5000000, maxBitrate: 9000000 }], 11000000), 0);
});

const { preventiveLevel } = require('./player.js');
test('predictive quality reduces bitrate before buffer exhaustion', () => {
  const levels = [{ bitrate: 12000000 }, { bitrate: 6000000 }, { bitrate: 2000000 }];
  // A four-second buffer uses a 60% safety budget: 5.4 Mbps excludes 6 Mbps.
  assert.equal(preventiveLevel(levels, 0, 9000000, 4), 2);
  assert.equal(preventiveLevel(levels, 1, 9000000, 12), 1);
  assert.equal(preventiveLevel(levels, 0, 2000000, 3), 2);
  assert.equal(preventiveLevel(levels, 0, 0, 3), 0);
});

function directPlayer({codec = 'auto', supported = false, autoPlay = false, autoplay = false} = {}) {
  const hub = eventHub();
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0, now = 0, mutation, started = false;
  const master = 'https://cloud.example/apps/memories/api/video/transcode/abcdef123456/123/index.m3u8?token=keep&codecs=h264';
  let source = { src: master };
  const store = createPreferencesStore({getItem: () => JSON.stringify({codec}), setItem() {}});
  const media = {
    readyState: 4, currentTime: 10, duration: 120, ended: false, bufferEnd: 30,
    buffered: { length: 1, start: () => 0, end: () => media.bufferEnd },
  };
  const player = {
    nodeType: 1, isConnected: true, paused: false, seeking: false, ended: false,
    currentTime: 10, autoPlay, autoplay, sources: [], playCalls: 0,
    querySelector: () => media, querySelectorAll: () => [], matches: name => name === 'media-player',
    addEventListener: (name, callback, options) => hub.add(name, callback, !!options?.once),
    get src() { return source; },
    set src(value) { source = value; started = false; this.sources.push(value); hub.emit('source-change', { detail: value }); },
    play() {
      this.playCalls++; this.paused = false; started = true;
      hub.emit('play', {autoPlay: false}); hub.emit('playing');
      return Promise.resolve();
    },
    pause() { this.paused = true; hub.emit('pause'); },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./player.js'), 'utf8'), {
    URL, WeakMap, WeakSet, Map, Symbol, Date, console: {info() {}, warn() {}},
    performance: {now: () => now},
    setInterval: fn => { const id = ++timerId; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (fn, delay) => { const id = ++timerId; timeouts.set(id, {fn, deadline: now + delay}); return id; },
    clearTimeout: id => timeouts.delete(id),
    location: {origin: 'https://cloud.example', href: 'https://cloud.example/apps/memories/', pathname: '/apps/memories/'},
    window: {
      addEventListener() {}, MediaSource: {isTypeSupported: () => supported},
      [Symbol.for('memories-rkmpp-settings')]: store,
    },
    document: {documentElement: {}, addEventListener() {}, querySelectorAll: name => name === 'media-player' ? [player] : []},
    MutationObserver: class {constructor(callback) {mutation = callback;} observe() {}},
  });
  return {
    player, media, master, intervals, timeouts, store, emit: hub.emit,
    async canPlay() {
      hub.emit('can-play');
      // Match Vidstack ready(): storage is awaited before its autoplay test.
      await Promise.resolve();
      if (!started && (player.autoPlay || player.autoplay)) await player.play();
    },
    remove() {
      player.isConnected = false;
      mutation([{removedNodes: [player], addedNodes: [], target: {nodeType: 1, closest() {}}}]);
    },
    tick(seconds = 1) {
      now += seconds * 1000;
      for (const fn of [...intervals.values()]) fn();
      for (const [id, timer] of [...timeouts]) {
        if (timer.deadline <= now) { timeouts.delete(id); timer.fn(); }
      }
    },
  };
}

test('direct playback keeps monitoring after can-play/playing and falls back before starvation once', () => {
  const h = directPlayer();
  assert.equal(h.intervals.size, 1);
  h.emit('can-play');
  h.emit('playing');
  assert.equal(h.intervals.size, 1);
  h.media.bufferEnd = 17; h.tick();
  h.media.bufferEnd = 16; h.tick();
  h.media.bufferEnd = 15; h.tick();
  assert.equal(h.player.src.src, h.master);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  const loads = h.player.sources.length;
  h.emit('waiting'); h.emit('error', {stopImmediatePropagation() {}}); h.tick(10);
  assert.equal(h.player.sources.length, loads);
});

test('pause clears direct work; resume starts one monitor with fresh buffer samples', () => {
  const h = directPlayer();
  h.media.bufferEnd = 17; h.tick();
  h.media.bufferEnd = 16; h.tick();
  h.emit('waiting');
  assert.equal(h.timeouts.size, 1);
  h.player.pause();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  h.tick(10);
  h.player.play(); h.emit('playing');
  assert.equal(h.intervals.size, 1);
  h.media.bufferEnd = 15; h.tick();
  assert.notEqual(h.player.src.src, h.master);
  h.media.bufferEnd = 14; h.tick();
  assert.notEqual(h.player.src.src, h.master);
  h.media.bufferEnd = 13; h.tick();
  assert.equal(h.player.src.src, h.master);
});

test('a fully buffered tail and ended event do not trigger unnecessary transcoding', () => {
  const h = directPlayer();
  h.media.bufferEnd = h.media.duration;
  for (const time of [113, 114, 115, 116, 117, 118]) {
    h.media.currentTime = time; h.tick();
  }
  assert.notEqual(h.player.src.src, h.master);
  h.player.ended = h.media.ended = true;
  h.emit('ended'); h.emit('waiting'); h.tick(10);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  assert.notEqual(h.player.src.src, h.master);
});

test('seeking cancels a pending stall and clears old risk samples', () => {
  const h = directPlayer();
  h.media.bufferEnd = 17; h.tick();
  h.media.bufferEnd = 16; h.tick();
  h.emit('waiting');
  h.player.seeking = true; h.emit('seeking'); h.emit('waiting');
  assert.equal(h.timeouts.size, 0);
  h.tick(10);
  h.player.seeking = false;
  h.media.bufferEnd = 15; h.tick();
  assert.notEqual(h.player.src.src, h.master);
});

test('healthy playback cancels the stall deadline without stopping buffer monitoring', () => {
  const h = directPlayer();
  h.emit('waiting');
  assert.equal(h.timeouts.size, 1);
  h.emit('playing');
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.intervals.size, 1);
  h.tick(10);
  assert.notEqual(h.player.src.src, h.master);
});

test('sustained waiting falls back after its deadline and preserves the current position', () => {
  const h = directPlayer();
  h.emit('can-play');
  h.media.bufferEnd = h.media.currentTime;
  h.emit('waiting'); h.tick(5);
  assert.notEqual(h.player.src.src, h.master);
  h.tick();
  assert.equal(h.player.src.src, h.master);
  h.player.currentTime = 0;
  h.emit('can-play');
  assert.equal(h.player.currentTime, h.media.currentTime);
  assert.equal(h.player.paused, false);
});

test('another direct-play asset cancels the previous stall and targets only its own fallback', () => {
  const h = directPlayer();
  h.emit('waiting');
  const nextMaster = h.master.replace('/123/', '/456/');
  h.player.src = {src: nextMaster};
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.intervals.size, 1);
  assert.ok(h.player.src.src.includes('/stream/456'));
  h.emit('can-play'); h.tick(10);
  assert.ok(h.player.src.src.includes('/stream/456'));
  h.emit('error', {stopImmediatePropagation() {}});
  assert.equal(h.player.src.src, nextMaster);
});

test('unrelated source replacement discards timers and cannot fall back to the previous asset', () => {
  const h = directPlayer();
  h.emit('waiting');
  h.player.src = {src: 'https://cloud.example/unrelated.mp4', type: 'video/mp4'};
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  h.emit('error', {stopImmediatePropagation() { throw new Error('old direct handler intercepted unrelated error'); }});
  h.tick(10);
  assert.equal(h.player.src.src, 'https://cloud.example/unrelated.mp4');
});

test('removed players release timers and ignore late direct errors', () => {
  const h = directPlayer();
  h.emit('waiting'); h.remove();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  h.emit('error', {stopImmediatePropagation() { throw new Error('removed player intercepted error'); }});
  h.tick(10);
  assert.notEqual(h.player.src.src, h.master);
});

for (const codec of ['hevc', 'h264']) {
  test(`explicit ${codec} preference bypasses the original trial`, () => {
    const h = directPlayer({codec, supported: true});
    assert.equal(h.player.sources.length, 0);
    assert.equal(h.player.src.src, h.master);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timeouts.size, 0);
  });
}

for (const flags of [{autoPlay: true, autoplay: false}, {autoPlay: false, autoplay: true}, {autoPlay: true, autoplay: true}]) {
  test(`pause before original metadata suppresses delayed autoplay: ${JSON.stringify(flags)}`, async () => {
    const h = directPlayer(flags);
    h.player.pause();
    await h.canPlay();
    assert.equal(h.player.paused, true);
    assert.equal(h.player.playCalls, 0);
    assert.equal(h.player.autoPlay, false);
    assert.equal(h.player.autoplay, false);
    assert.equal(h.intervals.size, 0);
    h.emit('media-play-request');
    assert.equal(h.player.autoPlay, flags.autoPlay);
    assert.equal(h.player.autoplay, flags.autoplay);
    await h.player.play();
    assert.equal(h.player.paused, false);
    assert.equal(h.intervals.size, 1);
  });
}

test('pause request before reactive pause state prevents original autoplay', async () => {
  const h = directPlayer({autoPlay: true});
  h.emit('media-pause-request');
  assert.equal(h.player.paused, false);
  await h.canPlay();
  assert.equal(h.player.paused, true);
  assert.equal(h.player.playCalls, 0);
});

for (const codec of ['hevc', 'h264']) {
  test(`switching original playback to ${codec} preserves time and stays HLS on Auto`, async () => {
    const h = directPlayer({supported: true});
    await h.canPlay();
    h.media.currentTime = 37.5;
    h.store.setPreferences({codec});
    const replacement = h.player.src.src;
    assert.equal(new URL(replacement).searchParams.get('codecs'), codec === 'hevc' ? 'h264,hevc' : 'h264');
    assert.equal(new URL(replacement).searchParams.get('token'), 'keep');
    assert.equal(h.intervals.size, 0);
    h.player.currentTime = 0;
    await h.canPlay();
    assert.equal(h.player.currentTime, 37.5);
    assert.equal(h.player.paused, false);
    h.store.setPreferences({codec: 'auto'});
    h.emit('source-change', {detail: {src: replacement}});
    assert.equal(h.player.src.src, replacement);
    assert.equal(h.intervals.size, 0);
  });
}

test('an explicit format after an early pause retains the pending position and autoplay hold', async () => {
  const h = directPlayer({supported: true, autoPlay: true, autoplay: true});
  h.player.pause();
  h.media.readyState = 0; h.media.currentTime = h.player.currentTime = 0;
  h.store.setPreferences({codec: 'hevc'});
  assert.equal(new URL(h.player.src.src).searchParams.get('codecs'), 'h264,hevc');
  await h.canPlay();
  assert.equal(h.player.currentTime, 10);
  assert.equal(h.player.paused, true);
  assert.equal(h.player.playCalls, 0);
  assert.equal(h.player.autoPlay, false);
  assert.equal(h.player.autoplay, false);
});

