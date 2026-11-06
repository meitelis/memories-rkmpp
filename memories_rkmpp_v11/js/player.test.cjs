const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chooseLevel, audioProfile, selectQuality, selectAudio, beginSeek, requestAge, renditionText, configure, update} = require('./player.js');
const {PlaybackPolicy} = require('./policy.js');

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('a seek does not interpret its old request timer as a new network stall',()=>{
  const levels=[400000,5000000].map((bitrate,i)=>({bitrate,url:[`/${i}.m3u8`]}));
  const policy=new PlaybackPolicy(levels,20000000,true);
  policy.beginSeek();
  const state={policy,seekAt:0,inflight:{stats:{loading:{start:6500}}}};
  const video={seeking:false,readyState:4};
  const step=()=>policy.step({now:7000,buffer:7.5,playing:true,seeking:video.seeking,auto:true,
    requestAge:requestAge(video,state,7000,7000)});
  assert.equal(step().cap,1,'resumed playback keeps its affordable rendition');
  video.seeking=true;video.readyState=1;state.inflight=null;
  assert.equal(step().cap,1,'a pending seek does not immediately force lower quality');
});

test('a seek respects an earlier downshift while Original pictures are still buffered',()=>{
  const state={selected:'auto',cap:0,hls:{currentLevel:6},policy:{beginSeek(){this.seeking=true}},inflight:{}};
  beginSeek(state);
  assert.equal(state.hls.loadLevel,0);
  assert.equal(state.seekLevel,0);
  assert.equal(state.inflight,null);
  assert.equal(state.policy.seeking,true);
  state.cap=6;beginSeek(state);
  assert.equal(state.hls.loadLevel,6,'a fast-network seek keeps Original');
});

test('runtime audio changes schedule the next track without flushing current audio', () => {
  const hls={set audioTrack(_) {throw Error('immediate audio flush');}};
  selectAudio(hls,2,false);
  assert.equal(hls.nextAudioTrack,2);
});


const levels = [350000,700000,1800000,4000000,9000000].map((bitrate,i)=>({bitrate,url:[i===4?'/direct.m3u8?x=y':`/${i}.m3u8`]}));
test('startup budgets headroom and selects the original only when ready and affordable', () => {
  assert.equal(chooseLevel(levels,20000000),4);
  assert.equal(chooseLevel(levels,5000000),3);
  assert.equal(chooseLevel(levels,20000000,false),3);
  assert.equal(chooseLevel(levels,20000000,true,2),2);
  assert.equal(chooseLevel(levels,150000),0);
});
test('audio budget is independent of video resolution', () => {
  assert.equal(audioProfile(8000000),'audio');
  assert.equal(audioProfile(2000000),'audio96');
  assert.equal(audioProfile(700000),'audio64');
  assert.equal(audioProfile(300000),'audio32');
});
test('manual selection uses the HLS switch scheduler and never resets shared audio or the media source', () => {
  const video={qualityList:[{id:'1080:6000000',index:1}],dispatchEvent(){}};
  const hls={levels:[{},{}],
    set currentLevel(_) {throw Error('playing buffer flushed');},
    set audioTrack(_) {throw Error('shared audio reset');}};
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.nextLevel,1);
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
  assert.equal(hls.loadLevel,0,'buffer-based Auto owns the initial rendition');
  assert.equal(state.checking,false);
  assert.equal(hls.audioTrack,3,'lowest video rendition starts with low-bandwidth audio');
  state.abort.abort();
});

