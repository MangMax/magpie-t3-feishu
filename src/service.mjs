import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Store,validateConfig } from './store.mjs';
import { Bridge } from './bridge.mjs';
import { T3Client } from './mcp.mjs';
import { FeishuChannel } from './channels/feishu.mjs';
export function authorized(header,token){const value=Buffer.from(String(header||''));const expected=Buffer.from('Bearer '+token);return value.length===expected.length&&timingSafeEqual(value,expected);}
export async function startService(input,options){
  const port=Number(options.port||18991),token=options.controlToken;
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return {status:()=>({running:false,error:'请打开插件页面，先生成本地控制密钥。'})};
  const base=process.env.MAGPIE_CONFIG_DIR||join(homedir(),'.config','magpie');
  const store=new Store(join(base,'t3-feishu-private'));
  let config=validateConfig(await store.read('config',{})),bridge=null,transition=Promise.resolve(),startupError=null;
  const status=()=>({...bridge?.status(),configured:!!config.appSecret,enabled:config.enabled,error:startupError||bridge?.error||null});
  async function restart(){
    if(bridge){await bridge.stop();bridge=null;}
    startupError=null;
    if(config.enabled){try{bridge=new Bridge({store,config,t3:new T3Client(process.env.MAGPIE_ADDR,config.serverName),channel:new FeishuChannel(config)});await bridge.start();}catch{startupError='启动失败：请核对飞书凭据、长连接订阅和 Magpie MCP 连接。';}}
  }
  const html=await readFile(new URL('../page/service.html',import.meta.url));
  const assets=new Map(await Promise.all(['ui.css','service.js'].map(async name=>['/'+name,await readFile(new URL('../page/'+name,import.meta.url))])));
  const server=createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403).end();return;}
    if(origin&&origin!=='null'&&origin!==`http://127.0.0.1:${port}`&&origin!==`http://localhost:${port}`){res.writeHead(403).end();return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST');res.writeHead(204).end();return;}
    let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400).end();return;}
    if(req.method==='GET'&&(path==='/'||path==='/index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' http://127.0.0.1:"+port+"; style-src 'self' http://127.0.0.1:"+port+"; connect-src 'self' http://127.0.0.1:"+port+"; base-uri 'none'; form-action 'none'");res.end(html);return;}
    if(req.method==='GET'&&assets.has(path)){res.setHeader('Content-Type',path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(assets.get(path));return;}
    if(!authorized(req.headers.authorization,token)){res.writeHead(401).end();return;}
    res.setHeader('Content-Type','application/json');
    try{
      if(path==='/api/config'&&req.method==='GET'){const {appSecret,...safe}=config;res.end(JSON.stringify({...safe,hasSecret:!!appSecret}));return;}
      if(path==='/api/status'&&req.method==='GET'){res.end(JSON.stringify(status()));return;}
      if(path==='/api/config'&&req.method==='POST'){
        if(!String(req.headers['content-type']).startsWith('application/json')){res.writeHead(415).end();return;}
        let body='';for await(const chunk of req){body+=chunk;if(body.length>32768){res.writeHead(413).end();return;}}
        const raw=JSON.parse(body);
        transition=transition.catch(()=>{}).then(async()=>{const next=validateConfig({...raw,appSecret:raw.appSecret||config.appSecret});await store.write('config',next);config=next;await restart();});
        await transition;res.end(JSON.stringify({ok:true}));return;
      }
      res.writeHead(404).end('{}');
    }catch{res.writeHead(400).end(JSON.stringify({error:'配置无效或保存失败。核对 open_id、线程及必填项；每个用户和线程只能绑定一次。'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  // Bound to plugin host lifetime. No detached process or second scheduler.
  transition=restart().catch(()=>{startupError='启动失败；请检查本地配置与状态文件。';});
  return {status,server};
}
