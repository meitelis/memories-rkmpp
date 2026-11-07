const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PlaybackPolicy, chooseLevel} = require('./policy.js');

const levels = [400000,700000,1300000,2900000,6400000,7400000,8700000]
  .map((bitrate, i) => ({bitrate,url:[i===6?'/direct.m3u8':`/${i}.m3u8`]}));
const step = (p, now, buffer, opts={}) => p.step({
  now,buffer,playing:true,seeking:false,auto:true,originalReady:true,
  currentLevel:p.cap,requestAge:0,...opts,
});
const fragment = (p, level, opts={}) => p.onFragment({
  level, duration:4, elapsedMs:4100, transferMs:100, bytes:200000,
  buffer:5, ...opts,
});

test('one startup bandwidth selection prefers Original when ready and affordable',()=>{
  assert.equal(chooseLevel(levels,50000000),6);
  assert.equal(chooseLevel(levels,800000),0);
  assert.equal(chooseLevel(levels,50000000,false),5);
  assert.equal(new PlaybackPolicy(levels,800000,true).cap,0);
});

test('no repeated buffer-threshold switching without completed-fragment evidence',()=>{
  for(const period of [3,3.5,4,4.5,5]){
    const p=new PlaybackPolicy(levels,50000000,true);
    for(let now=0;now<=40000;now+=250)
      assert.equal(step(p,now,6-(now/1000%period)).cap,6);
  }
});

test('normal buffer sawtooth cannot promote a low rendition by itself',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  for(let now=0;now<=40000;now+=500)step(p,5);
  assert.equal(p.cap,0);
});

test('two completed paced segments over fast Wi-Fi upgrade the playing level',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,0,5);
  fragment(p,0);
  assert.equal(step(p,1000,5).cap,0);
  fragment(p,0);
  assert.equal(step(p,2000,5).cap,1);
});

test('new upgrade must play before another upgrade can be evaluated',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,0,5);
  fragment(p,0);fragment(p,0);step(p,2000,5);
  assert.equal(p.cap,1);
  for(let now=2500;now<12000;now+=500) {
    fragment(p,1);
    step(p,now,5,{currentLevel:0});
    assert.equal(p.cap,1);
  }
  step(p,12000,5,{currentLevel:1});
  assert.equal(p.goodFragments,0);
  fragment(p,1);fragment(p,1);
  assert.equal(step(p,14000,5,{currentLevel:1}).cap,2);
});

test('two slow delivered segments downshift when buffer is shrinking',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,0,5);
  fragment(p,6,{elapsedMs:6000,buffer:3.5});
  assert.equal(step(p,1000,3.5).cap,6);
  fragment(p,6,{elapsedMs:6000,buffer:3.5});
  assert.equal(step(p,2000,3.5).cap,5);
});

test('one slow segment followed by normally paced delivery never causes a downgrade',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,0,5);
  for(let i=0;i<8;i++){
    fragment(p,6,{elapsedMs:i%2?1000:6000,buffer:4});
    assert.equal(step(p,1000+i*500,4).cap,6);
  }
});

test('imminent starvation triggers early downshift without waiting for a completed segment',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,0,6);
  assert.equal(step(p,2500,2,{requestAge:1600}).cap,5);
});

test('emergency buffer exhaustion skips two rungs',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,0,6);
  assert.equal(step(p,3000,0.3,{requestAge:500}).cap,4);
});

test('brief low buffer with a fast arriving fragment does not downshift',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,0,6);
  for(let now=500;now<=5000;now+=500)
    assert.equal(step(p,now,1.8,{requestAge:400}).cap,6);
});

