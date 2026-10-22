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
    setTimeout(fn,delay){const id=++nextTimer;fn.delay=delay;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
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
  const submit=async(selector='#showForm')=>{document.querySelector(selector).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();};
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

test('episode feedback keeps saves immediate, cleans up inert exit copies and respects reduced motion',async()=>{
  const app=boot({shows:[show()],episodes:[video(),video('BBBBBBBBBBB')]});
  const prototype=app.window.HTMLElement.prototype,originalAnimate=prototype.animate,originalRect=prototype.getBoundingClientRect;
  const animations=[];let reduced=false;
  app.window.matchMedia=()=>({matches:reduced});
  prototype.getBoundingClientRect=()=>({left:10,top:20,width:300,height:200});
  prototype.animate=function(frames){let finish;const finished=new Promise(resolve=>{finish=resolve;});animations.push({node:this,frames,finish});return {finished};};
  try{
    const card=app.document.querySelector('[data-key="episode-AAAAAAAAAAA"]');
    app.click('[data-id="AAAAAAAAAAA"]');
    assert.equal(app.writes.length,1);assert.equal(app.document.querySelector('[data-key="episode-AAAAAAAAAAA"]'),card);
    assert.ok(animations.some(animation=>animation.node===card));
    app.click('[data-remove-video="AAAAAAAAAAA"]');app.click('[data-action="confirm-removal"]');
    assert.equal(app.writes.length,2);
    const overlay=app.document.querySelector('[data-animation-overlay]');assert.ok(overlay);
    assert.equal(overlay.getAttribute('aria-hidden'),'true');assert.ok(overlay.hasAttribute('inert'));
    assert.equal(overlay.querySelector('[data-key]'),null);
    for(const animation of animations)animation.finish();await app.settle();
    assert.equal(app.document.querySelector('[data-animation-overlay]'),null);
    reduced=true;const count=animations.length;
    app.click('[data-id="BBBBBBBBBBB"]');assert.equal(app.writes.length,3);assert.equal(animations.length,count);
  }finally{
    if(originalAnimate)prototype.animate=originalAnimate;else delete prototype.animate;
    if(originalRect)prototype.getBoundingClientRect=originalRect;else delete prototype.getBoundingClientRect;
  }
});

test('successful imports show confirmation only after saving and then close their own dialog',async()=>{
  const app=boot({shows:[show()]},'#/show/program');
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'An episode'}],scanned:1,nextPageToken:null})");
  app.click('[data-youtube="program"]');await app.settle();
  assert.ok(app.document.querySelector('#modal').classList.contains('import-dialog'));
  app.run('globalThis.youtubeFavsCloud.save=()=>new Promise(resolve=>globalThis.completeImport=resolve)');
  app.click('[data-action="confirm-youtube-import"]');await app.settle();
  assert.match(app.document.querySelector('[data-action="confirm-youtube-import"]').textContent,/Import en cours/);
  assert.equal([...app.timers.values()].some(fn=>fn.delay===1200),false);
  app.run('completeImport()');await app.settle();
  const button=app.document.querySelector('[data-action="confirm-youtube-import"]');
  assert.match(button.textContent,/Importation réussie/);assert.ok(button.disabled);
  assert.ok(button.querySelector('svg'));assert.ok(app.document.querySelector('#modal').open);
  const close=[...app.timers.values()].find(fn=>fn.delay===1200);assert.ok(close);
  close();assert.equal(app.document.querySelector('#modal').open,false);
  assert.equal(app.document.querySelector('#modal').classList.contains('import-dialog'),false);
});
test('an old import completion timer cannot close a different modal',async()=>{
  const app=boot({shows:[show()]},'#/show/program');
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'An episode'}],scanned:1,nextPageToken:null})");
  app.click('[data-youtube="program"]');await app.settle();
  app.click('[data-action="confirm-youtube-import"]');await app.settle();
  const close=[...app.timers.values()].find(fn=>fn.delay===1200);assert.ok(close);
  app.run('showForm()');close();
  assert.ok(app.document.querySelector('#modal').open);assert.ok(app.document.querySelector('#showForm'));
  assert.equal(app.document.querySelector('#modal').classList.contains('import-dialog'),false);
});
test('failed imports never display success or schedule an automatic close',async()=>{
  const app=boot({shows:[show()]},'#/show/program');
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'An episode'}],scanned:1,nextPageToken:null})");
  app.click('[data-youtube="program"]');await app.settle();
  app.run("globalThis.youtubeFavsCloud.save=async()=>{throw new Error('Firestore unavailable');}");
  app.click('[data-action="confirm-youtube-import"]');await app.settle();
  assert.equal(app.document.querySelector('.import-success'),null);
  assert.equal([...app.timers.values()].some(fn=>fn.delay===1200),false);
  assert.equal(app.run('cloudStatus.phase'),'error');
});

