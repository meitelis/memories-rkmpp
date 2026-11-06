const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PlaybackPolicy, chooseLevel} = require('./policy.js');

const levels = [400000,700000,1300000,2900000,6400000,7400000,8700000]
  .map((bitrate,i) => ({bitrate, url:[i === 6 ? '/direct.m3u8' : '/' + i + '.m3u8']}));
const tick = (p, now, buffer, extra = {}) => p.step({
  now, buffer, playing:true, seeking:false, auto:true, originalReady:true,
  targetBuffer:12, ...extra,
});

test('fast connection starts Original; weak link starts affordable 480p', () => {
  assert.equal(chooseLevel(levels,400000000),6);
  assert.equal(chooseLevel(levels,800000),0);
  assert.equal(chooseLevel(levels,400000000,false),5);
});

test('startup aims for six buffered seconds before treating playback as healthy', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  assert.equal(tick(p,1000,3,{requestAge:4000}).phase,'startup');
  assert.equal(tick(p,2000,6).phase,'normal');
});

test('a slow first segment is not immediately mistaken for a bandwidth collapse', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  assert.equal(tick(p,1000,0,{requestAge:6500}).cap,6);
  assert.equal(tick(p,2000,0,{requestAge:9000}).cap,6);
  assert.equal(tick(p,3500,0,{requestAge:11000}).cap,4);
});

test('an ordinary fragmented buffer sawtooth does not trigger a downshift', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  for(const [now,buffer] of [[1000,12],[1500,11.5],[2000,11],[2500,10.5],
      [3000,13],[3500,12.5],[4000,12]]) {
    assert.equal(tick(p,now,buffer).cap,6);
  }
});

test('sustained depletion downshifts even without another speed probe', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  tick(p,1000,12);
  tick(p,4000,3,{requestAge:2500});
  assert.equal(tick(p,5500,2,{requestAge:4000}).cap,5);
  assert.equal(p.phase,'recovering');
});

test('near-empty buffer permits a larger emergency reduction', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  tick(p,1000,12);
  assert.equal(tick(p,4000,0.3,{requestAge:2500}).cap,4);
});

test('transient low buffer that recovers does not downshift', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  tick(p,1000,12);
  tick(p,4000,3,{requestAge:2500});
  tick(p,4500,7);
  assert.equal(tick(p,5200,3,{requestAge:2500}).cap,6);
});

test('healthy low rendition upgrades one rung without a network recheck', () => {
  const p = new PlaybackPolicy(levels,800000,true);
  assert.equal(p.cap,0);
  tick(p,1000,12);
  assert.equal(tick(p,8500,12).cap,0);
  assert.equal(tick(p,11000,12).cap,1);
  assert.equal(tick(p,12000,12).cap,1);
});

test('failed upgrade uses a cooldown, preventing quality oscillation', () => {
  const p = new PlaybackPolicy(levels,800000,true);
  tick(p,1000,12); tick(p,11000,12);
  assert.equal(p.cap,1);
  tick(p,14000,3,{requestAge:3000});
  assert.equal(tick(p,15500,2,{requestAge:4000}).cap,0);
  tick(p,17000,12);
  assert.equal(tick(p,45000,12).cap,0);
  assert.equal(tick(p,62000,12).cap,1);
});

test('Original readiness and decoder ceilings remain independent', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  assert.equal(tick(p,1000,12,{originalReady:false}).cap,5);
  assert.equal(tick(p,2000,12,{decoderCap:2}).cap,2);
});

test('pauses and manual mode do not change resolution', () => {
  const p = new PlaybackPolicy(levels,800000,true);
  tick(p,1000,12);
  tick(p,11000,12,{playing:false});
  assert.equal(tick(p,21000,12,{auto:false}).cap,0);
});

test('cold seeks do not force an unnecessary downgrade', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  tick(p,1000,12);
  p.beginSeek();
  assert.equal(tick(p,2000,0,{seeking:true,requestAge:4000}).cap,6);
  assert.equal(tick(p,3000,0,{requestAge:4500}).cap,6);
  assert.equal(tick(p,4000,6).phase,'normal');
});

test('audio profile follows the actual chosen rendition', () => {
  const p = new PlaybackPolicy(levels,400000000,true);
  tick(p,1000,12); tick(p,4000,0.3,{requestAge:2500});
  assert.equal(p.cap,4);
  assert.equal(p.result(false).audio,'audio');
  // Remaining low-quality renditions receive the cheaper audio track.
  p.cap = 0;
  assert.equal(p.result(false).audio,'audio32');
});
