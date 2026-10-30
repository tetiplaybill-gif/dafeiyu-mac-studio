'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {quiet}=require('./host_activity.cjs');
const LIMIT=10000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const seconds=n=>n>1e12?n/1000:n;
function count(value,fallback){
 if(value===undefined||value===''||value==='0')return fallback;
 if(!/^\d+$/.test(String(value)))return NaN;
 const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=LIMIT?n:NaN;
}
class GiftPolicy{
 constructor({now=()=>Date.now()/1000,ledgerPath=null}={}){
  this.now=now;this.ledgerPath=ledgerPath;this.enabled=true;this.started=now();this.pending=[];this.groups=new Map();this.seen=new Map();this.error='';
  if(ledgerPath&&fs.existsSync(ledgerPath))try{
   if(fs.statSync(ledgerPath).size>2*1024*1024)throw Error();
   const saved=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
   if(saved.version!==1||!Array.isArray(saved.groups)||saved.groups.length>10000)throw Error();
   for(const [key,entry] of saved.groups){
    if(!/^[a-f0-9]{64}$/.test(key)||!Number.isInteger(entry.high)||entry.high<1||entry.high>LIMIT||!Number.isInteger(entry.pack)||entry.pack<1||entry.pack>LIMIT||!Number.isFinite(entry.at))throw Error();
    if(now()-entry.at<86400)this.groups.set(key,entry);
   }
  }catch{this.error='礼物去重记录无法读取，自动礼物处理已暂停。请先检查记录。';}
 }
 clear(){for(const e of this.pending)e.status='gift_paused';this.pending=[];}
 reset(){this.clear();this.started=this.now();}
 setEnabled(value){if(this.enabled!==value){this.clear();this.started=this.now();}this.enabled=value;}
 save(){
  for(const [key,e] of this.groups)if(this.now()-e.at>=86400)this.groups.delete(key);
  while(this.groups.size>10000)this.groups.delete(this.groups.keys().next().value);
  if(!this.ledgerPath)return true;
  try{
   fs.mkdirSync(path.dirname(this.ledgerPath),{recursive:true,mode:0o700});
   const tmp=this.ledgerPath+'.tmp';
   fs.writeFileSync(tmp,JSON.stringify({version:1,groups:[...this.groups]}),{mode:0o600});fs.renameSync(tmp,this.ledgerPath);return true;
  }catch{this.error='礼物去重记录无法保存，已暂停礼物转交，防止重复加时。';return false;}
 }
 ingest(gift,room){
  if(this.error)return {accepted:false,reason:'ledger_error'};
  if(!room||gift.room!==room)return {accepted:false,reason:'room'};
  if(gift.for_linkmic)return {accepted:false,reason:'other_recipient'};
  if(!gift.id||!gift.user_id||!gift.gift_id||!gift.gift_name?.trim())return {accepted:false,reason:'missing_identity'};
  const message=hash(room+':'+gift.id);if(this.seen.has(message))return {accepted:false,reason:'duplicate'};
  const repeat=count(gift.repeat_count,0),combo=count(gift.combo_count,0),pack=count(gift.group_count,1);
  if(!Number.isFinite(repeat)||!Number.isFinite(combo)||!Number.isFinite(pack)||(repeat&&combo&&repeat!==combo)||(gift.combo&&!repeat&&!combo))return {accepted:false,reason:'ambiguous_count'};
  const cumulative=(repeat||combo||1)*pack;
  if(cumulative>LIMIT)return {accepted:false,reason:'count_limit'};
  const group=gift.group_id&&gift.group_id!=='0'?gift.group_id:'';
  if(!group&&(gift.combo||repeat>1||combo>1))return {accepted:false,reason:'missing_group'};
  const key=hash([room,gift.user_id,gift.recipient_id||'',gift.gift_id,group?'group:'+group:'message:'+gift.id].join(':'));
  const previous=this.groups.get(key);
  if(previous&&previous.pack!==pack)return {accepted:false,reason:'ambiguous_group_size'};
  this.seen.set(message,this.now());while(this.seen.size>10000)this.seen.delete(this.seen.keys().next().value);
  const stamp=seconds(gift.timestamp||gift.frame_timestamp||0);
  const fresh=stamp&&stamp>=this.started-3&&this.now()-stamp<=90&&stamp-this.now()<=30;
  const before=previous?.high||0,delta=Math.max(0,cumulative-before);
  if(delta){this.groups.set(key,{high:cumulative,pack,at:this.now()});if(!this.save())return {accepted:false,reason:'ledger_error'};}
  // Reserve before submitting. On crashes/unknown results never replay quantities automatically.
  const existing=this.pending.find(e=>e.group===key);
  if(!delta){if(existing&&gift.repeat_end)existing.ready_at=this.now();return {accepted:false,reason:'combo_duplicate'};}
  if(gift.initial_batch||!fresh)return {accepted:false,reason:gift.initial_batch?'initial_batch':'stale'};
  const readyAt=this.now()+(group&&!gift.repeat_end?1.5:0);
  if(this.enabled&&existing){
   existing.count+=delta;existing.to=cumulative;existing.id='dygift:'+key+':'+existing.from+'-'+cumulative;
   existing.content=existing.gift_name+' ×'+existing.count;existing.ready_at=readyAt;existing.updated_at=this.now();
   return {accepted:true,event:existing,delta,merged:true};
  }
  const event={id:'dygift:'+key+':'+before+'-'+cumulative,kind:'gift',username:String(gift.username||'观众').slice(0,30),
   content:gift.gift_name+' ×'+delta,gift_name:gift.gift_name.trim().slice(0,30),count:delta,group:key,from:before,to:cumulative,
   received_at:this.now(),updated_at:this.now(),ready_at:readyAt,status:this.enabled?'waiting_gift':'display_only'};
  if(this.enabled){if(this.pending.length<100)this.pending.push(event);else event.status='gift_overflow';}
  return {accepted:true,event,delta};
 }
 next(studio){
  const now=this.now();this.pending=this.pending.filter(e=>{if(now-e.updated_at>600){e.status='gift_expired';return false;}return true;});
  if(!this.enabled||this.error||!quiet(studio)||(!studio.key_ready&&studio.voice_effective!=='native'))return null;
  const index=this.pending.findIndex(e=>e.ready_at<=now);if(index<0)return null;
  const [event]=this.pending.splice(index,1);event.status='sending';return event;
 }
}
module.exports={GiftPolicy};
