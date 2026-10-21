'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const load=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

// Test the application's DOM boundary and cloud events without a real Google session.
function boot({legacy=null,privateData={},authenticated=true}={}) {
  const listeners={},windowListeners={},nodes=new Map(),values=new Map(legacy?[['youtube-favs:v1',JSON.stringify(legacy)]]:[]),writes=[];
  const element=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',open:false,classList:{toggle(){},add(){},remove(){}},style:{setProperty(){}},addEventListener(){},setAttribute(){},removeAttribute(){},showModal(){this.open=true;},close(){this.open=false;}});
    return nodes.get(selector);
  };
  const context=vm.createContext({
    document:{querySelector:element,querySelectorAll:()=>[],documentElement:element('html'),body:element('body'),addEventListener:(name,fn)=>listeners[name]=fn},
    window:{addEventListener:(name,fn)=>windowListeners[name]=fn,scrollTo(){}},
    localStorage:{getItem:key=>values.get(key)||null,setItem(){throw Error('Application data must not be written to localStorage');},removeItem:key=>values.delete(key)},
    location:{hash:'#/explore',reload(){}},history:{replaceState(){}},structuredClone,URL,setTimeout:()=>0,clearTimeout(){},crypto:require('node:crypto').webcrypto,
    FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??'';}},
    youtubeFavsCloud:{save:(previous,next)=>{writes.push({previous:structuredClone(previous),next:structuredClone(next)});return Promise.resolve();},signIn(){},signOut(){},retry(){}}
  });
  for(const file of ['data/catalog.js','cloud-state.js','app.js'])vm.runInContext(load(file),context);
  const emit=(name,detail)=>windowListeners[`youtube-favs:${name}`]({detail});
  const run=code=>vm.runInContext(code,context);
  const user={uid:'alice',displayName:'Alice',email:'alice@example.test',photoURL:''};
  if(authenticated){emit('auth',{status:'loading',user});emit('data',{uid:'alice',data:{...run('privateModel.empty()'),...privateData}});}
  const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
  return {run,nodes,values,writes,listeners,emit,click,user};
}

test('startup hides private views until the authenticated server state arrives',()=>{
  const app=boot({authenticated:false});
  assert.match(app.nodes.get('#app').innerHTML,/Votre espace se prépare/);
  assert.equal(app.nodes.get('header nav').hidden,true);
  app.emit('auth',{status:'signed-out',user:null});
  assert.match(app.nodes.get('#app').innerHTML,/Se connecter avec Google/);
  assert.equal(app.writes.length,0);
});

test('new accounts have no forced follows and can browse the shared catalogue',()=>{
  const app=boot();
  assert.match(app.nodes.get('#app').innerHTML,/Explorer/);
  assert.match(app.nodes.get('#results').innerHTML,/Papy Grenier/);
  assert.equal(app.run('state.following.length'),0);
  app.run("location.hash='#/shows';render()");
  assert.match(app.nodes.get('#results').innerHTML,/Aucune émission suivie/);
  app.run("location.hash='#/episodes';render()");
  assert.equal(app.run('filteredEpisodes().length'),0);
});

test('followed programs filter the episode feed independently for each account',()=>{
  const app=boot({privateData:{following:['rhino']}});
  app.run("location.hash='#/episodes';render()");
  assert.equal(app.run('filteredEpisodes().length'),72);
  app.emit('auth',{status:'loading',user:{uid:'bob',displayName:'Bob',email:'bob@example.test'}});
  assert.equal(app.run('state.following.length'),0);
  app.emit('data',{uid:'bob',data:{...app.run('privateModel.empty()'),following:['papy']}});
  assert.equal(app.run('filteredEpisodes().length'),20);
  app.emit('data',{uid:'alice',data:{...app.run('privateModel.empty()'),following:['rhino']}});
  assert.equal(app.run('filteredEpisodes().length'),20);
});

test('favorites and watched state save through the cloud without copying the catalogue',async()=>{
  const app=boot();
  app.run("toggle('favorites','V34x1CxlAZ0');toggle('watched','V34x1CxlAZ0');location.hash='#/favorites';render()");
  assert.equal(app.run('filteredEpisodes().length'),1);
  app.run("filter.status='Non vus'");assert.equal(app.run('filteredEpisodes().length'),0);
  await Promise.resolve();
  assert.equal(app.writes.length,2);
  assert.deepEqual(Array.from(app.writes.at(-1).next.favorites),['V34x1CxlAZ0']);
  assert.equal(app.writes.at(-1).next.episodes.length,0);
  assert.equal(app.values.size,0);
});

test('sign-out removes personal state and closes the player before another account loads',()=>{
  const app=boot({privateData:{favorites:['V34x1CxlAZ0'],following:['papy']}});
  app.run("playEpisode('V34x1CxlAZ0')");
  app.emit('auth',{status:'signed-out',user:null});
  assert.equal(app.run('state.favorites.length'),0);
  assert.equal(app.nodes.get('#modalContent').innerHTML,'');
  assert.doesNotMatch(app.nodes.get('#account').innerHTML,/Alice/);
  app.run("toggle('favorites','V34x1CxlAZ0')");assert.equal(app.writes.length,0);
});

