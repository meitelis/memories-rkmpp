const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectQuality, beginSeek, requestAge, renditionText, configure, update} = require('./player.js');
const {PlaybackPolicy} = require('./policy.js');

const EVENTS=['MANIFEST_PARSED','FRAG_LOADING','FRAG_LOADED','FRAG_BUFFERED',
  'LEVEL_SWITCHED','FPS_DROP_LEVEL_CAPPING','ERROR','AUDIO_TRACKS_UPDATED'];
const levels=[400000,800000,2000000].map((bitrate,i)=>({
  bitrate,width:640+400*i,height:360+180*i,url:['/'+i+'.m3u8']
}));
function fixture(){
  const listeners=new Map(),writes=[];
  const hls={
    constructor:{Events:Object.fromEntries(EVENTS.map(x=>[x,x])),version:'1.7.4'},
    config:{},levels:[],audioTracks:[],currentLevel:0,
    on(e,fn){listeners.set(e,fn)},off(e){listeners.delete(e)},
    startLoad(){this.started=true},stopLoad(){this.stopped=true},
    set loadLevel(x){writes.push(x);this._loadLevel=x},
    get loadLevel(){return this._loadLevel},
    set nextLevel(_){throw Error('may flush video')},
    set currentLevel(_) {throw Error('may flush video')},
    set audioTrack(_) {throw Error('audio switching must not occur')},
    set nextAudioTrack(_) {throw Error('audio switching must not occur')},
  };
  // Use an own data property for currentLevel; it is read-only in tests.
  Object.defineProperty(hls,'currentLevel',{value:0,writable:true,configurable:true});
  const video={
    _qualityHls:hls,currentTime:0,videoWidth:1280,videoHeight:720,
    paused:false,ended:false,seeking:false,readyState:4,
    buffered:{length:1,start:()=>0,end:()=>5},
    closest:()=>null,dispatchEvent(){},qualityList:[],
  };
  Object.defineProperty(video,'currentQuality',{
    configurable:true,get(){return this._qualitySelected},
    set(value){this._qualitySelected=value},
  });
  const state={badge:{dataset:{},textContent:''},debug:false,decoderCap:Infinity,bps:0};
  return {hls,video,state,writes,
    emit:(event,data={})=>listeners.get(event)?.(event,data),
    frame:(level,elapsedMs=4100,transferMs=100,bytes=200000)=> {
      const now=performance.now();
      const stats={loaded:bytes,loading:{start:Math.max(1,now-elapsedMs),first:now-transferMs,end:now}};
      listeners.get('FRAG_BUFFERED')?.('FRAG_BUFFERED',
        {frag:{type:'main',duration:4,level,stats,start:0,end:4},stats});
    },
  };
}
async function boot(f){
  const old=global.fetch;
  global.fetch=async()=>({ok:false,headers:{get:()=>''}});
  try{
    configure(f.video,f.state,f.hls);
    f.hls.levels=levels;
    await f.emit('MANIFEST_PARSED');
  }finally{global.fetch=old}
}

test('manual and Auto selections never invoke flushing HLS switches',()=>{
  const f=fixture();
  f.video.qualityList=[{id:'720:800000',index:1}];
  selectQuality(f.video,f.hls,'720:800000');
  selectQuality(f.video,f.hls,'auto',{policy:{cap:2},badge:{dataset:{}}});
  assert.deepEqual(f.writes,[1,2]);
});

test('badge reports presented dimensions and codec',()=>{
  const f=fixture();
  f.hls.levels=[{videoCodec:'hvc1.1.6.L120.80',url:['/720p.m3u8']}];
  assert.equal(renditionText(f.video,f.hls),'Auto · 720p (1280×720) · HEVC');
  f.hls.levels[0].url=['/direct.m3u8?token=x'];
  assert.match(renditionText(f.video,f.hls),/^Original · 720p/);
});

test('cold seek resets proof but keeps previously selected resolution',()=>{
  const f=fixture(),p=new PlaybackPolicy(levels,50000000,true);
  f.hls.currentLevel=2;
  f.state.policy=p;f.state.hls=f.hls;f.state.cap=2;f.state.selected='auto';
  p.step({now:0,buffer:5,playing:true,seeking:false,auto:true,
    originalReady:true,currentLevel:2});
  p.onFragment({level:2,duration:4,elapsedMs:1000,buffer:5});
  beginSeek(f.state);
  assert.equal(f.hls.loadLevel,2);
  assert.equal(p.phase,'seeking');
  assert.equal(p.goodFragments,0);
});

test('request age uses the monotonic loader clock',()=>{
  const f=fixture();
  assert.equal(requestAge(f.video,{inflight:{stats:{loading:{start:700}}}},1000,2200),1500);
});

