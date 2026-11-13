// Theme-only use of Magpie's documented page protocol. The bearer never leaves
// this page or appears in a parent message, URL query, storage, or diagnostics.
(() => {
  const keys = new Set(['bg','card','fg','fg-2','muted','faint','line','accent','accent-soft','accent-fg','green','red','amber','font','code']);
  const hello = 't3-feishu-theme';
  function paint(t) {
    if (!t || typeof t.dark !== 'boolean') return;
    const root = document.documentElement;
    root.dataset.theme = t.dark ? 'dark' : 'light';
    root.style.colorScheme = t.dark ? 'dark' : 'light only';
    for (const [key,value] of Object.entries(t.tokens || {})) {
      if (keys.has(key) && typeof value === 'string' && value.length < 512) root.style.setProperty('--magpie-' + key,value);
    }
  }
  addEventListener('message',e=>{
    if (e.source !== parent || !e.data || e.data.magpie !== 1) return;
    if (e.data.event === 'theme') paint(e.data.data);
    else if (e.data.id === hello && e.data.result) paint(e.data.result);
  });
  if (parent !== window) parent.postMessage({magpie:1,id:hello,method:'hello'},'*');
})();

(async () => {
  const token=location.hash.slice(1);
  try { history.replaceState(null,'',location.pathname+location.search); } catch { /* sandboxed webview */ }
  const $=id=>document.getElementById(id);
  const form=$('form'), fields=$('fields');
  let hasSecret=false, saving=false, refreshing=false, dirty=false, step=0, loadedAppId='', loadedServerName='', serverTouched=false, discovering=false;
  const requests=new Set();
  addEventListener('pagehide',()=>{for(const c of requests)c.abort();});
  function notice(message,kind='error') { $('notice').textContent=message; $('notice').dataset.kind=kind; }
  function edited() { dirty=true;$('dirty').textContent='有未保存的修改';updateReview(); }
  form.addEventListener('input',edited);
  $('serverName').addEventListener('input',()=>{serverTouched=true;});
  function busy(id,on){$(id).setAttribute('aria-busy',String(on));$(id).dataset.loading=String(on);}
  // Unknown data gets skeletons; a refresh never erases the last verified result.
  let runtimeReady=false,statsReady=false;
  const numberMotions=new Map();
  const motionAllowed=()=>!document.hidden&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function settleNumbers(){for(const item of numberMotions.values()){window.cancelAnimationFrame?.(item.frame);item.node.textContent=item.format(item.target);item.node.dataset.value=String(item.target);}numberMotions.clear();}
  addEventListener('visibilitychange',()=>{if(document.hidden)settleNumbers();});
  addEventListener('pagehide',settleNumbers);
  function numberValue(id,value,format=String,pane='stats'){
    const node=$(id),prior=numberMotions.get(id);if(prior)window.cancelAnimationFrame?.(prior.frame);
    numberMotions.delete(id);
    const from=Number(node.dataset.value),known=node.dataset.value!==undefined&&Number.isFinite(from);
    if(value===null||!Number.isFinite(value)){delete node.dataset.value;node.textContent='—';node.setAttribute('aria-label','暂无数据');return;}
    node.setAttribute('aria-label',format(value));
    // First observations are revealed, never counted up from a fabricated zero.
    if(!known||from===value||view!==pane||!motionAllowed()||!window.requestAnimationFrame){node.textContent=format(value);node.dataset.value=String(value);return;}
    const item={node,target:value,format,frame:null,start:null};numberMotions.set(id,item);
    const tick=time=>{
      if(numberMotions.get(id)!==item)return;
      if(!motionAllowed()||view!==pane){node.textContent=format(value);node.dataset.value=String(value);numberMotions.delete(id);return;}
      if(item.start===null)item.start=time;
      const progress=Math.min(1,(time-item.start)/360),current=from+(value-from)*(1-Math.pow(1-progress,3));
      node.textContent=format(current);node.dataset.value=String(current);
      if(progress<1)item.frame=window.requestAnimationFrame(tick);else{node.textContent=format(value);node.dataset.value=String(value);numberMotions.delete(id);}
    };item.frame=window.requestAnimationFrame(tick);
  }
  function regionState(id,state){$(id).dataset.loadState=state;}
  async function api(path,body) {
    const controller=new AbortController();requests.add(controller);
    const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const r=await fetch(new URL(path,location.href),{method:body?'POST':'GET',signal:controller.signal,
        headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      if(!r.ok) {let failure;try{failure=await r.json();}catch{}if(['unsupported_project','project_uncertain','project_pending','project_icon_pending','project_thread_pending'].includes(failure?.code))throw new Error(failure.error);if(failure?.code==='unsupported_create')throw new Error('此 T3 版本不支持安全幂等创建。请更新 T3 或选择已有会话。');throw new Error(r.status===401?'控制密钥已失效，请从 Magpie 重新打开插件页。':r.status===400?'配置无效或保存失败，请核对必填项、用户和线程是否重复。':'请求失败（'+r.status+'），请检查插件是否启用。');}
      return await r.json();
    } catch(e) { if(e.name==='AbortError')throw new Error(body?'保存超时，结果尚不确定。请重新打开页面核对已保存配置，不要重复提交。':'读取超时，请检查本地服务后重试。');throw e; }
    finally { clearTimeout(timer);requests.delete(controller); }
  }
  function bindingRow(b={}) {
    const row=document.createElement('div');row.className='binding';
    for(const [key,title,placeholder] of [['userId','飞书 open_id','ou_…'],['threadId','T3 线程 ID','创建工作区后自动填入，或手动填写'],['environmentId','环境 ID（可选）','可留空']]) {
      const label=document.createElement('label');label.className='field';
      const caption=document.createElement('span');caption.className='field-title';caption.textContent=title;
      const input=document.createElement('input');input.name=key;input.value=b[key]||'';input.placeholder=placeholder;input.autocomplete='off';input.spellcheck=false;input.maxLength=256;
      label.append(caption,input);if(key==='environmentId'){const advanced=document.createElement('details');advanced.className='binding-advanced';const summary=document.createElement('summary');summary.textContent='高级：远程环境';advanced.append(summary,label);row.append(advanced);}else row.append(label);
    }
    const create=document.createElement('button');create.type='button';create.className='workspace-create'+(b.threadId?'':' primary');create.textContent=b.threadId?'改绑到新的专用工作区':'创建独立项目（推荐）';create.onclick=()=>openThreads(row,'new');row.append(create);
    const choose=document.createElement('button');choose.type='button';choose.className='thread-choose';choose.textContent=b.threadId?'更换已有会话':'改用已有会话';choose.onclick=()=>openThreads(row);row.append(choose);
    const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.setAttribute('aria-label','移除此用户绑定');
    remove.onclick=()=>{if(createReceipt&&createTarget===row){notice('此绑定有结果未确认的创建请求，请先核对 T3 并完成同一请求。');return;}row.remove();edited();$('add-binding').disabled=false;};row.append(remove);$('bindings').append(row);
    $('add-binding').disabled=$('bindings').children.length>=20;
    return row;
  }
  $('add-binding').onclick=()=>{if($('bindings').children.length>=20)return;const row=bindingRow();edited();row.querySelector('input').focus();};
  function readBindings(){return [...$('bindings').children].map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(i=>[i.name,i.value.trim()])));}
  function validate(c){
    if(hasSecret&&c.appId&&c.appId!==loadedAppId&&!c.appSecret)throw new Error('更换 App ID 时，请同时填写该应用的新 App Secret。');
    if(c.serverName&&/^https?:/i.test(c.serverName.trim()))throw new Error('请填写 Magpie 中 T3 MCP 的服务名称，不要填写 Connect 网址。');
    if(c.bindings.some(b=>!/^ou_[a-zA-Z0-9]+$/.test(b.userId)||!b.threadId))throw new Error('每个用户都需要有效的 open_id（ou_ 开头）和 T3 线程 ID。');
    if(new Set(c.bindings.map(b=>b.userId)).size!==c.bindings.length)throw new Error('同一个用户只能绑定一次。');
    if(new Set(c.bindings.map(b=>b.environmentId+':'+b.threadId)).size!==c.bindings.length)throw new Error('每位用户需要独立的 T3 线程。');
    if(c.enabled&&(!/^cli_[0-9a-fA-F]{16}$/.test(c.appId)||!(c.appSecret||hasSecret)||!c.serverName||!c.bindings.length))throw new Error('启用前请填写有效的 App ID、App Secret、MCP 名称，并至少添加一位可信用户。');
  }
  function updateReview(){
    $('review').replaceChildren();
    for(const text of [
      'T3 服务：'+($('serverName').value.trim()||'尚未填写'),
      '飞书应用：'+($('appId').value.trim()||'尚未填写')+' · 密钥'+(($('appSecret').value||hasSecret)?'已提供':'尚未提供'),
      '可信用户：'+$('bindings').children.length+' 位（每位绑定独立线程）'
    ]){const li=document.createElement('li');li.textContent=text;$('review').append(li);}
  }
  // WAAPI explicitly restarts entry motion after display:none, with no delayed callbacks.
  // Cancelling previous motion prevents rapid switches from leaving stale opacity behind.
  function revealPane(pane){
    for(const motion of pane.getAnimations?.()||[])motion.cancel();
    if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
      pane.animate?.([{opacity:0},{opacity:1}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  function showStep(n,focus=false){
    const changed=step!==n;step=n;$('step-nav').dataset.step=String(n);for(let i=0;i<4;i++){$('step-'+i).hidden=i!==n;$('step-tab-'+i).setAttribute('aria-current',i===n?'step':'false');}
    $('previous').hidden=n===0;$('next').hidden=n===3;$('runtime').hidden=n!==3;
    updateReview();if(changed)revealPane($('step-'+n));if(focus)$('step-'+n).focus({preventScroll:true});
  }
  function checkStep(n){
    if(n===0&&(!$('serverName').value.trim()||/^https?:/i.test($('serverName').value.trim())))throw new Error('请填写 Magpie 中 T3 MCP 的服务名称，不要填写 Connect 网址。');
    if(n===1&&(!/^cli_[0-9a-fA-F]{16}$/.test($('appId').value.trim())||!($('appSecret').value||hasSecret)))throw new Error('请填写有效的飞书 App ID 和 App Secret，再继续。');
    if(n===2){const bindings=readBindings();if(!bindings.length)throw new Error('请先添加你自己的 open_id，再创建专用工作区或选择已有会话。');validate({enabled:false,bindings});}
  }
  $('next').onclick=()=>{try{checkStep(step);notice('','');showStep(Math.min(3,step+1),true);}catch(e){notice(e.message);}};
  $('previous').onclick=()=>{notice('','');showStep(Math.max(0,step-1),true);};
  for(let i=0;i<4;i++)$('step-tab-'+i).onclick=()=>{notice('','');showStep(i,true);};
  showStep(0);
  const channelNames={idle:'未连接',reconnecting:'重新连接中',failed:'连接失败',connected:'已连接',connecting:'连接中',disconnected:'未连接',stopped:'已停止',unknown:'未知'};
  const phases={queued:'等待提交',waiting:'等待 T3',reading:'读取回复',delivering:'准备发送',accepted:'已接收',submitting:'提交中',submitted:'等待 T3',running:'执行中',ready:'待回复',sending:'发送中',uncertain:'需人工核对',blocked:'需人工处理',done:'已完成'};
  const decisionNames={accepted:'已通过白名单，加入处理队列',unbound:'发信人未在白名单',duplicate:'重复消息已忽略',stale:'消息时间无效或已过期',invalid:'消息不完整或超过长度限制',notRunning:'桥接尚未运行'};
  const filterNames={not_private:'非私聊',not_text:'非文字消息',not_user:'非用户发信人',invalid_content:'消息内容格式无效',missing_fields:'缺少必要消息字段'};
  const operationNames={baseline:'读取线程起点',send:'提交消息',wait:'等待任务结束',read:'读取回复'};
  const outcomeNames={pending:'处理中',success:'收到响应',error:'失败'};
  const labelFor=(map,key)=>Object.hasOwn(map,key)?map[key]:undefined;
  const count=v=>Number.isSafeInteger(v)&&v>=0?v:0;
  const moment=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=Date.now()+86400000?new Date(v).toLocaleString():'尚无记录';
  function diagnose(s){
    const d=s.diagnostics,c=d?.channel;
    const safe={events:count(c?.events),normalized:count(c?.normalized),filtered:count(c?.filtered),accepted:count(d?.accepted),unbound:count(d?.unbound),duplicate:count(d?.duplicate),stale:count(d?.stale),invalid:count(d?.invalid),notRunning:count(d?.notRunning)};
    $('diag-events').textContent=d?String(safe.events):'暂无数据';$('diag-accepted').textContent=d?String(safe.accepted):'暂无数据';
    const t=d?.t3,op=labelFor(operationNames,t?.operation),outcome=labelFor(outcomeNames,t?.outcome);
    $('diag-t3').textContent=op&&outcome?op+' · '+outcome:'尚未调用';
    $('diag-decision').textContent='最近消息判断：'+(labelFor(decisionNames,d?.lastDecision)||'尚无记录');
    let next;
    if(!d)next='当前服务未提供消息诊断。请更新插件并重新打开页面；原有配置不会因此变更。';
    else if(!s.enabled||!s.running)next='先启用并保存桥接，再发送一条新的私聊文字。';
    else if(!safe.events)next='尚未收到 im.message.receive_v1 事件。检查飞书长连接事件订阅、私聊读取权限、应用发布与本人可用范围；连接成功不代表事件已经订阅。';
    else if(d.lastDecision==='unbound')next='已收到消息，但发信人未获授权。回到「绑定自己」，核对 open_id 是否来自同一飞书应用；不会自动授权陌生用户。';
    else if(d.lastDecision==='stale')next='该消息因时间被忽略。检查主机时间后发送一条新消息，不要重放旧消息。';
    else if(d.lastDecision==='duplicate')next='这条消息已处理或已入队，不会重复执行。查看现有任务状态，不要反复发送相同任务。';
    else if(d.lastDecision==='invalid')next='该消息缺少必要字段或过长。请改用一条简短的私聊文字。';
    else if(d.lastDecision==='notRunning')next='消息到达时桥接未运行。重新确认启用状态，再发送一条新消息。';
    else if(!safe.normalized)next='事件已到达，但不符合私聊文字要求。请直接私聊机器人，不要使用群聊、图片或卡片；过滤原因见下方。';
    else if(t?.outcome==='error')next='消息已进入处理流程，T3 调用失败。检查 Magpie 中 MCP 服务名称与登录、发送授权、线程及远程环境；先到 T3 核对任务，不要重复发送。';
    else if(safe.accepted)next='消息已通过白名单。查看下方任务状态和 T3 线程；需要审批时请回到 T3，只有本轮结束后才会回复飞书。';
    else next='已收到事件。核对消息类型和白名单，再查看最近消息判断。';
    $('diag-next').textContent=next;$('diag-filters').replaceChildren();
    for(const [key,label] of Object.entries(filterNames)){const n=count(c?.filterReasons?.[key]);if(n){const li=document.createElement('li');li.textContent=label+'：'+n;$('diag-filters').append(li);}}
    $('diag-time').textContent='最近事件：'+moment(c?.lastEventAt)+' · 最近白名单判断：'+moment(d?.lastReceivedAt);
    // Whitelist the copied diagnostic surface. Never stringify raw status,
    // pending jobs, remote errors, or unrecognized diagnostic keys.
    $('status').textContent=JSON.stringify({enabled:s.enabled===true,running:s.running===true,...safe,lastDecision:labelFor(decisionNames,d?.lastDecision)||null,t3:op&&outcome?{operation:op,outcome}:null},null,2);
  }
  async function refresh(){
    if(refreshing)return;regionState('view-overview',runtimeReady?'refreshing':'initial');refreshing=true;$('refresh').disabled=true;busy('refresh',true);busy('runtime',true);
    try{
      const s=await api('api/status');diagnose(s);
      const state=s.error?'需要关注':!s.enabled?'未启用':s.running?'桥接已启动':'未运行';
      $('connection').textContent=state;$('connection').dataset.kind=s.error?'error':s.running?'success':'';
      const channel=typeof s.channelConnection==='string'?s.channelConnection:s.channelConnection?.state;
      $('channel').textContent=labelFor(channelNames,channel)||'未知';
      $('overview-title').textContent=s.error?'连接需要关注':!s.enabled?'准备好开始了吗？':s.running?'桥接已启动':'桥接暂未运行';$('overview-next').textContent=s.error?'展开诊断，查看消息停在哪一步。':!s.enabled?'完成连接设置，再发出第一条私聊。':s.running?'给飞书机器人发一条私聊，继续你的 T3 任务。':'检查连接设置与 Magpie 插件状态。';
      const jobs=Array.isArray(s.pending)?s.pending:[];numberValue('pending-count',jobs.length,n=>String(Math.round(n)),'overview');numberValue('completed',count(s.completed),n=>String(Math.round(n)),'overview');
      $('status-error').textContent=s.error?'桥接遇到错误。请查看安全诊断及 T3 状态，确认后再继续。':'';$('jobs').replaceChildren();
      for(const job of jobs){const li=document.createElement('li');const label=document.createElement('strong');label.textContent=labelFor(phases,job.phase)||'未知阶段';const detail=document.createElement('p');detail.className='hint';detail.textContent=job.phase==='blocked'?'请在 T3 核对审批或回复；不要重复发送任务。':'请在对应 T3 线程查看任务详情。';li.append(label,detail);$('jobs').append(li);}
      runtimeReady=true;regionState('view-overview','ready');$('empty').hidden=jobs.length>0;$('updated').textContent='更新于 '+new Date().toLocaleTimeString();
    }catch(e){regionState('view-overview',runtimeReady?'stale':'error');$('connection').textContent='状态读取失败';$('connection').dataset.kind='error';$('overview-title').textContent='暂时无法读取状态';$('overview-next').textContent='点击刷新重试，配置不会丢失。';$('status-error').textContent=e.message;throw e;}
    finally{refreshing=false;$('refresh').disabled=false;busy('refresh',false);busy('runtime',false);}
  }
  $('refresh').onclick=()=>refresh().catch(()=>{});
  let activeBinding=null,threadCursor=null,threadRequest=0,creatingThread=false,createReceipt=null,createTarget=null,createTargetUser='',createTargetThread='',createTargetEnvironment='',qrTimer=null,qrObjectURL=null,qrActive=false,qrShownURL='',qrSaving=false;
  function textNotice(id,text,kind=''){$(id).textContent=text;$(id).dataset.kind=kind;}
  function bindingInput(row,name){return [...row.querySelectorAll('input')].find(i=>i.name===name);}
  async function discoverMCP(){
    if(discovering)return;discovering=true;$('discover-mcp').disabled=true;busy('discover-mcp',true);busy('mcp-results',true);textNotice('mcp-notice','正在查找…');$('mcp-results').replaceChildren();
    try{const data=await api('api/mcp/servers');if(!Array.isArray(data.servers))throw new Error('当前服务不支持自动发现。请手动填写服务名称。');
      const servers=data.servers.filter(item=>typeof item.name==='string'&&item.name),relays=servers.filter(item=>item.relayMatched===true);
      const preselect=!loadedServerName&&!serverTouched&&!$('serverName').value.trim()&&relays.length===1;
      if(preselect){$('serverName').value=relays[0].name;edited();}
      for(const item of servers){const button=document.createElement('button');button.type='button';button.className='choice';button.dataset.recommended=String(item.relayMatched===true);button.dataset.selected=String($('serverName').value===item.name);const title=document.createElement('strong');title.textContent=item.name;const description=document.createElement('span');description.textContent=item.relayMatched===true?'T3 Relay 匹配 · 未验证授权':item.suggested?'名称包含 T3 · 手动确认':'其他 MCP 服务';button.append(title,description);button.onclick=()=>{serverTouched=true;$('serverName').value=item.name;for(const c of $('mcp-results').children)c.dataset.selected=String(c===button);edited();textNotice('mcp-notice','已选择 '+item.name+'，尚未保存。');};$('mcp-results').append(button);}
      textNotice('mcp-notice',!servers.length?'未找到服务。展开下方手动配置。':preselect?'已预选唯一 T3 Relay，尚未保存。':relays.length>1?'发现多个 T3 Relay，请选择要使用的服务。':$('serverName').value?'已保留当前选择，也可切换其他服务。':'选择 T3 服务，或展开手动配置。');
    }catch(e){textNotice('mcp-notice',e.message+' 可继续手动配置。','error');}finally{discovering=false;$('discover-mcp').disabled=false;busy('discover-mcp',false);busy('mcp-results',false);}
  }
  $('discover-mcp').onclick=()=>discoverMCP();
  function openThreads(row,mode='existing'){if(creatingThread||createReceipt&&createTarget!==row){notice('正在创建或核对另一个绑定的会话，请先完成该请求。');return;}activeBinding=row;$('thread-picker').hidden=false;$('thread-existing').hidden=mode==='new';$('thread-new').hidden=mode!=='new';$('thread-picker-title').textContent=mode==='new'?'创建飞书 IM 独立项目':'选择已有 T3 对话';$('thread-picker-description').textContent=mode==='new'?'确认后才创建目录，不会发送消息或启动任务。':'只读取标题与标识，不会发送消息或打开任务。';$('thread-environment').value=bindingInput(row,'environmentId').value;$('thread-results').replaceChildren();$('thread-more').hidden=true;threadCursor=null;textNotice('thread-notice','');$('thread-picker').scrollIntoView?.({block:'start',behavior:'auto'});if(mode==='existing')loadThreads(false);}
  $('thread-close').onclick=()=>{if(creatingThread){textNotice('thread-notice','正在创建会话，请等待结果后再关闭。');return;}activeBinding=null;$('thread-picker').hidden=true;threadRequest++;};
  async function loadThreads(more){
    if(!activeBinding)return;const serverName=$('serverName').value.trim();if(!serverName){textNotice('thread-notice','请先选择或填写 T3 MCP 服务。','error');return;}const generation=++threadRequest;$('thread-search').disabled=true;$('thread-more').disabled=true;textNotice('thread-notice','正在读取 T3 会话…');busy('thread-results',true);busy('thread-search',true);if(!more)$('thread-results').replaceChildren();
    try{const query=new URLSearchParams({serverName,environmentId:$('thread-environment').value.trim(),query:$('thread-query').value.trim(),cursor:more&&threadCursor!==null?String(threadCursor):'0'});const data=await api('api/t3/threads?'+query);if(generation!==threadRequest||!activeBinding)return;if(!Array.isArray(data.threads))throw new Error('会话列表格式不兼容，请使用手动 ID。');
      for(const t of data.threads){if(typeof t.threadId!=='string'||!t.threadId)continue;const button=document.createElement('button');button.type='button';button.className='choice';const title=document.createElement('strong');title.textContent=t.title||'未命名会话';const detail=document.createElement('span');detail.textContent=t.threadId+(t.environmentId?' · 远程环境':'');button.append(title,detail);button.onclick=()=>{if(!activeBinding)return;bindingInput(activeBinding,'threadId').value=t.threadId;bindingInput(activeBinding,'environmentId').value=typeof t.environmentId==='string'?t.environmentId:'';edited();textNotice('thread-notice','已选择会话。请核对用户绑定后继续。');$('thread-picker').hidden=true;activeBinding=null;};$('thread-results').append(button);}
      threadCursor=data.nextCursor??null;$('thread-more').hidden=threadCursor===null;textNotice('thread-notice',$('thread-results').children.length?'选择一个独立会话，避免与其他用户共用。':'没有找到会话。可调整搜索条件、手动填 ID，或明确新建专用会话。');
    }catch(e){if(generation===threadRequest)textNotice('thread-notice',e.message+' 请确认 MCP 的登录和读取授权。','error');}finally{if(generation===threadRequest){$('thread-search').disabled=false;$('thread-more').disabled=false;busy('thread-results',false);busy('thread-search',false);}}
  }
  $('thread-search').onclick=()=>loadThreads(false);$('thread-more').onclick=()=>loadThreads(true);
  $('thread-recover').onclick=async()=>{if(creatingThread||createReceipt||!activeBinding)return;const row=activeBinding,user=bindingInput(row,'userId').value.trim(),serverName=$('serverName').value.trim(),title=$('thread-title').value.trim(),environmentId=$('thread-environment').value.trim(),rowEnvironment=bindingInput(row,'environmentId').value.trim();if(!serverName||!title){textNotice('thread-notice','请先填写原服务、项目名称及环境。','error');return;}try{const r=await api('api/t3/pending?'+new URLSearchParams({serverName,title,environmentId}));if(activeBinding!==row||![...$('bindings').children].includes(row)||bindingInput(row,'userId').value.trim()!==user||bindingInput(row,'environmentId').value.trim()!==rowEnvironment||$('serverName').value.trim()!==serverName||$('thread-title').value.trim()!==title||$('thread-environment').value.trim()!==environmentId)return;if(!Array.isArray(r.requests)||r.requests.length!==1){textNotice('thread-notice','未找到唯一未完成请求，请核对原名称与环境；不要反复创建。','error');return;}createReceipt={serverName,title,environmentId,confirmCreate:true,requestId:r.requests[0].requestId};createTarget=row;createTargetUser=user;createTargetThread=bindingInput(row,'threadId').value.trim();createTargetEnvironment=rowEnvironment;textNotice('thread-notice','已加载原创建请求。核对当前用户绑定，勾选确认后点击创建以续办；不会重复创建项目。');}catch(e){textNotice('thread-notice',e.message,'error');}};
  $('thread-create').onclick=async()=>{
    if(creatingThread||!activeBinding)return;if(!$('thread-create-confirm').checked){textNotice('thread-notice','请先确认创建新的专用工作区。','error');return;}
    if(!createReceipt){const serverName=$('serverName').value.trim(),title=$('thread-title').value.trim();if(!serverName||!title){textNotice('thread-notice','请填写 T3 服务和会话名称。','error');return;}createTarget=activeBinding;createTargetUser=bindingInput(activeBinding,'userId').value.trim();createTargetThread=bindingInput(activeBinding,'threadId').value.trim();createTargetEnvironment=bindingInput(activeBinding,'environmentId').value.trim();createReceipt={serverName,title,environmentId:$('thread-environment').value.trim(),confirmCreate:true,requestId:'im-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)};}
    if(createTarget!==activeBinding||$('serverName').value.trim()!==createReceipt.serverName||$('thread-environment').value.trim()!==createReceipt.environmentId||$('thread-title').value.trim()!==createReceipt.title||bindingInput(createTarget,'userId').value.trim()!==createTargetUser||bindingInput(createTarget,'threadId').value.trim()!==createTargetThread||bindingInput(createTarget,'environmentId').value.trim()!==createTargetEnvironment){textNotice('thread-notice','创建请求的目标已变化。请先在 T3 核对原请求，并恢复原服务、环境、会话名称和用户后重试。','error');return;}
    creatingThread=true;$('thread-create').disabled=true;textNotice('thread-notice','正在创建命名项目与会话，需要 Full Access，不会启动模型…');
    try{const t=await api('api/t3/create',createReceipt);if(typeof t.threadId!=='string'||!t.threadId)throw new Error('创建结果未确认，请先到 T3 核对，不要重复创建。');if($('serverName').value.trim()!==createReceipt.serverName||$('thread-environment').value.trim()!==createReceipt.environmentId||$('thread-title').value.trim()!==createReceipt.title||bindingInput(createTarget,'userId').value.trim()!==createTargetUser||bindingInput(createTarget,'threadId').value.trim()!==createTargetThread||bindingInput(createTarget,'environmentId').value.trim()!==createTargetEnvironment)throw new Error('会话已创建，但绑定目标在等待期间发生变化。请恢复原服务和用户后重试同一请求。');if(!createTarget||![...$('bindings').children].includes(createTarget))throw new Error('会话已创建，但原绑定已移除。请在 T3 核对并从会话列表选择，不要新建重复会话。');if(createTarget){bindingInput(createTarget,'threadId').value=t.threadId;bindingInput(createTarget,'environmentId').value=typeof t.environmentId==='string'?t.environmentId:'';for(const child of createTarget.children){if(child.className?.startsWith('workspace-create')){child.className='workspace-create';child.textContent='改绑到新的专用工作区';}}edited();}$('thread-picker').hidden=true;activeBinding=null;createReceipt=null;createTarget=null;$('thread-create-confirm').checked=false;notice('独立项目与会话已创建，使用蓝色「飞」字标；保存配置后才会用于飞书。'+(t.commitWarning?' 注意：项目的首次 Git 提交有警告，请在 T3 检查仓库状态。':''),t.commitWarning?'warning':'success');}
    catch(e){textNotice('thread-notice',e.message+' 再次点击只核验或续办同一创建请求，不会重新创建。若无法恢复，请先到 T3 核对；确认没有重复项目后可手动创建，再重新打开本页并选择已有会话。','error');}
    finally{creatingThread=false;$('thread-create').disabled=false;}
  };
  function releaseQR(){if(qrObjectURL){URL.revokeObjectURL(qrObjectURL);qrObjectURL=null;}clearTimeout(qrTimer);}
  addEventListener('pagehide',()=>{qrActive=false;releaseQR();});
  async function showQR(){const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(new URL('api/onboarding/feishu/qr.svg',location.href),{headers:{authorization:'Bearer '+token},signal:controller.signal});if(!r.ok)throw new Error('二维码读取失败，请使用官方授权地址或重试。');const blob=await r.blob();if(qrObjectURL)URL.revokeObjectURL(qrObjectURL);qrObjectURL=URL.createObjectURL(blob);$('qr-image').src=qrObjectURL;}finally{clearTimeout(timer);requests.delete(controller);}}
  async function checkQR(){
    if(!qrActive)return;clearTimeout(qrTimer);
    try{const data=await api('api/onboarding/feishu');if(!qrActive)return;
      if(data.state==='waiting'){if(data.url&&data.url!==qrShownURL){let url;try{url=new URL(data.url);}catch{}if(!url||url.protocol!=='https:'||!['accounts.feishu.cn','accounts.larksuite.com'].includes(url.hostname))throw new Error('返回的授权地址不受支持，未展示二维码。');qrShownURL=url.href;$('qr-url').value=url.href;$('qr-panel').hidden=false;await showQR();}textNotice('qr-notice',qrShownURL?'等待飞书授权。请在飞书中确认创建应用及权限。':'正在准备官方授权二维码…');qrTimer=setTimeout(()=>{if(!document.hidden)checkQR();else qrTimer=setTimeout(checkQR,5000);},3000);return;}
      if(data.state==='authorized'){releaseQR();$('qr-panel').hidden=true;$('qr-apply').hidden=false;textNotice('qr-notice','飞书授权已完成，尚未改动当前机器人。点击「使用此机器人」才会保存新配置；之后仍需核对事件订阅和发布。','success');return;}
      if(data.state==='saving'){qrSaving=true;textNotice('qr-notice','正在保存新的机器人配置，请稍候…');$('qr-apply').disabled=true;$('qr-cancel').disabled=true;qrTimer=setTimeout(checkQR,2000);return;}
      qrActive=false;qrSaving=false;releaseQR();$('qr-cancel').disabled=false;$('qr-apply').disabled=false;$('qr-cancel').hidden=true;$('qr-apply').hidden=true;$('qr-start').disabled=false;
      if(data.state==='complete'){const c=await api('api/config');$('appId').value=c.appId;loadedAppId=c.appId;hasSecret=!!c.hasSecret;$('appSecret').value='';$('appSecret').placeholder='已保存，留空不变';$('enabled').checked=false;$('bindings').replaceChildren();if(typeof data.openId==='string'&&/^ou_[a-zA-Z0-9]+$/.test(data.openId))bindingRow({userId:data.openId});$('qr-panel').hidden=true;$('qr-replace-row').hidden=!hasSecret;edited();textNotice('qr-notice','应用凭据已保存，桥接保持关闭。请核对飞书事件订阅和应用发布，再选择会话并确认启用。','success');showStep(2,true);notice('扫码已完成。请核对预填的本人身份，再点击「创建专用工作区」完成接入。','success');}
      else {const states={expired:'二维码已过期，请重新生成。',cancelled:'已取消本次接入。',error:'扫码接入未完成。请核对飞书授权后重试，或使用手动配置。',idle:'没有正在进行的扫码接入。'};textNotice('qr-notice',states[data.state]||'接入状态未知，请重新打开页面核对。',data.state==='error'?'error':'');$('qr-panel').hidden=true;}
    }catch(e){textNotice('qr-notice',e.message+' 可点击检查授权结果重试。','error');}
  }
  $('qr-start').onclick=async()=>{
    if(qrActive)return;if(!$('qr-confirm').checked){textNotice('qr-notice','请先确认创建新应用，并在飞书核对权限。','error');return;}
    $('qr-start').disabled=true;$('qr-cancel').disabled=false;qrSaving=false;textNotice('qr-notice','正在向飞书申请接入码…');try{await api('api/onboarding/feishu/start',{confirmCreate:true,confirmReplace:hasSecret&&$('qr-replace').checked});qrShownURL='';$('qr-cancel').hidden=false;qrActive=true;checkQR();}catch(e){textNotice('qr-notice',e.message,'error');$('qr-start').disabled=false;}
  };
  async function resumeQR(){try{const data=await api('api/onboarding/feishu');if(['waiting','authorized','saving'].includes(data.state)){qrActive=true;$('qr-start').disabled=true;$('qr-cancel').hidden=false;checkQR();}}catch{/* Optional state recovery does not block manual setup. */}}
  $('qr-refresh').onclick=()=>{qrActive=true;return checkQR();};$('qr-apply').onclick=async()=>{if(createReceipt){textNotice('qr-notice','请先核对尚未完成的 T3 创建请求，再替换机器人。','error');return;}if(qrSaving||$('qr-apply').disabled)return;if(hasSecret&&!$('qr-replace').checked){textNotice('qr-notice','替换前请明确确认暂停原桥接并清空原绑定。','error');return;}$('qr-apply').disabled=true;try{await api('api/onboarding/feishu/apply',{confirmReplace:true});qrActive=true;await checkQR();}catch(e){textNotice('qr-notice',e.message+' 请检查状态后再继续。','error');qrActive=true;await checkQR();}finally{if(!qrSaving)$('qr-apply').disabled=false;}};$('qr-cancel').onclick=async()=>{try{const cancelled=await api('api/onboarding/feishu/cancel',{});if(cancelled.ok===false&&cancelled.state==='saving'){textNotice('qr-notice','正在保存配置，此时无法取消。请等待完成后核对。');return;}qrActive=false;releaseQR();$('qr-panel').hidden=true;$('qr-cancel').hidden=true;$('qr-apply').hidden=true;$('qr-start').disabled=false;textNotice('qr-notice','已取消本次接入。');}catch(e){textNotice('qr-notice',e.message,'error');}};

  let view='settings',rangeDays=7,displayedRange=7,statsLoading=false,statsSequence=0;
  const viewScroll=new Map();
  function showView(name){
    if(!['overview','stats','settings'].includes(name))return;
    const changed=view!==name;
    const moveFocus=changed&&$('view-'+view).contains?.(document.activeElement);
    viewScroll.set(view,$('view-'+view).scrollTop||0);
    if(changed)settleNumbers();
    view=name;$('product-nav').dataset.view=name;
    for(const n of ['overview','stats','settings']){
      const active=n===name,pane=$('view-'+n),tab=$('nav-'+n);
      if(!active)for(const motion of pane.getAnimations?.()||[])motion.cancel();
      pane.hidden=!active;pane.inert=!active;
      tab.setAttribute('aria-current',active?'page':'false');
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    }
    const pane=$('view-'+name);pane.scrollTop=viewScroll.get(name)||0;
    if(changed)revealPane(pane);
    if(moveFocus)$('nav-'+name).focus({preventScroll:true});
    if(name==='overview'){$('runtime').hidden=false;refresh().catch(()=>{});}
    if(name==='stats')loadStats();
  }
  $('overview-settings').onclick=()=>{showView('settings');$('nav-settings').focus({preventScroll:true});};
  const viewNames=['overview','stats','settings'];
  for(const [index,name] of viewNames.entries()){
    const tab=$('nav-'+name);tab.onclick=()=>showView(name);
    tab.onkeydown=event=>{
      let next;
      if(event.key==='ArrowRight')next=(index+1)%viewNames.length;
      else if(event.key==='ArrowLeft')next=(index+viewNames.length-1)%viewNames.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=viewNames.length-1;
      else return;
      event.preventDefault();showView(viewNames[next]);$('nav-'+viewNames[next]).focus({preventScroll:true});
    };
  }
  const formatCount=n=>count(n).toLocaleString();
  const duration=n=>!Number.isFinite(n)||n<0?'—':n<1000?Math.round(n)+' 毫秒':n<60000?(n/1000).toFixed(1)+' 秒':(n/60000).toFixed(1)+' 分钟';
  function svgNode(tag,attrs={},text){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));if(text!==undefined)node.textContent=text;return node;}
  let trendSignature='',outcomeSignature='';
  function drawTrend(days){
    const signature=JSON.stringify(days);if(signature===trendSignature)return;trendSignature=signature;
    const host=$('trend-chart');host.replaceChildren();const hasData=days.some(d=>count(d.accepted)||count(d.completed)||count(d.blocked));$('trend-empty').hidden=hasData;host.hidden=!hasData;
    const svg=svgNode('svg',{viewBox:'0 0 720 220',role:'presentation','aria-hidden':'true'}),max=Math.max(1,...days.flatMap(d=>[count(d.accepted),count(d.completed)])),left=34,right=700,top=14,bottom=184;
    for(let i=0;i<4;i++){const y=bottom-(bottom-top)*i/3;svg.append(svgNode('line',{x1:left,y1:y,x2:right,y2:y,class:'chart-grid'}));svg.append(svgNode('text',{x:26,y:y+4,'text-anchor':'end',class:'chart-label'},String(Math.round(max*i/3))));}
    const x=i=>days.length===1?(left+right)/2:left+(right-left)*i/(days.length-1),y=v=>bottom-(bottom-top)*count(v)/max;
    for(const [key,cls]of [['accepted','chart-accepted'],['completed','chart-completed']]){const d=days.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v[key]).toFixed(1)).join(' ');svg.append(svgNode('path',{d,class:cls,pathLength:1}));for(let i=0;i<days.length;i++){const dot=svgNode('circle',{cx:x(i),cy:y(days[i][key]),r:3,class:cls+'-dot'});dot.append(svgNode('title',{},days[i].date+' · '+(key==='accepted'?'接收':'投递完成')+' '+count(days[i][key])));svg.append(dot);}}
    const indexes=[0,Math.floor((days.length-1)/2),days.length-1];for(const i of [...new Set(indexes)])if(days[i])svg.append(svgNode('text',{x:x(i),y:210,'text-anchor':i===0?'start':i===days.length-1?'end':'middle',class:'chart-label'},days[i].date.slice(5)));
    host.append(svg);host.setAttribute('aria-label','近 '+days.length+' 天任务趋势。完整数值见下方每日数据表。');
  }
  function drawOutcomes(total){
    const signature=JSON.stringify(total);if(signature===outcomeSignature)return;outcomeSignature=signature;
    const host=$('outcome-chart');host.replaceChildren();const rows=[['runCompleted','T3 已完成'],['runFailed','T3 失败'],['runCancelled','已取消'],['runInterrupted','已中断'],['runRolledBack','已回滚']];const sum=rows.reduce((a,[k])=>a+count(total[k]),0);
    if(!sum){const p=document.createElement('p');p.className='empty';p.textContent='尚无 T3 结束状态记录。';host.append(p);return;}
    for(const [key,label]of rows){const n=count(total[key]);if(!n)continue;const row=document.createElement('div');row.className='outcome-row';const caption=document.createElement('span');caption.textContent=label;const value=document.createElement('strong');value.textContent=formatCount(n);const bar=document.createElement('progress');bar.max=sum;bar.value=n;bar.setAttribute('aria-label',label+' '+n);row.append(caption,value,bar);host.append(row);}
  }
  async function loadStats(){
    if(!/^[0-9a-f]{64}$/.test(token))return;const sequence=++statsSequence;statsLoading=true;regionState('view-stats',statsReady?'refreshing':'initial');$('stats-refresh').disabled=true;busy('view-stats',true);busy('stats-refresh',true);
    for(const n of [7,30])$('range-'+n).setAttribute('aria-pressed',n===rangeDays?'true':'false');
    try{const data=await api('api/stats?days='+rangeDays);if(sequence!==statsSequence)return;if(data.version!==1||!Array.isArray(data.days))throw new Error('当前服务尚不支持统计，请更新插件并重新打开。');const validStart=typeof data.startedAt==='number'&&Number.isFinite(data.startedAt)&&data.startedAt>0&&data.startedAt<8.64e15-28800000;
      if(!validStart&&data.days.length&&data.coverageEstablished!==false)throw new Error('缺少可信的统计开始时间，暂不展示历史数据。');
      const today=new Date((Number.isFinite(data.asOf)?data.asOf:Date.now())+28800000).toISOString().slice(0,10);
      const startDay=validStart&&data.coverageEstablished!==false?new Date(data.startedAt+28800000).toISOString().slice(0,10):null;
      // The API zero-fills its requested range, including dates before telemetry existed.
      // Those dates are unknown, not recorded zeroes: exclude them from every display.
      const days=data.days.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&startDay&&d.date>=startDay&&d.date<=today).slice(-rangeDays);const total={};for(const d of days)for(const k of ['accepted','completed','blocked','latencyMs','latencyCount','runCompleted','runFailed','runCancelled','runInterrupted','runRolledBack'])total[k]=(total[k]||0)+count(d[k]);
      for(const [id,key]of [['stats-accepted','accepted'],['stats-delivered','completed'],['stats-blocked','blocked']])numberValue(id,days.length?count(total[key]):null,n=>Math.round(n).toLocaleString());numberValue('stats-latency',total.latencyCount?total.latencyMs/total.latencyCount:null,duration);
      $('stats-coverage').textContent=days.length?'近 '+rangeDays+' 天内实际覆盖：'+days[0].date+(days.length>1?' 至 '+days[days.length-1].date:'')+'（北京时间）'+(days.some(d=>d.date===startDay)?' · 起始日仅从 '+new Date(data.startedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 开始记录，部分覆盖':'')+(days.some(d=>d.date===today)?' · 今日尚未结束，部分覆盖':'')+' · 开始记录前无数据，不按 0 计':data.coverageEstablished===false?'尚未开始统计':'尚无已覆盖日期'+(startDay?' · 开始记录于 '+startDay+'（北京时间）':' · 统计开始时间未知');drawTrend(days);drawOutcomes(total);$('stats-table').replaceChildren();for(const d of days){const row=document.createElement('tr');for(const v of [d.date+(d.date===startDay||d.date===today?'（部分覆盖）':''),formatCount(d.accepted),formatCount(d.completed),formatCount(d.blocked)]){const cell=document.createElement('td');cell.textContent=v;row.append(cell);}$('stats-table').append(row);}$('stats-notice').textContent='';$('stats-notice').dataset.kind='';statsReady=true;displayedRange=rangeDays;regionState('view-stats','ready');
    }catch(e){if(sequence===statsSequence){regionState('view-stats',statsReady?'stale':'error');if(statsReady){rangeDays=displayedRange;for(const n of [7,30])$('range-'+n).setAttribute('aria-pressed',String(n===displayedRange));}$('stats-notice').textContent=e.message+(statsReady?' 当前保留上次成功读取的数据。':' 请重试。');$('stats-notice').dataset.kind='error';}}
    finally{if(sequence===statsSequence){statsLoading=false;$('stats-refresh').disabled=false;busy('view-stats',false);busy('stats-refresh',false);}}
  }
  $('stats-refresh').onclick=()=>loadStats();for(const n of [7,30])$('range-'+n).onclick=()=>{rangeDays=n;loadStats();};

  form.onsubmit=async e=>{
    e.preventDefault();if(saving)return;if(createReceipt){notice('请先完成或核对 T3 创建请求，再保存配置。');return;}if(step!==3){$('next').onclick();return;}
    const c={enabled:$('enabled').checked,appId:$('appId').value.trim(),appSecret:$('appSecret').value,serverName:$('serverName').value.trim(),bindings:readBindings()};
    try{validate(c);}catch(e){notice(e.message);return;}
    saving=true;fields.disabled=true;$('save').textContent='保存中…';notice('正在保存并应用配置…','');
    try{await api('api/config',c);hasSecret=hasSecret||!!c.appSecret;loadedAppId=c.appId;loadedServerName=c.serverName;$('appSecret').value='';$('appSecret').placeholder=hasSecret?'已保存，留空不变':'首次使用必填';dirty=false;$('dirty').textContent='已保存';notice(c.enabled?'配置已保存。请查看飞书连接，再发送一条私聊完成验证。':'配置已保存，桥接处于关闭状态。','success');showStep(3);showView('overview');await refresh().catch(()=>{});}
    catch(e){notice(e.message);}
    finally{saving=false;fields.disabled=false;$('save').textContent='保存并应用';}
  };
  if(!/^[0-9a-f]{64}$/.test(token)){notice('缺少有效控制密钥。请从 Magpie 插件页重新打开，不要直接访问此地址。');$('connection').textContent='未授权';$('refresh').disabled=true;return;}
  try{const c=await api('api/config');$('enabled').checked=c.enabled;$('appId').value=c.appId;loadedAppId=c.appId;$('serverName').value=c.serverName;loadedServerName=c.serverName;hasSecret=!!c.hasSecret;$('qr-replace-row').hidden=!hasSecret;$('appSecret').placeholder=hasSecret?'已保存，留空不变':'首次使用必填';for(const b of c.bindings)bindingRow(b);showStep(c.enabled?3:!c.appId&&!c.hasSecret&&!c.bindings.length?0:!c.serverName?0:!c.appId||!c.hasSecret?1:!c.bindings.length?2:3);fields.disabled=false;showView(c.enabled?'overview':'settings');await refresh().catch(()=>{});resumeQR();if(!loadedServerName)discoverMCP();}
  catch(e){notice(e.message);$('connection').textContent='配置读取失败';}
})();
