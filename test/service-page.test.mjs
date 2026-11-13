import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../page/service.js',import.meta.url),'utf8');
class Element {
 constructor(){this.children=[];this.dataset={};this.style={setProperty:(k,v)=>this.style[k]=v};this.value='';this.textContent='';this.disabled=false;this.checked=false;}
 append(...children){for(const c of children){c.parent=this;this.children.push(c);}}
 replaceChildren(){this.children=[];}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,fn){this['on'+k]=fn;}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.tag===s?[c]:[]),...c.querySelectorAll(s)]);}
 querySelector(s){return this.querySelectorAll(s)[0];}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
 focus(){}
}
function setup({token='a'.repeat(64),fail=false,failSave=false,configOverride={},statusOverride={},routes={}}={}){
 const elements=new Map(),root=new Element(),listeners={},posts=[],calls=[];let saved;
 const parent={postMessage:m=>posts.push(m)};
 const config={enabled:false,appId:'',hasSecret:false,serverName:'t3',bindings:[],...configOverride};
 const context=vm.createContext({parent,window:{},document:{documentElement:root,getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:tag=>{const e=new Element();e.tag=tag;return e;},createElementNS:(_,tag)=>{const e=new Element();e.tag=tag;return e;}},
 location:{hash:'#'+token,href:'http://127.0.0.1:19991/',pathname:'/',search:''},history:{replaceState:()=>{}},URL,URLSearchParams,AbortController,Date,setTimeout,clearTimeout,
 addEventListener:(name,fn)=>listeners[name]=fn,
 fetch:async(url,o)=>{calls.push({url:String(url),o});if(routes[url.pathname])return {ok:true,json:async()=>typeof routes[url.pathname]==='function'?routes[url.pathname](url,o):routes[url.pathname]};if(fail)throw Error('offline');if(o.method==='POST'){if(failSave)throw Error('save offline');saved=JSON.parse(o.body);return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>url.pathname==='/api/config'?config:{enabled:false,running:false,channelConnection:{state:'reconnecting',reconnectAttempts:2},completed:2,pending:[],...statusOverride}};}});
 return {elements,root,listeners,posts,parent,calls,get saved(){return saved;},run:()=>vm.runInContext(code,context),get:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
}
test('service page uses only external assets and official token styles',async()=>{
 const html=await readFile(new URL('../page/service.html',import.meta.url),'utf8');
 assert.match(html,/src="service.js"/);assert.doesNotMatch(html,/<script>\s*\S/);assert.doesNotMatch(html,/style="/);
 const css=await readFile(new URL('../page/ui.css',import.meta.url),'utf8');assert.match(css,/--magpie-bg/);assert.match(css,/--magpie-accent-fg/);assert.match(css,/@media\(max-width:600px\)/);
});
test('service themes accept only parent and known tokens, including live changes',async()=>{
 const s=setup();await s.run();assert.equal(s.posts[0].method,'hello');assert.equal(JSON.stringify(s.posts).includes('a'.repeat(64)),false);
 const result={dark:true,tokens:{bg:'#111',font:'system-ui',evil:'bad'}};
 s.listeners.message({source:{},data:{magpie:1,id:s.posts[0].id,result}});assert.equal(s.root.dataset.theme,undefined);
 s.listeners.message({source:s.parent,data:{magpie:1,id:s.posts[0].id,result}});assert.equal(s.root.dataset.theme,'dark');assert.equal(s.root.style['--magpie-bg'],'#111');assert.equal(s.root.style['--magpie-evil'],undefined);
 s.listeners.message({source:s.parent,data:{magpie:1,event:'theme',data:{dark:false,tokens:{bg:'#fff'}}}});assert.equal(s.root.dataset.theme,'light');assert.equal(s.root.style['--magpie-bg'],'#fff');
});
test('missing token does not request config or enable form',async()=>{const s=setup({token:''});await s.run();assert.equal(s.calls.length,0);assert.match(s.get('notice').textContent,/密钥/);});
test('save clears secret, refresh preserves edits, duplicate binding validation blocks write',async()=>{
 const s=setup();await s.run();assert.equal(s.get('channel').textContent,'重新连接中');s.get('step-tab-3').onclick();s.get('appSecret').value='secret';s.get('serverName').value='t3-edited';await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.saved.serverName,'t3-edited');assert.equal(s.get('appSecret').value,'');assert.match(s.get('notice').textContent,/配置已保存/);
 s.get('serverName').value='unsaved';await s.get('refresh').onclick();assert.equal(s.get('serverName').value,'unsaved');
 s.get('add-binding').onclick();s.get('add-binding').onclick();for(const row of s.get('bindings').children){row.querySelectorAll('input')[0].value='ou_test';row.querySelectorAll('input')[1].value='thread';}
 const before=s.calls.length;await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.calls.length,before);assert.match(s.get('notice').textContent,/只能绑定一次/);
});
test('load failure is shown and does not enable form',async()=>{const s=setup({fail:true});await s.run();assert.equal(s.get('connection').textContent,'配置读取失败');assert.match(s.get('notice').textContent,/offline/);});

