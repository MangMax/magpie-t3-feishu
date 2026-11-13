import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lark from '@larksuiteoapi/node-sdk';
import { FeishuChannel } from '../src/channels/feishu.mjs';
import { Bridge } from '../src/bridge.mjs';
import { decodeToolResult } from '../src/mcp.mjs';
const event={message:{chat_type:'p2p',message_type:'text',message_id:'om_private',chat_id:'oc_private',content:JSON.stringify({text:'secret body'}),create_time:'1000'},sender:{sender_type:'user',sender_id:{open_id:'ou_private'}}};
const quiet={error(){},warn(){},info(){},debug(){},trace(){}};
test('official dispatcher delivers normalized v2 event and counts without private data',async()=>{
 const c=new FeishuChannel({appId:'test',appSecret:'secret token'}),received=[];
 const d=new lark.EventDispatcher({logger:quiet}).register({'im.message.receive_v1':e=>c.handleEvent(e,m=>received.push(m))});
 await d.invoke({schema:'2.0',header:{event_type:'im.message.receive_v1'},event},{needCheck:false});
 await d.invoke({schema:'2.0',header:{event_type:'im.message.receive_v1'},event:{...event,message:{...event.message,chat_type:'group'}}},{needCheck:false});
 await c.handleEvent({...event,message:{...event.message,message_type:'image'}},()=>assert.fail());
 assert.equal(received.length,1);assert.equal(received[0].text,'secret body');
 const diag=c.diagnostics();assert.equal(diag.events,3);assert.equal(diag.normalized,1);assert.equal(diag.filtered,2);assert.equal(diag.filterReasons.not_private,1);assert.equal(diag.filterReasons.not_text,1);assert.equal(typeof diag.lastEventAt,'number');
 assert.doesNotMatch(JSON.stringify(diag),/om_private|oc_private|ou_private|secret body|secret token/); // enum not_private is allowed below
});
test('bridge diagnostics distinguish allowlist, stale, duplicates and queue without raw content',async()=>{
 const b=new Bridge({store:{write:async()=>{}},t3:{},channel:{},config:{bindings:[{userId:'ou_private',threadId:'thread'}]},clock:()=>1000});b.running=true;
 const m={id:'om_private',chatId:'oc_private',userId:'ou_private',text:'secret body',createdAt:1000};
 await b.accept({...m,userId:'ou_other'});await b.accept({...m,createdAt:-90000000});await b.accept({...m,text:'x'.repeat(16001)});await b.accept(m);await b.accept(m);
 const d=b.status().diagnostics;assert.equal(d.unbound,1);assert.equal(d.stale,1);assert.equal(d.invalid,1);assert.equal(d.accepted,1);assert.equal(d.duplicate,1);assert.equal(d.lastDecision,'duplicate');assert.equal(d.lastReceivedAt,1000);assert.doesNotMatch(JSON.stringify(d),/secret body|ou_private|om_private|oc_private|thread/);
 b.running=false;await b.accept(m);assert.equal(b.status().diagnostics.notRunning,1);
});
test('official typed MCP failure is not a successful wait response',async()=>{
 const fail={_tag:'OrchestratorMcpFailure',message:'secret server response'};
 for(const r of [{structuredContent:fail},{content:[{type:'text',text:JSON.stringify(fail)}]}])assert.throws(()=>decodeToolResult(r),{message:'T3 tool returned failure'});
 const b=new Bridge({store:{},t3:{call:async()=>decodeToolResult({structuredContent:fail})},channel:{},config:{},clock:()=>1000});
 await assert.rejects(b.callT3('wait','t3_thread_wait',{}));assert.deepEqual(b.observed.t3,{operation:'wait',outcome:'error',at:1000});
 assert.doesNotMatch(JSON.stringify(b.observed),/secret server response/);
 assert.deepEqual(decodeToolResult({structuredContent:{runId:'run',status:'completed'}}),{runId:'run',status:'completed'});
});
