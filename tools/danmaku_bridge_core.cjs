'use strict';
// Pure ingestion/routing policy, independently tested without network or API calls.
function roomTarget(value){
 const input=String(value||'').trim();
 if(/^\d{5,20}$/.test(input))return {url:'https://live.douyin.com/'+input,webId:input};
 const matched=input.match(/https:\/\/[^\s<>]+/);if(!matched)throw Error('请填写抖音直播间链接或房间号。');
 let url;try{url=new URL(matched[0]);}catch{throw Error('直播间链接格式不正确。');}
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('仅支持公开的 HTTPS 抖音直播间链接。');
 if(url.hostname==='live.douyin.com'&&/^\/\d{5,20}\/?$/.test(url.pathname))
  return {url:'https://live.douyin.com/'+url.pathname.split('/')[1],webId:url.pathname.split('/')[1]};
 if(url.hostname==='v.douyin.com'&&/^\/[A-Za-z0-9_-]{4,80}\/?$/.test(url.pathname))
  return {url:'https://v.douyin.com'+url.pathname,webId:''};
 throw Error('请提供 live.douyin.com 的房间地址或 v.douyin.com 分享链接。');
}
function seconds(timestamp){return timestamp>1e12?timestamp/1000:timestamp;}
class ChatPolicy{
 constructor(now=()=>Date.now()/1000){this.now=now;this.seen=new Map();this.recentUser=new Map();this.pending=[];this.started=now();this.auto=true;this.interval=8;this.lastSent=0;}
 reset(){this.pending=[];this.seen.clear();this.recentUser.clear();this.started=this.now();this.lastSent=0;}
 setAuto(enabled){this.auto=enabled;this.pending=[];this.started=this.now();}
 ingest(chat,room){
  const now=this.now();
  if(!room||chat.room!==room)return {accepted:false,reason:'room'};
  if(chat.visible_to_sender)return {accepted:false,reason:'private'};
  const id='douyin:'+room+':'+chat.id;
  if(this.seen.has(id))return {accepted:false,reason:'duplicate'};
  this.seen.set(id,now);while(this.seen.size>10000)this.seen.delete(this.seen.keys().next().value);
  // Some live rooms omit Common.createTime. Ignore connection warmup/history first,
  // then use the timestamp of a newly received server frame. Remember skipped IDs too.
  if(!chat.timestamp&&chat.initial_batch)return {accepted:false,reason:'initial_batch'};
  const stamp=seconds(chat.timestamp||chat.frame_timestamp||0);
  if(!stamp||stamp<this.started-3||now-stamp>45||stamp-now>30)return {accepted:false,reason:'stale'};
  const content=String(chat.content).trim().slice(0,300),username=String(chat.username).trim().slice(0,30);
  if(!content)return {accepted:false,reason:'empty'};
  const event={id,content,username,received_at:now,status:this.auto?'waiting':'display_only',user:chat.user_id||username};
  if(this.auto){
   const same=this.recentUser.get(event.user);
   if(same&&same.content===content&&now-same.at<30)event.status='repeated_text';
   else{this.recentUser.set(event.user,{content,at:now});while(this.recentUser.size>1000)this.recentUser.delete(this.recentUser.keys().next().value);
    if(this.pending.length>=10){const old=this.pending.shift();old.status='skipped_busy';}this.pending.push(event);}
  }
  return {accepted:true,event};
 }
 next(studio){
  const now=this.now();while(this.pending.length&&now-this.pending[0].received_at>45)this.pending.shift().status='expired';
  if(!this.auto||!studio.key_ready||studio.status!=='idle'||studio.queued||now-this.lastSent<this.interval)return null;
  const event=this.pending.shift();if(event){this.lastSent=now;event.status='sending';}return event||null;
 }
}
module.exports={roomTarget,ChatPolicy};
