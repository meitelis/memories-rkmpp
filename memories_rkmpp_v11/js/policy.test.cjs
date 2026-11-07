const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PlaybackPolicy, chooseLevel} = require('./policy.js');

const levels = [400000,700000,1300000,2900000,6400000,7400000,8700000]
  .map((bitrate,i)=>({bitrate,url:[i===6?'/direct.m3u8':'/'+i+'.m3u8']}));
const policy = (bps=100000000) => new PlaybackPolicy(levels,bps,true);
const step=(p,now,buffer,more={})=>p.step({
  now,buffer,requestAge:0,auto:true,playing:true,seeking:false,
  originalReady:true,currentLevel:p.target,...more,
});
const fragment=(p,sn,more={})=>p.onFragment({
  level:p.target,sn,duration:4,bytes:300000,
  loading:{start:100,first:4000,end:4100},buffer:18,now:sn*4000,...more,
});
const normal=(bps=100000000)=>{
  const p=policy(bps);p.onPlaying();step(p,0,18);return p;
};

test('start below unproven Original, even on an exceptionally fast probe',()=>{
  assert.equal(chooseLevel(levels,100000000),6);
  assert.equal(policy().target,5);
  assert.equal(policy(800000).target,0);
});
test('three-to-five-second buffer sawtooth never changes quality',()=>{
  for(const period of [3,4,4.5,5]){
    const p=normal();
    for(let n=500;n<90000;n+=250)
      assert.equal(step(p,n,20-(n/1000%period),{requestAge:1200}).cap,5);
  }
});
test('buffer cannot force an upgrade without completed video fragments',()=>{
  const p=normal(800000);
  for(let n=500;n<90000;n+=500)step(p,n,20);
  assert.equal(p.target,0);
});
test('endangered buffer downshifts while a useful reserve remains',()=>{
  const p=normal();
  assert.equal(step(p,500,8,{requestAge:1900}).cap,4);
});
test('critical near-stall uses a two-rung emergency reduction',()=>{
  const p=normal();
  assert.equal(step(p,500,2,{requestAge:1000}).cap,3);
});
test('a pending non-flushing downgrade cannot cascade every polling tick',()=>{
  const p=normal();
  assert.equal(step(p,1000,8,{requestAge:2500}).cap,4);
  for(let n=1500;n<6000;n+=500)
    assert.equal(step(p,n,7,{requestAge:4000,currentLevel:5}).cap,4);
});
test('after a downgrade is actually playing, another confirmed danger can reduce again',()=>{
  const p=normal();
  step(p,1000,8,{requestAge:2000});
  assert.equal(step(p,5000,8,{requestAge:2000,currentLevel:4}).cap,3);
});
test('a normal outstanding fragment at six seconds does not trigger a switch',()=>{
  const p=normal();
  for(let n=500;n<=5000;n+=500)
    assert.equal(step(p,n,6,{requestAge:900}).cap,5);
});
test('three distinct real fragments can promote one step to Original',()=>{
  const p=normal();
  fragment(p,1);fragment(p,2);
  assert.equal(step(p,15000,18).cap,5);
  fragment(p,3);
  assert.equal(step(p,16000,18).cap,6);
});
test('replayed fragment callbacks do not manufacture readiness',()=>{
  const p=normal();
  fragment(p,1);fragment(p,2);fragment(p,1);fragment(p,2);
  assert.equal(p.samples.length,2);
  assert.equal(step(p,16000,18).cap,5);
});
test('missing transfer timings cannot be used as fake bandwidth evidence',()=>{
  const p=normal();
  for(let i=1;i<=6;i++)fragment(p,i,{loading:{start:100,first:0,end:100}});
  assert.equal(step(p,18000,18).cap,5);
});
test('slow producer cannot justify a quality upgrade even with high transfer speed',()=>{
  const p=normal();
  for(let i=1;i<=6;i++)fragment(p,i,{loading:{start:100,first:8000,end:8100}});
  assert.equal(step(p,18000,18).cap,5);
});
test('Original requires sixteen seconds of buffer before first promotion',()=>{
  const p=normal();
  for(let i=1;i<=3;i++)fragment(p,i);
  assert.equal(step(p,17000,15).cap,5);
});
test('switch to Original must be seen on screen before further changes',()=>{
  const p=normal();
  for(let i=1;i<=3;i++)fragment(p,i);
  assert.equal(step(p,17000,18).cap,6);
  for(let n=18000;n<=22000;n+=500)
    assert.equal(step(p,n,18,{currentLevel:5}).cap,6);
});
test('failed Original trial is blacklisted after a draining buffer',()=>{
  const p=normal();
  for(let i=1;i<=3;i++)fragment(p,i);
  step(p,17000,18);
  step(p,19000,8,{requestAge:2000,currentLevel:5});
  assert.equal(p.target,5);
  assert.ok(p.blacklist.get(6)>19000);
  p.onLevelPlayed(5);
  for(let i=4;i<=8;i++)fragment(p,i);
  assert.equal(step(p,40000,18,{currentLevel:5}).cap,5);
});
test('buffer evidence does not cross a seek',()=>{
  const p=normal();
  fragment(p,1);fragment(p,2);p.beginSeek();
  assert.equal(p.samples.length,0);
  assert.equal(step(p,30000,0,{seeking:true}).cap,5);
  p.endSeek();
});
test('pause or manual selection suspends adaptation',()=>{
  for(const options of [{playing:false},{auto:false}]) {
    const p=normal();
    assert.equal(step(p,30000,0,{requestAge:5000,...options}).cap,5);
  }
});
test('decoder cap is respected independently of Original readiness',()=>{
  const p=normal();
  assert.equal(step(p,1000,18,{decoderCap:2}).cap,2);
});
test('Original is not requested until its preflight is ready',()=>{
  const p=normal();
  for(let i=1;i<=4;i++)fragment(p,i);
  assert.equal(step(p,18000,18,{originalReady:false}).cap,5);
});
test('waiting discards the previous promotion evidence',()=>{
  const p=normal();
  fragment(p,1);fragment(p,2);p.onWaiting();p.onPlaying();
  assert.equal(p.samples.length,0);
  assert.equal(step(p,18000,18).cap,5);
});
