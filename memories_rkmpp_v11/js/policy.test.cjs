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
test('recovery increases one level after sustained healthy buffering',()=>{
  const p=normal();tick(p,{now:1000,buffer:9,requestAge:2500});
  for(let i=0;i<6;i++)p.sample({loaded:200000,loading:{start:1000,first:1050,end:1075}});
  tick(p,{now:2000,buffer:12});
  assert.equal(tick(p,{now:11000,buffer:12}).cap,0);
  assert.equal(tick(p,{now:12000,buffer:12}).cap,1);
  assert.equal(tick(p,{now:22000,buffer:12}).cap,2);
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
});
