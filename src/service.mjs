import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Store,validateConfig } from './store.mjs';
import { Bridge } from './bridge.mjs';
import { T3Client } from './mcp.mjs';
import { FeishuChannel } from './channels/feishu.mjs';
import {FeishuOnboarding} from './onboarding.mjs';
import {discoverServers,serverName,listThreads,launchScratch} from './discovery.mjs';
import {statsSummary} from './stats.mjs';
export function authorized(header,token){const value=Buffer.from(String(header||''));const expected=Buffer.from('Bearer '+token);return value.length===expected.length&&timingSafeEqual(value,expected);}
export async function startService(input,options,dependencies={}){
  const port=Number(options.port||18991),token=options.controlToken;
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return {status:()=>({running:false,error:'请打开插件页面，先生成本地控制密钥。'})};
  const base=process.env.MAGPIE_CONFIG_DIR||join(homedir(),'.config','magpie');
  const libraryBase=process.env.MAGPIE_CONFIG_DIR||(typeof input.directory==='string'?input.directory:base);
  const store=dependencies.store||new Store(join(base,'t3-feishu-private'));
  let config=validateConfig(await store.read('config',{})),bridge=null,transition=Promise.resolve(),startupError=null;
  const status=()=>({...bridge?.status(),configured:!!config.appSecret,enabled:config.enabled,error:startupError||bridge?.error||null});
  async function restart(){
    if(bridge){await bridge.stop();bridge=null;}
    startupError=null;
    if(config.enabled){try{bridge=new Bridge({store,config,t3:new T3Client(process.env.MAGPIE_ADDR,config.serverName),channel:new FeishuChannel(config)});await bridge.start();}catch{startupError='启动失败：请核对飞书凭据、长连接订阅和 Magpie MCP 连接。';}}
  }
  const onboarding=new FeishuOnboarding({register:dependencies.registerApp,save:async (credentials,isCurrent,commit)=>{transition=transition.catch(()=>{}).then(async()=>{if(!isCurrent()||!commit())return;const next=validateConfig({...config,...credentials,enabled:false,bindings:[]});await store.write('config',next);config=next;try{await restart();}catch{startupError='配置已保存，但重启失败。请重启 Magpie 后检查状态。';}});await transition;}});
  async function withT3(name,fn){const client=new T3Client(process.env.MAGPIE_ADDR,serverName(name));try{return await fn(client);}finally{await client.close();}}
  async function bodyJSON(req){if(!String(req.headers['content-type']).startsWith('application/json'))throw new Error('JSON required');let body='';for await(const chunk of req){body+=chunk;if(body.length>32768)throw new Error('Body too large');}return JSON.parse(body);}
  const html=await readFile(new URL('../page/service.html',import.meta.url));
  const assets=new Map(await Promise.all(['ui.css','service.js'].map(async name=>['/'+name,await readFile(new URL('../page/'+name,import.meta.url))])));
  const server=createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403).end();return;}
    if(origin&&origin!=='null'&&origin!==`http://127.0.0.1:${port}`&&origin!==`http://localhost:${port}`){res.writeHead(403).end();return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST');res.writeHead(204).end();return;}
    let path,url;try{url=new URL(req.url,'http://localhost');path=url.pathname;}catch{res.writeHead(400).end();return;}
    if(req.method==='GET'&&(path==='/'||path==='/index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' http://127.0.0.1:"+port+"; style-src 'self' http://127.0.0.1:"+port+"; connect-src 'self' http://127.0.0.1:"+port+"; img-src 'self' blob:; base-uri 'none'; form-action 'none'");res.end(html);return;}
    if(req.method==='GET'&&assets.has(path)){res.setHeader('Content-Type',path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(assets.get(path));return;}
    if(!authorized(req.headers.authorization,token)){res.writeHead(401).end();return;}
    res.setHeader('Content-Type','application/json');
    try{
      if(path==='/api/stats'&&req.method==='GET'){const data=bridge?bridge.stats(url.searchParams.get('days')):statsSummary(await store.read('state',{jobs:[],seen:{}}),Date.now(),url.searchParams.get('days'));res.end(JSON.stringify(data));return;}
      if(path==='/api/mcp/servers'&&req.method==='GET'){try{res.end(JSON.stringify({servers:await discoverServers(libraryBase),source:'magpie-library'}));}catch{res.writeHead(503).end(JSON.stringify({error:'无法读取 Magpie 本机 MCP 名单，请手动填写已配置的服务名称。'}));}return;}
      if(path==='/api/t3/threads'&&req.method==='GET'){const data=await withT3(url.searchParams.get('serverName'),c=>listThreads(c,{cursor:Number(url.searchParams.get('cursor')||0),environmentId:url.searchParams.get('environmentId')||'',query:url.searchParams.get('query')||''}));res.end(JSON.stringify(data));return;}
      if(path==='/api/t3/create'&&req.method==='POST'){const raw=await bodyJSON(req);if(raw.confirmCreate!==true)throw new Error('Confirmation required');let result;transition=transition.catch(()=>{}).then(async()=>{result=await withT3(raw.serverName,c=>launchScratch(c,store,{...raw,serverName:serverName(raw.serverName)}));});await transition;res.end(JSON.stringify(result));return;}
      if(path==='/api/onboarding/feishu'&&req.method==='GET'){res.end(JSON.stringify(onboarding.status()));return;}
      if(path==='/api/onboarding/feishu/qr.svg'&&req.method==='GET'){res.setHeader('Content-Type','image/svg+xml');res.end(await onboarding.svg());return;}
      if(path==='/api/onboarding/feishu/start'&&req.method==='POST'){const raw=await bodyJSON(req);if(raw.confirmCreate!==true){res.writeHead(409).end(JSON.stringify({error:'请确认创建新应用；已有机器人将被替换并暂停桥接。'}));return;}res.end(JSON.stringify(onboarding.start()));return;}
      if(path==='/api/onboarding/feishu/apply'&&req.method==='POST'){const raw=await bodyJSON(req);if(raw.confirmReplace!==true)throw new Error('Confirmation required');res.end(JSON.stringify(await onboarding.apply()));return;}
      if(path==='/api/onboarding/feishu/cancel'&&req.method==='POST'){const cancelled=onboarding.cancel();res.end(JSON.stringify({ok:cancelled,...onboarding.status()}));return;}
      if(path==='/api/config'&&req.method==='GET'){const {appSecret,...safe}=config;res.end(JSON.stringify({...safe,hasSecret:!!appSecret}));return;}
      if(path==='/api/status'&&req.method==='GET'){res.end(JSON.stringify(status()));return;}
      if(path==='/api/config'&&req.method==='POST'){
        if(!String(req.headers['content-type']).startsWith('application/json')){res.writeHead(415).end();return;}
        let body='';for await(const chunk of req){body+=chunk;if(body.length>32768){res.writeHead(413).end();return;}}
        const raw=JSON.parse(body);if(!onboarding.cancel()){res.writeHead(409).end(JSON.stringify({code:'saving_in_progress',error:'正在保存扫码配置，请完成后再修改。'}));return;}
        transition=transition.catch(()=>{}).then(async()=>{if(String(raw.appId||'').trim()!==config.appId&&config.appSecret&&!raw.appSecret)throw new Error('New app requires matching secret');const next=validateConfig({...raw,appSecret:raw.appSecret||config.appSecret});await store.write('config',next);config=next;try{await restart();}catch{startupError='配置已保存，但重启失败。请重启 Magpie 后检查状态。';}});
        await transition;res.end(JSON.stringify({ok:true}));return;
      }
      res.writeHead(404).end('{}');
    }catch(e){const message=e?.code==='unsupported_create'?'此 T3 版本不支持安全幂等创建，请更新 T3 或选择已有会话。':path.startsWith('/api/t3/')?'T3 操作未完成，请检查 MCP 授权与版本。创建结果未知时请先刷新会话列表，不要重复创建。':path.startsWith('/api/onboarding/')?'扫码流程暂不可用，请重新发起或手动接入。':'配置无效或保存失败。核对 open_id、线程及必填项；每个用户和线程只能绑定一次。';res.writeHead(400).end(JSON.stringify({error:message,code:e?.code==='unsupported_create'?'unsupported_create':'request_failed'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  // Bound to plugin host lifetime. No detached process or second scheduler.
  transition=restart().catch(()=>{startupError='启动失败；请检查本地配置与状态文件。';});
  server.on('close',()=>onboarding.cancel());
  return {status,server};
}
