import * as lark from '@larksuiteoapi/node-sdk';
import QRCode from 'qrcode';
const scopes=['im:message.p2p_msg:readonly','im:message:send_as_bot'];
export class FeishuOnboarding {
  constructor({save,register=lark.registerApp,clock=Date.now}){Object.assign(this,{save,register,clock});this.state={state:'idle'};this.generation=0;}
  status(){return {...this.state};}
  cancel(){if(this.state.state==='saving')return false;this.generation++;this.controller?.abort();this.controller=null;this.qr=null;this.pending=null;this.state={state:'cancelled'};return true;}
  start(){
    if(!this.cancel())return this.status();const generation=this.generation,controller=new AbortController();this.controller=controller;this.state={state:'waiting'};
    this.task=this.register({createOnly:true,signal:controller.signal,source:'magpie-t3-feishu',appPreset:{name:'飞书 T3 桥',desc:'通过 Magpie 将本人私聊连接到指定的 T3 会话'},addons:{preset:false,scopes:{tenant:scopes},events:{items:{tenant:['im.message.receive_v1']}}},onQRCodeReady:info=>{
      if(generation!==this.generation)return;let u;try{u=new URL(info.url);}catch{controller.abort();return;}
      if(u.protocol!=='https:'||!['accounts.feishu.cn','accounts.larksuite.com'].includes(u.hostname)){controller.abort();return;}
      this.state={state:'waiting',url:u.toString(),expiresAt:this.clock()+Math.min(900,Math.max(1,Number(info.expireIn)||600))*1000};this.qr=QRCode.toString(u.toString(),{type:'svg',margin:2,width:256});
    }}).then(async r=>{
      if(generation!==this.generation)return;
      if(!/^cli_[a-f0-9]{16}$/i.test(r.client_id)||typeof r.client_secret!=='string'||!r.client_secret)throw new Error('Invalid receipt');
      this.pending={appId:r.client_id,appSecret:r.client_secret,openId:/^ou_[a-zA-Z0-9]+$/.test(r.user_info?.open_id||'')?r.user_info.open_id:null};
      this.qr=null;this.state={state:'authorized',appId:r.client_id,openId:this.pending.openId};
    }).catch(e=>{if(generation!==this.generation)return;this.qr=null;this.state={state:e?.code==='expired_token'?'expired':e?.code==='abort'?'cancelled':'error',error:'扫码未完成。请重新发起，或使用已有应用手动配置。'};});
    return this.status();
  }
  async apply(){
    if(this.state.state!=='authorized'||!this.pending)throw new Error('No authorized application');
    const generation=this.generation,pending=this.pending;this.state={state:'saving'};
    try{await this.save({appId:pending.appId,appSecret:pending.appSecret},()=>generation===this.generation,()=>{if(generation!==this.generation)return false;this.state={state:'saving'};return true;});}catch(e){this.state={state:'authorized',appId:pending.appId,openId:pending.openId,error:'本地保存未完成，原配置仍保留。请重试。'};throw e;}
    if(generation!==this.generation)return this.status();
    this.pending=null;this.state={state:'complete',appId:pending.appId,openId:pending.openId};return this.status();
  }
  async svg(){if(this.state.state!=='waiting'||!this.qr||this.state.expiresAt<=this.clock())throw new Error('QR unavailable');return this.qr;}
}
