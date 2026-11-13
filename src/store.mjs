import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
export class Store {
  constructor(dir) { this.dir=dir; this.queue=Promise.resolve(); }
  async read(name, fallback) { try { return JSON.parse(await readFile(join(this.dir,name+'.json'),'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw new Error('Local state unreadable; stopped to avoid duplicate delivery'); } }
  write(name,value) {
    const data=JSON.stringify(value,null,2);
    this.queue=this.queue.catch(()=>{}).then(async()=>{await mkdir(this.dir,{recursive:true,mode:0o700}); await chmod(this.dir,0o700); const p=join(this.dir,name+'.json'); await writeFile(p+'.tmp',data,{mode:0o600}); await chmod(p+'.tmp',0o600); await rename(p+'.tmp',p);});
    return this.queue;
  }
}
export function validateConfig(raw) {
  if(!raw || typeof raw!=='object') throw new Error('Invalid config');
  const c={enabled:raw.enabled===true,appId:String(raw.appId||'').trim(),appSecret:String(raw.appSecret||''),serverName:String(raw.serverName||'').trim(),bindings:Array.isArray(raw.bindings)?raw.bindings:[]};
  c.bindings=c.bindings.map(b=>({userId:String(b.userId||'').trim(),threadId:String(b.threadId||'').trim(),environmentId:String(b.environmentId||'').trim()}));
  if(c.bindings.length>20 || c.bindings.some(b=>!/^ou_[a-zA-Z0-9]+$/.test(b.userId)||!b.threadId||b.threadId.length>256)) throw new Error('Each binding needs an open_id (ou_…) and thread ID');
  if(new Set(c.bindings.map(b=>b.userId)).size!==c.bindings.length) throw new Error('Duplicate user bindings');
  if(new Set(c.bindings.map(b=>(b.environmentId||'')+':'+b.threadId)).size!==c.bindings.length) throw new Error('Use a separate T3 thread per IM user');
  if(c.serverName.length>100 || /[\x00-\x1f]/.test(c.serverName)) throw new Error('Invalid MCP server name');
  if(c.enabled&&(!/^cli_[0-9a-fA-F]{16}$/.test(c.appId)||!c.appSecret||!c.serverName||!c.bindings.length)) throw new Error('App ID, secret, MCP server and allowlisted binding required');
  return c;
}
