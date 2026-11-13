import * as lark from '@larksuiteoapi/node-sdk';
import { createHash } from 'node:crypto';
export function inspectEvent(event){
  const m=event?.message,s=event?.sender;
  if(m?.chat_type!=='p2p')return {reason:'not_private'};
  if(m.message_type!=='text')return {reason:'not_text'};
  if(s?.sender_type!=='user')return {reason:'not_user'};
  let text;try{text=JSON.parse(m.content).text;}catch{return {reason:'invalid_content'};}
  if(typeof text!=='string'||!text.trim()||!m.message_id||!m.chat_id||!s.sender_id?.open_id)return {reason:'missing_fields'};
  return {message:{id:m.message_id,userId:s.sender_id.open_id,chatId:m.chat_id,text:text.trim(),createdAt:Number(m.create_time)}};
}
export function normalizeEvent(event){return inspectEvent(event).message||null;}
// Adapter contract: start(onMessage), send(chatId,text,idempotencyKey), stop().
// Future IM adapters normalize identity and private conversation scope here, not in T3.
export class FeishuChannel {
  constructor(config){this.config=config;this.observed={events:0,normalized:0,filtered:0,filterReasons:{},lastEventAt:null};this.client=new lark.Client({appId:config.appId,appSecret:config.appSecret,loggerLevel:lark.LoggerLevel.error,logger:{error(){},warn(){},info(){},debug(){},trace(){}}});}
  async handleEvent(event,onMessage){
    this.observed.events++;this.observed.lastEventAt=Date.now();
    const {message,reason}=inspectEvent(event);
    if(!message){this.observed.filtered++;this.observed.filterReasons[reason]=(this.observed.filterReasons[reason]||0)+1;return;}
    this.observed.normalized++;await onMessage(message);
  }
  diagnostics(){return structuredClone(this.observed);}
  async start(onMessage){
    this.ws=new lark.WSClient({appId:this.config.appId,appSecret:this.config.appSecret,loggerLevel:lark.LoggerLevel.error,logger:{error(){},warn(){},info(){},debug(){},trace(){}}});
    await this.ws.start({eventDispatcher:new lark.EventDispatcher({}).register({'im.message.receive_v1':event=>this.handleEvent(event,onMessage)})});
  }
  async send(chatId,text,key){const r=await this.client.im.message.create({params:{receive_id_type:'chat_id'},data:{receive_id:chatId,msg_type:'text',content:JSON.stringify({text}),uuid:createHash('sha256').update(key).digest('hex').slice(0,32)}});if(r.code!==0||!r.data?.message_id)throw new Error('Feishu delivery not acknowledged');return r.data.message_id;}
  status(){return this.ws?.getConnectionStatus?.()||'idle';}
  async stop(){this.ws?.close({force:true});this.ws=null;}
}
