(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const capture = location.pathname === '/stage';
  if (capture) document.body.classList.add('capture-only');
  let mode = 'say', state = null, initialized = false, lastAction = '', captionId = -1, eventSignature = '';
  let motionSignature = '', animations = [], lastBonus = null, ruleSignature = '', timerAt = 0;
  const motionNames = {none:'原始动作',dance:'节奏舞',roam:'舞台走位'};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function duration(seconds, hours=true) {
    const n=Math.max(0,Math.ceil(seconds)), h=Math.floor(n/3600), m=Math.floor(n%3600/60), s=n%60;
    return (hours||h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }
  function renderTimer() {
    if(!state?.timer)return;
    const t=state.timer, seconds=Math.max(0,t.remaining_seconds-(t.running?(performance.now()-timerAt)/1000:0));
    $('stageCountdown').textContent=$('consoleCountdown').textContent=duration(seconds);
    $('stageTimerLabel').textContent='直播倒计时 · '+(seconds<=0?'时间到了':t.running?'陪伴进行中':'已暂停');
    $('stageAdded').textContent='+'+duration(t.added_seconds,false);
    $('timerToggle').textContent=t.running?'暂停计时':'开始计时';
    $('timerMeta').textContent='已陪伴 '+duration(t.elapsed_seconds,false)+' · 礼物累计增加 '+duration(t.added_seconds,false);
  }
  function choreography(s) {
    const signature=s.motion+':'+s.motion_seq;
    if(signature===motionSignature)return;
    motionSignature=signature; animations.forEach(a=>a.cancel());animations=[];
    $('actor').dataset.motion=s.motion;
    if(s.motion==='none'||reducedMotion.matches)return;
    const dance=s.motion==='dance';
    const travel=dance?[
      {transform:'translate(0,0)'},{transform:'translate(-5cqw,-1cqw)',offset:.25},
      {transform:'translate(5cqw,0)',offset:.65},{transform:'translate(0,0)'}
    ]:[
      {transform:'translate(0,0) scale(1)'},{transform:'translate(-18cqw,-5cqw) scale(.91)',offset:.26},
      {transform:'translate(-18cqw,-5cqw) scale(.91)',offset:.37},
      {transform:'translate(18cqw,0) scale(1.02)',offset:.7},
      {transform:'translate(18cqw,0) scale(1.02)',offset:.8},{transform:'translate(0,0) scale(1)'}
    ];
    const body=dance?[
      {transform:'translateY(0) rotate(-4deg)'},{transform:'translateY(-2cqw) rotate(0deg)',offset:.25},
      {transform:'translateY(0) rotate(4deg)',offset:.5},{transform:'translateY(-2cqw) rotate(0deg)',offset:.75},
      {transform:'translateY(0) rotate(-4deg)'}
    ]:[{transform:'translateY(0) rotate(-1.5deg)'},{transform:'translateY(-.6cqw) rotate(1.5deg)'},{transform:'translateY(0) rotate(-1.5deg)'}];
    const cycle=dance?1200:500;
    animations=[
      $('actor').animate(travel,{duration:s.motion_duration,easing:'ease-in-out'}),
      $('petBody').animate(body,{duration:cycle,iterations:s.motion_duration/cycle,easing:'ease-in-out'}),
      $('actor').querySelector('.pet-ground').animate([{opacity:.7},{opacity:.4},{opacity:.7}],{duration:cycle,iterations:s.motion_duration/cycle})
    ];
    for(const animation of animations)animation.currentTime=Math.min(s.motion_elapsed_ms,s.motion_duration);
  }
  function renderRules(rules) {
    const signature=JSON.stringify(rules);if(signature===ruleSignature)return;ruleSignature=signature;
    for(const b of document.querySelectorAll('[data-gift]')){
      const r=rules[b.dataset.gift];if(r){b.querySelector('small').textContent='+'+r.seconds+' 秒';
        const label=r.motion==='none'?(names[r.action]||'动作'):motionNames[r.motion];b.childNodes[1].textContent=label;}
    }
    $('stageGiftGuide').replaceChildren();
    for(const gift of ['小心心','玫瑰','加油鸭']){
      const r=rules[gift], row=document.createElement('div'),label=document.createElement('span'),detail=document.createElement('em');
      label.textContent=gift;detail.textContent=motionNames[r.motion]+' · +'+r.seconds+'秒';row.append(label,detail);$('stageGiftGuide').append(row);
    }
  }
  const statusNames = {idle:'准备好了', thinking:'在想怎么回答', preparing:'准备说话', speaking:'正在说话', error:'需要处理'};
  const names = {'01':'招手','04':'有灵感啦','05':'小得意','08':'贴贴','09':'傲娇','13':'小生气','14':'困了','18':'庆祝','22':'眷属印记','25':'幼龙吐息','17':'吃饼干','20':'比心','21':'龙族契约','24':'收集宝藏','26':'信任你',work01:'收到啦',work02:'认真忙碌',work03:'整理文件',work04:'翻阅书本',work05:'放大镜'};
  function notice(text) { $('notice').textContent=text; $('notice').hidden=!text; }
  async function post(path,data) {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'操作未完成');
    return result;
  }
  async function perform(path,data) {
    try { await post(path,data); notice(''); await poll(); }
    catch(error){notice(error.message);}
  }
  function render(s) {
    state=s;
    if(!initialized){
      initialized=true;
      const actions=s.actions.filter(a=>a.id!=='idle'&&a.id!=='idle2'&&!['drag','landing','quota'].includes(a.id));
      $('actionCount').textContent=actions.length+' 个动作';
      for(const a of actions){
        const b=document.createElement('button'); b.textContent=names[a.id]||a.name; b.dataset.action=a.id;
        b.addEventListener('click',()=>perform('/api/action',{action:a.id})); $('actions').appendChild(b);
      }
      $('initialMinutes').value=s.timer.initial_seconds/60;
      for(const [gift,r] of Object.entries(s.gift_rules)){
        const row=document.createElement('label');row.className='gift-rule';row.dataset.rule=gift;
        const name=document.createElement('span');name.textContent=gift;
        const seconds=document.createElement('input');seconds.type='number';seconds.min=0;seconds.max=3600;seconds.value=r.seconds;seconds.setAttribute('aria-label',gift+'加时秒数');
        const motion=document.createElement('select');motion.setAttribute('aria-label',gift+'舞台动作');
        for(const [value,text] of Object.entries(motionNames)){const option=document.createElement('option');option.value=value;option.textContent=text;motion.append(option);}motion.value=r.motion;
        row.append(name,seconds,motion);$('giftRules').append(row);
      }
    }
    timerAt=performance.now();renderTimer();renderRules(s.gift_rules);choreography(s);
    if(lastBonus!==null&&lastBonus!==s.timer.bonus_seq&&s.timer.last_bonus_seconds>0){
      const toast=$('bonusToast');toast.textContent='陪伴 +'+Math.floor(s.timer.last_bonus_seconds)+' 秒';toast.classList.remove('pop');void toast.offsetWidth;toast.classList.add('pop');
    }
    lastBonus=s.timer.bonus_seq;
    const next=s.action+':'+s.action_seq;
    if(next!==lastAction){
      const img=$('character'); img.src='/character/'+encodeURIComponent(s.action)+'.webp?play='+s.action_seq;
      img.alt='小龙娘：'+(names[s.action]||'待机'); lastAction=next;
      $('actionLabel').textContent=names[s.action]||'自在待机';
      for(const b of document.querySelectorAll('[data-action]'))b.classList.toggle('active',b.dataset.action===s.action);
    }
    if(s.motion!=='none')$('actionLabel').textContent=motionNames[s.motion];
    if(captionId!==s.caption_id){$('caption').textContent=s.caption;$('speaker').textContent=s.speaker;captionId=s.caption_id;}
    $('stage').classList.toggle('is-speaking',s.speaking);
    $('stage').classList.toggle('is-thinking',s.status==='thinking');
    $('statusPill').textContent=statusNames[s.status]||s.status;
    $('stageReplies').textContent=s.replies;
    $('stageGifts').textContent=s.gifts;
    $('modelStatus').textContent=s.key_ready?'GPT-6.1 Terra 已配置':'GPT-6.1 Terra 尚未连接';
    $('tokenCount').textContent=s.input_tokens+s.output_tokens? (s.input_tokens+s.output_tokens).toLocaleString()+' tokens · 本次运行':'';
    const natural=s.voice_effective==='openai';
    const needsKey=s.voice_effective==='needs_key';
    $('voiceStatus').textContent=needsKey?'自然语音等待连接 · 请配置已有密钥':natural?'OpenAI 自然语音 · '+s.voice_name+' · '+s.voice_speed+'×':'Mac 离线朗读 · '+s.voice_speed+'×';
    $('voiceHint').textContent=natural?'试听、播报和礼物感谢会产生 API 用量':'连接已有密钥后启用自然语音';
    $('composerHint').textContent=(mode==='chat'?'GPT-6.1 Terra + ':'')+(needsKey?'自然语音需要密钥':natural?'自然语音 · API 计费':'Mac 离线朗读');
    if(s.voice_requests)$('tokenCount').textContent+=' · 语音 '+s.voice_requests+' 次';
    $('queueCount').textContent=s.queued?s.queued+' 条等待中':'没有等待中的消息';
    if(s.error)notice(s.error);
    const signature=JSON.stringify(s.events);
    if(signature!==eventSignature){
      eventSignature=signature; $('events').replaceChildren();
      if(!s.events.length){const p=document.createElement('p');p.className='empty';p.textContent='还很安静，先和她打个招呼吧。';$('events').appendChild(p);}
      for(const event of [...s.events].reverse()){
        const row=document.createElement('div');row.className='event';
        const type=document.createElement('span');type.className='type';type.textContent={say:'台词',chat:'对话',gift:'礼物',entrance:'欢迎'}[event.kind]||'互动';
        const text=document.createElement('span');text.className='text';text.textContent=event.text;
        const time=document.createElement('time');time.textContent=event.time;
        row.append(type,text,time);$('events').appendChild(row);
      }
    }
  }
  let polling=false;
  async function poll(){
    if(polling)return;polling=true;
    try{const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw new Error();render(await r.json());}
    catch(e){notice('工作台连接中断，请检查启动窗口是否仍在运行。');}
    finally{polling=false;}
  }
  for(const tab of document.querySelectorAll('[data-mode]'))tab.addEventListener('click',()=>{
    mode=tab.dataset.mode;
    for(const t of document.querySelectorAll('[data-mode]'))t.classList.toggle('selected',t===tab);
    $('messageLabel').textContent=mode==='chat'?'和小龙娘聊些什么':'写一句想让她说的话';
    $('send').textContent=mode==='chat'?'发送给小龙娘 ↗':'让她说出来 ↗';
    $('message').placeholder=mode==='chat'?'小龙娘，你今天过得怎么样？':'今天也辛苦啦，来陪我吃一块小饼干吧。';
  });
  $('send').addEventListener('click',async()=>{
    const text=$('message').value.trim();if(!text){$('message').focus();return;}
    if(mode==='chat'&&!state?.key_ready){openSettings();return;}
    $('send').disabled=true;
    try{await post('/api/'+mode,{text,username:'主人'});notice('');await poll();}catch(e){notice(e.message);}finally{$('send').disabled=false;}
  });
  $('message').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')$('send').click();});
  for(const b of document.querySelectorAll('[data-line]'))b.addEventListener('click',()=>{$('message').value=b.dataset.line;$('message').focus();});
  for(const b of document.querySelectorAll('[data-gift]'))b.addEventListener('click',()=>perform('/api/gift',{gift_name:b.dataset.gift,username:'主人',event_id:crypto.randomUUID()}));
  for(const b of document.querySelectorAll('[data-motion]'))b.addEventListener('click',()=>perform('/api/choreography',{motion:b.dataset.motion}));
  $('timerToggle').addEventListener('click',()=>perform('/api/timer',{action:state?.timer.running?'pause':'start'}));
  $('timerReset').addEventListener('click',()=>perform('/api/timer',{action:'reset',minutes:$('initialMinutes').value}));
  $('saveGiftRules').addEventListener('click',async()=>{
    const rules={};for(const row of document.querySelectorAll('[data-rule]'))rules[row.dataset.rule]={seconds:row.querySelector('input').value,motion:row.querySelector('select').value};
    try{await post('/api/gift-rules',rules);$('rulesMessage').textContent='已保存到本次运行';await poll();}catch(e){$('rulesMessage').textContent=e.message;}
  });
  $('stop').addEventListener('click',()=>perform('/api/stop',{}));
  function openSettings(){
    $('settingsMessage').textContent='';
    if(state){$('voiceEngine').value=state.voice_engine;$('voiceName').value=state.voice_name;$('voiceStyle').value=state.voice_style;$('voiceSpeed').value=state.voice_speed;$('speedValue').value=state.voice_speed+'×';}
    $('settings').showModal();
  }
  $('settingsButton').textContent='声音与模型';
  $('settingsButton').addEventListener('click',openSettings);$('voiceSettings').addEventListener('click',openSettings);
  $('voiceSpeed').addEventListener('input',()=>$('speedValue').value=Number($('voiceSpeed').value).toFixed(2)+'×');
  $('voicePreview').addEventListener('click',()=>perform('/api/say',{text:'你来啦。今天过得怎么样？不着急，坐下来，陪我聊一会儿吧。'}));
  $('closeSettings').addEventListener('click',()=>{$('apiKey').value='';$('settings').close();});
  $('settings').addEventListener('close',()=>{$('apiKey').value='';});
  $('settingsForm').addEventListener('submit',async e=>{
    e.preventDefault();const key=$('apiKey').value.trim();
    $('apiKey').value='';
    const settings={voice_engine:$('voiceEngine').value,voice_name:$('voiceName').value,voice_style:$('voiceStyle').value,voice_speed:Number($('voiceSpeed').value)};
    if(key)settings.api_key=key;
    try{await post('/api/configure',settings);$('settings').close();notice('设置已保存，下一句开始使用。');await poll();}
    catch(e){$('settingsMessage').textContent=e.message;}
  });
  $('disconnect').addEventListener('click',async()=>{await perform('/api/configure',{clear_key:true});$('settings').close();});
  let pointerX=0,pointerY=0;
  $('stage').addEventListener('pointermove',e=>{const box=$('stage').getBoundingClientRect();pointerX=(e.clientX-box.left)/box.width-.5;pointerY=(e.clientY-box.top)/box.height-.5;});
  $('stage').addEventListener('pointerleave',()=>{pointerX=pointerY=0;});
  $('depthMotion').addEventListener('change',()=>$('stage').classList.toggle('depth-off',!$('depthMotion').checked));
  setInterval(()=>{if(document.hidden||reducedMotion.matches||!$('depthMotion').checked)return;
    const t=performance.now()/1000;$('stage').style.setProperty('--room-x',(Math.sin(t*.13)*.35+pointerX*.8)+'cqw');
    $('stage').style.setProperty('--room-y',(Math.cos(t*.11)*.2+pointerY*.5)+'cqw');},120);
  setInterval(renderTimer,200);
  function clock(){ $('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false}); }
  clock();setInterval(clock,1000);poll();setInterval(()=>{if(!document.hidden)poll();},350);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  // A separate collector keeps the current studio's memory-only key and live audio intact.
  async function pollDanmaku(){
    try{
      const r=await fetch('http://127.0.0.1:18768/api/state',{signal:AbortSignal.timeout(2000)});
      if(!r.ok)throw Error('collector');const d=await r.json();
      const label=$('stage').querySelector('.stage-label');
      const linked=d.connected&&(d.received>0||d.entrances_received>0||d.gift_frames>0);
      if(linked){label.lastChild.textContent=d.auto_reply||d.welcome_enabled||d.gift_enabled?' 直播互动中':' 已接入直播间';
        document.querySelector('.boundary-note').textContent='已接入房间 '+d.web_id+'。'+(d.gift_error?'礼物处理需要检查。':d.gift_enabled?'礼物互动已开启，已转交 '+(d.gift_units_forwarded||0)+' 份。':'礼物互动已暂停。')+'排练按钮仍为模拟事件。';}
      else{label.lastChild.textContent=d.status==='waiting'?' 等待弹幕':' 本地舞台';
        document.querySelector('.boundary-note').textContent='真实弹幕尚未确认接入；请查看弹幕面板的连接状态。礼物按钮用于本地排练。';}
    }catch{const label=$('stage').querySelector('.stage-label');label.lastChild.textContent=' 本地舞台';
      document.querySelector('.boundary-note').textContent='弹幕采集服务未连接；请启动「接入抖音弹幕.command」。礼物按钮用于本地排练。';}
  }
  pollDanmaku();setInterval(pollDanmaku,2000);
})();
