'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../cloud-state.js');
const model=globalThis.YouTubeFavsState;
const videoA='V34x1CxlAZ0',videoB='MatN8AsTDCs';

test('private payload excludes the public catalogue and starts with no subscriptions',()=>{
  const catalogue={shows:[{id:'papy',name:'Papy',mode:'playlist'}],episodes:[{id:videoA,showId:'papy',title:'Public'}]};
  const state=model.hydrate(model.empty(),catalogue);
  assert.equal(state.shows.length,0);assert.equal(state.episodes.length,0);assert.deepEqual(state.following,[]);
  assert.deepEqual(model.pack(state,catalogue),model.empty());
});

test('parallel device changes merge instead of replacing another device selections',()=>{
  const first=model.empty();
  const local={...first,favorites:[videoA],following:['papy']};
  const remote={...first,favorites:[videoB],queue:[videoB],theme:'light'};
  const merged=model.applyPatch(remote,model.diff(first,local));
  assert.deepEqual(new Set(merged.favorites),new Set([videoA,videoB]));
  assert.deepEqual(merged.queue,[videoB]);assert.equal(merged.theme,'light');
  const removed=model.applyPatch(merged,model.diff(local,{...local,favorites:[]}));
  assert.deepEqual(removed.favorites,[videoB]);
});

test('malformed records and unsafe source URLs do not reach the UI',()=>{
  const payload=model.sanitize({favorites:[videoA,videoA,'wrong'],following:['papy','../../alice'],shows:[{id:'bad',name:'Bad',channel:'X',mode:'channel',source:'javascript:alert(1)'},{name:'Missing ID',channel:'X',mode:'channel',source:'https://youtube.com/@example'}],accent:'url(evil)',episodes:[{id:videoA,showId:'papy',title:'Valid'}]});
  assert.deepEqual(payload.favorites,[videoA]);assert.deepEqual(payload.following,['papy']);
  assert.equal(payload.shows.length,0);assert.equal(payload.accent,'#f15a61');
  assert.equal(payload.episodes.length,1);
});

test('session queues rapid edits and includes intervening remote writes',async()=>{
  let remote=model.empty(),revision=-1;const delivered=[];const statuses=[];
  const session=model.createSession({async transact(update){await Promise.resolve();remote=update(remote);return {data:remote,revision:++revision};},onData:data=>delivered.push(data),onStatus:status=>statuses.push(status)});
  session.receive(remote,-1);
  const first={...model.empty(),favorites:[videoA]};
  const second={...first,queue:[videoB]};
  const saveA=session.save(model.empty(),first);
  remote={...remote,watched:[videoB]};
  const saveB=session.save(first,second);
  await Promise.all([saveA,saveB]);
  assert.deepEqual(remote.favorites,[videoA]);assert.deepEqual(remote.queue,[videoB]);assert.deepEqual(remote.watched,[videoB]);
  assert.deepEqual(delivered.at(-1),remote);assert.equal(statuses.at(-1),'ready');
});

test('stopping a session cancels queued writes and prevents late data delivery',async()=>{
  let writes=0;const delivered=[];
  const session=model.createSession({async transact(update){writes++;return {data:update(model.empty()),revision:0};},onData:data=>delivered.push(data),onStatus(){}});
  const saving=session.save(model.empty(),{...model.empty(),favorites:[videoA]});
  session.stop();
  await assert.rejects(saving,{code:'session-changed'});
  session.receive({...model.empty(),favorites:[videoA]},4);
  assert.equal(writes,0);assert.equal(delivered.length,0);
});

test('a completed old-account request cannot update a new account screen',async()=>{
  let release;const delivered=[];
  const session=model.createSession({transact:()=>new Promise(resolve=>{release=()=>resolve({data:{...model.empty(),favorites:[videoA]},revision:0});}),onData:data=>delivered.push(data),onStatus(){}});
  const pending=session.save(model.empty(),{...model.empty(),favorites:[videoA]});
  await Promise.resolve();session.stop();release();
  await assert.rejects(pending,{code:'session-changed'});
  assert.equal(delivered.length,0);
});

test('permission failures are explicit and disable later writes in that session',async()=>{
  const statuses=[];
  const session=model.createSession({async transact(){throw Object.assign(new Error('Denied'),{code:'permission-denied'});},onData(){},onStatus:(status,error)=>statuses.push([status,error?.code])});
  await assert.rejects(session.save(model.empty(),{...model.empty(),favorites:[videoA]}),{code:'permission-denied'});
  await assert.rejects(session.save(model.empty(),{...model.empty(),queue:[videoB]}),{code:'session-changed'});
  assert.ok(statuses.some(([status,code])=>status==='error'&&code==='permission-denied'));
});

test('API references persist without retaining YouTube metadata',()=>{
  const packed=model.pack({...model.empty(),episodes:[{id:videoA,showId:'papy',title:'API title',apiImported:true,author:'API author',publishedAt:'2026-10-21',durationLabel:'10:00',added:123}]},{shows:[],episodes:[]});
  assert.deepEqual(packed.episodes,[{id:videoA,showId:'papy',title:'Vidéo YouTube',apiImported:true,note:'',added:123}]);
  assert.equal(model.hydrate(packed,{shows:[{id:'papy'}],episodes:[]}).episodes[0].apiImported,true);
});


test('private removals override bundled records and survive unrelated edits without copying metadata',()=>{
  const catalogue={shows:[{id:'papy'}],episodes:[{id:videoA,showId:'papy',title:'Shared title',author:'Shared author'}]};
  const initial=model.hydrate({...model.empty(),following:['papy']},catalogue);initial.episodes[0].hidden=true;
  const packed=model.pack(initial,catalogue);
  assert.equal(packed.episodes[0].hidden,true);assert.equal(packed.episodes[0].title,'Vidéo retirée');
  assert.equal(packed.episodes[0].author,undefined);
  const restored=model.hydrate(packed,catalogue);assert.equal(restored.episodes[0].hidden,true);
  restored.theme='light';assert.equal(model.pack(restored,catalogue).episodes[0].hidden,true);
  restored.episodes[0].hidden=false;assert.equal(model.pack(restored,catalogue).episodes.length,0);
  assert.equal(model.hydrate(model.empty(),catalogue).episodes.length,0);
});

test('category arrays migrate legacy values, trim labels and preserve an explicitly empty selection',()=>{
  assert.deepEqual(model.categoriesOf({category:' Culture '}),['Culture']);
  assert.deepEqual(model.categoriesOf({category:'Culture',categories:[]}),[]);
  assert.deepEqual(model.categoriesOf({categories:[' Science ','science','Jeux vidéo','Jeux video','',null,12]}),['Science','Jeux vidéo']);
  assert.equal(model.categoriesOf({categories:Array.from({length:30},(_,n)=>`Category ${n}`)}).length,20);
});
