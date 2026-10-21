'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
let createService,parseRequest,durationLabel;
require('node:test').before(async()=>{({createService,parseRequest,durationLabel}=await import('../worker/src/youtube.js'));});
const id='V34x1CxlAZ0';
const source='https://www.youtube.com/playlist?list=PL01234567890';
const auth={uid:'alice'};
const catalog={action:'catalog',mode:'playlist',source};
const video={id,snippet:{title:'Rhinocéros 42',description:'Le programme',channelTitle:'BLAST',publishedAt:'2026-10-21T10:00:00Z'},contentDetails:{duration:'PT1H2M3S'},status:{embeddable:false}};
function fixture(overrides={}){
  const calls=[],costs=[];
  const service=createService({apiKey:()=> 'server-only-key',consume:async(uid,cost)=>costs.push([uid,cost]),fetchImpl:async url=>{
    calls.push(url);
    const body=url.pathname.endsWith('/channels')?{items:[{contentDetails:{relatedPlaylists:{uploads:'UU01234567890'}}}]}:url.pathname.endsWith('/playlistItems')?{items:[{contentDetails:{videoId:id}}],nextPageToken:'NEXT',pageInfo:{totalResults:80}}:{items:[video]};
    return {ok:true,json:async()=>body};
  },...overrides});
  return {service,calls,costs};
}
test('anonymous and invalid requests cannot consume quota or call Google',async()=>{
  const {service,calls,costs}=fixture();
  await assert.rejects(service({data:catalog}),{code:'unauthenticated'});
  await assert.rejects(service({auth,data:{...catalog,source:'https://evil.test/playlist?list=PL01234567890'}}),{code:'invalid-argument'});
  await assert.rejects(service({auth,data:{action:'videos',ids:Array(51).fill(id)}}),{code:'invalid-argument'});
  assert.equal(calls.length,0);assert.equal(costs.length,0);
});
test('source validation accepts handles and IDs but never arbitrary endpoints',()=>{
  assert.deepEqual(parseRequest({action:'catalog',mode:'channel',source:'https://youtube.com/@blastinfo'}).channel,{forHandle:'@blastinfo'});
  assert.throws(()=>parseRequest({...catalog,pageToken:'?key=attacker'}),{code:'invalid-argument'});
  assert.throws(()=>parseRequest({action:'catalog',mode:'channel',source:'https://youtube.com/c/example'}),{code:'invalid-argument'});
  assert.throws(()=>parseRequest({action:'catalog',mode:'keywords',source:'https://youtube.com/@blast',keywords:''}),{code:'invalid-argument'});
});
test('playlist pagination returns real metadata and a continuation without exposing the key',async()=>{
  const {service,calls,costs}=fixture();
  const result=await service({auth,data:{...catalog,pageToken:'FIRST'}});
  assert.equal(result.nextPageToken,'NEXT');assert.equal(result.scanned,1);assert.equal(result.total,80);
  assert.equal(calls[0].searchParams.get('pageToken'),'FIRST');
  assert.equal(calls[0].searchParams.get('maxResults'),'50');
  assert.equal(result.episodes[0].durationLabel,'1:02:03');assert.equal(result.episodes[0].embeddable,false);
  assert.equal(JSON.stringify(result).includes('server-only-key'),false);
  assert.deepEqual(costs,[['alice',2]]);
});
test('channel keywords are accent-insensitive and filtered on title or description',async()=>{
  const {service,calls,costs}=fixture();
  const data={action:'catalog',mode:'keywords',source:'https://youtube.com/@blastinfo',keywords:'rhinoceros, absent'};
  assert.equal((await service({auth,data})).episodes.length,1);
  assert.equal(calls[0].searchParams.get('forHandle'),'@blastinfo');
  assert.equal(calls[1].searchParams.get('playlistId'),'UU01234567890');
  assert.deepEqual(costs,[['alice',3]]);
  assert.equal((await service({auth,data:{...data,keywords:'not matching'}})).episodes.length,0);
});
test('cache is bounded by TTL and still applies per-user rate limiting',async()=>{
  let time=1000;
  const {service,calls,costs}=fixture({now:()=>time});
  await service({auth,data:catalog});
  assert.equal((await service({auth:{uid:'bob'},data:catalog})).cached,true);
  assert.equal(calls.length,2);assert.deepEqual(costs.at(-1),['bob',0]);
  time+=15*60*1000+1;await service({auth,data:catalog});assert.equal(calls.length,4);
});
test('quota refusal prevents upstream calls, including uncached concurrent clients',async()=>{
  const {service,calls}=fixture({consume:async()=>{throw Object.assign(new Error('Budget'),{code:'resource-exhausted'});}});
  await assert.rejects(service({auth,data:catalog}),{code:'resource-exhausted'});assert.equal(calls.length,0);
});
test('Google failures produce safe errors without reflecting credential URLs',async()=>{
  const {service}=fixture({fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:{errors:[{reason:'quotaExceeded'}]}})})});
  await assert.rejects(service({auth,data:catalog}),{code:'resource-exhausted'});
  const network=fixture({fetchImpl:async()=>{throw new Error('secret URL');}});
  await assert.rejects(network.service({auth,data:catalog}),error=>error.code==='unavailable'&&!error.message.includes('secret'));
});
test('missing key stops requests and explicit video batches handle disappeared videos',async()=>{
  const absent=fixture({apiKey:()=>''});
  await assert.rejects(absent.service({auth,data:catalog}),{code:'failed-precondition'});assert.equal(absent.calls.length,0);
  const empty=fixture({fetchImpl:async()=>({ok:true,json:async()=>({items:[]})})});
  assert.deepEqual((await empty.service({auth,data:{action:'videos',ids:[id]}})).episodes,[]);
});
test('duration formatting preserves long episodes',()=>{
  assert.equal(durationLabel('PT2M5S'),'2:05');assert.equal(durationLabel('P1DT2H'),'26:00:00');assert.equal(durationLabel('bad'),'');
});
