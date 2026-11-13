import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchScratch} from '../src/discovery.mjs';

test('Magpie plugin and sidebar use the same bundled Feishu SVG',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const svg=await readFile(new URL('../page/feishu.svg',import.meta.url),'utf8');
  assert.equal(pkg.magpie.page.icon,'page/feishu.svg');
  assert.equal(pkg.magpie.icon,'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'));
  assert.match(svg,/<svg[^>]+viewBox="0 0 24 24"/);
  assert.equal((svg.match(/<path /g)||[]).length,3);
  assert.doesNotMatch(svg,/<script|<foreignObject|\bon\w+=|href=|url\(/i);
  assert.ok(pkg.files.includes('page'));
  assert.ok(pkg.files.includes('THIRD_PARTY_NOTICES.md'));
  const notice=await readFile(new URL('../THIRD_PARTY_NOTICES.md',import.meta.url),'utf8');
  assert.match(notice,/Copyright \(c\) 2023 LobeHub/);
});

test('Scratch creation never updates the shared No project icon',async()=>{
  const calls=[],saved={};
  const client={
    tools:async()=>[{name:'t3_thread_launch',inputSchema:{properties:{scratch:{},clientRequestId:{}}}}],
    call:async(name,args)=>{
      calls.push({name,args});
      assert.equal(name,'t3_thread_launch','Scratch must not call project mutation tools');
      return {threadId:'scratch-thread',projectId:'shared-no-project'};
    }
  };
  const store={read:async(key,fallback)=>saved[key]??fallback,write:async(key,value)=>{saved[key]=value;}};
  const input={requestId:'scratch-icon-test-0001',serverName:'T3',title:'飞书 IM'};
  const result=await launchScratch(client,store,input);
  assert.equal(result.projectId,'shared-no-project');
  assert.deepEqual(calls,[{name:'t3_thread_launch',args:{scratch:true,title:'飞书 IM',clientRequestId:input.requestId}}]);
  assert.deepEqual(await launchScratch(client,store,input),result);
  assert.equal(calls.length,1,'Retry must not mutate the shared project either');
});
