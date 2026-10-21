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
    if(!nodes.has(selector))nodes.set(selector,{id:selector.slice(1),dataset:{},values:{},querySelector:child=>element(child),innerHTML:'',textContent:'',open:false,classList:{toggle(){},add(){},remove(){}},style:{setProperty(){}},addEventListener(){},setAttribute(){},removeAttribute(){},showModal(){this.open=true;},close(){this.open=false;}});
    return nodes.get(selector);
  };
  const context=vm.createContext({
    document:{querySelector:element,querySelectorAll:()=>[],documentElement:element('html'),body:element('body'),addEventListener:(name,fn)=>listeners[name]=fn},
    window:{addEventListener:(name,fn)=>windowListeners[name]=fn,scrollTo(){}},
    localStorage:{getItem:key=>values.get(key)||null,setItem(){throw Error('Application data must not be written to localStorage');},removeItem:key=>values.delete(key)},
    location:{hash:'#/explore',reload(){}},history:{replaceState(){}},structuredClone,URL,setTimeout:()=>0,clearTimeout(){},crypto:require('node:crypto').webcrypto,
    FormData:class{constructor(form){this.values=form.values;}get(key){return this.values?.[key]??'';}},
    youtubeFavsCloud:{save:(previous,next)=>{writes.push({previous:structuredClone(previous),next:structuredClone(next)});return Promise.resolve();},signIn(){},signOut(){},retry(){}}
  });
  for(const file of ['data/catalog.js','cloud-state.js','library.js','app.js'])vm.runInContext(load(file),context);
  const emit=(name,detail)=>windowListeners[`youtube-favs:${name}`]({detail});
  const run=code=>vm.runInContext(code,context);
  const user={uid:'alice',displayName:'Alice',email:'alice@example.test',photoURL:''};
  if(authenticated){emit('auth',{status:'loading',user});emit('data',{uid:'alice',data:{...run('privateModel.empty()'),...privateData}});}
  const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
  return {run,nodes,values,writes,listeners,emit,click,user,element};
}

const channelId='UC1234567890123456789012';
const show=(overrides={})=>({id:'program',name:'My show',channel:'My channel',source:'https://www.youtube.com/@mychannel',mode:'keywords',keywords:'show',releaseAfter:'2026-01-01T00:00:00Z',...overrides});
const video=(id='AAAAAAAAAAA',overrides={})=>({id,showId:'program',title:'Episode',apiImported:true,added:1,...overrides});
const readyData=(app,data={})=>({...app.run('privateModel.empty()'),...data});

