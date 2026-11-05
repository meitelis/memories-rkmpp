const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chooseLevel, audioProfile, selectQuality, selectAudio, beginSeek, requestAge, renditionText, prepareRendition, commitPreparedSwitch, configure} = require('./player.js');
const {PlaybackPolicy} = require('./policy.js');

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const manifest='#EXTM3U\n#EXT-X-MAP:URI="init.m4s?token=fixture"\n#EXTINF:0.96,\n0.m4s?token=fixture\n#EXTINF:1.04,\n1.m4s?token=fixture\n#EXTINF:5.2,\n2.m4s?token=fixture\n';
function switchFixture() {
  const video={currentTime:0.4,readyState:4,paused:false,seeking:false,
    buffered:{length:1,start:()=>0,end:()=>20},
    qualityList:[{id:'1440',index:1}],dispatchEvent(){}};
  const events=new Map(),flushes=[];
  const hls={currentLevel:0,bandwidthEstimate:50000000,
    constructor:{Events:{BUFFER_FLUSHED:'flushed',BUFFER_FLUSHING:'flushing'}},
    on(e,fn){events.set(e,fn)},off(e){events.delete(e)},
    trigger(e,data){flushes.push(data);events.get('flushed')?.('flushed',{type:data.type});},
    stopLoad(){this.stopped=true},startLoad(position,skipSeek){this.resumed={position,skipSeek}},
    levels:[{bitrate:8000000},{bitrate:4000000,url:['https://example.test/vod/1440p.m3u8?token=fixture']}],
    set nextLevel(_) {throw Error('unaligned old-grid switch');},
    set audioTrack(_) {throw Error('audio flushed');},
    set nextAudioTrack(_) {throw Error('audio changed during video switch');}};
  const state={abort:new AbortController(),bps:50000000,badge:{dataset:{}},selected:'1440',hls};
  return {video,hls,state,flushes,events};
}

test('preparation uses the actual Original keyframe grid without duplicating fragment traffic',async()=>{
  const previous=global.fetch,calls=[];
  global.fetch=async(url,options)=>{
    calls.push({url,method:options.method||'GET'});
    return {ok:true,text:async()=>manifest,arrayBuffer:async()=>new ArrayBuffer(1)};
  };
  try {
    assert.equal(await prepareRendition({url:['https://example.test/vod/direct.m3u8?token=fixture']},0.4,new AbortController().signal),2);
    assert.deepEqual(calls.map(c=>c.url),[
      'https://example.test/vod/direct.m3u8?token=fixture',
      'https://example.test/vod/2.m4s?token=fixture']);
    assert.deepEqual(calls.map(c=>c.method),['GET','HEAD']);
  } finally {global.fetch=previous;}
});

test('manual handoff waits for a completed server fragment and flushes only video at its IDR boundary',async()=>{
  const previous=global.fetch;
  let complete;const body=new Promise(resolve=>{complete=resolve;});
  global.fetch=async(_url,options)=>options.method==='HEAD'?body:{ok:true,text:async()=>manifest};
  const {video,hls,state,flushes}=switchFixture();
  try {
    selectQuality(video,hls,'1440',state);await settle();
    assert.equal(hls.loadLevel,0,'retain the old producer while preparing');
    assert.equal(flushes.length,0,'never flush before the producer is ready');
    complete({ok:true});await settle();
    assert.deepEqual(flushes,[{startOffset:2,endOffset:Infinity,type:'video'}]);
    assert.deepEqual(hls.resumed,{position:2,skipSeek:true});
    assert.equal(video.currentTime,0.4,'the playing clock never jumps to the switch point');
    assert.equal(state.preparing,null);
  } finally {state.abort.abort();global.fetch=previous;}
});

test('failed preparation falls back without an early buffer flush',async()=>{
  const previous=global.fetch;global.fetch=async()=>({ok:false});
  const {video,hls,state}=switchFixture();
  try {
    selectQuality(video,hls,'1440',state);await settle();
    assert.equal(hls.loadLevel,1);
    assert.equal(hls.stopped,undefined);
  } finally {state.abort.abort();global.fetch=previous;}
});