test('whole-channel imports load one page by default, resume with the next 50 and scan all only on request',async()=>{
  const app=boot({shows:[show({mode:'channel',keywords:''})]},'#/show/program');
  app.run("globalThis.catalogCalls=[];globalThis.youtubeFavsCloud.youtube=async input=>{catalogCalls.push(input);const n=catalogCalls.length;return {episodes:[{id:'A'+String(n).padStart(10,'0'),title:'Episode '+n,durationLabel:'10:00'}],scanned:50,nextPageToken:n<5?'PAGE'+n:null};}");
  app.click('[data-youtube="program"]');await app.settle();
  assert.equal(app.run('catalogCalls.length'),1);assert.equal(app.writes.length,0);
  assert.match(app.document.querySelector('[data-continue]').textContent,/50 suivantes/);
  app.click('[data-continue]:not([data-scan-all])');await app.settle();
  assert.equal(app.run('catalogCalls.length'),2);assert.equal(app.run('catalogCalls[1].pageToken'),'PAGE1');
  app.click('[data-scan-all]');await app.settle();
  assert.equal(app.run('catalogCalls.length'),5);assert.equal(app.writes.length,0);
});
test('the import filter reuses loaded pages and prevents excluded short videos from being saved',async()=>{
  const app=boot({shows:[show({mode:'channel'})]},'#/show/program');
  app.run("globalThis.catalogCalls=0;globalThis.youtubeFavsCloud.youtube=async()=>{catalogCalls++;return {episodes:[{id:'AAAAAAAAAAA',title:'Short video',durationLabel:'0:35'},{id:'BBBBBBBBBBB',title:'Three minutes',durationLabel:'3:00'},{id:'CCCCCCCCCCC',title:'Long video',durationLabel:'5:30'},{id:'DDDDDDDDDDD',title:'Unknown duration'}],scanned:4,nextPageToken:null};}");
  app.click('[data-youtube="program"]');await app.settle();
  assert.equal(app.document.querySelectorAll('.import-row').length,2);
  const checkbox=app.document.querySelector('[data-import-shorts]');checkbox.checked=true;checkbox.dispatchEvent(new app.window.Event('change',{bubbles:true}));
  assert.equal(app.document.querySelectorAll('.import-row').length,4);
  const off=app.document.querySelector('[data-import-shorts]');off.checked=false;off.dispatchEvent(new app.window.Event('change',{bubbles:true}));
  assert.equal(app.run('catalogCalls'),1);
  app.click('[data-action="confirm-youtube-import"]');await app.settle();
  assert.deepEqual([...app.writes.at(-1).next.episodes.map(episode=>episode.id)],['CCCCCCCCCCC','DDDDDDDDDDD']);
  assert.equal(app.writes.at(-1).next.shows[0].includeShorts,false);
});
test('profile filtering is reversible and does not delete any imported short videos',()=>{
  const app=boot({shows:[show()],episodes:[video(),video('BBBBBBBBBBB')]});
  app.run("youtubeMetadata.set('AAAAAAAAAAA',{id:'AAAAAAAAAAA',durationLabel:'0:30'});youtubeMetadata.set('BBBBBBBBBBB',{id:'BBBBBBBBBBB',durationLabel:'8:00'});applyYoutubeMetadata();render()");
  assert.equal(app.document.querySelectorAll('.episode').length,1);
  app.run("location.hash='#/settings';render()");
  const checkbox=app.document.querySelector('[data-show-shorts]');checkbox.checked=true;checkbox.dispatchEvent(new app.window.Event('change',{bubbles:true}));
  app.run("location.hash='#/episodes';render()");assert.equal(app.document.querySelectorAll('.episode').length,2);
  assert.equal(app.run('state.episodes.length'),2);assert.equal(app.writes.length,0);
  app.run('setShortVideosPreference(false)');assert.equal(app.document.querySelectorAll('.episode').length,1);
});
test('new-release checks honor the source inclusion preference for short videos',async()=>{
  for(const includeShorts of [false,true]){
    const app=boot({shows:[show({mode:'channel',includeShorts,releaseAfter:'2026-01-01T00:00:00Z'})]});
    app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'Short release',durationLabel:'0:20',publishedAt:new Date(Date.now()-10000).toISOString()}],scanned:1,nextPageToken:null})");
    await app.run('checkNewReleases()');
    assert.equal(app.run('state.episodes.length'),includeShorts?1:0);
  }
});