test('labels cover every backend phase and SDK connection state',()=>{
 for(const key of ['queued','waiting','reading','delivering','submitting','sending','blocked','done','idle','reconnecting','failed','connected','connecting','disconnected'])assert.match(code,new RegExp(key+":'[^']+'"));
 assert.doesNotMatch(code,/innerHTML|insertAdjacentHTML/);
});

test('wizard validates locally, preserves entries and only final step can save',async()=>{
 const s=setup();await s.run();assert.equal(s.get('step-0').hidden,false);assert.equal(s.get('runtime').hidden,true);
 s.get('serverName').value='https://connect.example';s.get('next').onclick();assert.match(s.get('notice').textContent,/不要填写/);assert.equal(s.get('step-0').hidden,false);
 s.get('serverName').value='t3';await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.get('step-1').hidden,false);assert.equal(s.saved,undefined);
 s.get('next').onclick();assert.match(s.get('notice').textContent,/App ID/);assert.equal(s.get('step-1').hidden,false);
 s.get('appId').value='cli_0123456789abcdef';s.get('appSecret').value='secret';s.get('next').onclick();assert.equal(s.get('step-2').hidden,false);
 s.get('next').onclick();assert.match(s.get('notice').textContent,/先添加/);
 s.get('add-binding').onclick();const inputs=s.get('bindings').children[0].querySelectorAll('input');inputs[0].value='ou_self';inputs[1].value='thread-1';s.get('next').onclick();assert.equal(s.get('step-3').hidden,false);assert.equal(s.get('runtime').hidden,false);
 s.get('previous').onclick();assert.equal(inputs[1].value,'thread-1');s.get('next').onclick();s.get('enabled').checked=true;await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.saved.enabled,true);assert.equal(s.get('appSecret').value,'');
});
test('configured enabled bridge opens usage view without claiming T3 connection',async()=>{
 const s=setup({configOverride:{enabled:true,appId:'cli_0123456789abcdef',hasSecret:true,bindings:[{userId:'ou_self',threadId:'t',environmentId:''}]}});await s.run();assert.equal(s.get('step-3').hidden,false);assert.equal(s.get('next').hidden,true);
 const html=await readFile(new URL('../page/service.html',import.meta.url),'utf8');assert.match(html,/不代表 T3 已验证/);assert.match(html,/t3_thread_list/);assert.match(html,/user_id_type=open_id/);assert.doesNotMatch(html,/累计完成|测试连接<\/button>/);
});

test('failed save retains input and final step without enabling bridge',async()=>{
 const s=setup({failSave:true});await s.run();s.get('step-tab-3').onclick();s.get('appSecret').value='not-lost';s.get('serverName').value='my-t3';await s.get('form').onsubmit({preventDefault(){}});
 assert.equal(s.saved,undefined);assert.equal(s.get('appSecret').value,'not-lost');assert.equal(s.get('serverName').value,'my-t3');assert.equal(s.get('fields').disabled,false);assert.equal(s.get('step-3').hidden,false);assert.match(s.get('notice').textContent,/save offline/);
});

test('sandboxed page exposes copyable reference URLs without blocked popup links',async()=>{
 const html=await readFile(new URL('../page/service.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/target="_blank"|<a /);
 for(const url of ['https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md','https://open.feishu.cn/app','https://open.feishu.cn/document/server-docs/contact-v3/user/batch_get_id'])assert.ok(html.includes('readonly value="'+url+'"'));
 assert.equal((html.match(/在浏览器中打开/g)||[]).length,3);
});

test('jumping directly to final step cannot bypass MCP URL validation',async()=>{
 const s=setup();await s.run();s.get('step-tab-3').onclick();s.get('serverName').value='https://connect.example/mcp';s.get('appId').value='cli_0123456789abcdef';s.get('appSecret').value='secret';s.get('enabled').checked=true;
 s.get('add-binding').onclick();const inputs=s.get('bindings').children[0].querySelectorAll('input');inputs[0].value='ou_self';inputs[1].value='thread-1';
 const before=s.calls.length;await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.calls.length,before);assert.equal(s.saved,undefined);assert.match(s.get('notice').textContent,/不要填写 Connect/);
});

test('changing app requires matching replacement secret before saving',async()=>{
 const s=setup({configOverride:{appId:'cli_0123456789abcdef',hasSecret:true}});await s.run();s.get('step-tab-3').onclick();s.get('appId').value='cli_1111111111111111';const before=s.calls.length;await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.calls.length,before);assert.match(s.get('notice').textContent,/更换 App ID/);
});