test('startup still uses one bounded probe and a six-second forward buffer',async()=>{
  const f=fixture();await boot(f);
  try{
    assert.equal(f.hls.config.maxBufferLength,6);
    assert.equal(f.hls.config.maxMaxBufferLength,6);
    assert.equal(f.hls.config.autoStartLoad,false);
    assert.equal(f.hls.started,true);
    assert.equal(f.hls.loadLevel,0);
    assert.equal(f.state.audioProfile,'audio');
  }finally{f.state.abort.abort()}
});

test('fast fragments—not 500ms polling—promote one rung at a time',async()=>{
  const f=fixture();await boot(f);
  try{
    update(f.video,f.state);
    const count=f.writes.length;
    for(let i=0;i<20;i++)update(f.video,f.state);
    assert.equal(f.writes.length,count);
    // We use actual performance.now()-loading.start in the fragment handler.
    // In fast Node test runs performance.now() may be <1000: make it
    // large enough for the recorded positive fragment timestamp.
    const previous=global.performance;
    Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>5000}});
    try{
      f.frame(0);update(f.video,f.state);
      assert.equal(f.hls.loadLevel,0);
      f.frame(0);update(f.video,f.state);
      assert.equal(f.hls.loadLevel,1);
      for(let i=0;i<4;i++){f.frame(1);update(f.video,f.state)}
      assert.equal(f.state.policy.cap,1,'previous rendition not yet displayed');
      f.hls.currentLevel=1;
      update(f.video,f.state);
      f.frame(1);f.frame(1);update(f.video,f.state);
      assert.equal(f.hls.loadLevel,2);
    }finally{Object.defineProperty(global,'performance',{configurable:true,value:previous})}
  }finally{f.state.abort.abort()}
});

test('video quality changes do not switch the independent AAC track',async()=>{
  const f=fixture();await boot(f);
  try{
    f.hls.audioTracks=['audio','audio96','audio64','audio32'].map(id=>({url:'/'+id+'.m3u8'}));
    f.emit('AUDIO_TRACKS_UPDATED');
    update(f.video,f.state);
    f.video.qualityList=[{id:'720:800000',index:1}];
    selectQuality(f.video,f.hls,'720:800000',f.state);
    assert.equal(f.state.audioProfile,'audio');
    assert.equal(f.hls.loadLevel,1);
  }finally{f.state.abort.abort()}
});

test('waiting with almost no buffer can still trigger immediate downshift',async()=>{
  const f=fixture();await boot(f);
  try{
    f.state.policy.cap=2;f.state.cap=2;
    f.hls.currentLevel=2;
    f.state.policy.phase='normal';
    f.state.policy.onWaiting();
    f.video.buffered.end=()=>1.2;
    update(f.video,f.state);
    assert.equal(f.state.policy.cap,1);
    assert.equal(f.hls.loadLevel,1);
  }finally{f.state.abort.abort()}
});

test('manual selection is not overridden by automatic quality decisions',async()=>{
  const f=fixture();await boot(f);
  try{
    f.state.selected='720:800000';
    f.video.qualityList=[{id:'720:800000',index:1}];
    selectQuality(f.video,f.hls,'720:800000',f.state);
    const before=f.writes.length;
    f.state.policy.onWaiting();
    f.video.buffered.end=()=>0.2;
    update(f.video,f.state);
    assert.equal(f.writes.length,before);
  }finally{f.state.abort.abort()}
});

test('native Memories level changes cannot mislabel Auto as manual',async()=>{
  const f=fixture();await boot(f);
  try {
    f.video._qualitySelected='360:400000';
    f.emit('LEVEL_SWITCHED',{level:0});
    assert.equal(f.video._qualitySelected,'auto');
    assert.equal(f.video.currentQuality,'auto');
  }finally{f.state.abort.abort()}
});
test('network telemetry excludes four seconds of paced RKMPP production',async()=>{
  const f=fixture();await boot(f);
  try{
    const previous=global.performance;
    Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>5000}});
    try{
      update(f.video,f.state);
      f.frame(0,4100,100,200000);
      assert.equal(f.state.badge.dataset.transferMbps,'16.00');
      assert.equal(f.state.badge.dataset.deliveryRate,(4000/4100).toFixed(2));
    }finally{Object.defineProperty(global,'performance',{configurable:true,value:previous})}
  }finally{f.state.abort.abort()}
});
test('missing HTTP first-byte timestamps cannot falsely upgrade Auto',async()=>{
  const f=fixture();await boot(f);
  try {
    update(f.video,f.state);
    const previous=global.performance;
    Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>5000}});
    try{
      for(let i=0;i<9;i++){
        const stats={loaded:200000,loading:{start:100,first:0,end:5000}};
        f.emit('FRAG_BUFFERED',{frag:{type:'main',duration:4,level:0,stats},stats});
        update(f.video,f.state);
      }
      assert.equal(f.state.policy.cap,0);
      assert.equal(f.state.badge.dataset.transferMbps,'');
    }finally{Object.defineProperty(global,'performance',{configurable:true,value:previous})}
  }finally{f.state.abort.abort()}
});
