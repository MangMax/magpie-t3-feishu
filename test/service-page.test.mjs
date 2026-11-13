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
function setup({token='a'.repeat(64),fail=false}={}){
 const elements=new Map(),root=new Element(),listeners={},posts=[],calls=[];let saved;
 const parent={postMessage:m=>posts.push(m)};
 const config={enabled:false,appId:'',hasSecret:false,serverName:'t3',bindings:[]};
 const context=vm.createContext({parent,window:{},document:{documentElement:root,getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:tag=>{const e=new Element();e.tag=tag;return e;}},
 location:{hash:'#'+token,href:'http://127.0.0.1:19991/',pathname:'/',search:''},history:{replaceState:()=>{}},URL,AbortController,Date,setTimeout,clearTimeout,
 addEventListener:(name,fn)=>listeners[name]=fn,
 fetch:async(url,o)=>{calls.push({url:String(url),o});if(fail)throw Error('offline');if(o.method==='POST'){saved=JSON.parse(o.body);return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>url.pathname==='/api/config'?config:{enabled:false,running:false,channelConnection:{state:'reconnecting',reconnectAttempts:2},completed:2,pending:[]}};}});
 return {elements,root,listeners,posts,parent,calls,get saved(){return saved;},run:()=>vm.runInContext(code,context),get:id=>elements.get(id)};
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
 const s=setup();await s.run();assert.equal(s.get('channel').textContent,'重新连接中');s.get('appSecret').value='secret';s.get('serverName').value='t3-edited';await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.saved.serverName,'t3-edited');assert.equal(s.get('appSecret').value,'');assert.match(s.get('notice').textContent,/配置已保存/);
 s.get('serverName').value='unsaved';await s.get('refresh').onclick();assert.equal(s.get('serverName').value,'unsaved');
 s.get('add-binding').onclick();s.get('add-binding').onclick();for(const row of s.get('bindings').children){row.querySelectorAll('input')[0].value='ou_test';row.querySelectorAll('input')[1].value='thread';}
 const before=s.calls.length;await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.calls.length,before);assert.match(s.get('notice').textContent,/只能绑定一次/);
});
test('load failure is shown and does not enable form',async()=>{const s=setup({fail:true});await s.run();assert.equal(s.get('connection').textContent,'配置读取失败');assert.match(s.get('notice').textContent,/offline/);});

test('labels cover every backend phase and SDK connection state',()=>{
 for(const key of ['queued','waiting','reading','delivering','submitting','sending','blocked','done','idle','reconnecting','failed','connected','connecting','disconnected'])assert.match(code,new RegExp(key+":'[^']+'"));
 assert.doesNotMatch(code,/innerHTML|insertAdjacentHTML/);
});