test('failed upgrade requires stronger network evidence rather than a blanket timeout',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,0,5);
  fragment(p,0);fragment(p,0);step(p,2000,5);
  assert.equal(step(p,4000,2,{requestAge:1800,currentLevel:0}).cap,0);
  assert.equal(p.failures.get(1),1);
  step(p,5000,5,{currentLevel:0});
  for(let i=0;i<8;i++){
    fragment(p,0,{elapsedMs:4100,transferMs:1800}); // slow link cannot justify retry
    assert.equal(step(p,6000+i*500,5).cap,0);
  }
  for(let i=0;i<4;i++){
    fragment(p,0,{elapsedMs:1000});
    step(p,12000+i*500,5);
  }
  assert.equal(p.cap,1);
});

test('mobile to Wi-Fi recovers to Original without any repeated speed probe',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,0,5);
  for(let i=1;i<=6;i++){
    fragment(p,i-1); fragment(p,i-1);
    assert.equal(step(p,i*5000,5,{currentLevel:i-1}).cap,i);
    step(p,i*5000+500,5,{currentLevel:i});
  }
  assert.equal(p.cap,6);
});

test('a buffering event with almost empty video can trigger a downgrade',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,0,5);
  p.onWaiting();
  assert.equal(step(p,1000,1.2,{requestAge:200}).cap,5);
  p.onPlaying();
  assert.equal(step(p,2000,5).cap,5);
});

test('startup protects cold segment producers but does not get stuck indefinitely',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  for(let now=1000;now<7000;now+=500)
    assert.equal(step(p,now,0,{requestAge:500}).cap,6);
  assert.equal(step(p,7000,0,{requestAge:500}).cap,4);
});

test('seek protects the current level until playback resumes or warmup expires',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,1000,5);p.beginSeek();
  for(let now=2000;now<8000;now+=500)
    assert.equal(step(p,now,0,{requestAge:300}).cap,6);
  assert.equal(step(p,8000,0,{requestAge:300}).cap,4);
});

test('paused and manually chosen qualities are not overridden by Auto',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  step(p,1000,5);
  p.onWaiting();
  assert.equal(step(p,3000,0,{playing:false}).cap,6);
  assert.equal(step(p,4000,0,{auto:false}).cap,6);
});

test('decoder cap and unavailable Original prevent unsafe quality selection',()=>{
  const p=new PlaybackPolicy(levels,50000000,true);
  assert.equal(step(p,1000,5,{decoderCap:2}).cap,2);
  assert.equal(step(p,2000,5,{originalReady:false}).cap,2);
});

test('RKMPP pacing at 1x does not block a Wi-Fi quality upgrade',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,1000,5);
  fragment(p,0,{elapsedMs:4100});fragment(p,0,{elapsedMs:4100});
  assert.equal(step(p,2000,5).cap,1);
});

test('a genuinely slow producer cannot justify upgrading, despite fast network',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,1000,5);
  for(let i=0;i<12;i++){
    fragment(p,0,{elapsedMs:6500});
    step(p,2000+i*500,5);
  }
  assert.equal(p.cap,0);
});
test('missing or tiny HTTP timing samples never falsely prove high bandwidth',()=>{
  for(const sample of [
    {transferMs:0,bytes:0},{transferMs:0,bytes:200000},
    {transferMs:200,bytes:5000},{transferMs:-1,bytes:200000}
  ]){
    const p=new PlaybackPolicy(levels,800000,true);
    step(p,1000,5);
    for(let i=0;i<8;i++){
      fragment(p,0,sample);
      step(p,2000+i*500,5);
    }
    assert.equal(p.cap,0);
  }
});
test('network improves after mobile traffic and climbs to Original with paced encoder',()=>{
  const p=new PlaybackPolicy(levels,800000,true);
  step(p,0,5);
  for(let i=0;i<12;i++)fragment(p,0,{transferMs:2700});
  assert.equal(step(p,1000,5).cap,0);
  for(let i=1;i<=6;i++){
    fragment(p,i-1,{elapsedMs:4100});
    fragment(p,i-1,{elapsedMs:4100});
    assert.equal(step(p,2000+i*5000,5,{currentLevel:i-1}).cap,i);
    step(p,2500+i*5000,5,{currentLevel:i});
  }
  assert.equal(p.cap,6);
});
