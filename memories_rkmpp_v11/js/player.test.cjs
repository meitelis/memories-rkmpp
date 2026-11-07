const {test}=require('node:test');
const assert=require('node:assert/strict');
const {selectQuality,beginSeek,requestAge,renditionText,configure,update}=require('./player.js');
const {PlaybackPolicy}=require('./policy.js');
const events=['MANIFEST_PARSED','FRAG_LOADING','FRAG_LOADED','FRAG_BUFFERED',
  'LEVEL_SWITCHED','ERROR','FPS_DROP_LEVEL_CAPPING'];
const levels=[400000,700000,1300000,2900000,6400000,7400000,8700000]
  .map((bitrate,i)=>({bitrate,width:640+400*i,height:360+240*i,url:[i===6?'/direct.m3u8':'/'+i+'.m3u8']}));
function fixture() {
  const handlers=new Map(),writes=[];
  const hls={levels:[],config:{},currentLevel:0,constructor:{Events:Object.fromEntries(events.map(e=>[e,e]))},
    on(e,f){handlers.set(e,f)},off(e){handlers.delete(e)},startLoad(){this.started=true},stopLoad(){},
    get loadLevel(){return this._loadLevel},set loadLevel(v){this._loadLevel=v;writes.push(v)},
    set nextLevel(_){throw Error('must not flush video')},
    set audioTrack(_){throw Error('must not switch audio')},
    set nextAudioTrack(_){throw Error('must not switch audio')}
  };
  const video={qualityList:[],_qualityHls:hls,readyState:4,seeking:false,paused:false,ended:false,
    currentTime:0,videoWidth:1920,videoHeight:1080,buffered:{length:1,start:()=>0,end:()=>18},
    dispatchEvent(){},closest(){return null}};
  Object.defineProperty(video,'currentQuality',{configurable:true,get(){return this._qualitySelected}});
  const state={badge:{dataset:{},textContent:''},decoderCap:Infinity};
  return {video,hls,state,writes,emit:(ev,data={})=>handlers.get(ev)?.(ev,data)};
}
async function boot(f) {
  const prior=global.fetch;
  global.fetch=async()=>({ok:false,headers:{get:()=>''}});
  try {
    configure(f.video,f.state,f.hls);f.hls.levels=levels;
    await f.emit('MANIFEST_PARSED');
  } finally {global.fetch=prior}
}
test('startup uses encoded 480p and a 20 second forward buffer',async()=>{
  const f=fixture();await boot(f);
  try {
    assert.equal(f.state.policy.target,0);
    assert.equal(f.state.cap,0);
    assert.equal(f.hls.loadLevel,0);
    assert.equal(f.hls.started,true);
    assert.equal(f.hls.config.maxBufferLength,20);
    assert.equal(f.hls.config.maxMaxBufferLength,20);
  } finally {f.state.abort.abort()}
});
test('manual quality changes use only non-flushing loadLevel',()=>{
  const f=fixture();f.video.qualityList=[{id:'720:700000',index:1}];
  selectQuality(f.video,f.hls,'720:700000');
  assert.equal(f.hls.loadLevel,1);
});
test('returning from manual to Auto uses policy target rather than missing cap',()=>{
  const f=fixture();
  selectQuality(f.video,f.hls,'auto',{policy:{target:3,onWaiting(){},onPlaying(){}},
    badge:{dataset:{}},pendingLevel:2});
  assert.equal(f.hls.loadLevel,3);
});
test('Original label reflects presented HLS level',()=>{
  const f=fixture();f.hls.levels=levels;f.hls.currentLevel=6;
  assert.match(renditionText(f.video,f.hls),/^Original/);
});
test('seek holds the existing policy target without removing buffered audio',()=>{
  const f=fixture(),p=new PlaybackPolicy(levels,1e8,true);
  f.hls.currentLevel=5;f.state.hls=f.hls;f.state.policy=p;f.state.cap=5;f.state.selected='auto';
  beginSeek(f.state);
  assert.equal(p.seek,true);assert.equal(f.hls.loadLevel,5);
});
test('fragment loading age uses monotonic clock',()=>{
  assert.equal(requestAge({},{inflight:{stats:{loading:{start:100}}}},0,2200),2100);
});
test('duplicate fragment events produce only bounded URL-free trace',async()=>{
  const f=fixture();await boot(f);
  try {
    for(let i=0;i<300;i++)
      f.emit('FRAG_BUFFERED',{frag:{type:'main',level:0,sn:i,duration:4},
        stats:{loaded:300000,loading:{start:100,first:400,end:500}}});
    assert.ok(f.video._rkmppTrace.length<=240);
    assert.ok(f.video._rkmppTrace.some(e=>e.event==='fragment-buffered'));
    assert.equal(JSON.stringify(f.video._rkmppTrace).includes('m3u8'),false);
  } finally {f.state.abort.abort()}
});
test('change to Original is not triggered by buffer alone and does not select another AAC track',async()=>{
  const f=fixture();await boot(f);
  try {
    f.hls.audioTracks=[{url:'/audio.m3u8'},{url:'/audio64.m3u8'}];
    for(let i=0;i<15;i++)update(f.video,f.state);
    assert.equal(f.state.policy.target,0);
    assert.equal(f.state.audioProfile,'audio');
  } finally {f.state.abort.abort()}
});
test('Memories native quality hook is kept on Auto after level switch',async()=>{
  const f=fixture();await boot(f);
  try {
    f.video._qualitySelected='manual';
    f.emit('LEVEL_SWITCHED',{level:0});
    assert.equal(f.video._qualitySelected,'auto');
  } finally {f.state.abort.abort()}
});
