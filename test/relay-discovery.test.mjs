import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {discoverServers,isT3RelayURL} from '../src/discovery.mjs';

test('relay detection accepts only HTTPS DNS subdomains at the MCP endpoint',()=>{
  for(const url of ['https://my.t3coderelay.com/mcp','HTTPS://My.T3CodeRelay.COM:443/mcp/','https://one.two.t3coderelay.com/mcp?token=PRIVATE'])assert.equal(isT3RelayURL(url),true,url);
  for(const url of [undefined,{},'', 'http://my.t3coderelay.com/mcp','https://t3coderelay.com/mcp','https://evilt3coderelay.com/mcp','https://my.t3coderelay.com.evil.test/mcp','https://t3coderelay.com@evil.test/mcp','https://user:pass@my.t3coderelay.com/mcp','https://my.t3coderelay.com:8443/mcp','https://my.t3coderelay.com/mcp/extra','https://my.t3coderelay.com/MCP','https://my.t3coderelay.com/mcp#secret','https://my.t3coderelay.com./mcp','https://-bad.t3coderelay.com/mcp','https://bad_.t3coderelay.com/mcp',' https://my.t3coderelay.com/mcp','https://my.t3coderelay.com\\@evil.test/mcp','https://my.t3coderelay.com/m\ncp'])assert.equal(isT3RelayURL(url),false,String(url));
});

test('discovery prioritizes safe relay matches without exposing secrets or altering selection',async()=>{
  const d=await mkdtemp(join(tmpdir(),'relay-discovery-'));
  try{
    const input=JSON.stringify({selection:'manual-original',mcp:[
      {name:'Other',transport:'stdio',command:'SECRET_COMMAND',env:{KEY:'SECRET_ENV'}},
      {name:'T3 local',transport:'stdio'},
      {name:'Connected account',transport:'http',url:'https://account.t3coderelay.com/mcp?token=SECRET_QUERY',headers:{Authorization:'SECRET_HEADER'},oauth:{secret:'SECRET_OAUTH'},accounts:[{secret:'SECRET_ACCOUNT'}]},
      {name:'Hidden relay',transport:'http',hidden:true,url:'https://hidden.t3coderelay.com/mcp'},
      {name:'https://bad-name',transport:'http',url:'https://bad.t3coderelay.com/mcp'},
      {name:'Bad URL manual',transport:'http',url:'not a URL'},
      {name:'Stdio with irrelevant URL',transport:'stdio',url:'https://irrelevant.t3coderelay.com/mcp'},
      {name:'Second relay',transport:'http',url:'https://second.t3coderelay.com/mcp'}
    ]});
    await writeFile(join(d,'library.json'),input);
    const result=await discoverServers(d);
    assert.deepEqual(result.map(s=>s.name),['Connected account','Second relay','T3 local','Other','Bad URL manual','Stdio with irrelevant URL']);
    assert.deepEqual(result[0],{name:'Connected account',transport:'http',suggested:true,relayMatched:true});
    assert.equal(result[4].relayMatched,undefined);assert.equal(result[5].relayMatched,undefined);
    assert.doesNotMatch(JSON.stringify(result),/SECRET|https:|oauth|headers|accounts|url|command|env/);
    assert.equal(await readFile(join(d,'library.json'),'utf8'),input);
  }finally{await rm(d,{recursive:true,force:true});}
});
