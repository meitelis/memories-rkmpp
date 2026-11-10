const {test} = require('node:test');
const assert = require('node:assert/strict');

// Run the actual hls.js controllers with an in-memory playlist loader. No
// network or browser decoder is involved in these selection-order tests.
global.self = global;
global.location = {href:'https://example.test/'};
global.MediaSource = {isTypeSupported:()=>true};
const Hls = require('hls.js');
const {configure} = require('../memories_rkmpp_v11/js/player.js');
const master = '#EXTM3U\n' + [400000,570000,1000000,1425000,1995000,4275000]
  .map((bps,i)=>`#EXT-X-STREAM-INF:BANDWIDTH=${bps},CODECS="avc1.640028",RESOLUTION=3840x2160\n${i}.m3u8\n`).join('');

async function startup({adapter=true, fast=true, throughput, afterStart, original=false, ready=true}={}) {
  const requests = [];
  class Loader {
    constructor() {
      this.stats = {aborted:false,loaded:0,total:0,retry:0,
        loading:{start:1,first:2,end:3},parsing:{start:0,end:0},buffering:{start:0,first:0,end:0}};
    }
    load(context, _config, callbacks) {
      this.context = context;
      requests.push(context.url);
      if (context.type === 'manifest') queueMicrotask(()=>callbacks.onSuccess(
        {url:context.url,data:original ? master.replace('5.m3u8','direct.m3u8') : master},this.stats,context,{}));
    }
    abort() { this.stats.aborted = true; }
    destroy() {}
  }
  const hls = new Hls({loader:Loader,enableWorker:false,autoStartLoad:false});
  const video = {currentTime:0,paused:false,seeking:false,buffered:{length:0}};
  const state = {badge:{dataset:{}},debug:false};
  const oldFetch = global.fetch, oldWindow = global.window, oldPerformance = global.performance;
  let probeClock = 1000;
  if (throughput) global.performance = {now:()=>probeClock};
  global.window = {OC:{generateUrl:()=>'/probe'}};
  global.fetch = async url => {
    if (String(url).includes('/direct.m3u8')) return {ok:ready,body:{cancel:async()=>{}}};
    if (!fast) return {ok:false};
    const bytes = Number(new URL(url,'https://example.test').searchParams.get('bytes'));
    let done = false;
    return {ok:true,headers:{get:()=> 'application/octet-stream'},body:{getReader:()=>({
      async read() {
        if (done) return {done:true};
        done=true;
        if (throughput) probeClock += bytes*8000/throughput;
        return {done:false,value:new Uint8Array(bytes)};
      },
      releaseLock() {},
    })}};
  };
  try {
    if (adapter) configure(video,state,hls);
    else {
      hls.bandwidthEstimate = 90000000;
      hls.on(Hls.Events.MANIFEST_PARSED,()=>{ hls.startLevel=-1; hls.startLoad(); });
    }
    hls.loadSource('https://example.test/index.m3u8');
    const deadline=Date.now()+2500;
    while (!requests.some(url=>/\/(?:\d|direct)\.m3u8$/.test(url)) && Date.now()<deadline)
      await new Promise(resolve=>setTimeout(resolve,5));
    const extra = afterStart?.(hls);
    return {requests,manual:hls.manualLevel,auto:hls.autoLevelEnabled,bitrateTest:hls.streamController.bitrateTest,
      cap:hls.autoLevelCapping,originalReady:state.originalReady,extra};
  } finally {
    state.abort?.abort();
    hls.destroy();
    global.fetch = oldFetch;
    global.performance = oldPerformance;
    if (oldWindow === undefined) delete global.window; else global.window=oldWindow;
  }
}

test('real hls.js reproduces lowest-rendition test despite a fast seeded estimate',async()=>{
  const result = await startup({adapter:false});
  assert.equal(result.requests.at(-1),'https://example.test/0.m3u8');
  assert.equal(result.bitrateTest,true);
});

test('native Auto considers a ready Original rendition on a fast connection',async()=>{
  const result = await startup({original:true});
  assert.equal(result.requests.at(-1),'https://example.test/direct.m3u8');
  assert.equal(result.originalReady,true);
  assert.equal(result.cap,-1);
  assert.equal(result.auto,true);
});

test('pending Original is excluded from Auto until its playlist is ready',async()=>{
  const result = await startup({original:true,ready:false});
  assert.equal(result.requests.at(-1),'https://example.test/4.m3u8');
  assert.equal(result.originalReady,false);
  assert.equal(result.cap,4);
  assert.equal(result.auto,true);
});

test('measured fast startup requests only the native-selected top rendition',async()=>{
  const result = await startup();
  assert.equal(result.requests.at(-1),'https://example.test/5.m3u8');
  assert.equal(result.requests.some(url=>/\/0\.m3u8$/.test(url)),false);
  assert.equal(result.bitrateTest,false);
  assert.equal(result.auto,true);
  assert.equal(result.manual,-1);
});

test('failed connection probe keeps a conservative automatic startup',async()=>{
  const result = await startup({fast:false});
  assert.equal(result.requests.at(-1),'https://example.test/0.m3u8');
  assert.equal(result.auto,true);
  assert.equal(result.manual,-1);
});

test('measured 1.5 Mbps connection starts at 720p instead of forcing 4K',async()=>{
  const result = await startup({throughput:1500000});
  assert.equal(result.requests.at(-1),'https://example.test/2.m3u8');
  assert.equal(result.auto,true);
});

test('measured slow connection starts at the lowest rendition',async()=>{
  const result = await startup({throughput:250000});
  assert.equal(result.requests.at(-1),'https://example.test/0.m3u8');
  assert.equal(result.auto,true);
});

test('native ABR still drops quality when subsequent fragment transfer is slow',async()=>{
  const result = await startup({afterStart(hls) {
    const initial = hls.nextAutoLevel;
    for (let i=0;i<4;i++) {
      const frag = {type:'main',sn:i,level:5,bitrate:4275000,duration:3,
        stats:{loaded:100000,loading:{start:100,first:200,end:15100},parsing:{end:15100}}};
      hls.abrController.onFragLoaded(Hls.Events.FRAG_LOADED,{frag});
      hls.abrController.onFragBuffered(Hls.Events.FRAG_BUFFERED,{frag});
    }
    return {initial,next:hls.nextAutoLevel};
  }});
  assert.equal(result.extra.initial,5);
  assert.equal(result.extra.next,0);
  assert.equal(result.auto,true);
  assert.equal(result.manual,-1);
});
