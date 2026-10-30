'use strict';
// Fabricated protocol fixtures; these tests do not contact Douyin/OpenAI or publish anything.
const test=require('node:test'),assert=require('node:assert/strict'),{gzipSync}=require('node:zlib');
const {decodeFrame,fields}=require('../../tools/douyin_chat_wire.cjs');
const {roomTarget,ChatPolicy}=require('../../tools/danmaku_bridge_core.cjs');
function vi(value){let n=BigInt(value),out=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;out.push(b);}while(n);return Buffer.from(out);}
function f(id,value){return typeof value==='string'||Buffer.isBuffer(value)?Buffer.concat([vi(id*8+2),vi(Buffer.byteLength(value)),Buffer.from(value)]):Buffer.concat([vi(id*8),vi(value)]);}
function fixture(){
 const common=Buffer.concat([f(2,9000000000000000011n),f(3,9000000000000000001n),f(4,1793367000)]);
 const user=Buffer.concat([f(1,12345),f(3,'测试观众')]);
 const chat=Buffer.concat([f(1,common),f(2,user),f(3,'小龙娘你好！')]);
 const msg=Buffer.concat([f(1,'WebcastChatMessage'),f(2,chat),f(3,9000000000000000011n)]);
 const response=Buffer.concat([f(1,msg),f(4,1793367000000n)]);
 return Buffer.concat([f(6,'gzip'),f(7,'msg'),f(8,gzipSync(response))]);
}
test('decode actual envelope shape without losing uint64 IDs',()=>{
 const result=decodeFrame(fixture());assert(result.valid);assert.equal(result.chats.length,1);
 assert.equal(result.chats[0].id,'9000000000000000011');assert.equal(result.chats[0].room,'9000000000000000001');
 assert.equal(result.chats[0].username,'测试观众');assert.equal(result.chats[0].content,'小龙娘你好！');
});
test('decode member action independently from chat, retaining exact IDs and frame time',()=>{
 const common=Buffer.concat([f(2,9000000000000000099n),f(3,9000000000000000001n)]);
 const user=Buffer.concat([f(1,1112223334445556667n),f(3,'新观众')]);
 const member=Buffer.concat([f(1,common),f(2,user),f(9,1),f(10,1)]);
 const msg=Buffer.concat([f(1,'WebcastMemberMessage'),f(2,member)]);
 const frame=Buffer.concat([f(8,Buffer.concat([f(1,msg),f(4,1793367000000n)]))]);
 const result=decodeFrame(frame);assert.equal(result.chats.length,0);assert.equal(result.members.length,1);
 assert.deepEqual(result.members[0],{id:'9000000000000000099',room:'9000000000000000001',username:'新观众',
  user_id:'1112223334445556667',timestamp:0,frame_timestamp:1793367000000,action:'1',enter_type:'1'});
});
test('reject malformed, truncated, oversized and compressed-bomb frames',()=>{
 assert.throws(()=>fields(Buffer.from([10,255,255,255,255,127])));
 assert.throws(()=>fields(Buffer.alloc(5*1024*1024)));
 assert.throws(()=>fields(Buffer.from([9,0])));
 const bomb=Buffer.concat([f(6,'gzip'),f(8,gzipSync(Buffer.alloc(5*1024*1024)))]);
 assert.throws(()=>decodeFrame(bomb));assert.equal(decodeFrame('ping').valid,false);
});
test('accept only supported public room URLs and strip tracking query',()=>{
 assert.equal(roomTarget('https://v.douyin.com/EXAMPLE_TEST/ 5@5.com :3pm').url,'https://v.douyin.com/EXAMPLE_TEST/');
 assert.equal(roomTarget('12345678901').webId,'12345678901');
 assert.equal(roomTarget('https://live.douyin.com/12345678901?x=1').url,'https://live.douyin.com/12345678901');
 for(const s of ['http://127.0.0.1/','https://live.douyin.com.evil.test/12345','https://user:pass@live.douyin.com/12345','https://live.douyin.com:444/12345','file:///etc/passwd'])assert.throws(()=>roomTarget(s));
});
function setup(){let time=1000;const policy=new ChatPolicy(()=>time);const chat={id:'123',room:'456',username:'观众',user_id:'789',content:'你好',timestamp:1000};return {policy,chat,advance:n=>time+=n};}
test('deduplicate IDs and repeated text; reject other rooms and historical messages',()=>{
 const {policy,chat}=setup();assert(policy.ingest(chat,'456').accepted);assert.equal(policy.ingest(chat,'456').reason,'duplicate');
 assert.equal(policy.ingest({...chat,id:'124',timestamp:900},'456').reason,'stale');
 assert.equal(policy.ingest({...chat,id:'124'},'other').reason,'room');
 assert.equal(policy.ingest({...chat,id:'125'},'456').event.status,'repeated_text');
 assert.equal(policy.ingest({...chat,id:'126',visible_to_sender:true},'456').reason,'private');
});
test('pause clears backlog and enable only queues future chat',()=>{
 const {policy,chat,advance}=setup();policy.ingest(chat,'456');policy.setAuto(false);assert.equal(policy.pending.length,0);
 assert.equal(policy.ingest({...chat,id:'2',content:'再见'},'456').event.status,'display_only');
 advance(10);policy.setAuto(true);assert.equal(policy.pending.length,0);assert.equal(policy.ingest({...chat,id:'3'},'456').reason,'stale');
});
test('rooms with no message time accept fresh frames only after initial batches',()=>{
 const {chat}=setup();let now=1793367000;const policy=new ChatPolicy(()=>now);
 assert.equal(policy.ingest({...chat,timestamp:0,frame_timestamp:now*1000,initial_batch:true},'456').reason,'initial_batch');
 now+=5;
 assert.equal(policy.ingest({...chat,timestamp:0,frame_timestamp:now*1000,initial_batch:false},'456').reason,'duplicate');
 assert(policy.ingest({...chat,id:'new',timestamp:0,frame_timestamp:now*1000,initial_batch:false},'456').accepted);
});
test('only dispatch when studio is idle and keyed, respecting interval and TTL',()=>{
 const {policy,chat,advance}=setup();policy.ingest(chat,'456');
 assert.equal(policy.next({key_ready:false,status:'idle',queued:0}),null);
 assert.equal(policy.next({key_ready:true,status:'speaking',queued:0}),null);
 const available={key_ready:true,status:'idle',queued:0};assert(policy.next(available));
 policy.ingest({...chat,id:'2',user_id:'other',content:'第二条'},'456');assert.equal(policy.next(available),null);
 advance(8);assert(policy.next(available));policy.ingest({...chat,id:'3',content:'第三条'},'456');advance(46);assert.equal(policy.next(available),null);
});
test('bound pending queue and preserve status for skipped events',()=>{
 const {policy,chat}=setup();const original=policy.ingest(chat,'456').event;
 for(let i=0;i<15;i++)policy.ingest({...chat,id:String(i+200),user_id:String(i),content:'消息'+i},'456');
 assert.equal(policy.pending.length,10);assert.equal(original.status,'skipped_busy');
});
