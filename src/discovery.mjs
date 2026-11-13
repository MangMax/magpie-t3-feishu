import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function serverName(value){if(typeof value!=='string'||!value.trim()||value.length>100||/[\x00-\x1f]/.test(value)||value.includes('://'))throw new Error('Invalid server name');return value.trim();}
export async function discoverServers(base){
  // Read Magpie's own library, never OAuth stores. Only names leave this process.
  const value=JSON.parse(await readFile(join(base,'library.json'),'utf8'));
  if(!Array.isArray(value.mcp))throw new Error('Unsupported Magpie library');
  return value.mcp.filter(s=>s&&typeof s.name==='string').map(s=>({name:serverName(s.name),transport:['stdio','http','sse'].includes(s.transport)?s.transport:'unknown',suggested:/t3/i.test(s.name)}));
}
export async function listThreads(client,{cursor=0,environmentId='',query=''}={}){
  if(!Number.isInteger(cursor)||cursor<0||typeof environmentId!=='string'||environmentId.length>256||typeof query!=='string'||query.length>256)throw new Error('Invalid list filter');
  const r=await client.call('t3_thread_list',{allProjects:true,limit:100,cursor,includeSubagents:false,...(environmentId?{environmentId}:{}),...(query.trim()?{titleContains:query.trim()}:{})});
  if(!Array.isArray(r.threads))throw new Error('Invalid thread list');
  return {threads:r.threads.filter(t=>typeof t.threadId==='string').map(t=>({threadId:t.threadId,title:String(t.title||'未命名会话'),projectId:String(t.projectId||''),status:String(t.status||''),environmentId})),nextCursor:Number.isInteger(r.nextCursor)?r.nextCursor:null,total:Number.isFinite(r.total)?r.total:r.threads.length};
}
export async function launchScratch(client,store,{requestId,title='飞书 IM',environmentId='',serverName:name}){
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof title!=='string'||!title.trim()||title.length>100||typeof environmentId!=='string'||environmentId.length>256)throw new Error('Invalid creation request');
  title=title.trim();const records=await store.read('launches',{}),key=JSON.stringify([name,requestId]);
  if(records[key]&&(records[key].environmentId!==environmentId||records[key].title!==title))throw new Error('Creation request changed');
  if(records[key]?.result)return records[key].result;
  const tools=await client.tools();const launch=tools.find(t=>t.name==='t3_thread_launch');
  const props=launch?.inputSchema?.properties;
  if(!props?.scratch||!props?.clientRequestId)throw Object.assign(new Error('Unsupported safe launch'),{code:'unsupported_create'});
  if(records[key]&&(records[key].environmentId!==environmentId||records[key].title!==title))throw new Error('Creation request changed');
  records[key]={environmentId,title,state:'pending'};await store.write('launches',records);
  const r=await client.call('t3_thread_launch',{scratch:true,title:title.trim(),clientRequestId:requestId,...(environmentId?{environmentId}:{})});
  if(typeof r.threadId!=='string'||!r.threadId)throw new Error('Creation receipt missing');
  const result={threadId:r.threadId,projectId:r.projectId||null,title:title.trim(),environmentId};records[key]={...records[key],state:'complete',result};await store.write('launches',records);return result;
}
