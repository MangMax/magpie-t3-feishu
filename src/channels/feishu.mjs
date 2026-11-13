import * as lark from '@larksuiteoapi/node-sdk';
import { createHash } from 'node:crypto';
export function normalizeEvent(event){
  const m=event?.message,s=event?.sender;
  if(m?.chat_type!=='p2p'||m.message_type!=='text'||s?.sender_type!=='user')return null;
  let text;try{text=JSON.parse(m.content).text;}catch{return null;}
  if(typeof text!=='string'||!text.trim()||!m.message_id||!m.chat_id||!s.sender_id?.open_id)return null;
  return {id:m.message_id,userId:s.sender_id.open_id,chatId:m.chat_id,text:text.trim(),createdAt:Number(m.create_time)};
}
// Adapter contract: start(onMessage), send(chatId,text,idempotencyKey), stop().
// Future IM adapters normalize identity and private conversation scope here, not in T3.
export class FeishuChannel {
  constructor(config){this.config=config;this.client=new lark.Client({appId:config.appId,appSecret:config.appSecret,loggerLevel:lark.LoggerLevel.error,logger:{error(){},warn(){},info(){},debug(){},trace(){}}});}
  async start(onMessage){
    this.ws=new lark.WSClient({appId:this.config.appId,appSecret:this.config.appSecret,loggerLevel:lark.LoggerLevel.error,logger:{error(){},warn(){},info(){},debug(){},trace(){}}});
    await this.ws.start({eventDispatcher:new lark.EventDispatcher({}).register({'im.message.receive_v1':async event=>{const message=normalizeEvent(event);if(message)await onMessage(message);}})});
  }
  async send(chatId,text,key){const r=await this.client.im.message.create({params:{receive_id_type:'chat_id'},data:{receive_id:chatId,msg_type:'text',content:JSON.stringify({text}),uuid:createHash('sha256').update(key).digest('hex').slice(0,32)}});if(r.code!==0||!r.data?.message_id)throw new Error('Feishu delivery not acknowledged');return r.data.message_id;}
  status(){return this.ws?.getConnectionStatus?.()||'idle';}
  async stop(){this.ws?.close({force:true});this.ws=null;}
}
