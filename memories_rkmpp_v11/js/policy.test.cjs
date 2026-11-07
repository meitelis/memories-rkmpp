const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isOriginal, bitrate, transferBandwidth, canTryHigherLevel, safeEstimate} = require('./policy.js');

const ladder = [
  {bitrate:400000,url:['/480pmobile.m3u8']},
  {bitrate:900000,url:['/480p.m3u8']},
  {bitrate:3000000,url:['/1080p.m3u8']},
  {bitrate:8000000,url:['/direct.m3u8?token=x']},
];

test('Original is identified with query-string tokens and array URLs',()=>{
  assert.equal(isOriginal(ladder[3]),true);
  assert.equal(isOriginal(ladder[0]),false);
  assert.equal(isOriginal({url:'/direct.m3u8?token=secret'}),true);
  assert.equal(isOriginal({url:'/direct.m3u8extra'}),false);
});

test('declared bitrate handles hls.js maxBitrate and invalid values',()=>{
  assert.equal(bitrate({maxBitrate:3000000,bitrate:2900000}),3000000);
  assert.equal(bitrate({attrs:{BANDWIDTH:'400000'}}),400000);
  assert.equal(bitrate({}),Infinity);
});

test('network estimate excludes encoder startup and first-byte wait',()=>{
  const sample={loaded:200000,loading:{start:100,first:4100,end:4200}};
  assert.equal(transferBandwidth(sample),16000000);
});

test('network estimate ignores incomplete timings and tiny fragments',()=>{
  for(const t of [
    {}, {loaded:200000,loading:{first:0,end:200}},
    {loaded:200000,loading:{first:200,end:200}},
    {loaded:15000,loading:{first:100,end:200}},
    {loaded:200000,loading:{first:200,end:100}},
  ]) assert.equal(transferBandwidth(t),0);
});

test('network estimate caps implausibly high timestamp results',()=>{
  assert.equal(transferBandwidth({loaded:1000000,loading:{first:100,end:101}}),120000000);
});

test('low network speed does not authorize an optimistic upgrade',()=>{
  assert.equal(canTryHigherLevel(ladder,0,900000),false);
  assert.equal(canTryHigherLevel(ladder,0,2000000),true);
});

test('a fresh high-speed estimate can reconsider the next level',()=>{
  assert.equal(canTryHigherLevel(ladder,0,10000000),true);
  assert.equal(canTryHigherLevel(ladder,2,13000000),true);
});

test('no next rung or invalid state cannot trigger a forced switch',()=>{
  for(const index of [-1,3,5]) assert.equal(canTryHigherLevel(ladder,index,50000000),false);
  assert.equal(canTryHigherLevel(ladder,0,NaN),false);
  assert.equal(canTryHigherLevel([],0,50000000),false);
});

test('safeEstimate reserves 25% headroom',()=>{
  assert.equal(safeEstimate(4000000),3000000);
  assert.equal(safeEstimate(1000000),750000);
});

test('safeEstimate rejects missing or unusable bandwidth',()=>{
  for(const value of [0,NaN,Infinity,-1,null]) assert.equal(safeEstimate(value),0);
});

test('safeEstimate limits unrealistically fast samples',()=>{
  assert.equal(safeEstimate(1000000000),90000000);
});
