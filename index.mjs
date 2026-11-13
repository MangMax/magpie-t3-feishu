import { startService } from './src/service.mjs';
// One exported plugin function: Magpie treats exported functions as plugin entries.
export const T3FeishuPlugin=async(input,options={})=>{
  const key=Symbol.for('magpie-t3-feishu.service');
  if(!globalThis[key])globalThis[key]=startService(input,options).catch(()=>({status:()=>({running:false,error:'服务未启动，请检查端口、控制密钥和配置目录。'})}));
  const service=await globalThis[key];
  const {tool}=await import('@opencode-ai/plugin');
  return {tool:{status:tool({description:'只读查看 T3 飞书桥运行情况。不返回凭据或聊天内容。',args:{},execute:async()=>JSON.stringify(service.status())})}};
};
