'use strict';
// Entirely offline: fake clock, fabricated entry events, stubbed HTTP. No paid voice.
const test=require('node:test'),assert=require('node:assert/strict');
const {WelcomePolicy,IdleActivity}=require('../../tools/host_activity.cjs');
const {Bridge}=require('../../tools/mac_danmaku.cjs');
const quiet={status:'idle',key_ready:true,queued:0,speaking:false,action:'idle',motion:'none',actions:[
 {id:'17',name:'偷吃',duration_ms:5792},{id:'20',name:'比心',duration_ms:4750},{id:'drag',name:'拖拽',duration_ms:4250}]};
function setup(){let now=1793367000;return {now:()=>now,advance:n=>now+=n,
 member:(id='1',user='viewer')=>({id,room:'456',username:'观众',user_id:user,action:'1',timestamp:now,frame_timestamp:now*1000})};}
test('welcome only fresh named entry events, not admin operations, snapshots or duplicates',()=>{
 const c=setup(),p=new WelcomePolicy(c.now);
 assert.equal(p.ingest({...c.member(),action:'2'},'456').reason,'not_entry');
 assert.equal(p.ingest({...c.member(),user_id:''},'456').reason,'anonymous');
 assert.equal(p.ingest(c.member(),'other').reason,'room');
 assert.equal(p.ingest({...c.member(),initial_batch:true},'456').reason,'initial_batch');
 assert.equal(p.ingest(c.member(),'456').reason,'duplicate');
 assert.equal(p.ingest({...c.member('2'),timestamp:c.now()-90},'456').reason,'stale');
 assert.equal(p.ingest({...c.member('3'),timestamp:0},'456').event.status,'waiting_welcome');
});
test('welcome waits behind chat, speech, gift and manual motions; deduplicates users for five minutes',()=>{
 const c=setup(),p=new WelcomePolicy(c.now);p.ingest(c.member(),'456');
 assert.equal(p.next(quiet,1),null);
 for(const busy of [{status:'speaking'},{action:'20'},{motion:'dance'},{queued:1},{key_ready:false}])assert.equal(p.next({...quiet,...busy}),null);
 assert.equal(p.next(quiet).kind,'entrance');
 assert.equal(p.ingest(c.member('2'),'456').event.status,'welcome_cooldown');
 p.ingest(c.member('3','another'),'456');assert.equal(p.next(quiet),null);
 c.advance(20);assert(p.next(quiet));c.advance(281);
 assert.equal(p.ingest(c.member('4'),'456').event.status,'waiting_welcome');assert(p.next(quiet));
});
test('welcome toggle, expiry, bounded queue and reconnect never replay pending welcomes',()=>{
 const c=setup(),p=new WelcomePolicy(c.now);const first=p.ingest(c.member(),'456').event;
 p.setEnabled(false);assert.equal(first.status,'display_only');assert.equal(p.pending.length,0);
 assert.equal(p.ingest(c.member('2'),'456').event.status,'display_only');p.setEnabled(true);assert.equal(p.next(quiet),null);
 const waiting=p.ingest(c.member('3'),'456').event;c.advance(31);assert.equal(p.next(quiet),null);assert.equal(waiting.status,'expired');
 for(let i=0;i<10;i++)p.ingest(c.member('new'+i,'person'+i),'456');assert.equal(p.pending.length,5);
 p.reset();assert.equal(p.pending.length,0);
});
test('idle action is randomized, supported, nonrepeating and postponed by all foreground work',()=>{
 const c=setup(),a=new IdleActivity(c.now,()=>0);c.advance(29);assert.equal(a.next(quiet),null);
 c.advance(1);assert.equal(a.next(quiet).id,'17');c.advance(60);assert.equal(a.next(quiet).id,'20');
 for(const busy of [{status:'thinking'},{status:'preparing'},{status:'speaking'},{status:'error'},{queued:1},{action:'01'},{motion:'roam'}]){
  c.advance(60);assert.equal(a.next({...quiet,...busy}),null);assert.equal(a.next(quiet),null);
 }
 c.advance(60);assert.equal(a.next(quiet,1),null);c.advance(60);a.configure(false,45);assert.equal(a.next(quiet),null);
 a.configure(true,45);assert.equal(a.next(quiet),null);c.advance(31);assert(a.next(quiet));
});
test('bridge validates all settings before changing any toggle',()=>{
 const b=new Bridge();assert.throws(()=>b.settings({auto_reply:false,welcome_enabled:false,idle_interval:0}));
 assert(b.policy.auto);assert(b.welcome.enabled);assert(b.activity.enabled);
 b.settings({welcome_enabled:false,idle_enabled:false});assert(b.policy.auto);assert(!b.welcome.enabled);assert(!b.activity.enabled);
});
test('bridge dispatches comment before welcome, uses entrance contract and tracks idle actions separately',async t=>{
 const b=new Bridge(),c=setup(),calls=[];b.sockets.add({});b.state.last_frame_at=Date.now()/1000;
 t.mock.method(global,'fetch',async(url,options)=>{if(options?.method!=='POST')return {ok:true,json:async()=>quiet};
  calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,accepted:true})};});
 b.welcome=new WelcomePolicy(c.now);b.welcome.ingest(c.member(),'456');
 b.policy.ingest({id:'comment',room:'456',username:'观众',user_id:'v',content:'你好',timestamp:Date.now()/1000},'456');
 await b.pump();assert.equal(calls[0].body.type,'comment');assert.equal(calls[0].body.data.username,'观众');
 await b.pump();assert.equal(calls[1].body.type,'entrance');assert.equal(calls[1].body.data.username,'新来的朋友');
 assert.equal(b.state.forwarded,1);assert.equal(b.state.welcomes_forwarded,1);
 b.activity.nextAt=0;await b.pump();assert(calls[2].url.endsWith('/api/action'));assert.equal(b.state.idle_actions,1);
 assert.equal(b.state.forwarded,1);assert.equal(b.state.welcomes_forwarded,1);
});
test('bridge does not act after disconnect or wrong-room detection',async t=>{
 const b=new Bridge(),calls=[];b.activity.nextAt=0;
 t.mock.method(global,'fetch',async(url,options)=>{if(options?.method==='POST')calls.push(url);return {ok:true,json:async()=>quiet};});
 await b.pump();assert.equal(calls.length,0);b.sockets.add({});b.state.last_frame_at=Date.now()/1000;b.state.status='wrong_room';
 await b.pump();assert.equal(calls.length,0);
});
test('explicit rejection releases welcome cooldown; disconnect aborts in-flight transfer without counting success',async t=>{
 const c=setup(),p=new WelcomePolicy(c.now);p.ingest(c.member(),'456');const event=p.next(quiet);p.rejected(event);
 assert.equal(p.ingest(c.member('2'),'456').event.status,'waiting_welcome');
 const b=new Bridge();b.welcome=p;b.sockets.add({});b.state.last_frame_at=Date.now()/1000;c.advance(20);
 let release,signal;const waiting=new Promise(resolve=>release=resolve);
 t.mock.method(global,'fetch',async(url,options)=>{if(options?.method!=='POST')return {ok:true,json:async()=>quiet};
  signal=options.signal;await waiting;return {ok:true,json:async()=>({accepted:true})};});
 const sending=b.pump();await new Promise(resolve=>setImmediate(resolve));b.cancelDispatch();assert(signal.aborted);
 release();await sending;assert.equal(b.state.welcomes_forwarded,0);assert.equal(b.welcome.pending.length,0);
});
