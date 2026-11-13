import { createHash } from 'node:crypto';
export const requestId=id=>'magpie-feishu-'+createHash('sha256').update(id).digest('hex');
export function chunks(text,size=3000){const points=Array.from(text);return Array.from({length:Math.ceil(points.length/size)},(_,i)=>points.slice(i*size,(i+1)*size).join(''));}
export class Bridge {
  constructor({store,t3,channel,config,clock=Date.now}){Object.assign(this,{store,t3,channel,config,clock});this.running=false;this.busy=false;this.state={jobs:[],seen:{}};this.error=null;}
  async start(){this.state=await this.store.read('state',{jobs:[],seen:{}});this.running=true;await this.channel.start(m=>this.accept(m));this.timer=setInterval(()=>this.tick().catch(()=>{}),3000);this.timer.unref?.();void this.tick().catch(()=>{});}
  async save(){try{await this.store.write('state',this.state);}catch{this.running=false;this.error='本地状态保存失败；已停止桥接，避免重复执行。';throw new Error('State persistence failed');}}
  async accept(m){
    const binding=this.config.bindings.find(b=>b.userId===m.userId);
    if(!binding||!this.running||!m.id||!m.chatId||m.text.length>16000)return;
    // Replayed events older than 24h cannot start a new turn after dedupe pruning.
    if(!Number.isFinite(m.createdAt)||Math.abs(this.clock()-m.createdAt)>86400000)return;
    if(this.state.seen[m.id])return;
    this.state.seen[m.id]=this.clock();
    this.state.jobs.push({id:m.id,chatId:m.chatId,userId:m.userId,threadId:binding.threadId,environmentId:binding.environmentId,message:m.text,botId:this.config.appId,serverName:this.config.serverName,phase:'queued',createdAt:this.clock()});
    await this.save();
  }
  async tick(){
    if(this.busy||!this.running)return;this.busy=true;
    try{
      // One in-flight turn per thread. Other chats may proceed while a run waits.
      const held=new Set();
      for(const job of this.state.jobs){
        if(['done','blocked'].includes(job.phase))continue;
        const key=job.environmentId+':'+job.threadId;if(held.has(key))continue;
        if(job.botId!==this.config.appId||job.serverName!==this.config.serverName)continue;
        if(!this.config.bindings.some(b=>b.userId===job.userId&&b.threadId===job.threadId&&b.environmentId===job.environmentId))continue;
        held.add(key);
        try{await this.advance(job);this.error=null;}catch{if(this.running)this.error='连接暂不可用；保留原请求，稍后重连。';}
        if(!this.running)break;
      }
      const now=this.clock();for(const [id,at] of Object.entries(this.state.seen))if(now-at>2*86400000)delete this.state.seen[id];
      this.state.jobs=this.state.jobs.filter(j=>j.phase!=='done'||now-j.createdAt<2*86400000);
      await this.save();
    }finally{this.busy=false;}
  }
  args(j,extra={}){return {threadId:j.threadId,...(j.environmentId?{environmentId:j.environmentId}:{}),...extra};}
  async advance(j){
    if(j.phase==='queued'||j.phase==='submitting'){
      if(j.phase==='queued'){const baseline=await this.t3.call('t3_thread_read',this.args(j,{view:'messages',limit:1}));if(!Array.isArray(baseline.items))throw new Error('Unexpected baseline');j.cursor=Math.max(-1,...baseline.items.map(i=>i.position).filter(Number.isInteger));}
      j.phase='submitting';await this.save();
      // The same ID on a reconnect is essential: never mint a new turn on timeout.
      const r=await this.t3.call('t3_thread_send',this.args(j,{message:j.message,mode:'queue',clientRequestId:requestId(j.id)}));
      if(!r.runId||r.threadId!==j.threadId)throw new Error('Missing run receipt');
      j.runId=r.runId;j.phase='waiting';j.message=null;await this.save();
    }
    if(j.phase==='waiting'){
      const r=await this.t3.call('t3_thread_wait',this.args(j,{runId:j.runId,timeoutMs:1}));
      if(r.runId!==j.runId||r.timedOut||!['completed','failed','cancelled','interrupted','rolled_back'].includes(r.status))return;
      j.phase='reading';j.cursor??=-1;j.parts=[];await this.save();
    }
    if(j.phase==='reading'){
      // Traverse fully, but never forward a different run or user/tool text.
      for(let pages=0;pages<10;pages++){
        const r=await this.t3.call('t3_thread_read',this.args(j,{view:'messages',afterPosition:j.cursor,limit:100,maxCharsPerItem:20000}));
        if(!Array.isArray(r.items))throw new Error('Unexpected read schema');
        for(const item of r.items){
          if(item.runId!==j.runId||item.type!=='assistant_message'||typeof item.text!=='string'||!item.text)continue;
          if(j.parts.some(p=>p.id===item.itemId))continue;
          let value=item.text;
          if(item.textTruncated){j.phase='blocked';j.reason='T3 回复超过读取窗口；请在 T3 查看完整回复。';await this.save();return;}
          j.parts.push({id:item.itemId,text:value});
        }
        if(!r.hasMore){j.out=chunks(j.parts.map(p=>p.text).join('\n\n')||'此轮已结束，没有可转发的文字回复。请在 T3 查看状态或处理审批。');j.phase='delivering';j.outIndex=0;await this.save();break;}
        if(!Number.isInteger(r.nextPosition)||r.nextPosition<=j.cursor)throw new Error('Invalid read cursor');j.cursor=r.nextPosition;await this.save();
      }
    }
    if(j.phase==='sending') {j.phase='blocked';j.reason='飞书发送结果不确定，已停止重发以避免重复。请在 T3 查看回复。';await this.save();return;}
    if(j.phase==='delivering'){
      while(j.outIndex<j.out.length){
        const i=j.outIndex;j.phase='sending';await this.save();
        // Persist intent first. Unknown API outcomes are NOT blindly retried after restart.
        let receipt;try{receipt=await this.channel.send(j.chatId,j.out[i],requestId(j.id)+':'+i);}catch{j.phase='blocked';j.reason='飞书发送结果未知；请在 T3 查看回复。';await this.save();return;}
        j.receipts??=[];j.receipts.push(receipt);j.outIndex++;j.phase='delivering';await this.save();
      }
      j.phase='done';delete j.parts;delete j.out;await this.save();
    }
  }
  status(){return {running:this.running,channelConnection:this.channel.status?.()||'unknown',error:this.error,pending:this.state.jobs.filter(j=>j.phase!=='done').map(j=>({id:j.id,threadId:j.threadId,phase:j.phase,reason:j.reason||null})),completed:this.state.jobs.filter(j=>j.phase==='done').length};}
  async stop(){this.running=false;clearInterval(this.timer);await this.channel.stop();while(this.busy)await new Promise(r=>setTimeout(r,50));await this.t3.close();}
}