test('message diagnostics identify subscription, allowlist and T3 stages',async()=>{
 for(const [diagnostics,expected] of [
  [{channel:{events:0}},/事件订阅/],
  [{channel:{events:1,normalized:1},unbound:1,lastDecision:'unbound'},/未获授权/],
  [{channel:{events:1,normalized:0,filtered:1,filterReasons:{not_text:1}}},/不符合私聊文字/],
  [{channel:{events:1,normalized:1},accepted:1,lastDecision:'accepted',t3:{operation:'send',outcome:'error'}},/T3 调用失败/],
  [{channel:{events:1,normalized:1},accepted:1,lastDecision:'accepted',t3:{operation:'wait',outcome:'pending'}},/已通过白名单/]
 ]){const s=setup({statusOverride:{enabled:true,running:true,diagnostics}});await s.run();assert.match(s.get('diag-next').textContent,expected);}
});
test('diagnostic surface excludes payloads, IDs, tokens and unknown fields',async()=>{
 const secret='PRIVATE-MARKER';const s=setup({statusOverride:{enabled:true,running:true,error:secret,pending:[{id:secret,threadId:secret,phase:'blocked',reason:secret}],diagnostics:{accepted:1,lastDecision:secret,token:secret,message:secret,t3:{operation:secret,outcome:secret},channel:{events:1,normalized:1,filterReasons:{[secret]:10},lastEventAt:secret}}}});await s.run();
 for(const id of ['status','status-error','diag-next','diag-decision','diag-time','diag-t3'])assert.ok(!s.get(id).textContent.includes(secret));
 const texts=e=>[e.textContent,...e.children.flatMap(texts)].join(' ');assert.ok(!texts(s.get('jobs')).includes(secret));assert.ok(!texts(s.get('diag-filters')).includes(secret));assert.equal(s.get('diag-t3').textContent,'尚未调用');
});

test('received T3 response is not presented as validated operation success',async()=>{
 const s=setup({statusOverride:{enabled:true,running:true,diagnostics:{channel:{events:1,normalized:1},accepted:1,lastDecision:'accepted',t3:{operation:'send',outcome:'success'}}}});await s.run();assert.equal(s.get('diag-t3').textContent,'提交消息 · 收到响应');assert.doesNotMatch(s.get('diag-t3').textContent,/成功/);
 const html=await readFile(new URL('../page/service.html',import.meta.url),'utf8');assert.match(html,/不代表任务执行或回复投递成功/);
});

