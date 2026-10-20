'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalogueSource = fs.readFileSync(require('node:path').join(__dirname, '../data/catalog.js'), 'utf8');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');

// Minimal DOM boundary: exercise application state and rendering without loading YouTube.
function boot(saved) {
  const listeners = {};
  const values = new Map(saved ? [['youtube-favs:v1', saved]] : []);
  const nodes = new Map();
  function element(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', open: false,
      classList: {toggle(){},add(){},remove(){}}, style:{setProperty(){}},
      addEventListener(){},setAttribute(){},removeAttribute(){},
      showModal(){this.open=true;},close(){this.open=false;},
    });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document:{querySelector:element,querySelectorAll:()=>[],documentElement:element('html'),body:element('body'),addEventListener:(name,fn)=>listeners[name]=fn},
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
    location:{hash:'#/shows'},history:{replaceState(){}},window:{addEventListener(){},scrollTo(){}},
    structuredClone,URL,setTimeout:()=>0,clearTimeout(){},crypto:require('node:crypto').webcrypto,
    FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key] ?? '';}}
  });
  vm.runInContext(catalogueSource,context);
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),nodes,values,listeners};
}

test('show and episode routes render with seeded programs',()=>{
  const app=boot();
  assert.match(app.nodes.get('#app').innerHTML,/Mes émissions/);
  assert.match(app.nodes.get('#results').innerHTML,/Papy Grenier/);
  assert.match(app.nodes.get('#results').innerHTML,/Rhinocéros/);
  app.run("location.hash='#/episodes';render()");
  assert.equal(app.run('filteredEpisodes().length'),189);
  app.run("location.hash='#/show/papy';render()");
  assert.equal(app.run('filteredEpisodes().length'),20);
});

test('favorites, watched filter, following and persistence remain independent',()=>{
  const app=boot();
  app.run("toggle('favorites','V34x1CxlAZ0');location.hash='#/favorites';render()");
  assert.equal(app.run('filteredEpisodes().length'),1);
  app.run("toggle('watched','V34x1CxlAZ0');filter.status='Non vus'");
  assert.equal(app.run('filteredEpisodes().length'),0);
  app.run("filter.status='Vus'");
  assert.equal(app.run('filteredEpisodes().length'),1);
  const reloaded=boot(app.values.get('youtube-favs:v1'));
  assert.equal(reloaded.run("state.favorites.includes('V34x1CxlAZ0')"),true);
  app.run("state.following=['rhino'];location.hash='#/episodes';render()");
  assert.equal(app.run('filteredEpisodes().length'),72);
});

test('catalogue search ignores accents and returns both Cyberpunk versions',()=>{
  const app=boot();
  app.run("location.hash='#/episodes';render();filter.query='CYBERPUNK'");
  assert.equal(app.run('filteredEpisodes().length'),2);
  assert.equal(app.run("normalize('Rhinocéros')"),'rhinoceros');
});

test('video URL validation rejects wrong hosts and supports short and mobile links',()=>{
  const app=boot();
  for(const url of ['https://youtu.be/V34x1CxlAZ0','https://m.youtube.com/watch?v=V34x1CxlAZ0','https://www.youtube.com/shorts/V34x1CxlAZ0']){
    assert.equal(app.run(`videoId(${JSON.stringify(url)})`),'V34x1CxlAZ0');
  }
  for(const url of ['https://youtube.com.evil.test/watch?v=V34x1CxlAZ0','javascript:alert(1)','https://youtube.com/watch?v=wrong']){
    assert.equal(app.run(`videoId(${JSON.stringify(url)})`),null);
  }
});

test('manual show creation validates source and stores the new rule',()=>{
  const app=boot();
  const form={id:'showForm',dataset:{},values:{name:'Test program',channel:'Test channel',mode:'keywords',source:'https://evil.test/@channel',keywords:'test'}};
  const submit=()=>app.listeners.submit({preventDefault(){},target:form});
  submit();
  assert.equal(app.run('state.shows.length'),5);
  assert.match(app.nodes.get('#formError').textContent,/youtube.com/);
  form.values.source='https://www.youtube.com/@channel';submit();
  assert.equal(app.run('state.shows.length'),6);
  assert.equal(app.run("state.shows.find(s=>s.name==='Test program').keywords"),'test');
});

