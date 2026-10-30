'use strict';
const {ChatPolicy}=require('./danmaku_bridge_core.cjs');
function quiet(studio){
 return studio.status==='idle'&&!studio.speaking&&!studio.queued&&
  (!studio.action||studio.action==='idle')&&(!studio.motion||studio.motion==='none');
}
class WelcomePolicy{
 constructor(now=()=>Date.now()/1000){
  this.now=now;this.enabled=true;this.ingress=new ChatPolicy(now);this.ingress.setAuto(false);
  this.pending=[];this.recent=new Map();this.lastSent=-Infinity;
 }
 clear(){for(const event of this.pending)event.status='display_only';this.pending=[];}
 reset(){this.clear();this.ingress.reset();}
 setEnabled(value){if(value!==this.enabled){this.clear();this.ingress.started=this.now();}this.enabled=value;}
 rejected(event){if(this.recent.get(event.user)===event.dispatched_at)this.recent.delete(event.user);}
 ingest(member,room){
  // Member messages also carry admin/membership operations. Only action=1 is entry.
  if(member.action!=='1')return {accepted:false,reason:'not_entry'};
  if(!member.user_id||!member.username?.trim())return {accepted:false,reason:'anonymous'};
  const result=this.ingress.ingest({...member,content:'进入直播间',timestamp:member.initial_batch?0:member.timestamp},room);
  if(!result.accepted)return result;
  const event=result.event;event.kind='entrance';event.user=room+':'+member.user_id;
  if(!this.enabled)return result;
  if(this.now()-(this.recent.get(event.user)??-Infinity)<300||this.pending.some(e=>e.user===event.user))event.status='welcome_cooldown';
  else{
   event.status='waiting_welcome';
   if(this.pending.length>=5)this.pending.shift().status='skipped_busy';
   this.pending.push(event);
  }
  return result;
 }
 next(studio,chatPending=0){
  const now=this.now();while(this.pending.length&&now-this.pending[0].received_at>30)this.pending.shift().status='expired';
  if(!this.enabled||chatPending||!studio.key_ready||!quiet(studio)||now-this.lastSent<20)return null;
  const event=this.pending.shift();
  // Reserve while sending; ambiguous results must not cause duplicate spoken welcomes.
  if(event){event.status='sending';event.dispatched_at=now;this.lastSent=now;this.recent.set(event.user,now);
   while(this.recent.size>2000)this.recent.delete(this.recent.keys().next().value);}
  return event||null;
 }
}
class IdleActivity{
 constructor(now=()=>Date.now()/1000,random=Math.random){
  this.now=now;this.random=random;this.enabled=true;this.interval=45;this.lastAction='';this.defer();
 }
 defer(){this.nextAt=this.now()+this.interval*(2/3+this.random()*2/3);}
 configure(enabled,interval){if(enabled!==this.enabled||interval!==this.interval){this.enabled=enabled;this.interval=interval;this.defer();}}
 next(studio,pending=0){
  if(!this.enabled)return null;
  if(!quiet(studio)||pending){this.defer();return null;}
  if(this.now()<this.nextAt)return null;
  const choices=(studio.actions||[]).filter(a=>['idle2','01','04','05','14','17','20','24'].includes(a.id)&&a.duration_ms<=8000&&a.id!==this.lastAction);
  this.defer();if(!choices.length)return null;
  const action=choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))];
  this.lastAction=action.id;this.nextAt+=action.duration_ms/1000;
  return action;
 }
}
module.exports={WelcomePolicy,IdleActivity,quiet};