test('legacy demo data is imported only after explicit confirmation',async()=>{
  const legacy={following:['papy'],favorites:['V34x1CxlAZ0'],shows:[],episodes:[]};
  const app=boot({legacy});
  assert.equal(app.run('state.favorites.length'),0);assert.equal(app.writes.length,0);
  await app.click({action:'import-legacy'});
  assert.match(app.nodes.get('#modalContent').innerHTML,/alice@example.test/);
  assert.equal(app.writes.length,0);
  await app.click({action:'confirm-import'});
  assert.equal(app.run('state.favorites.length'),1);assert.equal(app.writes.length,1);
  assert.equal(app.values.has('youtube-favs:v1'),false);
});

test('cloud access failures show recovery instructions without enabling a local fallback',()=>{
  const app=boot();
  app.emit('sync',{uid:'alice',status:'error',message:'Firestore refuse l’accès.'});
  assert.match(app.nodes.get('#app').innerHTML,/Firestore refuse/);
  assert.match(app.nodes.get('#app').innerHTML,/firestore.rules/);
  app.run("toggle('favorites','V34x1CxlAZ0')");assert.equal(app.writes.length,0);
});

test('search and catalogue metadata remain available with both Cyberpunk versions',()=>{
  const app=boot({privateData:{following:['papy']}});
  app.run("location.hash='#/episodes';render();filter.query='CYBERPUNK'");
  assert.equal(app.run('filteredEpisodes().length'),2);
  assert.equal(app.run('seedEpisodes.length'),189);
  assert.equal(app.run('new Set(seedEpisodes.map(e=>e.id)).size'),189);
});

test('new shows save their private rule and automatically open an import preview',async()=>{
  const app=boot();
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[],scanned:0,nextPageToken:null})");
  const form={id:'showForm',dataset:{},values:{name:'Test show',channel:'Test channel',mode:'channel',source:'https://evil.test/@channel',keywords:''}};
  const submit=()=>app.listeners.submit({preventDefault(){},target:form});
  await submit();assert.equal(app.run('state.shows.length'),5);
  form.values.source='https://www.youtube.com/@test';await submit();
  assert.equal(app.run('state.shows.length'),6);
  assert.equal(app.writes.at(-1).next.shows.length,1);
  assert.equal(app.writes.at(-1).next.shows[0].name,'Test show');
  assert.match(app.nodes.get('#modalContent').innerHTML,/Importer depuis YouTube/);
});

test('player waits for explicit load and rejects unsafe external inputs',()=>{
  const app=boot();app.run("playEpisode('V34x1CxlAZ0')");
  assert.match(app.nodes.get('#modalContent').innerHTML,/Charger le lecteur/);
  assert.doesNotMatch(app.nodes.get('#modalContent').innerHTML,/<iframe/);
  assert.equal(app.run("videoId('https://youtube.com.evil.test/watch?v=V34x1CxlAZ0')"),null);
  assert.equal(app.run("escapeHtml('<img onerror=alert(1)>')"),'&lt;img onerror=alert(1)&gt;');
});

test('YouTube previews paginate without saving and import only explicitly selected videos',async()=>{
  const app=boot();
  app.run(`location.hash='#/show/papy';render();globalThis.calls=[];globalThis.youtubeFavsCloud.youtube=async data=>{calls.push(data);return {episodes:[{id:'AAAAAAAAAAA',title:'New YouTube episode',author:'JDG',durationLabel:'12:00',publishedAt:'2026-10-21T00:00:00Z'},{id:'BBBBBBBBBBB',title:'Second episode'}],nextPageToken:data.pageToken?null:'NEXT',scanned:50};};`);
  await app.click({youtube:'papy'});
  assert.equal(app.run("state.episodes.some(e=>e.id==='AAAAAAAAAAA')"),false);
  assert.equal(app.writes.length,0);
  assert.match(app.nodes.get('#modalContent').innerHTML,/Importer la sélection/);
  app.listeners.change({target:{dataset:{importVideo:'BBBBBBBBBBB'},checked:false}});
  await app.click({youtube:'papy',continue:'true'});
  assert.equal(app.run('calls[1].pageToken'),'NEXT');
  assert.equal(app.run("youtubeImports.get('papy').candidates.length"),2);
  assert.equal(app.run("youtubeImports.get('papy').selected.has('BBBBBBBBBBB')"),false);
  assert.match(app.nodes.get('#modalContent').innerHTML,/100 publications analysées/);
  await app.click({action:'confirm-youtube-import'});
  assert.equal(app.run("state.episodes.find(e=>e.id==='AAAAAAAAAAA').title"),'New YouTube episode');
  assert.equal(app.run("state.episodes.some(e=>e.id==='BBBBBBBBBBB')"),false);
  assert.equal(app.writes.at(-1).next.episodes[0].title,'Vidéo YouTube');
  assert.equal(app.writes.at(-1).next.episodes[0].apiImported,true);
  assert.match(app.nodes.get('#modalContent').innerHTML,/Déjà présente/);
});