test('player requires explicit load and user text is escaped',()=>{
  const app=boot();
  app.run("playEpisode('V34x1CxlAZ0')");
  const markup=app.nodes.get('#modalContent').innerHTML;
  assert.match(markup,/Charger le lecteur/);
  assert.doesNotMatch(markup,/<iframe/);
  assert.equal(app.run("escapeHtml('<img onerror=alert(1)>')"),'&lt;img onerror=alert(1)&gt;');
});

test('malformed saved state recovers safely and drops orphaned videos',()=>{
  const app=boot('{broken');
  assert.equal(app.run('state.shows.length'),5);
  const state=JSON.parse(app.run('JSON.stringify(initialState())'));
  state.episodes.push({id:'abcdefghijk',title:'orphan',showId:'missing'});
  const restored=boot(JSON.stringify(state));
  assert.equal(restored.run('state.episodes.length'),189);
});


test('catalogue contains verified selections without duplicate or orphaned videos',()=>{
  const app=boot();
  for(const [id,count] of Object.entries({papy:20,rhino:72,esquive:74,underscore:11,'retro-f1':12})){
    assert.equal(app.run(`seedEpisodes.filter(e=>e.showId===${JSON.stringify(id)}).length`),count);
  }
  assert.equal(app.run('new Set(seedEpisodes.map(e=>e.id)).size'),189);
  assert.equal(app.run("seedEpisodes.every(e=>seedShows.some(s=>s.id===e.showId) && /^[\\w-]{11}$/.test(e.id) && Number.isFinite(Date.parse(e.publishedAt)))"),true);
  assert.equal(app.run("seedEpisodes.filter(e=>e.showId==='retro-f1').every(e=>e.channelId==='UC8ggH3zU61XO0nMskSQwZdA')"),true);
  assert.equal(app.run("seedEpisodes.some(e=>e.id==='c_iqJ1ViNQk')"),false);
});

test('upgrading the original prototype retains personal state and adds new selections once',()=>{
  const old=boot();
  const saved=JSON.parse(old.run('JSON.stringify(initialState())'));
  saved.shows=saved.shows.filter(s=>['papy','rhino'].includes(s.id));
  saved.episodes=saved.episodes.filter(e=>['V34x1CxlAZ0','MatN8AsTDCs','VXycYC2xqrE'].includes(e.id));
  saved.following=['papy'];saved.favorites=['V34x1CxlAZ0'];saved.watched=['MatN8AsTDCs'];saved.queue=['VXycYC2xqrE'];saved.accent='#e7bc75';
  delete saved.catalogVersion;delete saved.knownCatalogShows;
  const migrated=boot(JSON.stringify(saved));
  assert.equal(migrated.run('state.shows.length'),5);
  assert.equal(migrated.run('state.episodes.length'),189);
  assert.equal(migrated.run("state.favorites.includes('V34x1CxlAZ0') && state.watched.includes('MatN8AsTDCs') && state.queue.includes('VXycYC2xqrE')"),true);
  assert.equal(migrated.run("state.following.includes('rhino')"),false);
  assert.equal(migrated.run('state.following.length'),4);
  assert.equal(migrated.run('state.accent'),'#e7bc75');
  const reloaded=boot(migrated.values.get('youtube-favs:v1'));
  assert.equal(reloaded.run('state.episodes.length'),189);
  assert.equal(reloaded.run('state.following.length'),4);
});

test('full-channel rules and user-edited rules persist alongside catalogue refreshes',()=>{
  const app=boot();
  assert.equal(app.run("showFor('esquive').mode"),'channel');
  app.run("showFor('rhino').keywords='custom keyword';showFor('rhino').customRule=true;save()");
  const restored=boot(app.values.get('youtube-favs:v1'));
  assert.equal(restored.run("showFor('rhino').keywords"),'custom keyword');
  restored.run("location.hash='#/show/retro-f1';render()");
  assert.match(restored.nodes.get('#app').innerHTML,/2021/);
});
