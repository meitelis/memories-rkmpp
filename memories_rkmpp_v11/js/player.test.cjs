const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chooseLevel, audioProfile, adaptLevel, selectQuality, renditionText, configure} = require('./player.js');

const levels = [350000,700000,1800000,4000000,9000000].map((bitrate,i)=>({bitrate,url:[i===4?'/direct.m3u8?x=y':`/${i}.m3u8`]}));
test('startup budgets headroom and selects the original only when ready and affordable', () => {
  assert.equal(chooseLevel(levels,20000000),4);
  assert.equal(chooseLevel(levels,5000000),2);
  assert.equal(chooseLevel(levels,20000000,false),3);
  assert.equal(chooseLevel(levels,20000000,true,2),2);
  assert.equal(chooseLevel(levels,150000),0);
});
test('draining buffers downshift quickly; recovery needs sustained headroom', () => {
  assert.equal(adaptLevel(3,3,4,-0.8,500,3000),2);
  assert.equal(adaptLevel(3,1,10,0,1000,3000),1);
  assert.equal(adaptLevel(1,4,12,0,9000,20000),1);
  assert.equal(adaptLevel(1,4,2,0,20000,20000),0);
  assert.equal(adaptLevel(1,4,12,0,11000,20000),4);
  assert.equal(adaptLevel(2,1,2,-1,20000,500),2);
});
test('audio budget is independent of video resolution', () => {
  assert.equal(audioProfile(8000000),'audio');
  assert.equal(audioProfile(2000000),'audio96');
  assert.equal(audioProfile(700000),'audio64');
  assert.equal(audioProfile(300000),'audio32');
});
test('manual and Auto selection never flush the playing fragment', () => {
  const video={qualityList:[{id:'1080:6000000',index:1}],dispatchEvent(){}};
  const hls={levels:[{},{}],set currentLevel(_) {throw Error('playing buffer flushed');}};
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.loadLevel,1);
  hls.levels[1].audioGroupIds=['audio'];
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.nextLevel,1);
  selectQuality(video,hls,'auto');
  assert.equal(hls.loadLevel,-1);
});
test('label reports presented resolution and original codec', () => {
  const video={videoWidth:1920,videoHeight:1080};
  const hls={autoLevelEnabled:true,currentLevel:0,levels:[{videoCodec:'hvc1.1.6.L120.80',url:['/1080p.m3u8']}]};
  assert.equal(renditionText(video,hls),'Auto · 1080p (1920×1080) · HEVC');
  hls.levels[0].url=['/direct.m3u8?codecs=hevc'];
  assert.match(renditionText(video,hls),/^Original · 1080p/);
});

test('startup holds fragments without aborting the manifest and resumes when parsed', async () => {
  const events = new Map();
  const hls = {
    constructor:{Events:{MANIFEST_PARSED:'parsed'},version:'1.7'}, config:{}, levels:[],
    audioTracks:['audio','audio96','audio64','audio32'].map(id=>({url:`https://example.test/${id}.m3u8?token=fixture`})),
    on(event,fn){ events.set(event,fn); },
    stopLoad(){ throw Error('manifest aborted before parsing'); },
    startLoad(){ this.started=true; },
  };
  const state={badge:{dataset:{}},audioChanged:0};
  configure({},state,hls);
  assert.equal(hls.config.autoStartLoad,false);
  assert.equal(hls.started,undefined);
  hls.levels=[{bitrate:400000,url:['/480plow.m3u8']}];
  await events.get('parsed')();
  assert.equal(hls.started,true);
  assert.equal(state.checking,false);
  assert.equal(hls.audioTrack,2,'conservative startup selects the matching 64 kbps audio URI');
  state.abort.abort();
});
