'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const show=(overrides={})=>({id:'program',name:'My show',channel:'My channel',source:'https://www.youtube.com/@mychannel',mode:'keywords',keywords:'show',...overrides});
const video=(id='AAAAAAAAAAA',overrides={})=>({id,showId:'program',title:'Episode',apiImported:true,added:1,...overrides});
function boot(data={},hash='#/episodes'){
  const {document,window}=parseHTML(source('index.html'));
  const writes=[],requests=[],timers=new Map();let nextTimer=0;
  // LinkeDOM does not select the first option by default as browsers do.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{
    configurable:true,
    get(){return (this.querySelector('option[selected]')||this.querySelector('option'))?.value||'';},
    set(value){for(const option of this.querySelectorAll('option'))option.removeAttribute('selected');this.querySelectorAll('option').forEach(option=>{if(option.value===value)option.setAttribute('selected','');});},
  });
  for(const dialog of document.querySelectorAll('dialog')){
    Object.defineProperty(dialog,'open',{get(){return this.hasAttribute('open');}});
    dialog.showModal=function(){this.setAttribute('open','');};
    dialog.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
  }
  const context=vm.createContext({document,window,URL,structuredClone,crypto:require('node:crypto').webcrypto,
    location:{hash},history:{replaceState(){}},
    localStorage:{getItem(){return null;}},
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    FormData:class{constructor(form){this.form=form;}get(key){return this.form.querySelector(`[name="${key}"]`)?.value||'';}},
    youtubeFavsCloud:{save:async(previous,next)=>{writes.push({previous,next});},youtube:async input=>{requests.push(input);return {episodes:[],channels:[],scanned:0,nextPageToken:null};}},
  });
  const run=code=>vm.runInContext(code,context);
  for(const file of ['data/catalog.js','cloud-state.js','library.js','dom-sync.js','app.js'])run(source(file));
  const emit=(type,detail)=>window.dispatchEvent(new window.CustomEvent(`youtube-favs:${type}`,{detail}));
  emit('auth',{status:'loading',user:{uid:'alice',displayName:'Alice'}});
  emit('data',{uid:'alice',data:{...run('privateModel.empty()'),...data}});
  const click=selector=>{const node=document.querySelector(selector);assert.ok(node,selector);node.dispatchEvent(new window.Event('click',{bubbles:true}));};
  const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  const submit=async()=>{document.querySelector('#showForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();};
  const fill=(name,value)=>{const input=document.querySelector(`#showForm [name="${name}"]`);input.value=value;return input;};
  return {document,window,run,emit,click,writes,requests,settle,submit,fill,timers};
}

test('watched toggles and cloud acknowledgements preserve card, image and search nodes',async()=>{
  const app=boot({shows:[show()],episodes:[video(),video('BBBBBBBBBBB')]});
  const card=app.document.querySelector('[data-key="episode-AAAAAAAAAAA"]'),image=card.querySelector('img'),search=app.document.querySelector('#search');
  app.click('[data-id="AAAAAAAAAAA"]');await app.settle();
  assert.equal(app.document.querySelector('[data-key="episode-AAAAAAAAAAA"]'),card);
  assert.equal(card.querySelector('img'),image);assert.equal(app.document.querySelector('#search'),search);
  assert.equal(card.querySelector('[data-toggle]').getAttribute('aria-pressed'),'true');
  app.emit('data',{uid:'alice',data:app.writes.at(-1).next});
  assert.equal(app.document.querySelector('[data-key="episode-AAAAAAAAAAA"]'),card);
  assert.equal(card.querySelector('img'),image);
});
test('watchlist removes a watched card without recreating the remaining thumbnails',async()=>{
  const app=boot({shows:[show({releaseAfter:'2026-10-22T00:00:00Z'})],episodes:[video(),video('BBBBBBBBBBB')]},'#/watchlist');await app.settle();
  const remaining=app.document.querySelector('[data-key="episode-BBBBBBBBBBB"]'),image=remaining.querySelector('img');
  app.click('[data-id="AAAAAAAAAAA"]');await app.settle();
  assert.equal(app.document.querySelector('[data-key="episode-AAAAAAAAAAA"]'),null);
  assert.equal(app.document.querySelector('[data-key="episode-BBBBBBBBBBB"]'),remaining);
  assert.equal(remaining.querySelector('img'),image);
});
test('all imported visible episodes of one show can be marked watched in one write',async()=>{
  const app=boot({shows:[show(),show({id:'other'})],episodes:[video(),video('BBBBBBBBBBB',{hidden:true}),video('CCCCCCCCCCC',{showId:'other'})]},'#/show/program');
  app.click('[data-mark-show-watched="program"]');await app.settle();
  assert.deepEqual([...app.writes.at(-1).next.watched],['AAAAAAAAAAA']);
  assert.equal(app.writes.length,1);
  assert.ok(app.document.querySelector('[data-mark-show-watched]').disabled);
});
test('show deletion is confirmed and removes all associated private records without restoring legacy programmes',async()=>{
  for(const imported of [false,true]){
    const app=boot({following:['papy'],shows:[show()],episodes:imported?[video()]:[],watched:imported?['AAAAAAAAAAA']:[]},'#/show/program');
    app.click('[data-remove-show="program"]');assert.equal(app.writes.length,0);
    assert.match(app.document.querySelector('#removalTitle').textContent,/émission/);
    app.click('[data-action="cancel-removal"]');assert.equal(app.writes.length,0);
    app.click('[data-remove-show="program"]');app.click('[data-action="confirm-removal"]');await app.settle();
    assert.equal(app.run("state.shows.some(s=>s.id==='program')"),false);
    const payload=app.writes.at(-1).next;
    assert.equal(payload.episodes.some(e=>e.showId==='program'),false);assert.equal(payload.watched.includes('AAAAAAAAAAA'),false);
    app.emit('data',{uid:'alice',data:payload});assert.equal(app.run("state.shows.some(s=>s.id==='program')"),false);
    // Delete a formerly bundled show as well: no following or episode references may resurrect it.
    app.run("location.hash='#/show/papy';render()");app.click('[data-remove-show="papy"]');app.click('[data-action="confirm-removal"]');await app.settle();
    app.emit('data',{uid:'alice',data:app.writes.at(-1).next});assert.equal(app.run('state.shows.length'),0);
  }
});
test('one channel input searches live, selects a canonical source and derives keywords from the show name',async()=>{
  const app=boot();app.run("showForm();globalThis.youtubeFavsCloud.youtube=async input=>{if(input.action==='channels')return {channels:[{id:'UC1234567890123456789012',name:'Actual channel',url:'https://www.youtube.com/channel/UC1234567890123456789012'}]};return {episodes:[],scanned:0,nextPageToken:null};}");
  app.fill('name','Rhinocéros');app.fill('channel','Blast');
  await app.run("searchChannels('Blast')");
  assert.equal(app.document.querySelectorAll('[name="channel"]').length,1);
  assert.equal(app.document.querySelector('[name="resolvedSource"]'),null);
  assert.equal(app.document.querySelector('[name="keywords"]'),null);
  app.click('[data-select-channel="0"]');
  assert.equal(app.document.querySelector('[name="source"]').value,'https://www.youtube.com/channel/UC1234567890123456789012');
  await app.submit();
  assert.equal(app.run('state.shows[0].channel'),'Actual channel');assert.equal(app.run('state.shows[0].keywords'),'Rhinocéros');
});
test('late channel search results are ignored after input changes or the form closes',async()=>{
  const app=boot();app.run("showForm();globalThis.youtubeFavsCloud.youtube=()=>new Promise(resolve=>globalThis.resolveSearch=resolve)");
  const pending=app.run("searchChannels('Old')");
  const input=app.fill('channel','New');input.dispatchEvent(new app.window.Event('input',{bubbles:true}));
  app.run("resolveSearch({channels:[{name:'Old channel',id:'UC1234567890123456789012',url:'https://www.youtube.com/@old'}]})");await pending;
  assert.equal(app.document.querySelector('[data-select-channel]'),null);
  const closed=app.run("searchChannels('New')");app.run('closeModal()');
  app.run("resolveSearch({channels:[{name:'New channel',url:'https://www.youtube.com/@new'}]})");await closed;
  assert.equal(app.document.querySelector('#modal').open,false);
});
test('playlist mode requires a playlist link and keeps the selected channel identity',async()=>{
  const app=boot({shows:[show()]});app.run('showForm()');app.fill('name','Playlist');
  await app.run("searchChannels('My channel')");app.click('[data-select-channel="0"]');
  const mode=app.fill('mode','playlist');mode.dispatchEvent(new app.window.Event('change',{bubbles:true}));
  assert.equal(app.document.querySelector('[name="source"]').value,'');
  await app.submit();assert.equal(app.writes.length,0);
  app.fill('source','https://www.youtube.com/playlist?list=PL1234567890123');await app.submit();
  assert.equal(app.writes.at(-1).next.shows.at(-1).mode,'playlist');
});
