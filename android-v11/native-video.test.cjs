const {test} = require('node:test');
const assert = require('node:assert/strict');
const {attach} = require('./native-video.js');

function fixture() {
  const host = new EventTarget();
  const badge = {setAttribute() {}, remove() { this.removed = true; }};
  const controls = {prepend(b) { b.parentElement = this; }};
  Object.assign(host, {src: 'https://example.invalid/index.m3u8', ownerDocument: {createElement: () => badge},
    closest: () => ({querySelector: () => controls})});
  const state = {url: host.src, selected: 'auto', width: 2560, height: 1440, codec: 'video/hevc', original: true,
    qualities: [{id: 'auto', size: -1}, {id: 'v:0', size: 480, bitrate: 400000},
      {id: 'v:1', size: 480, bitrate: 700000}, {id: 'v:2', size: 480, bitrate: 1300000}]};
  const commands = [];
  const bridge = {getNativeVideoQualityState: () => JSON.stringify(state), nativeVideoCommand: command => commands.push(JSON.parse(command))};
  return {host, badge, controls, state, commands, dispose: attach(host, bridge)};
}

test('native controls expose distinct bitrates and actual presented dimensions', () => {
  const {host, badge, controls} = fixture();
  assert.deepEqual(host.qualityList.map(q => q.id), ['auto', 'v:2', 'v:1', 'v:0']);
  assert.equal(badge.textContent, 'Original · 1440p (2560×1440) · HEVC');
  assert.equal(badge.parentElement, controls);
});

test('paused manual selection sends only a track command and updates the menu', () => {
  const {host, commands} = fixture();
  let changes = 0;
  host.addEventListener('quality-selected', () => changes++);
  host.currentQuality = 'v:1';
  assert.equal(host.currentQuality, 'v:1');
  assert.equal(changes, 1);
  assert.deepEqual(commands, [{action: 'quality', url: host.src, id: 'v:1'}]);
  host.currentQuality = 'unknown';
  assert.equal(commands.length, 1);
});

test('stale clip snapshots and commands cannot select tracks for another URL', () => {
  const {host, commands, state, dispose, badge} = fixture();
  host.src = 'https://example.invalid/next.m3u8';
  assert.deepEqual(host.qualityList, []);
  host.currentQuality = 'v:0';
  assert.equal(commands.length, 0);
  state.url = host.src;
  state.selected = 'v:2';
  host.dispatchEvent(new Event('timeupdate'));
  assert.equal(host.currentQuality, 'v:2');
  dispose();
  assert.equal(host.qualityList, undefined);
  assert.equal(badge.removed, true);
});
