import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/src/index.js';
import {createTokenVerifier,PROJECT_ID} from '../worker/src/firebase-auth.js';
const origin='https://vchaillo.github.io';
const payload={action:'videos',ids:['AAAAAAAAAAA']};
const makeRequest=(options={})=>new Request('https://worker.test/api/youtube',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test-token','Content-Type':'application/json'},body:JSON.stringify(payload),...options});
const env=()=>({YOUTUBE_API_KEY:'server-only-key',USER_LIMITER:{limit:async()=>({success:true})},GLOBAL_LIMITER:{limit:async()=>({success:true})}});
const fakeGoogle=async()=>Response.json({items:[{id:'AAAAAAAAAAA',snippet:{title:'API title',channelTitle:'Channel',publishedAt:'2026-10-21T00:00:00Z'},contentDetails:{duration:'PT5M'},status:{embeddable:true}}]});

test('health and CORS expose configuration without secrets or Google calls',async()=>{
  const worker=createWorker({verifyToken:async()=>{throw Error('Must not verify health');},fetchImpl:async()=>{throw Error('Must not call Google');}});
  const health=await worker.fetch(new Request('https://worker.test/health'),env());
  const body=await health.json();
  assert.equal(body.projectId,PROJECT_ID);assert.equal(body.youtubeConfigured,true);
  assert.equal(JSON.stringify(body).includes('server-only-key'),false);
  const preflight=await worker.fetch(makeRequest({method:'OPTIONS',body:null}),env());
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await worker.fetch(makeRequest({headers:{Origin:'https://attacker.test'}}),env())).status,403);
});
test('anonymous and invalid sessions cannot call YouTube, even without an Origin header',async()=>{
  let calls=0;
  const worker=createWorker({verifyToken:async()=>{throw Error('Invalid JWT');},fetchImpl:async()=>{calls++;return fakeGoogle();}});
  assert.equal((await worker.fetch(makeRequest({headers:{'Content-Type':'application/json'}}),env())).status,401);
  assert.equal((await worker.fetch(makeRequest(),env())).status,401);assert.equal(calls,0);
});
test('authenticated HTTP requests use the configured key and return metadata only',async()=>{
  let called;
  const worker=createWorker({verifyToken:async token=>{assert.equal(token,'test-token');return {uid:'alice'};},fetchImpl:async url=>{called=url;return fakeGoogle();}});
  const response=await worker.fetch(makeRequest(),env());
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  const body=await response.json();assert.equal(body.episodes[0].title,'API title');
  assert.equal(called.searchParams.get('key'),'server-only-key');assert.equal(JSON.stringify(body).includes('server-only-key'),false);
});
test('missing secrets, missing limit bindings, excessive bodies and forbidden methods fail closed',async()=>{
  const worker=createWorker({verifyToken:async()=>({uid:'alice'}),fetchImpl:async()=>{throw Error('Do not call Google');}});
  assert.equal((await worker.fetch(makeRequest(),{...env(),YOUTUBE_API_KEY:''})).status,503);
  assert.equal((await worker.fetch(makeRequest(),{YOUTUBE_API_KEY:'x'})).status,503);
  assert.equal((await worker.fetch(makeRequest({body:'x'.repeat(17000)}),env())).status,400);
  assert.equal((await worker.fetch(makeRequest({body:'{broken'}),env())).status,400);
  assert.equal((await worker.fetch(makeRequest({method:'GET',body:null}),env())).status,405);
});
test('Cloudflare limiters apply to signed-in users and prevent upstream quota consumption',async()=>{
  let calls=0,userKey;
  const worker=createWorker({verifyToken:async()=>({uid:'alice'}),fetchImpl:async()=>{calls++;return fakeGoogle();}});
  const limited={...env(),USER_LIMITER:{limit:async({key})=>{userKey=key;return {success:false};}}};
  const response=await worker.fetch(makeRequest(),limited);
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');assert.equal(calls,0);assert.equal(userKey,'alice');
});

const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function signingFixture(){
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'key-1',alg:'RS256',use:'sig'};
  const seconds=Math.floor(Date.now()/1000);
  async function sign(overrides={},headerOverrides={}){
    const header=encode({alg:'RS256',kid:'key-1',...headerOverrides});
    const claims=encode({aud:PROJECT_ID,iss:`https://securetoken.google.com/${PROJECT_ID}`,sub:'alice',iat:seconds-5,auth_time:seconds-10,exp:seconds+3600,...overrides});
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(`${header}.${claims}`));
    return `${header}.${claims}.${Buffer.from(signature).toString('base64url')}`;
  }
  let fetches=0;
  const verify=createTokenVerifier({now:()=>seconds*1000,fetchKeys:async()=>{fetches++;return Response.json({keys:[jwk]},{headers:{'cache-control':'max-age=3600'}});}});
  return {verify,sign,seconds,fetches:()=>fetches,jwk};
}
test('real RSA signatures are verified and Google public keys are cached',async()=>{
  const f=await signingFixture();const token=await f.sign();
  assert.deepEqual(await f.verify(token),{uid:'alice'});await f.verify(token);assert.equal(f.fetches(),1);
  const pieces=token.split('.');pieces[1]=encode({sub:'attacker',aud:PROJECT_ID,iss:`https://securetoken.google.com/${PROJECT_ID}`,exp:f.seconds+3600,iat:f.seconds-5,auth_time:f.seconds-10});
  await assert.rejects(f.verify(pieces.join('.')),/Invalid signature/);
});
test('tokens with wrong audience, issuer, expired or future claims are rejected',async()=>{
  const f=await signingFixture();
  for(const claims of [{aud:'other-project'},{iss:'https://attacker.test'},{exp:f.seconds},{iat:f.seconds+60},{auth_time:f.seconds+60},{nbf:f.seconds+60},{sub:42},{sub:''}])await assert.rejects(f.verify(await f.sign(claims)),/Invalid claims/);
  await assert.rejects(f.verify(await f.sign({}, {alg:'none'})),/Invalid algorithm/);
  assert.equal(f.fetches(),0);
});
test('unknown signing keys cannot trigger repeated key fetches and rotated keys refresh',async()=>{
  const f=await signingFixture();await f.verify(await f.sign());
  for(let i=0;i<3;i++)await assert.rejects(f.verify(await f.sign({}, {kid:'unknown'})),/Signing key/);
  assert.equal(f.fetches(),1);
  let time=f.seconds*1000,calls=0;
  const rotated={...f.jwk,kid:'rotated'};
  const verify=createTokenVerifier({now:()=>time,fetchKeys:async()=>{calls++;return Response.json({keys:[calls===1?f.jwk:rotated]},{headers:{'cache-control':'max-age=3600'}});}});
  await verify(await f.sign());time+=61000;
  await verify(await f.sign({}, {kid:'rotated'}));assert.equal(calls,2);
});
test('the HTTP boundary accepts a signed Firebase token through the real verifier',async()=>{
  const f=await signingFixture();const worker=createWorker({verifyToken:f.verify,fetchImpl:fakeGoogle});
  const response=await worker.fetch(makeRequest({headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${await f.sign()}`}}),env());
  assert.equal(response.status,200);
});