test('new accounts have an empty library and no shared shows, favorites or follow controls',()=>{
  const app=boot();
  assert.equal(app.run('state.shows.length'),0);assert.equal(app.run('visibleEpisodes().length'),0);
  assert.match(app.nodes.get('#results').innerHTML,/Votre bibliothèque commence ici/);
  assert.doesNotMatch(app.nodes.get('#app').innerHTML,/Papy Grenier|Mes favoris|data-follow=/);
});
test('auth loading gates the library and sign-out clears data and the direct player',()=>{
  const app=boot({authenticated:false});assert.equal(app.nodes.get('header nav').hidden,true);
  app.emit('auth',{status:'signed-out',user:null});assert.match(app.nodes.get('#app').innerHTML,/Se connecter avec Google/);
  app.emit('auth',{status:'loading',user:app.user});app.emit('data',{uid:'alice',data:readyData(app,{following:['papy']})});
  app.run("playEpisode('V34x1CxlAZ0')");assert.match(app.nodes.get('#modalContent').innerHTML,/<iframe/);
  app.emit('auth',{status:'signed-out',user:null});assert.equal(app.run('state.shows.length'),0);assert.equal(app.nodes.get('#modalContent').innerHTML,'');
});
test('legacy migration preserves only explicitly followed or imported programmes',()=>{
  const app=boot({privateData:{following:['papy']}});
  assert.equal(app.run('state.shows.length'),1);assert.equal(app.run('visibleEpisodes().length'),20);
  app.emit('auth',{status:'loading',user:{uid:'bob'}});app.emit('data',{uid:'bob',data:readyData(app)});
  assert.equal(app.run('state.shows.length'),0);
  app.emit('data',{uid:'alice',data:readyData(app,{following:['rhino']})});assert.equal(app.run('state.shows.length'),0);
});
test('library navigation groups multiple programmes by channel and exposes their episodes',()=>{
  const app=boot({privateData:{shows:[show(),show({id:'second',name:'Other show'})],episodes:[video(),video('BBBBBBBBBBB',{showId:'second'})]}});
  assert.equal(app.run('channels().length'),1);
  app.run("location.hash='#/channels';render()");assert.match(app.nodes.get('#results').innerHTML,/2 émissions/);
  app.run("location.hash='#/channel/my%20channel';render()");assert.match(app.nodes.get('#results').innerHTML,/Other show/);
  app.run("location.hash='#/channel-episodes/my%20channel';render()");assert.equal(app.run('filteredEpisodes().length'),2);
});
test('new programme validation requires links for channels and playlists but accepts a known channel name for keywords',async()=>{
  const app=boot({privateData:{shows:[show()]}});
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[],scanned:50,nextPageToken:null})");
  const form={id:'showForm',dataset:{},values:{name:'Second',channel:'My channel',mode:'channel',source:'',keywords:''}};
  await app.listeners.submit({preventDefault(){},target:form});assert.equal(app.run('state.shows.length'),1);
  form.values.mode='playlist';await app.listeners.submit({preventDefault(){},target:form});assert.equal(app.run('state.shows.length'),1);
  form.values.mode='keywords';form.values.keywords='second';await app.listeners.submit({preventDefault(){},target:form});
  assert.equal(app.run('state.shows.length'),2);assert.match(app.nodes.get('#modalContent').innerHTML,/Importer depuis YouTube/);
  assert.equal(app.writes.at(-1).next.shows[1].source,'https://www.youtube.com/@mychannel');
});
test('unknown channel names are searched and require an explicit choice before importing',async()=>{
  const app=boot();app.run("showForm();globalThis.calls=[];globalThis.youtubeFavsCloud.youtube=async data=>{calls.push(data);return data.action==='channels'?{channels:[{id:'UC1234567890123456789012',name:'Actual channel',url:'https://www.youtube.com/channel/UC1234567890123456789012'}]}:{episodes:[],scanned:0,nextPageToken:null};}");
  const form=app.element('#showForm');form.values={name:'Show',channel:'A name',mode:'keywords',source:'',keywords:'show'};
  await app.listeners.submit({preventDefault(){},target:form});
  assert.equal(app.run('state.shows.length'),0);assert.match(app.nodes.get('#channelMatches').innerHTML,/Actual channel/);
  form.values.resolvedSource='https://www.youtube.com/channel/UC1234567890123456789012';
  await app.listeners.submit({preventDefault(){},target:form});
  assert.equal(app.run('state.shows[0].channel'),'Actual channel');assert.equal(app.run('calls[0].action'),'channels');
});
test('keyword scanning stops after five empty pages and resumes with the next token',async()=>{
  const app=boot({privateData:{shows:[show()]}});
  app.run("globalThis.calls=[];globalThis.youtubeFavsCloud.youtube=async data=>{calls.push(data);return {episodes:[],scanned:50,nextPageToken:String(calls.length)};}");
  await app.click({youtube:'program'});assert.equal(app.run('calls.length'),5);
  assert.match(app.nodes.get('#modalContent').innerHTML,/250 publications/);
  await app.click({youtube:'program',continue:'true'});assert.equal(app.run('calls[5].pageToken'),'5');assert.equal(app.run('calls.length'),10);
  assert.equal(app.writes.length,0);
});
test('import selections preserve watched choices and set a persistent cover from imported videos',async()=>{
  const app=boot({privateData:{shows:[show({mode:'channel',keywords:''})]}});
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'First'},{id:'BBBBBBBBBBB',title:'Second'}],scanned:2,nextPageToken:null})");
  await app.click({youtube:'program'});assert.equal(app.writes.length,0);
  await app.click({importWatched:'AAAAAAAAAAA'});
  app.listeners.change({target:{dataset:{importVideo:'BBBBBBBBBBB'},checked:false}});
  await app.click({action:'confirm-youtube-import'});
  assert.equal(app.run('visibleEpisodes().length'),1);assert.equal(app.run("state.watched.includes('AAAAAAAAAAA')"),true);
  assert.equal(app.writes.at(-1).next.shows[0].cover,'AAAAAAAAAAA');
  assert.match(app.run('showCard(state.shows[0])'),/i.ytimg.com\/vi\/AAAAAAAAAAA/);
});
test('closing preview writes no episodes and old-account responses are ignored',async()=>{
  const app=boot({privateData:{shows:[show()]}});
  app.run('globalThis.youtubeFavsCloud.youtube=()=>new Promise(resolve=>globalThis.release=resolve)');
  const pending=app.click({youtube:'program'});app.emit('auth',{status:'signed-out',user:null});
  app.run("release({episodes:[{id:'AAAAAAAAAAA',title:'Old account'}],scanned:1,nextPageToken:null})");await pending;
  assert.equal(app.writes.length,0);assert.equal(app.run('visibleEpisodes().length'),0);
});
test('removing imported videos persists private exclusions and keeps them unchecked on reimport',async()=>{
  const app=boot({privateData:{shows:[show()],episodes:[video()]}});
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'Removed'}],scanned:1,nextPageToken:null})");
  await app.click({removeVideo:'AAAAAAAAAAA'});assert.equal(app.writes.length,0);
  assert.equal(app.nodes.get('#removalModal').open,true);
  await app.click({action:'confirm-removal'});assert.equal(app.writes.at(-1).next.episodes[0].hidden,true);
  assert.equal(app.nodes.get('#removalModal').open,false);
  await app.click({youtube:'program'});assert.equal(app.run("youtubeImports.get('program').selected.size"),0);
});
test('watchlist checks sources and separates new releases from the unseen backlog',async()=>{
  const app=boot({privateData:{shows:[show({mode:'channel',keywords:''})],episodes:[video(),video('CCCCCCCCCCC',{hidden:true})]}});
  app.run("globalThis.calls=[];globalThis.youtubeFavsCloud.youtube=async data=>{calls.push(data);return {episodes:[{id:'BBBBBBBBBBB',title:'New release',publishedAt:'2026-10-20T10:00:00Z'},{id:'CCCCCCCCCCC',title:'Removed',publishedAt:'2026-10-20T10:00:00Z'},{id:'DDDDDDDDDDD',title:'Old archive',publishedAt:'2025-01-01T00:00:00Z'}],scanned:3,nextPageToken:null};}");
  await app.run('checkNewReleases()');
  assert.equal(app.run("state.episodes.some(e=>e.id==='BBBBBBBBBBB'&&e.newRelease)"),true);
  assert.equal(app.run("state.episodes.some(e=>e.id==='DDDDDDDDDDD')"),false);
  assert.equal(app.run("visibleEpisodes().some(e=>e.id==='CCCCCCCCCCC')"),false);
  app.run("newsVisit=true;location.hash='#/watchlist';render()");
  assert.match(app.nodes.get('#results').innerHTML,/Nouvelles sorties/);assert.match(app.nodes.get('#results').innerHTML,/Épisodes non vus/);
  app.run("toggle('watched','BBBBBBBBBBB')");assert.equal(app.run("state.episodes.find(e=>e.id==='BBBBBBBBBBB').newRelease"),false);
  assert.equal(app.run("filteredEpisodes().some(e=>e.id==='BBBBBBBBBBB')"),false);
  assert.equal(app.run('calls[0].refresh'),true);
});
test('entering watchlist triggers a new check on each visit without a render loop',async()=>{
  const app=boot({privateData:{shows:[show({mode:'channel',keywords:''})]}});
  app.run("globalThis.calls=0;globalThis.youtubeFavsCloud.youtube=async()=>{calls++;return {episodes:[],scanned:0,nextPageToken:null};};location.hash='#/watchlist';render()");
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(app.run('calls'),1);app.run("render();location.hash='#/shows';render();location.hash='#/watchlist';render()");
  for(let i=0;i<20;i++)await Promise.resolve();assert.equal(app.run('calls'),2);
});
test('source failures are explicit and preserve existing unwatched episodes',async()=>{
  const app=boot({privateData:{shows:[show()],episodes:[video()]}});
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>{throw new Error('Quota atteint');}");await app.run('checkNewReleases()');
  assert.equal(app.run('newsState.errors.length'),1);assert.equal(app.run('visibleEpisodes().length'),1);assert.equal(app.run('cloudStatus.phase'),'ready');
});
test('player loads immediately and uses an accessible watched icon',()=>{
  const app=boot({privateData:{following:['papy']}});app.run("playEpisode('V34x1CxlAZ0')");
  assert.match(app.nodes.get('#modalContent').innerHTML,/youtube-nocookie.com\/embed\/V34x1CxlAZ0\?autoplay=1/);
  assert.doesNotMatch(app.nodes.get('#modalContent').innerHTML,/Charger le lecteur/);
  assert.match(app.nodes.get('#modalContent').innerHTML,/data-player-watched=/);
  assert.match(app.run("watchedButton(state.episodes[0])"),/data-toggle="watched" data-id=/);
  assert.equal(app.run("videoId('https://youtube.com.evil.test/watch?v=V34x1CxlAZ0')"),null);
});
test('cloud failures block modifications without a local private-data fallback',()=>{
  const app=boot({privateData:{shows:[show()],episodes:[video()]}});
  app.emit('sync',{uid:'alice',status:'error',message:'Firestore refuse l’accès.'});assert.match(app.nodes.get('#app').innerHTML,/Firestore refuse/);
  app.run("toggle('watched','AAAAAAAAAAA')");assert.equal(app.writes.length,0);assert.equal(app.values.size,0);
});
test('public Worker URL configuration does not overwrite private selections',async()=>{
  const app=boot();app.run("globalThis.youtubeFavsCloud.configureWorker=async origin=>({origin,persisted:true});location.hash='#/settings';render()");
  await app.listeners.submit({preventDefault(){},target:{id:'workerForm',values:{origin:'https://example.workers.dev'},querySelector:()=>({})}});
  assert.match(app.nodes.get('#app').innerHTML,/Worker connecté/);assert.equal(app.writes.length,0);
});

