const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectQuality, renditionText, configure, update, refreshBandwidth, speedProbe} = require('./player.js');

const EVENTS=['MANIFEST_PARSED','FRAG_LOADED','FRAG_BUFFERED','LEVEL_SWITCHED','ERROR'];
const levels=[
  {bitrate:400000,maxBitrate:400000,width:854,height:480,url:['/480p.m3u8']},
  {bitrate:2000000,maxBitrate:2000000,width:1920,height:1080,url:['/1080p.m3u8']},
  {bitrate:8000000,maxBitrate:8000000,width:3200,height:1800,url:['/direct.m3u8']},
];
function fixture(list=levels.slice(0,2)){
  const listeners=new Map(),writes=[],switches=[];
  let manual=-1,estimate=800000;
  const hls={
    constructor:{Events:Object.fromEntries(EVENTS.map(x=>[x,x])),version:'1.7.4'},
    config:{},levels:[],currentLevel:0,startLevel:0,
    on(e,fn){listeners.set(e,fn)},off(e){listeners.delete(e)},
    stopLoad(){this.stopped=true},startLoad(){this.started=true},
    get manualLevel(){return manual},
    get autoLevelEnabled(){return manual===-1},
    get loadLevel(){return manual},
    set loadLevel(value){manual=value;writes.push(value)},
    set nextLevel(value){manual=value;switches.push(value)},
    get bandwidthEstimate(){return estimate},
    set bandwidthEstimate(value){estimate=value},
  };
  const video={
    _qualityHls:hls,_qualitySelected:'auto',currentTime:0,videoWidth:1280,videoHeight:720,
    paused:false,ended:false,seeking:false,readyState:4,
    buffered:{length:1,start:()=>0,end:()=>8},
    closest:()=>null,dispatchEvent(){},qualityList:[
      {id:'480:400000',index:0},{id:'1080:2000000',index:1},
      {id:'1800:8000000',index:2},
    ],
  };
  Object.defineProperty(video,'currentQuality',{configurable:true,
    get(){return this._qualitySelected},set(id){this._qualitySelected=id}});
  const state={badge:{dataset:{},textContent:''},hls:null,bps:0,debug:false};
  return {video,hls,state,writes,switches,list,
    emit:(name,data={})=>listeners.get(name)?.(name,data),
  };
}
async function boot(f){
  const old=global.fetch;
  global.fetch=async()=>({ok:false,headers:{get:()=>''}});
  try{
    configure(f.video,f.state,f.hls);
    f.hls.levels=f.list;
    await f.emit('MANIFEST_PARSED');
  }finally{global.fetch=old}
}
function installFastProbe(){
  const previousWindow=global.window,previousFetch=global.fetch;
  global.window={OC:{generateUrl:()=>'/probe'}};
  global.fetch=async url=>{
    const n=Number(new URL(String(url),'https://example.test').searchParams.get('bytes')) || 131072;
    let used=false;
    return {ok:true,headers:{get:()=> 'application/octet-stream'},
      body:{getReader(){return {
        async read(){if(used)return{done:true};used=true;
          return{done:false,value:new Uint8Array(n)}},
        releaseLock(){},
      }}}};
  };
  return ()=>{
    global.fetch=previousFetch;
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
  };
}

test('cold startup leaves hls.js in actual automatic mode',async()=>{
  const f=fixture();await boot(f);
  try{
    assert.equal(f.hls.started,true);
    assert.equal(f.hls.startLevel,-1);
    assert.equal(f.hls.loadLevel,-1);
    assert.equal(f.hls.autoLevelEnabled,true);
    assert.equal(f.state.selected,'auto');
    assert.equal(f.state.badge.dataset.phase,'native-auto');
  }finally{f.state.abort.abort()}
});

test('forward and backward buffer bounds match the new profile',async()=>{
  const f=fixture();await boot(f);
  try{
    assert.equal(f.hls.config.maxBufferLength,18);
    assert.equal(f.hls.config.maxMaxBufferLength,18);
    assert.equal(f.hls.config.maxBufferSize,96*1024*1024);
    assert.equal(f.hls.config.backBufferLength,8);
    assert.equal(f.hls.config.maxStarvationDelay,6);
    assert.equal(f.hls.config.maxLoadingDelay,6);
  }finally{f.state.abort.abort()}
});