test('fast startup awaits an affordable Original preflight instead of racing into an encoder', async () => {
  const previousWindow=global.window,previousFetch=global.fetch;
  const events=new Map();
  global.window={OC:{generateUrl:()=>'/probe'}};
  global.fetch=async url=>{
    if(url.includes('/direct.m3u8')) {
      await new Promise(resolve=>setTimeout(resolve,30));
      return {ok:true,body:{cancel:async()=>{}}};
    }
    return {ok:true,headers:{get:()=> 'application/octet-stream'},body:{getReader:()=>{
      let sent=false;
      return {read:async()=>sent?{done:true}:(sent=true,{done:false,value:new Uint8Array(1572864)}),releaseLock(){}};
    }}};
  };
  const hls={constructor:{Events:{MANIFEST_PARSED:'parsed'},version:'1.7.4'},
    config:{},levels:[],audioTracks:[],on(e,fn){events.set(e,fn)},startLoad(){this.started=true;}};
  const state={badge:{dataset:{}},audioChanged:0};
  try {
    configure({},state,hls);
    hls.levels=[{bitrate:4000000,url:['/1440p.m3u8']},{bitrate:8000000,url:['/direct.m3u8']}];
    await events.get('parsed')();
    assert.equal(hls.startLevel,1);
    assert.equal(state.originalReady,true);
    assert.equal(hls.loadLevel,1);
  } finally {
    state.abort?.abort();global.window=previousWindow;global.fetch=previousFetch;
  }
});

test('late audio-track discovery applies the measured startup rate immediately', async () => {
  const events=new Map();
  const hls={constructor:{Events:{MANIFEST_PARSED:'parsed',AUDIO_TRACKS_UPDATED:'audio'},version:'1.7.4'},
    config:{},levels:[],audioTracks:[],on(e,fn){events.set(e,fn)},startLoad(){},
    set nextAudioTrack(_) {throw Error('initial audio was delayed into a runtime switch')}};
  const state={badge:{dataset:{}},audioChanged:0};
  configure({},state,hls);
  hls.levels=[{bitrate:400000,url:['/480plow.m3u8']}];
  await events.get('parsed')();
  hls.audioTracks=['audio','audio96','audio64','audio32'].map(id=>({url:`https://example.test/${id}.m3u8`}));
  events.get('audio')();
  assert.equal(hls.audioTrack,3);
  assert.equal(state.audioProfile,'audio32');
  state.abort.abort();
});

test('healthy buffer upgrades one step without replacing audio, source or probing again', () => {
  const previousNow = Date.now;
  const levels = [350000,700000,1800000].map((bitrate,i) => ({
    bitrate, width:640+i*400, height:360+i*180, url:['/'+i+'.m3u8']
  }));
  const policy = new PlaybackPolicy(levels,600000,true);
  const changes = [];
  const hls = {
    levels, currentLevel:0, config:{maxMaxBufferLength:18,maxBufferSize:48*1024*1024},
    audioTracks:[], on(){}, off(){},
    set nextLevel(v){changes.push(v);},
    set audioTrack(_){throw Error('shared audio should not reset');},
    set currentLevel(_){throw Error('playing source should not reset');},
  };
  const video = {
    _qualityHls:hls, currentTime:0, videoWidth:640, videoHeight:360,
    paused:false, ended:false, seeking:false,
    buffered:{length:1,start:()=>0,end:()=>12},
    closest:()=>null,
  };
  const state = {
    hls, policy, badge:{dataset:{},textContent:''}, cap:policy.cap,
    originalReady:true, selected:'auto', decoderCap:Infinity,
    checking:false, abort:new AbortController(), bps:600000,
    audioInitialized:true, audioProfile:'audio32', audioChanged:0,
  };
  try {
    Date.now=()=>1000;
    update(video,state);
    assert.equal(changes.length,0,'no quality change before buffer is proven healthy');
    Date.now=()=>11000;
    update(video,state);
    assert.deepEqual(changes,[1],'one scheduled upgrade');
    assert.equal(state.cap,1);
    assert.equal(hls.currentLevel,0,'rendered video is not reset or forced');
  } finally {Date.now=previousNow;state.abort.abort();}
});

test('an internal auto choice is scheduled even though hls.js manualLevel is used',()=>{
  const video={qualityList:[],dispatchEvent(){}};
  const hls={currentLevel:0};
  selectQuality(video,hls,'auto',{policy:{cap:2},badge:{dataset:{}}});
  assert.equal(hls.nextLevel,2);
  assert.equal(video._qualitySelected,'auto');
});
