import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export function proxyURL(addr,name) {
  const u=new URL('http://'+addr);
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash) throw new Error('MAGPIE_ADDR must be loopback host:port');
  u.pathname='/mcp/'+encodeURIComponent(name); return u;
}
export class T3Client {
  constructor(addr,name){this.url=proxyURL(addr,name);this.client=null;}
  async connect(){if(this.client)return; const client=new Client({name:'magpie-t3-feishu',version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(this.url));this.client=client;}
  async call(name,args){
    try{await this.connect();const r=await this.client.callTool({name,arguments:args},undefined,{timeout:40000});if(r.isError)throw new Error('T3 tool failed');
      const data=r.structuredContent??JSON.parse((r.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'));
      if(data?.error||data?._tag?.endsWith('Error'))throw new Error('T3 tool returned failure');return data;
    }catch(e){await this.close();throw new Error('T3 MCP unavailable or incompatible; check Magpie OAuth and tool version');}
  }
  async close(){const c=this.client;this.client=null;await c?.close().catch(()=>{});}
}