test('the browser display preference is restored per account without changing cloud data',()=>{
  const app=boot();
  app.run("globalThis.preferenceStore=new Map();globalThis.localStorage={getItem:key=>preferenceStore.get(key)||null,setItem:(key,value)=>preferenceStore.set(key,value)};setShortVideosPreference(true)");
  assert.equal(app.run("preferenceStore.get('youtube-favs:short-videos:alice')"),'true');
  app.emit('auth',{status:'loading',user:{uid:'bob'}});assert.equal(app.run('showShortVideos'),false);
  app.emit('auth',{status:'loading',user:{uid:'alice'}});assert.equal(app.run('showShortVideos'),true);
  assert.equal(app.writes.length,0);
});

test('category filters are shared by library views and watchlist views only include unseen programmes',async()=>{
  const app=boot({shows:[show({category:'Culture'}),show({id:'sports',name:'Sports',category:'Sport',channel:'Sports channel'}),show({id:'empty',name:'Empty programme',category:'Culture',channel:'Empty channel'})],episodes:[video(),video('BBBBBBBBBBB',{showId:'sports'}),video('CCCCCCCCCCC',{newRelease:true})],watched:['AAAAAAAAAAA']},'#/shows');
  const choose=value=>{const select=app.document.querySelector('#categoryFilter');select.value=value;select.dispatchEvent(new app.window.Event('change',{bubbles:true}));};
  choose('Culture');assert.equal(app.document.querySelectorAll('.show-card').length,2);
  app.run("location.hash='#/channels';render()");assert.equal(app.document.querySelectorAll('.show-card').length,2);assert.equal(app.run('filter.category'),'Culture');
  app.run("location.hash='#/watchlist/shows';render()");await app.settle();choose('Culture');
  assert.equal(app.document.querySelectorAll('.show-card').length,1);assert.match(app.document.querySelector('#results').textContent,/1 à voir/);
  app.run("location.hash='#/watchlist/channels';render()");await app.settle();
  assert.equal(app.document.querySelectorAll('.show-card').length,1);assert.equal(app.run('filter.category'),'Culture');
  const link=app.document.querySelector('#results a.cover').getAttribute('href');assert.match(link,/watchlist\/shows\?channel=/);
  app.run(`location.hash=${JSON.stringify(link)};render()`);await app.settle();assert.equal(app.document.querySelectorAll('.show-card').length,1);
  const episodeLink=app.document.querySelector('#results a.cover').getAttribute('href');
  app.run(`location.hash=${JSON.stringify(episodeLink)};render()`);await app.settle();
  assert.equal(app.document.querySelectorAll('.episode').length,1);assert.ok(app.document.querySelector('[data-key="episode-CCCCCCCCCCC"]'));
  const calls=app.requests.filter(request=>request.action==='catalog').length;
  app.run("location.hash='#/watchlist/channels';render()");await app.settle();
  assert.equal(app.requests.filter(request=>request.action==='catalog').length,calls);
});
test('search finds programmes and channels through episode titles and sorting works in grouped views',()=>{
  const app=boot({shows:[show({name:'Ancient',channel:'First'}),show({id:'second',name:'Modern',channel:'Second'})],episodes:[video('AAAAAAAAAAA',{showId:'program'}),video('BBBBBBBBBBB',{showId:'second'})]},'#/channels');
  app.run("youtubeMetadata.set('AAAAAAAAAAA',{id:'AAAAAAAAAAA',title:'A journey through space',publishedAt:'2025-01-01T00:00:00Z'});youtubeMetadata.set('BBBBBBBBBBB',{id:'BBBBBBBBBBB',title:'A race',publishedAt:'2026-01-01T00:00:00Z'});applyYoutubeMetadata();render()");
  assert.equal(app.document.querySelector('#results .cover-title').textContent,'Chaîne YouTubeSecond');
  const search=app.document.querySelector('#search');search.value='space';search.dispatchEvent(new app.window.Event('input',{bubbles:true}));
  assert.equal(app.document.querySelectorAll('.show-card').length,1);assert.match(app.document.querySelector('#results').textContent,/First/);
  app.run("location.hash='#/shows';render()");assert.equal(app.document.querySelectorAll('.show-card').length,1);assert.match(app.document.querySelector('#results').textContent,/Ancient/);
});
test('category and manual cover changes save without a YouTube import and survive a cloud reload',async()=>{
  const app=boot({shows:[show()],episodes:[video()]},'#/show/program');
  app.click('.show-cover-editor');
  const form=app.document.querySelector('#appearanceForm');
  form.querySelector('[name="category"]').value='Science';form.querySelector('[name="coverMode"]').value='manual';form.querySelector('[name="coverSource"]').value='https://images.example.com/science.jpg';
  const calls=app.requests.length;await app.submit('#appearanceForm');
  assert.equal(app.writes.length,1);assert.equal(app.requests.length,calls);
  const payload=app.writes.at(-1).next;assert.equal(payload.shows[0].category,'Science');assert.equal(payload.shows[0].coverMode,'manual');assert.equal(payload.shows[0].coverUrl,'https://images.example.com/science.jpg');
  app.emit('data',{uid:'alice',data:payload});
  assert.equal(app.document.querySelector('.show-cover-editor img').getAttribute('src'),'https://images.example.com/science.jpg');
});
test('cover editing accepts programme thumbnails and rejects unsafe external URLs',async()=>{
  const app=boot({shows:[show()],episodes:[video()]},'#/show/program');app.click('.show-cover-editor');
  let form=app.document.querySelector('#appearanceForm');form.querySelector('[name="coverMode"]').value='manual';form.querySelector('[name="coverSource"]').value='javascript:alert(1)';
  await app.submit('#appearanceForm');assert.equal(app.writes.length,0);assert.match(app.document.querySelector('#appearanceError').textContent,/HTTPS/);
  app.click('[data-cover-video="AAAAAAAAAAA"]');await app.submit('#appearanceForm');
  assert.equal(app.writes.at(-1).next.shows[0].cover,'AAAAAAAAAAA');assert.equal(app.writes.at(-1).next.shows[0].coverMode,'manual');assert.equal(app.writes.at(-1).next.shows[0].coverUrl,'');
});
test('new releases update automatic covers to the newest publication and preserve manual covers',async()=>{
  for(const coverMode of ['auto','manual']){
    const app=boot({shows:[show({cover:'AAAAAAAAAAA',coverMode,coverUrl:coverMode==='manual'?'https://images.example.com/manual.jpg':'',releaseAfter:'2026-01-01T00:00:00Z'})],episodes:[video()]});
    app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'BBBBBBBBBBB',title:'Earlier release',publishedAt:new Date(Date.now()-20000).toISOString()},{id:'CCCCCCCCCCC',title:'Latest release',publishedAt:new Date(Date.now()-10000).toISOString()}],scanned:2,nextPageToken:null})");
    await app.run('checkNewReleases()');
    assert.equal(app.run('state.shows[0].cover'),coverMode==='auto'?'CCCCCCCCCCC':'AAAAAAAAAAA');
    assert.equal(app.writes.at(-1).next.shows[0].coverUrl,coverMode==='manual'?'https://images.example.com/manual.jpg':'');
  }
});
