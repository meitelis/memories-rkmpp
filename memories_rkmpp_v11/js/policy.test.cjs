const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PlaybackPolicy}=require('./policy.js');
const levels=[400000,700000,1300000,2900000,6400000,7400000,8700000].map((bitrate,i)=>({bitrate,url:[i===6?'/direct.m3u8':`/${i}.m3u8`]}));
const tick=(policy,values={})=>policy.step({now:0,buffer:18,playing:true,seeking:false,auto:true,originalReady:true,...values});
function normal(){const p=new PlaybackPolicy(levels,30000000,true);tick(p);return p;}

test('metadata preloading and startup are not a bandwidth-collapse signal',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,{buffer:3,playing:false,requestAge:30000}).cap,6);
  assert.equal(tick(p,{buffer:3,requestAge:2500}).cap,6);
  assert.equal(p.phase,'startup');
  assert.equal(tick(p).phase,'normal');
});
test('a stalled original download causes one rescue before the buffer empties',()=>{
  const p=normal();
  const a=tick(p,{now:1000,buffer:9,requestAge:2500});
  assert.deepEqual([a.phase,a.cap,a.audio,a.cancel],['recovering',0,'audio64',true]);
  assert.equal(tick(p,{now:1500,buffer:8,requestAge:3000}).cancel,false);
});
test('a delayed proxy burst stays constrained for the full weak-link trace',()=>{
  const p=normal();tick(p,{now:1000,buffer:9,requestAge:2500});
  for(let now=2000;now<=62000;now+=3000){
    p.sample({loaded:800000,loading:{start:now,first:now+7900,end:now+8000}});
    const a=tick(p,{now,buffer:12});
    assert.equal(a.cap,0);
    assert.equal(a.audio,'audio64');
    assert.equal(a.cancel,false);
  }
});
test('recovery remeasures capacity after healthy buffering instead of trusting paced segment waits',()=>{
  const p=normal();tick(p,{now:1000,buffer:9,requestAge:2500});
  for(let i=0;i<6;i++)p.sample({loaded:200000,loading:{start:1000,first:1050,end:1075}});
  tick(p,{now:2000,buffer:12});
  assert.equal(tick(p,{now:10000,buffer:12}).probe,false);
  const recheck=tick(p,{now:12000,buffer:12});
  assert.equal(recheck.probe,true);
  assert.equal(recheck.cap,0);
  p.measured(30000000,12000,true);
  assert.equal(tick(p,{now:12500,buffer:12}).cap,2,'open only two new quality steps');
  assert.equal(p.phase,'normal');
});

test('a lowest-only decoder does not alternate rescue and normal on each tick',()=>{
  const p=normal();const stalled={buffer:0,requestAge:2500,decoderCap:0,currentLevel:0};
  assert.equal(tick(p,{now:1000,...stalled,requestedLevel:0}).cancel,false,'never cancel lowest rendition');
  const second=tick(p,{now:1100,...stalled});
  assert.deepEqual([second.phase,second.cancel],['recovering',false]);
  const third=tick(p,{now:1200,...stalled});
  assert.deepEqual([third.phase,third.cancel],['recovering',false]);
});
test('recovery completes after healthy buffering even below the decoder ceiling',()=>{
  const p=normal();tick(p,{now:1000,buffer:0,requestAge:2500});
  p.measured(2000000,2000,true);
  assert.equal(tick(p,{now:2000,buffer:12}).phase,'recovering');
  assert.equal(tick(p,{now:11999,buffer:12}).phase,'recovering');
  const recovered=tick(p,{now:12000,buffer:12});
  assert.deepEqual([recovered.phase,recovered.cap],['normal',0]);
  p.measured(2000000,12000,true);
  assert.equal(p.cap,2,'a new stable measurement can permit higher quality');
});

