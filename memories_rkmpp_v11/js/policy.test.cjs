const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PlaybackPolicy, chooseLevel} = require('./policy.js');

const levels = [400000,700000,1300000,2900000,6400000,7400000,8700000]
  .map((bitrate,i) => ({bitrate,url:[i===6?'/direct.m3u8':'/'+i+'.m3u8']}));
const tick=(p,now,buffer,opts={}) => p.step({
  now,buffer,playing:true,seeking:false,auto:true,originalReady:true,
  currentLevel:p.cap,requestAge:0,...opts,
});

test('startup speed chooses affordable initial quality, preferring Original',()=>{
  assert.equal(chooseLevel(levels,400000000),6);
  assert.equal(chooseLevel(levels,800000),0);
  assert.equal(chooseLevel(levels,400000000,false),5);
});

test('three playable seconds enables adaptive control; HLS still targets six',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,1000,2,{requestAge:1000}).phase,'startup');
  assert.equal(tick(p,1500,3.1).phase,'normal');
});

test('cold first segment has bounded warm-up even when request age is high',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  for(let now=1000;now<=9500;now+=500)
    assert.equal(tick(p,now,0,{requestAge:11000}).cap,6);
  assert.equal(tick(p,10000,0,{requestAge:500}).cap,4);
});

test('fragment sawtooth between 3 and 6 seconds remains healthy',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  for(let now=1500;now<15000;now+=500) {
    const buffer=3.1+2.9*(now%3000)/3000;
    assert.equal(tick(p,now,buffer,{requestAge:2800}).cap,6);
  }
});

test('genuinely endangered buffer drops one step',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  tick(p,4000,2,{requestAge:2500});
  assert.equal(tick(p,5500,1.4,{requestAge:3500}).cap,5);
  assert.equal(p.phase,'recovering');
});

test('less than half a second triggers emergency two-step downshift',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  assert.equal(tick(p,4000,0.3,{requestAge:3000}).cap,4);
});

test('a transient low buffer that refills does not downshift',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  tick(p,3000,2,{requestAge:2500});
  tick(p,3500,5);
  assert.equal(tick(p,4300,3.2).cap,6);
});

test('sustainable low rendition climbs one rung with no subsequent speed probe',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  for(let now=1500;now<=6000;now+=500)tick(p,now,4.5);
  assert.equal(p.cap,1);
  assert.equal(tick(p,6500,4.5).cap,1);
});

test('mobile data to fast WiFi reaches Original despite 3-to-6-second sawtooth',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  for(let now=1500;now<=50000;now+=500) {
    const buffer=3.1+2.9*(now%3000)/3000;
    tick(p,now,buffer);
  }
  assert.equal(p.cap,6);
});

test('ordinary downshift has no blanket 45-second upgrade ban',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  tick(p,4000,2,{requestAge:2500});
  assert.equal(tick(p,5500,1.4,{requestAge:3500}).cap,5);
  for(let now=6000;now<=14000;now+=500)tick(p,now,4.5);
  assert.equal(p.cap,6);
});

test('failed recent upshift delays its retry exactly ten seconds',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  for(let now=1500;now<=6500;now+=500)tick(p,now,5);
  assert.equal(p.cap,1);
  assert.equal(tick(p,7000,2,{requestAge:2500}).cap,0);
  assert.equal(tick(p,8500,1.5,{requestAge:3500}).cap,0);
  for(let now=9000;now<=16500;now+=500)tick(p,now,5);
  assert.equal(p.cap,0);
  assert.equal(tick(p,17000,5).cap,1);
});

test('do not queue a second upshift until the previous rendition is playing',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  for(let now=1500;now<=6000;now+=500)tick(p,now,4.5,{currentLevel:0});
  assert.equal(p.cap,1);
  for(let now=6500;now<=20000;now+=500)tick(p,now,5,{currentLevel:0});
  assert.equal(p.cap,1);
  for(let now=20500;now<=26000;now+=500)tick(p,now,5,{currentLevel:1});
  assert.equal(p.cap,2);
});

