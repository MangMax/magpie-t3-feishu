import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../page/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../page/app.js', import.meta.url), 'utf8');
function setup(magpie, timeout = false) {
  const button = {disabled:true, textContent:'准备中…'}, status = {textContent:''};
  const context = vm.createContext({magpie, document:{querySelector:s=>s==='#open'?button:status},
    location:{href:'http://127.0.0.1:3437/_magpie/plugin/test/page/index.html', replace:url=>context.destination=url},
    crypto:{getRandomValues:a=>a.fill(42)}, Uint8Array, URL,
    setTimeout:fn=>{ if(timeout)queueMicrotask(fn); return 1; }, clearTimeout:()=>{}});
  return {context, button, status, run:()=>vm.runInContext(app,context)};
}
test('static page loads official handshake bridge then external app under strict CSP',()=>{
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,2);
  assert.match(scripts[0][1], /src="_magpie\/bridge\.js"/);
  assert.match(scripts[1][1], /src="app\.js"/);
  assert.ok(scripts.every(s=>s[2].trim()===''), 'inline scripts are blocked by Magpie');
});
test('waits for handshake before options and enables token creation',async()=>{
  let ready, reads=0, saved;
  const s=setup({ready:new Promise(r=>ready=r),options:{get:async()=>{reads++;return {port:18991,other:'preserve'};},set:async o=>{saved=o;}}});
  const run=s.run(); assert.equal(reads,0); assert.equal(s.button.disabled,true);
  ready({});await run;assert.equal(reads,1);assert.equal(s.button.disabled,false);
  await s.button.onclick();assert.equal(saved.controlToken,'2a'.repeat(32));assert.equal(saved.other,'preserve');
  assert.match(s.status.textContent,/重新打开/);assert.equal(s.context.destination,undefined);
});
test('opens desktop local service with token only in fragment',async()=>{
  const s=setup({ready:Promise.resolve({}),service:'',options:{get:async()=>({port:18992,controlToken:'a'.repeat(64)})}});
  await s.run();await s.button.onclick();assert.equal(s.context.destination,'http://127.0.0.1:18992/#'+'a'.repeat(64));
});
test('uses remote service proxy supplied by Magpie',async()=>{
  const s=setup({ready:Promise.resolve({}),service:'http://127.0.0.1:3437/_magpie/plugin/test/_magpie/service/',options:{get:async()=>({controlToken:'a'.repeat(64)})}});
  await s.run();await s.button.onclick();assert.equal(s.context.destination,'http://127.0.0.1:3437/_magpie/plugin/test/_magpie/service/#'+'a'.repeat(64));
});
test('missing bridge, rejected options and stalled handshake render actionable failures',async()=>{
  for(const [bridge,timeout] of [[undefined,false],[{ready:Promise.resolve(),options:{get:async()=>{throw new Error('options denied');}}},false],[{ready:new Promise(()=>{})},true]]){
    const s=setup(bridge,timeout);await s.run();assert.equal(s.button.textContent,'初始化失败');assert.equal(s.button.disabled,true);assert.ok(s.status.textContent);
  }
});
test('rejects malformed control tokens and ports without navigation',async()=>{
  for (const opts of [{controlToken:'A'.repeat(64)},{controlToken:'short'},{controlToken:null},{controlToken:123},{port:'18991'},{port:'18991@evil.example'},{port:1023},{port:65536},{port:3.14}]) {
    const s=setup({ready:Promise.resolve(),options:{get:async()=>opts}});
    await s.run();assert.equal(s.button.textContent,'初始化失败');assert.equal(s.context.destination,undefined);
  }
});
test('refuses foreign origins, other plugin services, credentials and extra URL components',async()=>{
  for (const service of ['https://evil.example/_magpie/plugin/test/_magpie/service/','http://127.0.0.1:3437/_magpie/plugin/other/_magpie/service/','http://127.0.0.1:3437/anything','http://user:pass@127.0.0.1:3437/_magpie/plugin/test/_magpie/service/','_magpie/service/?redirect=evil','http://127.0.0.1:3437/_magpie/plugin/test/_magpie/service/#injected']) {
    const s=setup({ready:Promise.resolve(),service,options:{get:async()=>({controlToken:'a'.repeat(64)})}});
    await s.run();await s.button.onclick();assert.equal(s.context.destination,undefined);assert.match(s.status.textContent,/无法打开/);
  }
});
