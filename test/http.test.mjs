import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authorized,startService} from '../src/service.mjs';
import {proxyURL} from '../src/mcp.mjs';
import {normalizeEvent} from '../src/channels/feishu.mjs';
test('constant-time authentication handles Unicode without throwing',()=>{assert.equal(authorized('Bearer '+'é'.repeat(64),'a'.repeat(64)),false);assert.equal(authorized('Bearer '+'a'.repeat(64),'a'.repeat(64)),true);});
test('MCP proxy only accepts loopback, encodes names',()=>{assert.equal(proxyURL('localhost:1234','a/b').pathname,'/mcp/a%2Fb');assert.throws(()=>proxyURL('evil.example:1234','a'));assert.throws(()=>proxyURL('localhost:1@evil.example','a'));});
test('Feishu normalization excludes groups and bot events',()=>{const base={sender:{sender_type:'user',sender_id:{open_id:'ou_x'}},message:{chat_type:'p2p',message_type:'text',message_id:'m',chat_id:'c',create_time:'123',content:'{"text":"hello"}'}};assert.equal(normalizeEvent(base).text,'hello');assert.equal(normalizeEvent({...base,message:{...base.message,chat_type:'group'}}),null);assert.equal(normalizeEvent({...base,sender:{sender_type:'app'}}),null);});
test('local control API bearer, CORS, private config and bad target',async()=>{const dir=await mkdtemp(join(tmpdir(),'bridge-http-'));process.env.MAGPIE_CONFIG_DIR=dir;const port=19991,token='a'.repeat(64);const service=await startService({}, {port,controlToken:token});const call=(path,headers={},method='GET',body)=>new Promise((resolve,reject)=>{const r=request({host:'127.0.0.1',port,path,method,headers},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:data,headers:res.headers}));});r.on('error',reject);r.end(body);});try{
assert.equal((await call('/api/config')).status,401);
const page=await call('/');assert.match(page.headers['content-security-policy'],/script-src 'self'/);assert.doesNotMatch(page.headers['content-security-policy'],/unsafe-inline/);
for(const [path,mime] of [['/service.js','text/javascript'],['/ui.css','text/css'],['/feishu.svg','image/svg+xml']]){const a=await call(path);assert.equal(a.status,200);assert.ok(a.headers['content-type'].startsWith(mime));assert.equal(a.body.includes(token),false);}
const logo=await call('/feishu.svg');assert.match(logo.body,/<svg/);assert.equal(logo.headers['x-content-type-options'],'nosniff');
assert.equal((await call('/feishu.svg',{origin:'https://evil.example'})).status,403);
assert.equal((await call('/page/feishu.svg')).status,401);
assert.equal((await call('/service.js',{origin:'https://evil.example'})).status,403);
assert.equal((await call('/api/config',{authorization:'Bearer '+token,origin:'https://evil.example'})).status,403);
assert.equal((await call('/api/config',{authorization:'Bearer '+token,host:'evil.example'})).status,403);
assert.equal((await call('//[%')).status,400);
const auth={authorization:'Bearer '+token,origin:'null'};const config=await call('/api/config',auth);assert.equal(config.status,200);assert.equal('appSecret' in JSON.parse(config.body),false);assert.equal(config.headers['access-control-allow-origin'],'null');
const saved=await call('/api/config',{...auth,'content-type':'application/json'},'POST',JSON.stringify({enabled:false,appId:'test',appSecret:'DO_NOT_LEAK',serverName:'t3',bindings:[]}));assert.equal(saved.status,200);assert.equal((await call('/api/config',auth)).body.includes('DO_NOT_LEAK'),false);
const mismatch=await call('/api/config',{...auth,'content-type':'application/json'},'POST',JSON.stringify({enabled:false,appId:'changed',appSecret:'',serverName:'t3',bindings:[]}));assert.equal(mismatch.status,400);assert.equal(JSON.parse((await call('/api/config',auth)).body).appId,'test');
for(const path of ['/api/stats','/api/mcp/servers','/api/t3/threads','/api/onboarding/feishu','/api/onboarding/feishu/qr.svg'])assert.equal((await call(path)).status,401);
assert.equal((await call('/api/onboarding/feishu/start',{...auth,'content-type':'application/json'},'POST','{}')).status,409);
}finally{await new Promise(r=>service.server.close(r));await rm(dir,{recursive:true,force:true});delete process.env.MAGPIE_CONFIG_DIR;}});

test('manual configuration cannot interleave with committed QR application save',async()=>{
 const token='b'.repeat(64),port=19992;let release,entered;const saving=new Promise(r=>entered=r);let cfg={enabled:false,appId:'cli_1111111111111111',appSecret:'OLD',serverName:'t3',bindings:[]};
 const store={read:async(name,fallback)=>name==='config'?structuredClone(cfg):fallback,write:async(name,value)=>{if(name==='config'&&value.appId==='cli_2222222222222222'){entered();await new Promise(r=>release=r);}if(name==='config')cfg=structuredClone(value);}};
 const service=await startService({}, {port,controlToken:token},{store,registerApp:async()=>({client_id:'cli_2222222222222222',client_secret:'NEW'})});
 const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{await call('/api/onboarding/feishu/start',{confirmCreate:true});for(let i=0;i<10&&(await call('/api/onboarding/feishu')).body.state!=='authorized';i++)await new Promise(r=>setTimeout(r,1));const applying=call('/api/onboarding/feishu/apply',{confirmReplace:true});await saving;assert.equal((await call('/api/config',{...cfg,appSecret:''})).status,409);assert.equal((await call('/api/onboarding/feishu/cancel',{})).body.ok,false);release();await applying;assert.equal(cfg.appId,'cli_2222222222222222');assert.equal(cfg.appSecret,'NEW');assert.equal(cfg.enabled,false);}finally{release?.();await new Promise(r=>service.server.close(r));}
});
