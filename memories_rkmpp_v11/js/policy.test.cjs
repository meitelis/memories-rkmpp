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

test('six playable seconds ends startup warm-up',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,1000,5,{requestAge:1000}).phase,'startup');
  assert.equal(tick(p,1500,6).phase,'normal');
});

test('a cold first segment does not trigger an early resolution collapse',()=>{
  const p=new PlaybackPolicy(levels,30000000,true);
  assert.equal(tick(p,1000,0,{requestAge:6000}).cap,6);
  assert.equal(tick(p,1500,0,{requestAge:8000}).cap,6);
  assert.equal(tick(p,3000,0,{requestAge:11000}).cap,4);
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

test('failed recent upshift has a bounded 10-second cooldown',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  tick(p,1000,6);
  for(let now=1500;now<=6500;now+=500)tick(p,now,5);
  assert.equal(p.cap,1);
  tick(p,7000,2,{requestAge:2500});
  assert.equal(tick(p,8500,1.5,{requestAge:3500}).cap,0);
  for(let now=9000;now<=17000;now+=500)tick(p,now,5);
  assert.equal(p.cap,0);
  for(let now=17500;now<=21000;now+=500)tick(p,now,5);
  assert.ok(p.cap>=1);
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
