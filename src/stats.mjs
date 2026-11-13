// Aggregate-only telemetry. No message text, identity, thread or credentials.
const KEYS=['accepted','completed','blocked','replyParts','latencyMs','latencyCount','runCompleted','runFailed','runCancelled','runInterrupted','runRolledBack'];
const dayKey=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const empty=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
export function ensureStats(state,now=Date.now()){
  if(!state.stats)state.stats={version:1,startedAt:now,updatedAt:now,total:empty(),days:{}};
  return state.stats;
}
export function addStat(state,key,amount=1,now=Date.now()){
  if(!KEYS.includes(key)||!Number.isFinite(amount)||amount<0)return;
  const s=ensureStats(state,now),day=dayKey(now);
  s.total[key]=(s.total[key]||0)+amount;s.days[day]??=empty();s.days[day][key]+=amount;s.updatedAt=now;
  const cutoff=dayKey(now-89*86400000);
  for(const d of Object.keys(s.days))if(d<cutoff)delete s.days[d];
}
export function finishStats(state,job,now=Date.now()){
  if(job.statsVersion!==1||job.statsFinished||!['done','blocked'].includes(job.phase))return;
  job.statsFinished=true;addStat(state,job.phase==='done'?'completed':'blocked',1,now);
  if(job.phase==='done'){addStat(state,'latencyMs',Math.max(0,now-job.createdAt),now);addStat(state,'latencyCount',1,now);}
}
export function statsSummary(state,now=Date.now(),range=30){
  const coverageEstablished=!!state.stats;
  // Reading statistics must not invent a recording start for an inactive/legacy bridge.
  const s=state.stats||{startedAt:null,updatedAt:null,total:empty(),days:{}},days=[];range=Math.min(90,Math.max(1,Math.floor(Number(range)||30)));
  for(let i=range-1;i>=0;i--){const date=dayKey(now-i*86400000);days.push({date,...empty(),...s.days[date]});}
  const total={...empty(),...s.total};const inFlight=state.jobs.filter(j=>j.statsVersion===1&&!['done','blocked'].includes(j.phase)).length;
  return {version:1,coverageEstablished,asOf:now,startedAt:s.startedAt,updatedAt:s.updatedAt,timeZone:'Asia/Shanghai',retentionDays:90,rangeDays:range,total,rangeTotal:days.reduce((a,d)=>{for(const k of KEYS)a[k]+=d[k];return a;},empty()),days,inFlight,averageLatencyMs:total.latencyCount?Math.round(total.latencyMs/total.latencyCount):null};
}
