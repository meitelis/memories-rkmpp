const {test} = require('node:test');
const assert = require('node:assert/strict');
const {autoCap, selectQuality, renditionText} = require('./player.js');

test('Auto avoids 1800p/50fps on a small display while respecting high-density screens', () => {
  const levels = [480, 720, 1080, 1440, 1800, 2160].map(height => ({height, width:height*16/9}));
  assert.equal(autoCap(levels, 640, 360, 1), 2);
  assert.equal(autoCap(levels, 1920, 1080, 2), 5);
});

test('quality changes keep the playing fragment and muxed AAC buffer', () => {
  const video = {qualityList:[{id:'1080:6000000',index:1}],dispatchEvent(){}};
  const hls = {levels:[{},{}],set currentLevel(_) {throw Error('playing buffer flushed');}};
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.loadLevel,1);
  assert.equal(hls.nextLevel,undefined);
  hls.levels[1].audioGroupIds=['audio'];
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.nextLevel,1);
  selectQuality(video,hls,'auto');
  assert.equal(hls.loadLevel,-1);
});

test('resolution label describes presented frames, not the requested quality', () => {
  const video={videoWidth:1920,videoHeight:1080};
  const hls={autoLevelEnabled:true,currentLevel:0,levels:[{videoCodec:'hvc1.1.6.L120.80',url:['/1080p.m3u8']}]};
  assert.equal(renditionText(video,hls),'Auto · 1080p (1920×1080) · HEVC');
  hls.levels[0].url=['/direct.m3u8?codecs=hevc'];
  assert.match(renditionText(video,hls),/^Original · 1080p/);
});
