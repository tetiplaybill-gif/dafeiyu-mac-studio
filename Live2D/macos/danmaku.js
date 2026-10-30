(()=>{'use strict';const $=id=>document.getElementById(id);let initialized=false,signature='',polling=false,settingsDirty=false;
 if(parent!==window)document.body.classList.add('embedded');
 const states={stopped:'未连接',opening:'打开直播间',waiting_page:'等待网页连接',waiting:'已连接 · 等待新弹幕',receiving:'正在接收弹幕',disconnected:'连接已断开',closed:'采集窗口已关闭',wrong_room:'直播间已变化',error:'需要处理'};
 const labels={waiting:'等待回复',waiting_welcome:'等待欢迎',welcome_cooldown:'已欢迎过，略过',welcome_forwarded:'已送入欢迎播报',display_only:'仅显示',repeated_text:'重复内容已略过',skipped_busy:'忙碌已略过',expired:'消息已过时',sending:'正在转交',forwarded:'已送入 AI',duplicate:'已去重',rejected:'转交失败',unknown:'结果待确认'};
 Object.assign(labels,{waiting_gift:'等待礼物互动',gift_forwarded:'已送入礼物互动',gift_paused:'已暂停，未转交',gift_overflow:'礼物队列已满，未转交',gift_expired:'等待过久，未转交'});
 async function post(route,data){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const s=await r.json();if(!r.ok)throw Error(s.error||'操作失败');return s;}
 async function act(route,data){try{$('error').textContent='';await post(route,data);if(route==='/api/settings'||route==='/api/connect')settingsDirty=false;await poll();}catch(e){$('error').textContent=e.message;}}
 $('auto').onchange=()=>{settingsDirty=true;};$('interval').oninput=()=>{settingsDirty=true;};
 $('welcome').onchange=()=>{settingsDirty=true;};$('idle').onchange=()=>{settingsDirty=true;};$('idleInterval').oninput=()=>{settingsDirty=true;};
 $('gift').onchange=()=>{settingsDirty=true;};
 const settings=()=>({auto_reply:$('auto').checked,interval:Number($('interval').value),welcome_enabled:$('welcome').checked,idle_enabled:$('idle').checked,idle_interval:Number($('idleInterval').value),gift_enabled:$('gift').checked});
 $('connect').onclick=async()=>{if(!$('room').value.trim()){$('room').focus();return;}$('connect').disabled=true;await act('/api/connect',{url:$('room').value,...settings()});$('connect').disabled=false;};
 $('disconnect').onclick=()=>act('/api/stop',{});
 $('apply').onclick=()=>act('/api/settings',settings());
 async function poll(){if(polling)return;polling=true;try{
  const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();
  if(!initialized){$('room').value=s.room_url;initialized=true;}
  if(!settingsDirty){$('auto').checked=s.auto_reply;$('interval').value=s.interval;$('welcome').checked=s.welcome_enabled??false;$('idle').checked=s.idle_enabled??false;$('idleInterval').value=s.idle_interval||45;$('gift').checked=s.gift_enabled??false;}
  $('status').textContent=!s.connected&&['waiting','receiving'].includes(s.status)?'连接暂无数据，等待恢复':states[s.status]||s.status;
  $('description').textContent=s.web_id?'房间 '+s.web_id+' · '+(s.auto_reply?'自动语音回复已开启':'仅接收显示，不自动回复'):'打开你的直播间网页，接收新弹幕并转给小龙娘。';
  $('received').textContent=s.received;$('forwarded').textContent=s.forwarded;$('pending').textContent=s.pending;
  $('entrances').textContent=s.entrances_received||0;$('welcomes').textContent=s.welcomes_forwarded||0;$('idleCount').textContent=s.idle_actions||0;
  $('giftUnits').textContent=s.gift_units||0;$('giftForwarded').textContent=s.gift_units_forwarded||0;$('giftPending').textContent=s.gift_pending||0;
  const needsReview=['ambiguous_count','ambiguous_group_size','missing_group','missing_identity','count_limit'].includes(s.last_gift?.result);
  $('giftStatus').textContent=s.gift_error||(needsReview?'最新礼物数量信息需要核对，已保留诊断，未按猜测加时。':
   !s.gift_enabled?'礼物互动已暂停，期间收到的数量不补播、不补加时。':
   !s.gift_frames?'礼物互动已启用，等待真实礼物。若观众已赠送却收不到，请在采集 Chrome 中正常登录后重连。':
   '已检测到真实礼物数据，连送按新增数量处理。按已有规则加时；未配置的礼物仅感谢与庆祝。');
  $('activityStatus').textContent=(s.welcome_enabled?'主动欢迎已开启':'主动欢迎已暂停')+' · '+(s.idle_enabled?'空闲小动作已开启':'空闲小动作已暂停')+(s.last_idle_action?' · 最近：'+s.last_idle_action:'')+(s.connected?'':' · 连接直播间后生效');
  if(s.gift_error||s.error)$('error').textContent=s.gift_error||s.error;
  else if(s.status!=='stopped'&&!s.studio_ready)$('error').textContent=s.studio_status==='offline'?'工作台未运行，暂时无法转交。':'工作台尚未配置 AI 密钥，弹幕会显示在这里。';
  else $('error').textContent='';
  const next=JSON.stringify(s.events);if(next!==signature){signature=next;$('events').replaceChildren();
   if(!s.events.length){const p=document.createElement('p');p.className='empty';p.textContent='等待观众发送新弹幕。这里只显示实际收到的消息。';$('events').append(p);}
   for(const e of [...s.events].reverse()){const row=document.createElement('div');row.className='event';const name=document.createElement('b'),text=document.createElement('span'),status=document.createElement('small');name.textContent=e.username;text.textContent=e.content;status.textContent=labels[e.status]||e.status;row.append(name,text,status);$('events').append(row);}
  }
 }catch{$('status').textContent='采集服务未运行';$('error').textContent='请双击项目中的「接入抖音弹幕.command」。';}finally{polling=false;}}
 poll();setInterval(poll,1000);
})();