test('deletion can be cancelled and a pending confirmation is cleared on account changes',async()=>{
  const app=boot({privateData:{shows:[show()],episodes:[video()]}});
  await app.click({removeVideo:'AAAAAAAAAAA'});
  assert.match(app.run('episodeCard(state.episodes[0])'),/title="Supprimer de ma bibliothèque"/);
  await app.click({action:'cancel-removal'});
  assert.equal(app.run('visibleEpisodes().length'),1);assert.equal(app.writes.length,0);
  await app.click({action:'confirm-removal'});assert.equal(app.writes.length,0);
  await app.click({removeVideo:'AAAAAAAAAAA'});
  app.emit('auth',{status:'loading',user:{uid:'bob'}});
  app.emit('data',{uid:'bob',data:readyData(app,{shows:[show()],episodes:[video()]})});
  await app.click({action:'confirm-removal'});
  assert.equal(app.nodes.get('#removalModal').open,false);
  assert.equal(app.run('visibleEpisodes().length'),1);assert.equal(app.writes.length,0);
});
test('confirmation preserves the open import preview and its selections',async()=>{
  const app=boot({privateData:{shows:[show()],episodes:[video()]}});
  app.run("globalThis.youtubeFavsCloud.youtube=async()=>({episodes:[{id:'AAAAAAAAAAA',title:'Existing'},{id:'BBBBBBBBBBB',title:'New'}],scanned:2,nextPageToken:null})");
  await app.click({youtube:'program'});
  await app.click({removeVideo:'AAAAAAAAAAA'});
  await app.click({action:'cancel-removal'});
  assert.equal(app.run('activeImportId'),'program');
  assert.equal(app.run("youtubeImports.get('program').selected.has('BBBBBBBBBBB')"),true);
  await app.click({removeVideo:'AAAAAAAAAAA'});await app.click({action:'confirm-removal'});
  assert.equal(app.nodes.get('#modal').open,true);
  assert.match(app.nodes.get('#modalContent').innerHTML,/Retirée de votre bibliothèque/);
  assert.equal(app.run("youtubeImports.get('program').selected.has('BBBBBBBBBBB')"),true);
});
test('publication display respects timezone offsets, rejects missing dates and distinguishes duration',()=>{
  const app=boot();
  assert.equal(app.run("publicationLabel('2026-10-21T12:30:00Z')"),app.run("publicationLabel('2026-10-21T14:30:00+02:00')"));
  assert.match(app.run("publicationLabel('2026-10-21T12:30:00Z')"),/datetime="2026-10-21T12:30:00.000Z"/);
  assert.equal(app.run("publicationLabel('invalid')"),'');assert.equal(app.run("publicationLabel('')"),'');
  assert.match(app.run("episodeMetadata({durationLabel:'12:34'},'Channel')"),/Durée de la vidéo/);
  assert.doesNotMatch(app.run("episodeMetadata({durationLabel:'12:34'},'Channel')"),/<time/);
});