test('closing the import preview never writes video references',async()=>{
  const app=boot();app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'Preview only'}],scanned:1,nextPageToken:null})");
  await app.click({youtube:'papy'});await app.click({close:''});
  assert.equal(app.writes.length,0);assert.equal(app.run("state.episodes.some(e=>e.id==='AAAAAAAAAAA')"),false);
});

test('removing a bundled video persists a private exclusion and does not auto-select it on import',async()=>{
  const app=boot({privateData:{following:['papy'],favorites:['V34x1CxlAZ0'],queue:['V34x1CxlAZ0']}});
  await app.click({removeVideo:'V34x1CxlAZ0'});
  app.run("location.hash='#/show/papy';render()");
  assert.equal(app.run("filteredEpisodes().some(e=>e.id==='V34x1CxlAZ0')"),false);
  assert.equal(app.writes.at(-1).next.episodes[0].hidden,true);
  assert.equal(app.writes.at(-1).next.favorites.length,0);
  const saved=app.writes.at(-1).next;
  app.emit('data',{uid:'alice',data:saved});
  assert.equal(app.run("filteredEpisodes().some(e=>e.id==='V34x1CxlAZ0')"),false);
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'V34x1CxlAZ0',title:'Removed video'}],scanned:1,nextPageToken:null})");
  await app.click({youtube:'papy'});
  assert.equal(app.run("youtubeImports.get('papy').selected.size"),0);
  app.listeners.change({target:{dataset:{importVideo:'V34x1CxlAZ0'},checked:true}});
  await app.click({action:'confirm-youtube-import'});
  assert.equal(app.run("visibleEpisodes().some(e=>e.id==='V34x1CxlAZ0')"),true);
  assert.equal(app.writes.at(-1).next.episodes.length,0);
});

test('removed custom imports stay absent and a different account keeps the shared catalogue',async()=>{
  const app=boot({privateData:{episodes:[{id:'AAAAAAAAAAA',showId:'papy',title:'Video',apiImported:true}]}});
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[]})");
  await app.click({removeVideo:'AAAAAAAAAAA'});
  assert.equal(app.writes.at(-1).next.episodes[0].hidden,true);
  assert.equal(app.run("visibleEpisodes().some(e=>e.id==='AAAAAAAAAAA')"),false);
  app.emit('auth',{status:'loading',user:{uid:'bob'}});app.emit('data',{uid:'bob',data:app.run('privateModel.empty()')});
  assert.equal(app.run('visibleEpisodes().length'),189);
});

test('an old-account YouTube response cannot import into the next account',async()=>{
  const app=boot();
  app.run('globalThis.youtubeFavsCloud.youtube=()=>new Promise(resolve=>globalThis.releaseYoutube=resolve)');
  const pending=app.click({youtube:'papy'});
  app.emit('auth',{status:'signed-out',user:null});
  app.run("releaseYoutube({episodes:[{id:'AAAAAAAAAAA',title:'Private context'}],scanned:1,nextPageToken:null})");
  await pending;
  assert.equal(app.run("state.episodes.some(e=>e.id==='AAAAAAAAAAA')"),false);
  assert.equal(app.writes.length,0);
  assert.equal(app.run('youtubeMetadata.size'),0);
});

test('YouTube errors leave existing selections available and can be retried',async()=>{
  const app=boot({privateData:{following:['papy']}});
  app.run("location.hash='#/show/papy';render();globalThis.youtubeFavsCloud.youtube=async()=>{throw new Error('Quota YouTube atteint');}");
  await app.click({youtube:'papy'});
  assert.match(app.nodes.get('#app').innerHTML,/Quota YouTube atteint/);
  assert.equal(app.run('cloudStatus.phase'),'ready');
  assert.equal(app.run('state.following[0]'),'papy');
  assert.equal(app.run("youtubeImports.get('papy').busy"),false);
});

test('Worker URL configuration has a test-and-save flow without modifying private selections',async()=>{
  const app=boot();
  app.run("globalThis.youtubeFavsCloud.workerOrigin=()=> 'https://old.workers.dev';globalThis.youtubeFavsCloud.configureWorker=async origin=>({origin,persisted:true});location.hash='#/settings';render()");
  assert.match(app.nodes.get('#app').innerHTML,/URL du Worker Cloudflare/);
  const button={disabled:false};
  await app.listeners.submit({preventDefault(){},target:{id:'workerForm',values:{origin:'https://new.workers.dev'},querySelector:()=>button}});
  assert.match(app.nodes.get('#app').innerHTML,/Worker connecté/);
  assert.equal(button.disabled,false);assert.equal(app.writes.length,0);
});