test('canceling during video removal releases loading without applying a stale switch point',async()=>{
  const {video,hls,events}=switchFixture();
  hls.media=video;hls.trigger=()=>{};
  const abort=new AbortController();
  const finished=commitPreparedSwitch(video,hls,1,2,abort.signal);
  events.get('flushed')('flushed',{type:'audio'});
  assert.equal(hls.resumed,undefined,'audio completion must not commit the video switch');
  abort.abort();await assert.rejects(finished,/canceled/);
  assert.deepEqual(hls.resumed,{position:-1,skipSeek:true});
  assert.equal(events.size,0);
});

test('a newer Auto choice or seek cancels a prepared handoff that has not committed',async()=>{
  const previous=global.fetch;let complete;
  global.fetch=async()=>({ok:true,text:()=>new Promise(resolve=>{complete=resolve;})});
  const {video,hls,state}=switchFixture();
  try {
    selectQuality(video,hls,'1440',state);await settle();
    selectQuality(video,hls,'auto',state);
    complete(manifest);await settle();
    assert.equal(hls.loadLevel,-1);assert.equal(hls.stopped,undefined);
    selectQuality(video,hls,'1440',state);await settle();
    beginSeek(state);
    complete(manifest);await settle();
    assert.equal(hls.loadLevel,1);assert.equal(hls.stopped,undefined);
  } finally {state.abort.abort();global.fetch=previous;}
});

test('paused, thin-buffer and unaffordable manual choices retain the conservative handoff',()=>{
  for(const kind of ['paused','buffer','bandwidth']) {
    const {video,hls,state}=switchFixture();
    if(kind==='paused')video.paused=true;
    if(kind==='buffer')video.buffered.end=()=>4;
    if(kind==='bandwidth')state.bps=hls.bandwidthEstimate=1000000;
    selectQuality(video,hls,'1440',state);
    assert.equal(hls.loadLevel,1);assert.equal(state.preparing,undefined);
    state.abort.abort();
  }
});

test('a resumed seek cannot turn its old seek timer into a new network stall',()=>{
  const levels=[400000,5000000].map((bitrate,i)=>({bitrate,url:[`/${i}.m3u8`]}));
  const policy=new PlaybackPolicy(levels,20000000,true);
  policy.beginSeek();
  const state={policy,seekAt:0,inflight:{stats:{loading:{start:6500}}}};
  const video={seeking:false,readyState:4};
  const step=()=>policy.step({now:7000,buffer:7.5,playing:true,seeking:video.seeking,auto:true,
    requestAge:requestAge(video,state,7000,7000)});
  assert.equal(step().cap,1,'resumed playback keeps its affordable rendition');
  video.seeking=true;video.readyState=1;state.inflight=null;
  assert.equal(step().cap,0,'an actually stuck seek still has a bounded rescue');
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
  assert.equal(chooseLevel(levels,5000000),2);
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
test('manual and Auto selection retain buffered video while a cold rendition starts', () => {
  const video={qualityList:[{id:'1080:6000000',index:1}],dispatchEvent(){}};
  const hls={levels:[{},{}],
    set currentLevel(_) {throw Error('playing buffer flushed');},
    set nextLevel(_) {throw Error('future video buffer flushed');}};
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.loadLevel,1);
  hls.levels[1].audioGroupIds=['audio'];
  selectQuality(video,hls,'1080:6000000');
  assert.equal(hls.loadLevel,1);
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
  assert.equal(hls.loadLevel,-1,'Auto must clear a native default manual level');
  assert.equal(state.checking,false);
  assert.equal(hls.audioTrack,2,'conservative startup selects the matching 64 kbps audio URI');
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
    assert.equal(hls.loadLevel,-1);
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
  assert.equal(hls.audioTrack,2);
  assert.equal(state.audioProfile,'audio64');
  state.abort.abort();
});
