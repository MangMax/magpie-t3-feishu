import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function serverName(value){if(typeof value!=='string'||!value.trim()||value.length>100||/[\x00-\x1f]/.test(value)||value.includes('://'))throw new Error('Invalid server name');return value.trim();}
export function isT3RelayURL(value){
  if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\]/.test(value))return false;
  try{
    const u=new URL(value);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash
      && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+t3coderelay\.com$/.test(u.hostname)
      && (u.pathname==='/mcp'||u.pathname==='/mcp/');
  }catch{return false;}
}
export async function discoverServers(base){
  // Match configured URLs locally. Never return URLs, headers, accounts or OAuth data.
  const value=JSON.parse(await readFile(join(base,'library.json'),'utf8'));
  if(!Array.isArray(value.mcp))throw new Error('Unsupported Magpie library');
  const servers=[];
  for(const s of value.mcp){
    if(!s||s.hidden===true)continue;
    let name;try{name=serverName(s.name);}catch{continue;}
    const transport=['stdio','http','sse'].includes(s.transport)?s.transport:'unknown';
    const relayMatched=['http','sse'].includes(transport)&&isT3RelayURL(s.url);
    servers.push({name,transport,suggested:relayMatched||/t3/i.test(name),...(relayMatched?{relayMatched:true}:{})});
  }
  // Stable within each group; discovery never changes the user's saved selection.
  return servers.sort((a,b)=>(b.relayMatched?2:b.suggested?1:0)-(a.relayMatched?2:a.suggested?1:0));
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

const creationError=code=>Object.assign(new Error(code),{code});
async function allProjects(client,environmentId){
  const projects=[],seen=new Set();let cursor=0;
  for(let pages=0;pages<1000;pages++){
    const r=await client.call('t3_project_list',{limit:100,cursor,...(environmentId?{environmentId}:{})});
    if(!Array.isArray(r.projects))throw creationError('project_uncertain');
    for(const p of r.projects){if(typeof p.id!=='string'||typeof p.workspaceRoot!=='string')throw creationError('project_uncertain');if(!seen.has(p.id)){seen.add(p.id);projects.push(p);}}
    if(r.nextCursor===null)return projects;
    if(!Number.isInteger(r.nextCursor)||r.nextCursor<=cursor)throw creationError('project_uncertain');cursor=r.nextCursor;
  }
  throw creationError('project_uncertain');
}
export async function launchNamedProject(client,store,{requestId,title='飞书 IM',environmentId='',serverName:name}){
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof title!=='string'||!title.trim()||title.length>100||typeof environmentId!=='string'||environmentId.length>256)throw new Error('Invalid creation request');
  title=title.trim();const records=await store.read('named-projects',{}),key=JSON.stringify([name,requestId]);let record=records[key];
  if(record&&(record.environmentId!==environmentId||record.title!==title))throw new Error('Creation request changed');
  if(record?.result)return record.result;
  if(!record&&Object.entries(records).some(([k,r])=>k!==key&&r.serverName===name&&r.environmentId===environmentId&&r.title===title&&!r.result))throw creationError('project_pending');
  const tools=await client.tools(),has=(tool,fields)=>{const p=tools.find(t=>t.name===tool)?.inputSchema?.properties;return p&&fields.every(f=>Object.hasOwn(p,f));};
  if(!has('t3_project_create',['title'])||!has('t3_project_list',[])||!has('t3_project_read',['projectId'])||!has('t3_project_update',['projectId','projectIcon','title'])||!has('t3_thread_launch',['projectId','clientRequestId']))throw creationError('unsupported_project');
  const env=environmentId?{environmentId}:{},persist=async()=>{records[key]=record;await store.write('named-projects',records);};
  if(!record){
    const baseline=await allProjects(client,environmentId);
    // Unique, persisted provisional title permits read-only recovery; creation itself is never retried.
    const {createHash}=await import('node:crypto');const suffix=createHash('sha256').update(key).digest('hex').slice(0,16);
    record={serverName:name,environmentId,title,provisionalTitle:title+' · IM-'+suffix,baseline:baseline.map(p=>p.id),state:'creating'};await persist();
    let r;try{r=await client.call('t3_project_create',{title:record.provisionalTitle,...env});}catch{throw creationError('project_uncertain');}
    if(typeof r.id!=='string'||!r.id||typeof r.workspaceRoot!=='string'||!r.workspaceRoot)throw creationError('project_uncertain');
    record.projectId=r.id;record.workspaceRoot=r.workspaceRoot;record.state='project-created';record.commitWarning=!!r.commitError;await persist();
  }
  if(!record.projectId){
    const candidates=(await allProjects(client,environmentId)).filter(p=>p.title===record.provisionalTitle&&!record.baseline.includes(p.id));
    if(candidates.length!==1)throw creationError('project_uncertain');
    const p=candidates[0],verified=await client.call('t3_project_read',{projectId:p.id,...env});
    if(verified.id!==p.id||verified.title!==record.provisionalTitle||verified.workspaceRoot!==p.workspaceRoot)throw creationError('project_uncertain');
    record.projectId=p.id;record.workspaceRoot=p.workspaceRoot;record.state='project-created';await persist();
  }
  if(record.state==='project-created'){
    // This is a built-in blue character badge, not a fabricated filesystem favicon or the brand SVG.
    try{await client.call('t3_project_update',{projectId:record.projectId,title,projectIcon:{kind:'monogram',text:'飞',color:'blue'},...env});}catch{throw creationError('project_icon_pending');}
    const updated=await client.call('t3_project_read',{projectId:record.projectId,...env});
    if(updated.id!==record.projectId||updated.title!==title||updated.workspaceRoot!==record.workspaceRoot||updated.projectIcon?.kind!=='monogram'||updated.projectIcon?.text!=='飞'||updated.projectIcon?.color!=='blue')throw creationError('project_icon_pending');
    record.state='project-ready';await persist();
  }
  const r=await client.call('t3_thread_launch',{projectId:record.projectId,title,clientRequestId:requestId,...env});
  if(typeof r.threadId!=='string'||!r.threadId||r.projectId!==record.projectId)throw creationError('project_thread_pending');
  record.result={threadId:r.threadId,projectId:record.projectId,workspaceRoot:record.workspaceRoot,title,environmentId,icon:'blue-monogram',commitWarning:record.commitWarning===true};record.state='complete';await persist();return record.result;
}

export async function pendingNamedProjects(store,{serverName:name,environmentId='',title=''}){
  const records=await store.read('named-projects',{}),matches=[];
  for(const [key,r] of Object.entries(records)){if(r.result||r.serverName!==name||r.environmentId!==environmentId||r.title!==title)continue;let parts;try{parts=JSON.parse(key);}catch{continue;}if(parts[0]!==name||!Array.isArray(parts)||typeof parts[1]!=='string')continue;matches.push({requestId:parts[1],title:r.title,environmentId:r.environmentId,projectId:r.projectId||null,state:r.state});}
  return matches;
}