test('manual selection pins requested rendition without flushing',async()=>{
  const f=fixture();await boot(f);
  try{
    selectQuality(f.video,f.hls,'1080:2000000',f.state);
    assert.equal(f.hls.manualLevel,1);
    assert.equal(f.hls.autoLevelEnabled,false);
    assert.equal(f.state.selected,'1080:2000000');
    assert.deepEqual(f.switches,[]);
  }finally{f.state.abort.abort()}
});

test('manual 480p to Auto immediately releases the manual lock',async()=>{
  const f=fixture();await boot(f);
  try{
    selectQuality(f.video,f.hls,'480:400000',f.state);
    selectQuality(f.video,f.hls,'auto',f.state);
    assert.equal(f.hls.loadLevel,-1);
    assert.equal(f.hls.autoLevelEnabled,true);
    assert.equal(f.video._qualitySelected,'auto');
  }finally{f.state.abort.abort()}
});

test('Auto selector is safe without a per-video state object',()=>{
  const f=fixture();
  assert.doesNotThrow(()=>selectQuality(f.video,f.hls,'auto'));
  assert.equal(f.hls.autoLevelEnabled,true);
});

test('invalid manual selection cannot silently turn off Auto',async()=>{
  const f=fixture();await boot(f);
  try{
    selectQuality(f.video,f.hls,'invalid:quality',f.state);
    assert.equal(f.hls.autoLevelEnabled,true);
    assert.equal(f.state.selected,'auto');
  }finally{f.state.abort.abort()}
});

