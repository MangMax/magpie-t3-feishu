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
  let hasSecret=false, saving=false, refreshing=false, dirty=false;
  const requests=new Set();
  addEventListener('pagehide',()=>{for(const c of requests)c.abort();});
  function notice(message,kind='error') { $('notice').textContent=message; $('notice').dataset.kind=kind; }
  function edited() { dirty=true;$('dirty').textContent='有未保存的修改'; }
  form.addEventListener('input',edited);
  async function api(path,body) {
    const controller=new AbortController();requests.add(controller);
    const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const r=await fetch(new URL(path,location.href),{method:body?'POST':'GET',signal:controller.signal,
        headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      if(!r.ok) throw new Error(r.status===401?'控制密钥已失效，请从 Magpie 重新打开插件页。':r.status===400?'配置无效或保存失败，请核对必填项、用户和线程是否重复。':'请求失败（'+r.status+'），请检查插件是否启用。');
      return await r.json();
    } catch(e) { if(e.name==='AbortError')throw new Error(body?'保存超时，结果尚不确定。请重新打开页面核对已保存配置，不要重复提交。':'读取超时，请检查本地服务后重试。');throw e; }
    finally { clearTimeout(timer);requests.delete(controller); }
  }
  function bindingRow(b={}) {
    const row=document.createElement('div');row.className='binding';
    for(const [key,title,placeholder] of [['userId','飞书 open_id','ou_…'],['threadId','T3 线程 ID','现有线程 ID'],['environmentId','环境 ID（可选）','可留空']]) {
      const label=document.createElement('label');label.className='field';
      const caption=document.createElement('span');caption.className='field-title';caption.textContent=title;
      const input=document.createElement('input');input.name=key;input.value=b[key]||'';input.placeholder=placeholder;input.autocomplete='off';input.spellcheck=false;input.maxLength=256;
      label.append(caption,input);row.append(label);
    }
    const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.setAttribute('aria-label','移除此用户绑定');
    remove.onclick=()=>{row.remove();edited();$('add-binding').disabled=false;};row.append(remove);$('bindings').append(row);
    $('add-binding').disabled=$('bindings').children.length>=20;
    return row;
  }
  $('add-binding').onclick=()=>{if($('bindings').children.length>=20)return;const row=bindingRow();edited();row.querySelector('input').focus();};
  function readBindings(){return [...$('bindings').children].map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(i=>[i.name,i.value.trim()])));}
  function validate(c){
    if(c.bindings.some(b=>!/^ou_[a-zA-Z0-9]+$/.test(b.userId)||!b.threadId))throw new Error('每个用户都需要有效的 open_id（ou_ 开头）和 T3 线程 ID。');
    if(new Set(c.bindings.map(b=>b.userId)).size!==c.bindings.length)throw new Error('同一个用户只能绑定一次。');
    if(new Set(c.bindings.map(b=>b.environmentId+':'+b.threadId)).size!==c.bindings.length)throw new Error('每位用户需要独立的 T3 线程。');
    if(c.enabled&&(!/^cli_[0-9a-fA-F]{16}$/.test(c.appId)||!(c.appSecret||hasSecret)||!c.serverName||!c.bindings.length))throw new Error('启用前请填写有效的 App ID、App Secret、MCP 名称，并至少添加一位可信用户。');
  }
  const channelNames={idle:'未连接',reconnecting:'重新连接中',failed:'连接失败',connected:'已连接',connecting:'连接中',disconnected:'未连接',stopped:'已停止',unknown:'未知'};
  const phases={queued:'等待提交',waiting:'等待 T3',reading:'读取回复',delivering:'准备发送',accepted:'已接收',submitting:'提交中',submitted:'等待 T3',running:'执行中',ready:'待回复',sending:'发送中',uncertain:'需人工核对',blocked:'需人工处理',done:'已完成'};
  async function refresh(){
    if(refreshing)return;refreshing=true;$('refresh').disabled=true;
    try{
      const s=await api('api/status');$('status').textContent=JSON.stringify(s,null,2);
      const state=s.error?'需要关注':!s.enabled?'未启用':s.running?'运行中':'未运行';
      $('connection').textContent=state;$('connection').dataset.kind=s.error?'error':s.running?'success':'';
      const channel=typeof s.channelConnection==='string'?s.channelConnection:s.channelConnection?.state;
      $('channel').textContent=channelNames[channel]||channel||'—';
      const jobs=Array.isArray(s.pending)?s.pending:[];$('pending-count').textContent=String(jobs.length);$('completed').textContent=String(s.completed||0);
      $('status-error').textContent=s.error||'';$('jobs').replaceChildren();
      for(const job of jobs){const li=document.createElement('li');const label=document.createElement('strong');label.textContent=phases[job.phase]||job.phase;const detail=document.createElement('p');detail.className='hint';detail.textContent='线程 '+job.threadId+(job.reason?' · '+job.reason:'');li.append(label,detail);$('jobs').append(li);}
      $('empty').hidden=jobs.length>0;$('updated').textContent='更新于 '+new Date().toLocaleTimeString();
    }catch(e){$('connection').textContent='状态读取失败';$('connection').dataset.kind='error';$('status-error').textContent=e.message;throw e;}
    finally{refreshing=false;$('refresh').disabled=false;}
  }
  $('refresh').onclick=()=>refresh().catch(()=>{});
  form.onsubmit=async e=>{
    e.preventDefault();if(saving)return;
    const c={enabled:$('enabled').checked,appId:$('appId').value.trim(),appSecret:$('appSecret').value,serverName:$('serverName').value.trim(),bindings:readBindings()};
    try{validate(c);}catch(e){notice(e.message);return;}
    saving=true;fields.disabled=true;$('save').textContent='保存中…';notice('正在保存并应用配置…','');
    try{await api('api/config',c);hasSecret=hasSecret||!!c.appSecret;$('appSecret').value='';$('appSecret').placeholder=hasSecret?'已保存，留空不变':'首次使用必填';dirty=false;$('dirty').textContent='已保存';notice('配置已保存。请以运行状态确认连接是否成功。','success');await refresh().catch(()=>{});}
    catch(e){notice(e.message);}
    finally{saving=false;fields.disabled=false;$('save').textContent='保存并应用';}
  };
  if(!/^[0-9a-f]{64}$/.test(token)){notice('缺少有效控制密钥。请从 Magpie 插件页重新打开，不要直接访问此地址。');$('connection').textContent='未授权';$('refresh').disabled=true;return;}
  try{const c=await api('api/config');$('enabled').checked=c.enabled;$('appId').value=c.appId;$('serverName').value=c.serverName;hasSecret=!!c.hasSecret;$('appSecret').placeholder=hasSecret?'已保存，留空不变':'首次使用必填';for(const b of c.bindings)bindingRow(b);fields.disabled=false;await refresh().catch(()=>{});}
  catch(e){notice(e.message);$('connection').textContent='配置读取失败';}
})();