test('product navigation preserves edits and graphs only actual aggregate data',async()=>{
 const s=setup({routes:{'/api/stats':{version:1,startedAt:Date.now(),retentionDays:90,timeZone:'Asia/Shanghai',days:[{date:'2026-11-13',accepted:3,completed:2,blocked:1,latencyCount:2,latencyMs:10000,runCompleted:1,runFailed:1}]}}});await s.run();s.get('serverName').value='unsaved';s.get('nav-stats').onclick();await new Promise(setImmediate);
 assert.equal(s.get('view-stats').hidden,false);assert.equal(s.get('view-settings').hidden,true);assert.equal(s.get('stats-accepted').textContent,'3');assert.equal(s.get('stats-delivered').textContent,'2');assert.equal(s.get('stats-latency').textContent,'5.0 秒');assert.equal(s.get('trend-chart').children[0].tag,'svg');assert.equal(s.get('stats-table').children.length,1);s.get('nav-settings').onclick();assert.equal(s.get('serverName').value,'unsaved');
});
test('empty statistics remain explicit and unknown counters are never rendered',async()=>{
 const s=setup({routes:{'/api/stats':{version:1,startedAt:Date.now(),retentionDays:90,days:[]}}});await s.run();s.get('nav-stats').onclick();await new Promise(setImmediate);assert.equal(s.get('trend-empty').hidden,false);assert.equal(s.get('stats-accepted').textContent,'0');assert.equal(s.get('stats-latency').textContent,'—');assert.match(s.get('outcome-chart').children[0].textContent,/尚无/);
});
test('MCP discovery selects only safe server name without mutating saved config',async()=>{
 const s=setup({routes:{'/api/mcp/servers':{servers:[{name:'t3-connected',suggested:true,token:'DO-NOT-SHOW'}]}}});await s.run();await s.get('discover-mcp').onclick();s.get('mcp-results').children[0].onclick();assert.equal(s.get('serverName').value,'t3-connected');assert.equal(s.saved,undefined);assert.ok(!s.get('mcp-results').children[0].children.some(c=>c.textContent.includes('DO-NOT-SHOW')));
});
test('thread discovery fills selected binding without submitting a task',async()=>{
 const s=setup({routes:{'/api/t3/threads':{threads:[{threadId:'thread-found',title:'专用任务',environmentId:'remote'}],nextCursor:null}}});await s.run();s.get('add-binding').onclick();const row=s.get('bindings').children[0];row.children.find(c=>c.className==='thread-choose').onclick();await new Promise(setImmediate);s.get('thread-results').children[0].onclick();assert.equal(row.querySelectorAll('input')[1].value,'thread-found');assert.equal(row.querySelectorAll('input')[2].value,'remote');assert.equal(s.saved,undefined);assert.ok(s.calls.every(c=>c.o.method==='GET'));
});
test('new scratch creation requires explicit confirmation and retains stable retry identity',async()=>{
 let tries=0;const payloads=[];const s=setup({routes:{'/api/t3/threads':{threads:[],nextCursor:null},'/api/t3/create':(url,o)=>{payloads.push(JSON.parse(o.body));if(!tries++)throw new Error('unknown outcome');return {threadId:'scratch-new',environmentId:''};}}});await s.run();s.get('add-binding').onclick();const row=s.get('bindings').children[0];row.children.find(c=>c.className==='thread-choose').onclick();await new Promise(setImmediate);s.get('thread-title').value='飞书 IM';await s.get('thread-create').onclick();assert.equal(payloads.length,0);s.get('thread-create-confirm').checked=true;await s.get('thread-create').onclick();assert.match(s.get('thread-notice').textContent,/同一创建请求/);await s.get('thread-create').onclick();assert.equal(payloads[0].requestId,payloads[1].requestId);assert.equal(row.querySelectorAll('input')[1].value,'scratch-new');assert.equal(s.saved,undefined);
});
test('QR app creation cannot start without explicit creation and replacement consent',async()=>{
 const s=setup({configOverride:{hasSecret:true,appId:'cli_0123456789abcdef'}});await s.run();let before=s.calls.length;await s.get('qr-start').onclick();assert.equal(s.calls.length,before);assert.match(s.get('qr-notice').textContent,/先确认/);s.get('qr-confirm').checked=true;await s.get('qr-apply').onclick();assert.equal(s.calls.length,before);assert.match(s.get('qr-notice').textContent,/替换前/);
});
test('QR completion fills app and identity but never enables bridge or exposes secret',async()=>{
 const config={appId:'cli_0123456789abcdef',hasSecret:true,enabled:false,bindings:[],serverName:'t3'};
 const s=setup({routes:{'/api/onboarding/feishu/start':{state:'waiting'},'/api/onboarding/feishu':{state:'complete',appId:config.appId,openId:'ou_new'},'/api/config':config}});await s.run();s.get('qr-confirm').checked=true;s.get('qr-replace').checked=true;await s.get('qr-start').onclick();await new Promise(setImmediate);assert.equal(s.get('enabled').checked,false);assert.equal(s.get('appSecret').value,'');assert.equal(s.get('bindings').children[0].querySelectorAll('input')[0].value,'ou_new');assert.equal(s.get('step-2').hidden,false);s.listeners.pagehide();
});

test('QR authorized state waits for local apply and does not replace existing config',async()=>{
 const s=setup({routes:{'/api/onboarding/feishu/start':{state:'waiting'},'/api/onboarding/feishu':{state:'authorized',appId:'cli_0123456789abcdef',openId:'ou_new'}}});await s.run();s.get('qr-confirm').checked=true;await s.get('qr-start').onclick();await new Promise(setImmediate);assert.equal(s.get('qr-apply').hidden,false);assert.match(s.get('qr-notice').textContent,/尚未改动/);assert.equal(s.get('appId').value,'');assert.equal(s.get('bindings').children.length,0);assert.ok(s.calls.every(c=>!c.url.includes('/apply')));s.listeners.pagehide();
});