test('480p to Auto uses a new probe and hls.js decides the faster next fragment',async()=>{
  const f=fixture();await boot(f);
  const restore=installFastProbe();
  try{
    f.hls.currentLevel=0;
    selectQuality(f.video,f.hls,'480:400000',f.state);
    selectQuality(f.video,f.hls,'auto',f.state);
    // Wait for the event-driven recovery probe to finish.
    for(let i=0;i<20 && !f.state.badge.dataset.recoveryProbeAt;i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(f.hls.autoLevelEnabled,true);
    assert.ok(f.hls.bandwidthEstimate>2000000);
    assert.ok(f.switches.includes(-1),'hls.js should choose the next quality in Auto');
  }finally{restore();f.state.abort.abort()}
});

test('mobile-data to Wi-Fi probe raises the EWMA without manually pinning a rung',async()=>{
  const f=fixture();await boot(f);
  const restore=installFastProbe();
  try{
    f.hls.currentLevel=0;
    f.hls.bandwidthEstimate=400000;
    await refreshBandwidth(f.state,true);
    assert.ok(f.hls.bandwidthEstimate>1000000);
    assert.equal(f.hls.autoLevelEnabled,true);
    assert.ok(f.state.badge.dataset.recoveryBandwidth);
  }finally{restore();f.state.abort.abort()}
});

test('periodic recovery probe obeys its cooldown',async()=>{
  const f=fixture();await boot(f);
  const restore=installFastProbe();
  try{
    f.state.lastProbeAt=Date.now();
    const previous=f.hls.bandwidthEstimate;
    await refreshBandwidth(f.state,false);
    assert.equal(f.hls.bandwidthEstimate,previous);
    assert.equal(f.state.badge.dataset.recoveryProbeAt,undefined);
  }finally{restore();f.state.abort.abort()}
});

test('manual selection ignores pending background Auto probes',async()=>{
  const f=fixture();await boot(f);
  let resolve;
  const priorFetch=global.fetch,priorWindow=global.window;
  global.window={OC:{generateUrl:()=>'/probe'}};
  global.fetch=()=>new Promise(r=>{resolve=r});
  try{
    const pending=refreshBandwidth(f.state,true);
    selectQuality(f.video,f.hls,'480:400000',f.state);
    resolve({ok:false,headers:{get:()=>''}});
    await pending;
    assert.equal(f.hls.manualLevel,0);
    assert.equal(f.hls.autoLevelEnabled,false);
  }finally{
    global.fetch=priorFetch;
    if(priorWindow===undefined)delete global.window;else global.window=priorWindow;
    f.state.abort.abort();
  }
});

test('a superseded hls.js session cannot be changed by an old probe',async()=>{
  const f=fixture();await boot(f);
  let resolve;
  const priorFetch=global.fetch,priorWindow=global.window;
  global.window={OC:{generateUrl:()=>'/probe'}};
  global.fetch=()=>new Promise(r=>{resolve=r});
  try{
    const pending=refreshBandwidth(f.state,true);
    f.state.abort.abort();
    resolve({ok:false,headers:{get:()=>''}});
    await pending;
    assert.equal(f.state.badge.dataset.recoveryProbeAt,undefined);
  }finally{
    global.fetch=priorFetch;
    if(priorWindow===undefined)delete global.window;else global.window=priorWindow;
  }
});

test('paced RKMPP production cannot permanently poison the native EWMA',async()=>{
  const f=fixture();await boot(f);
  try{
    f.hls.bandwidthEstimate=400000;
    for(let i=0;i<2;i++)
      f.emit('FRAG_BUFFERED',{frag:{type:'main',level:0},stats:{
        loaded:200000,loading:{start:100,first:4100,end:4200},
      }});
    assert.ok(f.hls.bandwidthEstimate>=5000000);
    assert.equal(f.hls.autoLevelEnabled,true);
    assert.equal(f.hls.loadLevel,-1);
  }finally{f.state.abort.abort()}
});

test('fast-serving backend does not spuriously override the native EWMA',async()=>{
  const f=fixture();await boot(f);
  try{
    f.hls.bandwidthEstimate=400000;
    for(let i=0;i<2;i++)
      f.emit('FRAG_BUFFERED',{frag:{type:'main',level:0},stats:{
        loaded:200000,loading:{start:100,first:150,end:250},
      }});
    assert.equal(f.hls.bandwidthEstimate,400000);
  }finally{f.state.abort.abort()}
});

test('audio track stays untouched when changing manual and Auto quality',async()=>{
  const f=fixture();await boot(f);
  try{
    Object.defineProperty(f.hls,'audioTrack',{set(){throw Error('audio must not switch')}});
    selectQuality(f.video,f.hls,'480:400000',f.state);
    selectQuality(f.video,f.hls,'auto',f.state);
    f.hls.currentLevel=1;
    f.emit('LEVEL_SWITCHED',{level:1});
    assert.equal(f.state.audioProfile,'audio');
    assert.equal(f.hls.autoLevelEnabled,true);
  }finally{f.state.abort.abort()}
});

test('Original has correct displayed dimensions and codec information',()=>{
  const f=fixture();
  f.hls.levels=[{url:'/direct.m3u8?token=x',videoCodec:'hvc1.1.6.L120.80'}];
  assert.match(renditionText(f.video,f.hls),/^Original · 720p \(1280×720\) · HEVC$/);
});

test('an invalid probe response does not invent a high bandwidth',async()=>{
  const prevFetch=global.fetch,prevWindow=global.window;
  global.window={OC:{generateUrl:()=>'/probe'}};
  global.fetch=async()=>({ok:false,headers:{get:()=>''}});
  const abort=new AbortController();
  try{assert.equal(await speedProbe(abort.signal,[131072]),0)}
  finally{
    global.fetch=prevFetch;
    if(prevWindow===undefined)delete global.window;else global.window=prevWindow;
  }
});

test('truncated and interrupted probes do not seed bandwidth',async()=>{
  const previousFetch=global.fetch,previousWindow=global.window;
  global.window={OC:{generateUrl:()=>'/probe'}};
  try{
    for(const mode of ['truncated','interrupted']){
      global.fetch=async()=>({
        ok:true,headers:{get:()=> 'application/octet-stream'},
        body:{getReader(){
          let reads=0;
          return {
            async read(){
              if(++reads===1)return {done:false,value:new Uint8Array(65536)};
              if(mode==='interrupted')throw new Error('network interrupted');
              return {done:true};
            },
            releaseLock(){},
          };
        }},
      });
      assert.equal(await speedProbe(new AbortController().signal,[131072]),0,mode);
    }
  }finally{
    global.fetch=previousFetch;
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
  }
});

test('a valid first sample survives a truncated or interrupted second response',async()=>{
  const previousFetch=global.fetch,previousWindow=global.window;
  global.window={OC:{generateUrl:()=>'/probe'}};
  try{
    for(const mode of ['truncated','interrupted']){
      let requests=0;
      global.fetch=async()=>{
        const request=++requests;
        let reads=0;
        return {ok:true,headers:{get:()=> 'application/octet-stream'},
          body:{getReader(){return {
            async read(){
              if(++reads===1)return {done:false,
                value:new Uint8Array(request===1 ? 131072 : 1)};
              if(request===2 && mode==='interrupted')throw new Error('network interrupted');
              return {done:true};
            },
            releaseLock(){},
          }}},
        };
      };
      const measured=await speedProbe(new AbortController().signal,[131072,393216,1572864]);
      assert.equal(requests,2,'the probe must stop after the failed second response');
      // An old implementation overwrote the 128 KiB measurement with a 1-byte
      // partial sample (at most 320 bps, given the 25 ms timing floor).
      assert.ok(measured>100000,mode+' must retain the complete first measurement');
    }
  }finally{
    global.fetch=previousFetch;
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
  }
});

test('explicit cancellation rejects a complete-size but aborted response',async()=>{
  const previousFetch=global.fetch,previousWindow=global.window;
  const controller=new AbortController();
  global.window={OC:{generateUrl:()=>'/probe'}};
  global.fetch=async()=>({
    ok:true,headers:{get:()=> 'application/octet-stream'},
    body:{getReader(){let reads=0;return {
      async read(){
        if(++reads===1){
          controller.abort();
          return {done:false,value:new Uint8Array(131072)};
        }
        return {done:true};
      },
      releaseLock(){},
    }}},
  });
  try{
    assert.equal(await speedProbe(controller.signal,[131072]),0);
  }finally{
    global.fetch=previousFetch;
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
  }
});

test('probe timeout discards incomplete read even after bytes arrived',async()=>{
  const previousFetch=global.fetch,previousWindow=global.window;
  const previousSetTimeout=global.setTimeout;
  global.window={OC:{generateUrl:()=>'/probe'}};
  // Exercise the actual internal 2200 ms timer without slowing CI by 2.2 s.
  global.setTimeout=(callback,delay,...args)=>
    previousSetTimeout(callback,delay===2200 ? 1 : delay,...args);
  let timedOut=false;
  global.fetch=async(_url,{signal})=>{
    signal.addEventListener('abort',()=>{timedOut=true},{once:true});
    return {ok:true,headers:{get:()=> 'application/octet-stream'},
      body:{getReader(){let reads=0;return {
        read(){
          if(++reads===1)return Promise.resolve({done:false,value:new Uint8Array(65536)});
          return new Promise((_resolve,reject)=>{
            if(signal.aborted)reject(new Error('timeout'));
            else signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});
          });
        },
        releaseLock(){},
      }}},
    };
  };
  try{
    assert.equal(await speedProbe(new AbortController().signal,[131072]),0);
    assert.equal(timedOut,true,'the internal timeout must have fired');
  }finally{
    global.fetch=previousFetch;
    global.setTimeout=previousSetTimeout;
    if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
  }
});

test('diagnostics report actual native Auto, not the UI label',async()=>{
  const f=fixture();await boot(f);
  try{
    update(f.video,f.state);
    assert.equal(f.state.badge.dataset.hlsAuto,'true');
    f.hls.loadLevel=0;
    update(f.video,f.state);
    assert.equal(f.state.badge.dataset.hlsAuto,'false');
  }finally{f.state.abort.abort()}
});

test('fatal media errors remain visible without endless retries',async()=>{
  const f=fixture();await boot(f);
  try{
    f.emit('ERROR',{fatal:true,type:'mediaError',details:'bufferAppendError'});
    assert.equal(f.state.failure,'Playback error');
  }finally{f.state.abort.abort()}
});
