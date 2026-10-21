'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({URL,AbortSignal});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../youtube-api.js'),'utf8'),context);
const api=context.YouTubeFavsApi;
const health=()=>Response.json({service:'youtube-favs',projectId:'yt-favs-b05e1',youtubeConfigured:true,rateLimitConfigured:true});
const storage=()=>{const values=new Map();return {values,getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};};

test('Worker URLs are HTTPS origins and never contain tokens or arbitrary paths',()=>{
  assert.equal(api.normalizeOrigin('https://example.workers.dev/'),'https://example.workers.dev');
  for(const value of ['http://example.workers.dev','https://user:pass@example.test','https://example.test/api','https://example.test?key=secret','javascript:alert(1)'])assert.throws(()=>api.normalizeOrigin(value));
});
test('configuration tests health without authentication before persisting only the public URL',async()=>{
  const saved=storage();let options;
  const client=api.createClient({storage:saved,fetchImpl:async(url,opts)=>{assert.equal(url,'https://new.workers.dev/health');options=opts;return health();}});
  await client.configure('https://new.workers.dev');
  assert.equal(options.headers,undefined);assert.equal(saved.values.size,1);assert.equal([...saved.values.values()][0],'https://new.workers.dev');
});
test('wrong workers and missing API secrets cannot replace a working configuration',async()=>{
  const client=api.createClient({storage:storage(),fetchImpl:async()=>Response.json({service:'movie-quest'})});
  await assert.rejects(client.configure('https://wrong.workers.dev'),{code:'wrong-worker'});
  assert.equal(client.getOrigin(),api.DEFAULT_ORIGIN);
});
test('API calls send Firebase bearer tokens and retry one expired token with force refresh',async()=>{
  const tokens=[],requests=[];
  const client=api.createClient({storage:storage(),fetchImpl:async(url,opts)=>{requests.push({url,...opts});return requests.length===1?Response.json({error:{code:'unauthenticated'}},{status:401}):Response.json({episodes:[],nextPageToken:null});}});
  await client.call({action:'videos',ids:['AAAAAAAAAAA']},{getToken:async refresh=>{tokens.push(refresh);return refresh?'fresh-token':'old-token';},isCurrent:()=>true});
  assert.deepEqual(tokens,[false,true]);assert.equal(requests[1].headers.Authorization,'Bearer fresh-token');assert.equal(requests[1].redirect,'error');
  assert.equal(requests[0].body.includes('token'),false);
});
test('account changes during token acquisition prevent the network request',async()=>{
  let active=true,calls=0;
  const client=api.createClient({storage:storage(),fetchImpl:async()=>{calls++;return Response.json({episodes:[]});}});
  await assert.rejects(client.call({}, {getToken:async()=>{active=false;return 'token';},isCurrent:()=>active}),{code:'session-changed'});assert.equal(calls,0);
});
test('late API responses are ignored after account changes and errors remain actionable',async()=>{
  let active=true;
  const client=api.createClient({storage:storage(),fetchImpl:async()=>{active=false;return Response.json({episodes:[]});}});
  await assert.rejects(client.call({}, {getToken:async()=> 'token',isCurrent:()=>active}),{code:'session-changed'});
  const limited=api.createClient({storage:storage(),fetchImpl:async()=>Response.json({error:{code:'resource-exhausted',message:'Quota atteint'}},{status:429})});
  await assert.rejects(limited.call({}, {getToken:async()=> 'token',isCurrent:()=>true}),{code:'resource-exhausted',message:'Quota atteint'});
});

test('channel-name lookups accept channel result arrays through the same authenticated transport',async()=>{
  const client=api.createClient({storage:storage(),fetchImpl:async()=>Response.json({channels:[{id:'UC1234567890123456789012',name:'Example',url:'https://www.youtube.com/channel/UC1234567890123456789012'}]})});
  const result=await client.call({action:'channels',query:'Example'},{getToken:async()=> 'token',isCurrent:()=>true});
  assert.equal(result.channels[0].name,'Example');
});
