'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {decodeFrame}=require('./douyin_chat_wire.cjs');
const {roomTarget,ChatPolicy}=require('./danmaku_bridge_core.cjs');
const {WelcomePolicy,IdleActivity}=require('./host_activity.cjs');
const {GiftPolicy}=require('./gift_policy.cjs');
const ROOT=path.resolve(__dirname,'..'),PORT=18768,STUDIO='http://127.0.0.1:18766';
const OUT=path.join(ROOT,'out/macos'),PROFILE=path.join(OUT,'douyin-browser');
function loadBrowser(){
 const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 for(const name of ['playwright',bundled]){try{return require(name).chromium;}catch{}}
 throw Error('没有找到已安装的 Playwright。请先配置运行环境。');
}
class Bridge{
 constructor({giftLedgerPath=null}={}){
  this.gifts=new GiftPolicy({ledgerPath:giftLedgerPath});
  this.policy=new ChatPolicy();this.welcome=new WelcomePolicy();this.activity=new IdleActivity();this.generation=0;this.dispatchEpoch=0;this.context=null;this.sockets=new Set();this.dispatching=false;this.chromium=null;this.transitioning=false;this.sendAbort=null;
  this.state={status:'stopped',room_url:'',room_id:'',web_id:'',auto_reply:true,received:0,forwarded:0,
   frames:0,decode_errors:0,skipped:0,skip_reasons:{},last_drop:null,last_frame_at:0,last_chat_at:0,error:'',events:[],studio_ready:false,studio_status:'unknown',
   member_frames:0,entrances_received:0,welcomes_forwarded:0,member_skips:{},last_member:null,idle_actions:0,last_idle_action:'',last_idle_at:0,
   gift_frames:0,gift_units:0,gifts_forwarded:0,gift_units_forwarded:0,gift_skips:{},last_gift:null};
 }
 snapshot(){
  const s={...this.state,auto_reply:this.policy.auto,interval:this.policy.interval,pending:this.policy.pending.length,
   connected:this.sockets.size>0&&Date.now()/1000-this.state.last_frame_at<90,
   welcome_enabled:this.welcome.enabled,welcome_pending:this.welcome.pending.length,
   idle_enabled:this.activity.enabled,idle_interval:this.activity.interval,
   gift_enabled:this.gifts.enabled,gift_pending:this.gifts.pending.length,gift_error:this.gifts.error};
  s.events=this.state.events.map(({id,kind,username,content,received_at,status,gift_name,count})=>({id,kind,username,content,received_at,status,gift_name,count}));
  return s;
 }
 cancelDispatch(clearGifts=true){this.dispatchEpoch++;if(this.sendAbort)this.sendAbort.abort();this.welcome.clear();if(clearGifts)this.gifts.clear();}
 async stop(){
  this.generation++;this.sockets.clear();this.policy.pending=[];this.welcome.clear();this.activity.defer();this.state.status='stopped';
  this.cancelDispatch();
  const context=this.context;this.context=null;if(context)await context.close().catch(()=>{});
 }
 settings(data){
  const auto='auto_reply' in data?data.auto_reply:this.policy.auto;
  const interval='interval' in data?Number(data.interval):this.policy.interval;
  const welcome='welcome_enabled' in data?data.welcome_enabled:this.welcome.enabled;
  const idle='idle_enabled' in data?data.idle_enabled:this.activity.enabled;
  const idleInterval='idle_interval' in data?Number(data.idle_interval):this.activity.interval;
  const gift='gift_enabled' in data?data.gift_enabled:this.gifts.enabled;
  if(typeof gift!=='boolean'||typeof auto!=='boolean'||typeof welcome!=='boolean'||typeof idle!=='boolean'||!Number.isInteger(interval)||interval<5||interval>60||!Number.isInteger(idleInterval)||idleInterval<30||idleInterval>180)throw Error('回复设置无效。');
  if(auto!==this.policy.auto)this.policy.setAuto(auto);this.policy.interval=interval;
  this.welcome.setEnabled(welcome);this.activity.configure(idle,idleInterval);
  this.gifts.setEnabled(gift);
 }
 async start(input,auto=true){
  const target=roomTarget(input);if(this.transitioning)throw Error('正在连接，请稍候。');this.transitioning=true;
  const generation=++this.generation,previous=this.context;this.context=null;this.sockets.clear();
  this.cancelDispatch();
  this.policy.reset();this.policy.auto=auto;this.welcome.reset();this.gifts.reset();this.activity.defer();
  this.state={...this.state,status:'opening',room_url:target.url,room_id:'',web_id:target.webId,error:'',
   received:0,forwarded:0,frames:0,decode_errors:0,skipped:0,skip_reasons:{},last_drop:null,last_frame_at:0,last_chat_at:0,events:[],
   member_frames:0,entrances_received:0,welcomes_forwarded:0,member_skips:{},last_member:null,idle_actions:0,last_idle_action:'',last_idle_at:0,
   gift_frames:0,gift_units:0,gifts_forwarded:0,gift_units_forwarded:0,gift_skips:{},last_gift:null};
  try{
   if(previous)await previous.close().catch(()=>{});
   if(generation!==this.generation)return;
   this.chromium=this.chromium||loadBrowser();fs.mkdirSync(OUT,{recursive:true,mode:0o700});
   const context=await this.chromium.launchPersistentContext(PROFILE,{
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,
    viewport:{width:1180,height:850},args:['--mute-audio']});
   if(generation!==this.generation){await context.close();return;}
   this.context=context;
   context.on('close',()=>{if(generation===this.generation){this.context=null;this.sockets.clear();this.policy.pending=[];this.cancelDispatch();this.state.status='closed';}});
   const page=context.pages()[0]||await context.newPage();
   let expectedInternal='',expectedWeb=target.webId;
   page.on('framenavigated',frame=>{
    if(frame!==page.mainFrame()||generation!==this.generation)return;
    let u;try{u=new URL(frame.url());}catch{return;}
    if(u.hostname==='webcast.amemv.com')expectedInternal=u.pathname.match(/\/reflow\/(\d+)/)?.[1]||expectedInternal;
    if(u.hostname==='live.douyin.com'&&/^\/\d+\/?$/.test(u.pathname)){
     const id=u.pathname.split('/')[1];
     if(expectedWeb&&id!==expectedWeb){this.policy.setAuto(false);this.cancelDispatch();this.state.status='wrong_room';this.state.error='浏览器切到了另一个直播间，自动互动已暂停。';return;}
     expectedWeb=id;this.state.web_id=id;this.state.room_url='https://live.douyin.com/'+id;
    }
   });
   page.on('websocket',ws=>{
    if(generation!==this.generation)return;
    let url;try{url=new URL(ws.url());}catch{return;}
    if(!url.hostname.endsWith('.douyin.com')||!url.pathname.includes('/webcast/im/push/'))return;
    const room=url.searchParams.get('room_id')||'';
    if(!/^\d{5,22}$/.test(room))return;
    if((expectedInternal&&room!==expectedInternal)||(this.state.room_id&&this.state.room_id!==room)){
     this.policy.setAuto(false);this.cancelDispatch();this.state.status='wrong_room';this.state.error='直播间 ID 不一致，已暂停自动互动。';return;
    }
    this.state.room_id=room;this.sockets.add(ws);this.state.status='waiting';this.state.error='';
    const openedAt=Date.now();let batchCount=0;
    ws.on('close',()=>{if(generation===this.generation){this.sockets.delete(ws);if(!this.sockets.size){this.state.status='disconnected';this.policy.pending=[];this.cancelDispatch(false);}}});
    ws.on('framereceived',({payload})=>{
     if(generation!==this.generation||this.state.status==='wrong_room')return;
     try{
      const decoded=decodeFrame(payload);if(!decoded.valid)return;
      batchCount++;
      this.state.frames++;this.state.last_frame_at=Date.now()/1000;
      if(this.state.status!=='receiving')this.state.status='waiting';
      for(const chat of decoded.chats){
       chat.initial_batch=batchCount===1||Date.now()-openedAt<4000;
       const result=this.policy.ingest(chat,room);
       if(!result.accepted){if(result.reason!=='duplicate')this.state.skipped++;
        this.state.skip_reasons[result.reason]=(this.state.skip_reasons[result.reason]||0)+1;
        this.state.last_drop={reason:result.reason,room:chat.room,timestamp:chat.timestamp,server_time:decoded.serverTime,now:Date.now()/1000,visible_to_sender:chat.visible_to_sender};continue;}
       this.state.received++;this.state.last_chat_at=Date.now()/1000;this.state.status='receiving';
       this.state.events=(this.state.events.concat(result.event)).slice(-20);
      }
      for(const member of decoded.members){
       member.initial_batch=batchCount===1||Date.now()-openedAt<4000;this.state.member_frames++;
       this.state.last_member={action:member.action,enter_type:member.enter_type,timestamp:member.timestamp};
       const result=this.welcome.ingest(member,room);
       if(!result.accepted){this.state.member_skips[result.reason]=(this.state.member_skips[result.reason]||0)+1;continue;}
       this.state.entrances_received++;this.state.events=this.state.events.concat(result.event).slice(-20);
      }
      for(const gift of decoded.gifts){gift.initial_batch=batchCount===1||Date.now()-openedAt<4000;this.ingestGift(gift,room);}
     }catch{this.state.decode_errors++;}
    });
   });
   await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>{});
   if(generation===this.generation&&this.state.status==='opening')this.state.status='waiting_page';
  }catch{
   if(generation===this.generation){this.state.status='error';this.state.error='直播网页未能启动。请关闭重复采集窗口，确认 Chrome 和运行环境可用后重连。';}
  }finally{this.transitioning=false;}
 }
 ingestGift(gift,room){
  this.state.gift_frames++;
  this.state.last_gift={gift_name:gift.gift_name,group_present:Boolean(gift.group_id&&gift.group_id!=='0'),
   repeat_count:gift.repeat_count,combo_count:gift.combo_count,group_count:gift.group_count,repeat_end:gift.repeat_end,
   total_count:gift.total_count,send_type:gift.send_type,timestamp:gift.timestamp};
  const result=this.gifts.ingest(gift,room);
  if(!result.accepted){this.state.gift_skips[result.reason]=(this.state.gift_skips[result.reason]||0)+1;this.state.last_gift.result=result.reason;return;}
  this.state.last_gift.result=result.event.status;this.state.gift_units+=result.delta;
  if(!result.merged)this.state.events=this.state.events.concat(result.event).slice(-20);
 }
 async pump(){
  if(this.dispatching)return;this.dispatching=true;const generation=this.generation;
  try{
   const r=await fetch(STUDIO+'/api/state',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('studio');
   const studio=await r.json();this.state.studio_ready=Boolean(studio.key_ready);this.state.studio_status=studio.status;
   if(generation!==this.generation||!this.sockets.size||!this.snapshot().connected||this.state.status==='wrong_room')return;
   const event=this.gifts.next(studio)||((!studio.motion||studio.motion==='none')?this.policy.next(studio):null)||this.welcome.next(studio,this.policy.pending.length+this.gifts.pending.length);
   if(event)this.activity.defer();
   const action=event?null:this.activity.next(studio,this.policy.pending.length+this.welcome.pending.length+this.gifts.pending.length);
   if(!event&&!action)return;
   const dispatchEpoch=this.dispatchEpoch;
   this.sendAbort=new AbortController();const timeout=setTimeout(()=>this.sendAbort?.abort(),4000);
   try{
    const body=action?{action:action.id}:event.kind==='gift'?{type:'gift',data:{username:'这位朋友',gift_name:event.gift_name,gift_num:event.count,event_id:event.id}}:
     {type:event.kind==='entrance'?'entrance':'comment',data:{username:event.kind==='entrance'?'新来的朋友':event.username,content:event.content,event_id:event.id}};
    const response=await fetch(STUDIO+(action?'/api/action':'/send'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:this.sendAbort.signal});
    const result=await response.json();
    if(generation!==this.generation||dispatchEpoch!==this.dispatchEpoch){if(event)event.status='unknown';return;}
    if(action){if(response.ok&&result.ok){this.state.idle_actions++;this.state.last_idle_action=action.name;this.state.last_idle_at=Date.now()/1000;this.state.error='';}
     else this.state.error='空闲动作未执行，请检查工作台状态。';}
    else if(response.ok&&(result.accepted||result.duplicate)){event.status=result.duplicate?'duplicate':event.kind==='gift'?'gift_forwarded':event.kind==='entrance'?'welcome_forwarded':'forwarded';
     if(result.accepted){this.state[event.kind==='gift'?'gifts_forwarded':event.kind==='entrance'?'welcomes_forwarded':'forwarded']++;
      if(event.kind==='gift')this.state.gift_units_forwarded+=event.count;}this.state.error='';}
    else{event.status='rejected';if(event.kind==='entrance')this.welcome.rejected(event);this.state.error='工作台未接受这条互动，请检查模型连接或队列状态。';}
   }catch{if(event)event.status='unknown';if(generation===this.generation&&dispatchEpoch===this.dispatchEpoch)this.state.error='转交结果未确认，未自动重复提交。请查看工作台动态。';}
   finally{clearTimeout(timeout);this.sendAbort=null;}
  }catch{this.state.studio_ready=false;this.state.studio_status='offline';}
  finally{this.dispatching=false;}
 }
}
if(require.main===module){
const bridge=new Bridge({giftLedgerPath:path.join(OUT,'gift-ledger.json')});
function local(req,res,mutate=false){
 const hosts=['127.0.0.1:'+PORT,'localhost:'+PORT];
 if(!hosts.includes(req.headers.host)){res.writeHead(403).end();return false;}
 const origin=req.headers.origin;
 const origins=hosts.map(h=>'http://'+h);
 if(!mutate)origins.push(STUDIO,'http://localhost:18766');
 if((origin&&!origins.includes(origin))||(mutate&&req.headers['sec-fetch-site']==='cross-site')){res.writeHead(403).end();return false;}
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return true;
}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
const server=http.createServer(async(req,res)=>{
 if(!local(req,res,req.method!=='GET'))return;
 const route=req.url.split('?')[0];
 if(req.method==='GET'){
  if(route==='/api/state')return json(res,bridge.snapshot());
  if(route==='/health')return json(res,{service:'bailong-danmaku',ok:true});
  const files={'/':'danmaku.html','/danmaku.js':'danmaku.js'};
  if(files[route]){const file=path.join(ROOT,'Live2D/macos',files[route]);res.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});return fs.createReadStream(file).pipe(res);}
  return json(res,{error:'接口不存在。'},404);
 }
 if(req.method!=='POST')return json(res,{error:'不支持的操作。'},405);
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(res,{error:'请发送 JSON。'},400);
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096){json(res,{error:'请求过长。'},413);return;}}
  const data=JSON.parse(raw);if(!data||Array.isArray(data)||typeof data!=='object')throw Error('请求格式无效。');
  if(route==='/api/connect'){
   if(bridge.transitioning)return json(res,{error:'正在连接直播间，请稍候。'},409);
   const target=roomTarget(data.url);if(typeof data.auto_reply!=='boolean')throw Error('自动回复设置无效。');
   bridge.settings(data);
   bridge.start(target.url,data.auto_reply).catch(()=>{});return json(res,{accepted:true},202);
  }
  if(route==='/api/stop'){await bridge.stop();return json(res,{ok:true});}
  if(route==='/api/settings'){bridge.settings(data);return json(res,{ok:true});}
  return json(res,{error:'接口不存在。'},404);
 }catch{return json(res,{error:'配置无效，请检查房间链接、回复开关与间隔。'},400);}
});
server.on('error',error=>{console.log(error.code==='EADDRINUSE'?'弹幕接入服务已运行。':'弹幕接入服务启动失败。');process.exitCode=1;});
server.listen(PORT,'127.0.0.1',()=>{
 console.log('弹幕接入已就绪：http://127.0.0.1:'+PORT);
 const args=process.argv.slice(2),at=args.indexOf('--room');
 if(args.includes('--observe'))bridge.settings({auto_reply:false,welcome_enabled:false,idle_enabled:false,gift_enabled:false});
 if(at>=0&&args[at+1])bridge.start(args[at+1],!args.includes('--observe')).catch(()=>{});
});
const poll=setInterval(()=>bridge.pump(),1000);poll.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{clearInterval(poll);await bridge.stop();server.close();process.exit(0);});
}
module.exports={Bridge};