test('in-flight scratch result cannot move into another binding',async()=>{
 let resolve;const s=setup({routes:{'/api/t3/threads':{threads:[],nextCursor:null},'/api/t3/create':()=>new Promise(r=>{resolve=r;})}});await s.run();s.get('add-binding').onclick();s.get('add-binding').onclick();const [first,second]=s.get('bindings').children;first.children.find(c=>c.className==='thread-choose').onclick();await new Promise(setImmediate);s.get('thread-title').value='飞书 IM';s.get('thread-create-confirm').checked=true;const pending=s.get('thread-create').onclick();await new Promise(setImmediate);s.get('thread-close').onclick();assert.equal(s.get('thread-picker').hidden,false);second.children.find(c=>c.className==='thread-choose').onclick();resolve({threadId:'created-only-for-first',environmentId:''});await pending;assert.equal(first.querySelectorAll('input')[1].value,'created-only-for-first');assert.equal(second.querySelectorAll('input')[1].value,'');
});
test('uncertain scratch retry rejects changing the original target',async()=>{
 let writes=0;const s=setup({routes:{'/api/t3/threads':{threads:[],nextCursor:null},'/api/t3/create':()=>{writes++;throw new Error('unknown');}}});await s.run();s.get('add-binding').onclick();const row=s.get('bindings').children[0];row.children.find(c=>c.className==='thread-choose').onclick();await new Promise(setImmediate);s.get('thread-title').value='飞书 IM';s.get('thread-create-confirm').checked=true;await s.get('thread-create').onclick();s.get('serverName').value='different';await s.get('thread-create').onclick();assert.equal(writes,1);assert.match(s.get('thread-notice').textContent,/目标已变化/);
});

test('pending creation blocks robot replacement and missing original row cannot report success',async()=>{
 let resolve;const s=setup({routes:{'/api/t3/threads':{threads:[],nextCursor:null},'/api/t3/create':()=>new Promise(r=>{resolve=r;})}});await s.run();s.get('add-binding').onclick();const row=s.get('bindings').children[0];row.children.find(c=>c.className==='thread-choose').onclick();await new Promise(setImmediate);s.get('thread-title').value='飞书 IM';s.get('thread-create-confirm').checked=true;const pending=s.get('thread-create').onclick();await new Promise(setImmediate);await s.get('qr-apply').onclick();assert.match(s.get('qr-notice').textContent,/创建请求/);assert.ok(s.calls.every(c=>!c.url.includes('/feishu/apply')));row.remove();resolve({threadId:'created-in-t3',environmentId:''});await pending;assert.match(s.get('thread-notice').textContent,/原绑定已移除/);assert.doesNotMatch(s.get('notice').textContent,/已创建并填入/);
});
test('new binding prioritizes workspace creation without listing or creating automatically',async()=>{
 const s=setup();await s.run();s.get('add-binding').onclick();const row=s.get('bindings').children[0];
 const primary=row.children.find(c=>c.className==='workspace-create primary');assert.ok(primary);primary.onclick();
 assert.equal(s.get('thread-new').hidden,false);assert.equal(s.get('thread-existing').hidden,true);
 assert.ok(s.calls.every(c=>!c.url.includes('/api/t3/')));assert.match(s.get('thread-picker-title').textContent,/创建/);
 assert.equal(row.querySelectorAll('input')[1].value,'');assert.equal(s.saved,undefined);
});
test('existing bindings stay unchanged and choose existing remains read-only',async()=>{
 const s=setup({configOverride:{bindings:[{userId:'ou_self',threadId:'old-thread',environmentId:'remote'}]},routes:{'/api/t3/threads':{threads:[],nextCursor:null}}});await s.run();
 const row=s.get('bindings').children[0];assert.equal(row.querySelectorAll('input')[1].value,'old-thread');
 assert.ok(s.calls.every(c=>!c.url.includes('/api/t3/')));row.children.find(c=>c.className==='thread-choose').onclick();await new Promise(setImmediate);
 assert.equal(s.get('thread-existing').hidden,false);assert.equal(s.get('thread-new').hidden,true);assert.equal(row.querySelectorAll('input')[1].value,'old-thread');
 assert.ok(s.calls.every(c=>c.o.method==='GET'));
});
test('workspace creation is visible and status is outside the optional existing-thread pane',async()=>{
 const html=await readFile(new URL('../page/service.html',import.meta.url),'utf8');
 assert.match(html,/<section id="thread-new"/);assert.doesNotMatch(html,/<details[^>]*>\s*<summary>新建飞书/);
 assert.ok(html.indexOf('id="thread-notice"')>html.indexOf('id="thread-results"'));
 assert.match(html,/不承诺自动清理或永久保留/);assert.doesNotMatch(html,/临时工作区/);
});
