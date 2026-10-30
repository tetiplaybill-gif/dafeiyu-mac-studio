'use strict';
// Fabricated frames and isolated Python studio: no platform traffic, audio or paid calls.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {GiftPolicy}=require('../../tools/gift_policy.cjs');
const {Bridge}=require('../../tools/mac_danmaku.cjs');
const {decodeFrame}=require('../../tools/douyin_chat_wire.cjs');
const quiet={status:'idle',key_ready:true,queued:0,speaking:false,action:'idle',motion:'none'};
function setup(options={}){let now=1793367000;const clock=()=>now;return {policy:new GiftPolicy({now:clock,...options}),now:clock,advance:n=>now+=n,
 gift:(id='1',count='1',group='999')=>({id,room:'456',username:'测试观众',user_id:'123',recipient_id:'789',gift_id:'100',gift_name:'小心心',
  group_id:group,group_count:'1',repeat_count:String(count),combo_count:String(count),repeat_end:false,combo:true,timestamp:now,frame_timestamp:now*1000})};}
function vi(v){let n=BigInt(v),out=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;out.push(b);}while(n);return Buffer.from(out);}
function f(id,v){return typeof v==='string'||Buffer.isBuffer(v)?Buffer.concat([vi(id*8+2),vi(Buffer.byteLength(v)),Buffer.from(v)]):Buffer.concat([vi(id*8),vi(v)]);}
test('gift wire parser retains exact group/user IDs and distinguishes count metadata',()=>{
 const common=Buffer.concat([f(2,9000000000000000099n),f(3,9000000000000000001n)]);
 const user=Buffer.concat([f(1,1112223334445556667n),f(3,'礼物观众')]);
 const item=Buffer.concat([f(5,7788),f(10,1),f(16,'小心心')]);
 const payload=Buffer.concat([f(1,common),f(2,7788),f(4,1),f(5,3),f(6,3),f(7,user),f(9,1),f(11,8887776665554443331n),f(15,item),f(29,998),f(33,1793367000000n)]);
 const frame=Buffer.concat([f(8,Buffer.concat([f(1,Buffer.concat([f(1,'WebcastGiftMessage'),f(2,payload)])),f(4,1793367000000n)]))]);
 const result=decodeFrame(frame);assert.equal(result.chats.length,0);assert.equal(result.members.length,0);assert.equal(result.gifts.length,1);
 const g=result.gifts[0];assert.equal(g.group_id,'8887776665554443331');assert.equal(g.user_id,'1112223334445556667');
 assert.equal(g.repeat_count,'3');assert.equal(g.total_count,'998');assert(g.repeat_end);assert(g.combo);assert.equal(g.gift_name,'小心心');
});
test('combo progress, final frame, replay and out-of-order counts credit only positive deltas',()=>{
 const c=setup(),p=c.policy;assert.equal(p.ingest(c.gift(),'456').delta,1);
 assert.equal(p.ingest(c.gift(),'456').reason,'duplicate');
 const r=p.ingest(c.gift('2','3'),'456');assert.equal(r.delta,2);assert(r.merged);
 assert.equal(p.ingest(c.gift('3','2'),'456').reason,'combo_duplicate');
 assert.equal(p.ingest({...c.gift('4','3'),repeat_end:true},'456').reason,'combo_duplicate');
 const first=p.next(quiet);assert.equal(first.count,3);assert.equal(p.pending.length,0);
 assert.equal(p.ingest({...c.gift('5','3'),repeat_end:true},'456').reason,'combo_duplicate');
 p.ingest({...c.gift('6','5'),repeat_end:true},'456');assert.equal(p.next(quiet).count,2);
});
test('separate groups/users/recipients/rooms never merge; group size multiplies quantity once',()=>{
 const c=setup(),p=c.policy;p.ingest({...c.gift(),group_count:'2'},'456');p.ingest({...c.gift('2','3'),group_count:'2',repeat_end:true},'456');
 assert.equal(p.next(quiet).count,6);
 const events=[c.gift('3','1','other'),{...c.gift('4'),user_id:'different'},{...c.gift('5'),recipient_id:'different'},
  {...c.gift('6'),room:'457'}];
 for(const e of events)assert.equal(p.ingest(e,e.room).delta,1);assert.equal(p.pending.length,4);
 assert.equal(p.ingest({...c.gift('7'),for_linkmic:true},'456').reason,'other_recipient');
});
test('unsupported or ambiguous quantity never reaches studio; noncombo single uses message ID',()=>{
 const c=setup(),p=c.policy;
 for(const changes of [{repeat_count:'2',combo_count:'3'},{group_count:'-1'},{repeat_count:'9007199254740993',combo_count:'9007199254740993'},
  {repeat_count:'0',combo_count:'0'},{repeat_count:'100',combo_count:'100',group_count:'1000'}])assert.equal(p.ingest({...c.gift(),...changes},'456').accepted,false);
 assert.equal(p.ingest({...c.gift(),group_id:''},'456').reason,'missing_group');
 assert.equal(p.ingest({...c.gift(),gift_name:''},'456').reason,'missing_identity');
 assert.equal(p.ingest(c.gift(),'other').reason,'room');
 const single={...c.gift(),combo:false,group_id:'',repeat_count:'0',combo_count:'0',group_count:'0'};
 assert.equal(p.ingest(single,'456').delta,1);assert.equal(p.next(quiet).count,1);assert.equal(p.ingest(single,'456').reason,'duplicate');
});
test('warmup, stale events and disabled mode establish baseline instead of replaying counts later',()=>{
 const c=setup(),p=c.policy;assert.equal(p.ingest({...c.gift('1','5'),initial_batch:true},'456').reason,'initial_batch');
 c.advance(5);assert.equal(p.ingest(c.gift('2','6'),'456').delta,1);
 p.setEnabled(false);assert.equal(p.pending.length,0);
 assert.equal(p.ingest(c.gift('3','8'),'456').event.status,'display_only');
 p.setEnabled(true);assert.equal(p.ingest({...c.gift('4','9'),repeat_end:true},'456').delta,1);assert.equal(p.next(quiet).count,1);
 assert.equal(p.ingest({...c.gift('old','10','oldgroup'),timestamp:c.now()-120},'456').reason,'stale');
});
test('durable high water prevents duplicate quantities across restarts without storing nicknames',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gift-ledger-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const ledgerPath=path.join(dir,'ledger.json'),c=setup({ledgerPath});c.policy.ingest(c.gift('1','3'),'456');
 const next=new GiftPolicy({now:c.now,ledgerPath});assert.equal(next.ingest(c.gift('2','3'),'456').reason,'combo_duplicate');
 assert.equal(next.ingest(c.gift('3','4'),'456').delta,1);
 const saved=fs.readFileSync(ledgerPath,'utf8');assert(!saved.includes('测试观众'));assert(!saved.includes('小心心'));
 fs.writeFileSync(ledgerPath,'invalid');const broken=new GiftPolicy({now:c.now,ledgerPath});assert(broken.error);assert.equal(broken.ingest(c.gift(),'456').reason,'ledger_error');
});
test('ledger write failure blocks gift dispatch and malformed group shape is rejected',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gift-ledger-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const blocker=path.join(dir,'file');fs.writeFileSync(blocker,'test');const c=setup({ledgerPath:path.join(blocker,'ledger')});
 assert.equal(c.policy.ingest(c.gift(),'456').reason,'ledger_error');assert.equal(c.policy.next(quiet),null);
 const other=setup();other.policy.ingest(other.gift(),'456');assert.equal(other.policy.ingest({...other.gift('2','2'),group_count:'2'},'456').reason,'ambiguous_group_size');
});
test('gift batching waits for quiet stage, does not expire at comment TTL, and caps backlog visibly',()=>{
 const c=setup(),p=c.policy;const first=p.ingest(c.gift(),'456').event;assert.equal(p.next(quiet),null);c.advance(2);
 for(const busy of [{status:'speaking'},{status:'preparing'},{queued:1},{action:'20'},{motion:'dance'}])assert.equal(p.next({...quiet,...busy}),null);
 c.advance(60);assert.equal(p.next(quiet).count,1);
 for(let i=0;i<101;i++)p.ingest(c.gift('g'+i,'1','group'+i),'456');assert.equal(p.pending.length,100);
 c.advance(601);assert.equal(p.next(quiet),null);assert.equal(p.pending.length,0);assert.equal(first.status,'sending');
});
test('bridge routes real gift delta through existing gift contract, ahead of comments and welcomes',async t=>{
 const c=setup(),b=new Bridge(),calls=[];b.gifts=c.policy;b.sockets.add({});b.state.last_frame_at=Date.now()/1000;
 t.mock.method(global,'fetch',async(url,options)=>{if(options?.method!=='POST')return {ok:true,json:async()=>quiet};calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({accepted:true})};});
 b.ingestGift(c.gift(),'456');b.ingestGift({...c.gift('2','3'),repeat_end:true},'456');
 b.policy.ingest({id:'comment',room:'456',username:'真实昵称',user_id:'u',content:'你好',timestamp:Date.now()/1000},'456');
 await b.pump();assert.equal(calls[0].type,'gift');assert.equal(calls[0].data.gift_num,3);assert.equal(calls[0].data.username,'这位朋友');
 assert.equal(b.state.gift_units,3);assert.equal(b.state.gift_units_forwarded,3);assert.equal(b.state.forwarded,0);
 await b.pump();assert.equal(calls[1].type,'comment');assert.equal(b.state.forwarded,1);
 const snapshot=b.snapshot();assert.equal(snapshot.events[0].status,'gift_forwarded');assert.equal(snapshot.events[0].count,3);
});
test('gift network ambiguity is not automatically retried and disconnect clears pending gifts',async t=>{
 const c=setup(),b=new Bridge();b.gifts=c.policy;b.sockets.add({});b.state.last_frame_at=Date.now()/1000;
 b.ingestGift({...c.gift(),repeat_end:true},'456');let posts=0;
 t.mock.method(global,'fetch',async(url,options)=>{if(options?.method!=='POST')return {ok:true,json:async()=>quiet};posts++;throw Error('network timeout');});
 await b.pump();await b.pump();assert.equal(posts,1);assert.equal(b.state.events[0].status,'unknown');assert.equal(b.state.gift_units_forwarded,0);
 b.ingestGift(c.gift('2','2'),'456');assert.equal(b.gifts.pending.length,1);b.cancelDispatch();assert.equal(b.gifts.pending.length,0);
 assert.equal(b.gifts.ingest({...c.gift('3','2'),repeat_end:true},'456').reason,'combo_duplicate');
 assert.throws(()=>b.settings({gift_enabled:false,idle_interval:0}));assert(b.gifts.enabled);
});
test('transient socket loss preserves undispatched gift batches; explicit stop clears them',()=>{
 const c=setup(),b=new Bridge();b.gifts=c.policy;b.ingestGift(c.gift(),'456');
 b.cancelDispatch(false);assert.equal(b.gifts.pending.length,1);assert.equal(b.gifts.pending[0].status,'waiting_gift');
 b.cancelDispatch();assert.equal(b.gifts.pending.length,0);assert.equal(b.state.events[0].status,'gift_paused');
});
test('decoded policy quantities cause one timer credit and dance in isolated speech-free Python studio',()=>{
 const c=setup(),p=c.policy,events=[];
 p.ingest(c.gift(),'456');p.ingest(c.gift('2','3'),'456');p.ingest({...c.gift('3','3'),repeat_end:true},'456');
 const e=p.next(quiet);events.push({username:'这位朋友',gift_name:e.gift_name,gift_num:e.count,event_id:e.id});events.push(events[0]);
 const script="import sys,json\nsys.path.insert(0,'tests/macos')\nfrom test_studio import StudioTests\nt=StudioTests();t.setUp()\ntry:\n for event in json.load(sys.stdin):t.app.enqueue('gift',event)\n t.app.jobs.join()\n s=t.app.snapshot();print(json.dumps({'gifts':s['gifts'],'added':s['timer']['added_seconds'],'motion':s['motion'],'status':s['status'],'voice_requests':s['voice_requests']}))\nfinally:t.tearDown()\n";
 const result=JSON.parse(execFileSync('python3',['-c',script],{cwd:path.resolve(__dirname,'../..'),input:JSON.stringify(events),encoding:'utf8'}));
 assert.deepEqual(result,{gifts:3,added:180,motion:'dance',status:'idle',voice_requests:0});
});