test('fluctuating buffers do not restart lowest 480p segment or prematurely recover',()=>{
  const p=normal();
  assert.equal(tick(p,{now:1000,buffer:3,requestAge:3000,requestedLevel:6}).cancel,true);
  for(const [now,buffer] of [[2000,6.2],[12000,6.2],[13000,10],[14000,9],[24000,10],[25000,9]]) {
    const a=tick(p,{now,buffer,requestAge:3000,currentLevel:0,requestedLevel:0});
    assert.equal(a.cancel,false,'keep the ongoing 480p producer');
    assert.equal(a.phase,'recovering','one high buffer sample is not sustained recovery');
  }
});
test('full buffer must remain healthy for ten consecutive seconds',()=>{
  const p=normal();tick(p,{now:1000,buffer:3,requestAge:3000});
  tick(p,{now:2000,buffer:10,currentLevel:0});
  tick(p,{now:11999,buffer:9,currentLevel:0});
  assert.equal(tick(p,{now:12000,buffer:10,currentLevel:0}).phase,'recovering');
  assert.equal(tick(p,{now:22000,buffer:10,currentLevel:0}).phase,'normal');
});
test('slow first fragment gets bounded warm-up before bandwidth rescue',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,{now:2000,buffer:0,requestAge:8000,currentLevel:6,requestedLevel:6}).cancel,false);
  assert.equal(tick(p,{now:3000,buffer:0,requestAge:9500,currentLevel:6,requestedLevel:6}).cancel,true);
  assert.equal(p.phase,'recovering');
});
test('weak-to-fast recovery climbs gradually and can reach Original',()=>{
  const p=normal();tick(p,{now:1000,buffer:3,requestAge:3000});
  tick(p,{now:2000,buffer:12,currentLevel:0});
  tick(p,{now:12000,buffer:12,currentLevel:0});
  p.measured(30000000,12000,true);
  assert.equal(p.cap,2);
  p.measured(30000000,14000,true);
  assert.equal(p.cap,2);
  p.measured(30000000,28000,true);
  assert.equal(p.cap,4);
  p.measured(30000000,44000,true);
  assert.equal(p.cap,6);
});
test('failed high-quality producer imposes cooldown despite fast speed probes',()=>{
  const p=normal();tick(p,{now:1000,buffer:3,requestAge:3000});
  tick(p,{now:2000,buffer:12,currentLevel:0});
  tick(p,{now:12000,buffer:12,currentLevel:0});
  p.measured(30000000,12000,true);
  assert.equal(p.cap,2);
  assert.equal(tick(p,{now:13000,buffer:2,requestAge:3000,requestedLevel:2,currentLevel:2}).cancel,true);
  p.measured(30000000,30000,true);
  assert.equal(p.cap,0);
  p.measured(30000000,74000,true);
  assert.equal(p.cap,0,'fast probe alone cannot promote an unhealthy buffer');
  tick(p,{now:75000,buffer:12,currentLevel:0});
  tick(p,{now:85000,buffer:12,currentLevel:0});
  p.measured(30000000,85000,true);
  assert.equal(p.cap,2);
});
test('cold seek does not get false startup rescue before seek threshold',()=>{
  const p=normal();p.beginSeek();
  assert.equal(tick(p,{now:1000,buffer:0,seeking:true,requestAge:4500}).cancel,false);
  assert.equal(tick(p,{now:2000,buffer:12}).cap,6);
});
test('recovery measurements respect affordability, Original readiness and decoder limits',()=>{
  const p=normal();tick(p,{now:1000,buffer:9,requestAge:2500});
  p.measured(800000,12000,true);
  assert.equal(tick(p,{now:12500}).cap,0);
  assert.equal(tick(p,{now:26000}).probe,false);
  assert.equal(tick(p,{now:27000}).probe,true);
  p.measured(30000000,28000,false,3);
  assert.equal(tick(p,{now:28500,originalReady:false,decoderCap:3}).cap,2);
});

test('weak-startup playback rechecks capacity even without a buffer rescue',()=>{
  const p=new PlaybackPolicy(levels,750000,true);
  tick(p,{now:1000,currentLevel:0});
  assert.equal(p.phase,'normal');
  assert.equal(p.cap,0,'buffer warmup does not invalidate the measured network budget');
  p.sample({loaded:800000,loading:{start:2000,first:9900,end:10000}});
  assert.equal(p.bps,750000,'a proxy burst does not change the measured audio budget');
  assert.equal(tick(p,{now:11000,currentLevel:0}).probe,true);
  assert.equal(tick(p,{now:12000,currentLevel:0}).probe,false);
  assert.equal(tick(p,{now:30000,currentLevel:6}).probe,false);
  assert.equal(tick(p,{now:30000,currentLevel:0,playing:false}).probe,false);
});

test('recovery does not wait for a paced producer to fill ten seconds of buffer',()=>{
  const p=normal();tick(p,{now:1000,buffer:9,requestAge:2500});
  tick(p,{now:2000,buffer:7,currentLevel:0});
  assert.equal(tick(p,{now:12000,buffer:7,currentLevel:0}).probe,true);
});
test('pause, seeking and manual selection never trigger a rescue',()=>{
  for(const override of [{playing:false},{seeking:true},{auto:false}]){
    const p=normal();const a=tick(p,{buffer:0,requestAge:20000,...override});
    assert.equal(a.cap,6);assert.equal(a.cancel,false);
  }
});
test('an encoded-only ladder is not accidentally capped to its lowest level',()=>{
  const p=new PlaybackPolicy(levels.slice(0,6),30000000);
  assert.equal(tick(p,{originalReady:false}).cap,5);
});
test('unready original and decoder limits remain respected',()=>{
  const p=normal();assert.equal(tick(p,{originalReady:false}).cap,5);
  assert.equal(tick(p,{decoderCap:3}).cap,3);
  assert.equal(tick(p).cap,6,'availability and decoder gates do not erase the measured network budget');
});

test('a cold seek preserves quality after seeked until the producer has warmed',()=>{
  const p=normal();p.beginSeek();
  p.sample({loaded:2000000,loading:{start:0,first:4500,end:4600}});
  assert.equal(p.bps,30000000,'cold generation must not poison the network estimate');
  const pending=tick(p,{buffer:0,seeking:true,requestAge:4500});
  assert.deepEqual([pending.phase,pending.cap,pending.cancel],['seeking',6,false]);
  assert.equal(tick(p,{buffer:12}).phase,'normal');
});

test('byte-limited high-bitrate playback can warm up without ten buffered seconds',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,{buffer:4,targetBuffer:6}).phase,'normal');
  const healthy=tick(p,{buffer:4,targetBuffer:6,requestAge:2500});
  assert.equal(healthy.cap,6);assert.equal(healthy.cancel,false);
});

test('a seek does not suppress recovery indefinitely on an actually stalled link',()=>{
  const p=normal();p.beginSeek();
  const stalled=tick(p,{buffer:0,seeking:true,requestAge:6500});
  assert.equal(stalled.cap,0);assert.equal(stalled.cancel,true);
});