test('unready Original is unavailable but becomes eligible without resetting budget',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6,{originalReady:false});
  assert.equal(p.cap,5);
  for(let now=1500;now<=6500;now+=500)tick(p,now,5,{originalReady:true,currentLevel:5});
  assert.equal(p.cap,6);
});

test('decoder FPS cap limits quality independently of buffer',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,1000,6,{decoderCap:2}).cap,2);
});

test('paused and manually selected streams do not change their quality policy',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  tick(p,11000,6,{playing:false});
  assert.equal(tick(p,21000,6,{auto:false}).cap,0);
});

test('cold seek does not treat an empty seek buffer as slow WiFi',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  p.beginSeek();
  assert.equal(tick(p,2000,0,{seeking:true,requestAge:5000}).cap,6);
  assert.equal(tick(p,3000,0,{requestAge:5500}).cap,6);
  assert.equal(tick(p,4000,6).phase,'normal');
});

test('audio follows selected rendition without separate bandwidth controller',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  tick(p,4000,0.3,{requestAge:3000});
  assert.equal(p.cap,4);
  assert.equal(p.result(false).audio,'audio');
  p.cap=0;
  assert.equal(p.result(false).audio,'audio32');
});

test('short successful fragments cannot strand Auto forever in startup',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  for(let now=1000;now<10000;now+=500) {
    assert.equal(tick(p,now,0.4,{requestAge:300}).phase,'startup');
  }
  const result=tick(p,10000,0.4,{requestAge:300});
  assert.equal(result.phase,'recovering');
  assert.equal(result.cap,4);
});

test('a seek that never fills six seconds is bounded by elapsed time',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  tick(p,1000,6);
  p.beginSeek();
  for(let now=2000;now<8000;now+=500) {
    assert.equal(tick(p,now,0,{requestAge:250}).cap,6);
  }
  assert.equal(tick(p,8000,0,{requestAge:250}).cap,4);
});

test('quality control exits startup with three seconds but retains six-second buffer target externally',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,1000,3.5).phase,'normal');
  assert.equal(tick(p,1500,2.8).cap,6);
});

test('depletion without new fragments downshifts at two seconds remaining',()=>{
  const p=new PlaybackPolicy(levels,400000000,true);
  for(let now=1000;now<5000;now+=500)
    assert.equal(tick(p,now,6-(now-1000)/1000).cap,6);
  assert.equal(tick(p,5000,2).cap,5);
});
test('four-second HLS segment sawtooth never downshifts, including clock offsets',()=>{
  for(const offset of [0,125,250,375]){
    const p=new PlaybackPolicy(levels,400000000,true);
    for(let now=1000+offset;now<=21000;now+=500) {
      const buffer=6-(((now-1000)/1000)%4);
      assert.equal(tick(p,now,buffer).cap,6);
    }
  }
});
test('slow persistent depletion prompts a downshift before exhaustion',()=>{
  const p=new PlaybackPolicy(levels,400000000,true);
  let first=null;
  for(let now=1000;now<=15000;now+=500) {
    const buffer=6-(now-1000)/2500;
    const action=tick(p,now,buffer);
    if(first===null && action.cap<6)first={now,buffer};
  }
  assert.ok(first && first.buffer>=1.5);
});
test('do not upgrade just because a buffer is above three seconds while falling',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  for(let now=1000;now<=7000;now+=500) {
    const buffer=6-(now-1000)*0.00035;
    assert.equal(tick(p,now,buffer).cap,0);
  }
});
test('WiFi recovery still climbs from mobile quality to Original',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  for(let now=1500;now<=65000;now+=500)
    tick(p,now,3.1+2.9*(now%3000)/3000);
  assert.equal(p.cap,6);
});
test('transient low buffer refill must not trigger a downgrade',()=>{
  const p=new PlaybackPolicy(levels,400000000,true);
  for(const [now,buffer] of [[1000,6],[2000,5],[3000,4],[3500,3.5],[4000,6],[4500,5.5]])
    assert.equal(tick(p,now,buffer,{requestAge:2000}).cap,6);
});
