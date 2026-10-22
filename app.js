'use strict';

const STORAGE_KEY = 'youtube-favs:v1';
const icons = {
  search: '<circle cx="7.5" cy="7.5" r="5.5"/><path d="m12 12 4 4"/>',
  grid: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="11" y="2" width="5" height="5" rx="1"/><rect x="2" y="11" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/>',
  list: '<path d="M6 4h10M6 9h10M6 14h10M2 4h.1M2 9h.1M2 14h.1"/>',
  check: '<path d="m3 9 4 4 8-9"/>',
  clock: '<circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2"/>',
  plus: '<path d="M9 3v12M3 9h12"/>',
  trash: '<path d="M2 4h14M6 4V2h6v2M4 4l1 12h8l1-12M7 7v6M11 7v6"/>',
  close: '<path d="m4 4 10 10M14 4 4 14"/>',
  info: '<circle cx="9" cy="9" r="7"/><path d="M9 8v5M9 5h.01"/>',
  settings: '<path d="M2 5h14M2 13h14"/><circle cx="6" cy="5" r="2"/><circle cx="12" cy="13" r="2"/>',
  arrow: '<path d="M3 9h12m-5-5 5 5-5 5"/>',
};
const syncMarkup=(node,html,options)=>globalThis.YouTubeFavsDOM.update(node,html,options);
const icon = name => `<svg viewBox="0 0 18 18" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const catalogue = globalThis.YOUTUBE_FAVS_CATALOG || {version:'empty', importedAt:null, shows:[], episodes:[]};
const seedEpisodes = catalogue.episodes;
const privateModel = globalThis.YouTubeFavsState;
function initialState() { return privateModel.hydrate(privateModel.empty(),catalogue); }
let state = initialState();
let cloudStatus = {phase:'loading',user:null,message:'',sync:'ready'};
let lastSaved = privateModel.empty();
let youtubeGeneration=0;
const youtubeMetadata=new Map(),youtubeImports=new Map(),youtubeRequested=new Set();
let youtubeMessage='';
let workerMessage='';
function legacyState() {
  try {const raw=localStorage.getItem(STORAGE_KEY);return raw?JSON.parse(raw):null;}catch{return null;}
}
let filter = {query:'',category:'all',status:'all',sort:'newest',show:'all'};
let lastRoute = '';
let toastTimer;
let loadingTimer;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modalContent');
const removalModal = document.querySelector('#removalModal');
let pendingRemoval=null;
function canEdit() { return cloudStatus.phase==='ready' && Boolean(globalThis.youtubeFavsCloud); }
function save() {
  applyPreferences();
  if(!canEdit())return Promise.resolve(false);
  const previous=lastSaved;
  const next=privateModel.pack(state,catalogue);
  lastSaved=structuredClone(next);
  const uid=cloudStatus.user.uid;
  return globalThis.youtubeFavsCloud.save(previous,next).then(()=>true).catch(error=>{
    if(error.code!=='session-changed' && cloudStatus.user?.uid===uid && cloudStatus.phase!=='error'){
      cloudStatus.phase='error';
      cloudStatus.message='La sauvegarde cloud a échoué. Réessayez pour recharger les dernières données enregistrées.';
      closeModal();render();
    }
    return false;
  });
}
// API metadata stays in this account's tab memory; Firestore stores references only.
function applyYoutubeMetadata(){
  state.episodes=state.episodes.map(episode=>({...episode,...(youtubeMetadata.get(episode.id)||{}),showId:episode.showId}));
}
let activeImportId=null,importCloseTimer,modalVersion=0;
let showShortVideos=false;
const isShortVideo=episode=>globalThis.YouTubeFavsLibrary.isShortVideo(episode);
const shortVideosKey=()=>`youtube-favs:short-videos:${cloudStatus.user?.uid||'anonymous'}`;
function loadShortVideosPreference(){
  try{showShortVideos=localStorage.getItem(shortVideosKey())==='true';}catch{showShortVideos=false;}
}
function setShortVideosPreference(value){
  showShortVideos=value;
  try{localStorage.setItem(shortVideosKey(),String(value));}catch{}
  render();toast(value?'Shorts et vidéos courtes affichés.':'Shorts et vidéos courtes masqués.');
}
const visibleEpisodes=()=>state.episodes.filter(episode=>!episode.hidden&&(showShortVideos||!isShortVideo(episode)));
const importCandidates=progress=>progress.candidates.filter(episode=>progress.includeShorts||!isShortVideo(episode));
const canImportVideo=id=>!state.episodes.some(episode=>episode.id===id&&!episode.hidden);
function youtubePanel(show){
  const progress=youtubeImports.get(show.id)||{};
  return `<section class="panel youtube-panel" aria-label="Import YouTube"><div><h2>Importer des vidéos</h2><p role="status" aria-live="polite">${escapeHtml(progress.message||'Recherchez les épisodes de cette source, puis choisissez les vidéos à ajouter.')}</p><span class="small muted">Prévisualisation avant import · Archives par pages de 50 publications.</span></div><div class="actions"><button class="primary" data-youtube="${escapeHtml(show.id)}" ${progress.busy?'disabled':''}>Importer depuis YouTube</button>${progress.next?`<button data-youtube="${show.id}" data-continue="true" ${progress.busy?'disabled':''}>${show.mode==='channel'?'Charger les 50 suivantes':'Reprendre la recherche'}</button>`:''}</div></section>`;
}
function renderImportPreview(showId){
  if(activeImportId!==showId)return;
  const show=showFor(showId),progress=youtubeImports.get(showId);
  if(!show||!progress)return;
  modal.classList.add('import-dialog');
  const locked=progress.committing||progress.success;
  const scrollTop=document.querySelector('.import-results')?.scrollTop||0;
  const focusedVideo=document.activeElement?.dataset?.importVideo;
  const selected=importCandidates(progress).filter(episode=>progress.selected.has(episode.id)&&canImportVideo(episode.id));
  const candidates=importCandidates(progress),excluded=progress.candidates.length-candidates.length;
  const rows=candidates.map(episode=>{
    const existing=state.episodes.find(item=>item.id===episode.id);
    const imported=existing&&!existing.hidden,hidden=existing?.hidden;
    return `<article class="import-row" data-episode-id="${episode.id}"><label class="import-choice"><input type="checkbox" data-import-video="${episode.id}" ${progress.selected.has(episode.id)&&!imported?'checked':''} ${imported||locked?'disabled':''}><span class="sr-only">Sélectionner ${escapeHtml(episode.title)}</span></label>${imageTag(episode.id)}<div class="import-description"><strong>${escapeHtml(episode.title)}</strong><p class="small">${episodeMetadata(episode,show.channel)}</p><span class="import-badge ${imported?'imported':''}">${imported?`Déjà présente dans ${escapeHtml(showFor(existing.showId)?.name||'votre bibliothèque')}`:hidden?'Retirée de votre bibliothèque · réimportation possible':'Nouvelle vidéo'}</span></div><a class="text-button" href="https://www.youtube.com/watch?v=${episode.id}" target="_blank" rel="noopener noreferrer">Voir ↗</a>${imported?`<button class="icon-button danger" data-remove-video="${episode.id}" aria-label="Supprimer ${escapeHtml(episode.title)} de ma bibliothèque" title="Supprimer de ma bibliothèque" ${locked?'disabled':''}>${icon('trash')}</button>`:`<button class="icon-button ${progress.watched.has(episode.id)?'selected':''}" data-import-watched="${episode.id}" ${locked?'disabled':''} aria-pressed="${progress.watched.has(episode.id)}" aria-label="Importer ${escapeHtml(episode.title)} comme ${progress.watched.has(episode.id)?'non vu':'vu'}" title="${progress.watched.has(episode.id)?'Sera marqué vu':'Sera marqué non vu'}">${icon('check')}</button>`}</article>`;
  }).join('');
  modalContent.innerHTML=modalHeading(`Importer depuis YouTube · ${escapeHtml(show.name)}`)+`<p class="small import-status" role="status">${escapeHtml(progress.message)}</p><p class="hint import-explanation">Aucune vidéo n’est ajoutée avant votre confirmation. Les vidéos déjà présentes sont indiquées ; celles que vous avez retirées restent décochées.</p><div class="import-toolbar"><span>${candidates.length} vidéos affichées${excluded?` · ${excluded} formats courts exclus`:''} · <strong>${selected.length} sélectionnées</strong></span><div class="actions"><button data-action="import-select-all" ${locked?'disabled':''}>Tout sélectionner</button><button data-action="import-select-none" ${locked?'disabled':''}>Tout désélectionner</button></div></div><label class="import-shorts"><input type="checkbox" data-import-shorts ${progress.includeShorts?'checked':''} ${locked?'disabled':''}> Inclure les Shorts et vidéos courtes (≤ 3 min)<span class="hint">Filtre par durée : certaines vidéos classiques courtes sont aussi exclues.${!showShortVideos&&progress.includeShorts?' Le profil les masque actuellement dans la bibliothèque.':''}</span></label><label class="import-watched-all"><input type="checkbox" data-import-watched-all ${progress.defaultWatched?'checked':''} ${locked?'disabled':''}> Marquer les vidéos sélectionnées comme vues</label><div class="import-results">${rows||`<p class="empty">${progress.busy?'Recherche des vidéos…':'Aucune vidéo sur les pages analysées.'}</p>`}</div><p class="form-error" role="alert">${escapeHtml(progress.error||'')}</p><div class="import-footer">${progress.busy?'<button data-action="stop-scan">Mettre en pause</button>':''}<button data-close ${progress.committing?'disabled':''}>Fermer</button>${progress.next?`<button data-youtube="${escapeHtml(showId)}" data-continue="true" ${progress.busy||locked?'disabled':''}>${show.mode==='channel'?'Charger les 50 suivantes':'Continuer la recherche'}</button>${show.mode==='channel'?`<button data-youtube="${escapeHtml(showId)}" data-continue="true" data-scan-all="true" ${progress.busy||locked?'disabled':''}>Parcourir tout le reste</button>`:''}`:''}<button class="primary ${progress.success?'import-success':''}" data-action="confirm-youtube-import" ${!selected.length||progress.busy||locked?'disabled':''}>${progress.success?`${icon('check')} <span role="status">Importation réussie</span>`:progress.committing?'Import en cours…':`Importer la sélection (${selected.length})`}</button></div>`;
  const results=document.querySelector('.import-results');if(results)results.scrollTop=scrollTop;
  if(focusedVideo)document.querySelector(`[data-import-video="${focusedVideo}"]`)?.focus?.({preventScroll:true});
}
async function refreshYoutube(showId,continuing=false,allPages=false){
  const show=showFor(showId),previous=youtubeImports.get(showId);
  if(!canEdit()||!show||previous?.busy||previous?.committing)return;
  const generation=youtubeGeneration,rule=JSON.stringify([show.mode,show.source,show.keywords]);
  const progress=continuing&&previous?previous:{next:null,scanned:0,candidates:[],selected:new Set(),watched:new Set(),defaultWatched:false,includeShorts:show.includeShorts===true};
  progress.busy=true;progress.stop=false;progress.success=false;progress.error='';progress.message='Recherche des vidéos sur YouTube…';
  youtubeImports.set(showId,progress);
  if(activeImportId!==showId){openModal('');activeImportId=showId;}
  renderImportPreview(showId);render();
  try{
    const summary=await globalThis.YouTubeFavsLibrary.scan({
      mode:show.mode,pageToken:progress.next||'',singlePage:show.mode==='channel'?!allPages:show.mode!=='keywords',
      shouldStop:()=>generation!==youtubeGeneration||!canEdit()||progress.stop||!showFor(showId),
      request:pageToken=>globalThis.youtubeFavsCloud.youtube({action:'catalog',mode:show.mode,source:show.source,keywords:show.keywords,pageToken}),
      onPage(result,page){
        if(generation!==youtubeGeneration)return;
        const current=showFor(showId);if(!current||JSON.stringify([current.mode,current.source,current.keywords])!==rule){progress.stop=true;return;}
        progress.channelId=result.channelId||progress.channelId;
        for(const episode of result.episodes){
          if(progress.candidates.some(candidate=>candidate.id===episode.id))continue;
          progress.candidates.push(episode);
          if((progress.includeShorts||!isShortVideo(episode))&&!state.episodes.some(existing=>existing.id===episode.id))progress.selected.add(episode.id);
          if(progress.defaultWatched)progress.watched.add(episode.id);
        }
        progress.scanned+=result.scanned||0;progress.next=page.next;
        progress.message=`${progress.scanned} publications analysées · ${progress.candidates.length} vidéos trouvées${show.mode==='keywords'?` · ${page.emptyPages}/5 pages consécutives sans correspondance`:''}.`;
        render();renderImportPreview(showId);
      },
    });
    if(generation!==youtubeGeneration)return;
    progress.next=summary.next;
    progress.message=`${progress.scanned} publications analysées · ${progress.candidates.length} vidéos trouvées. ${!progress.next?'Dernière page atteinte.':summary.reason==='five-empty'?'Pause après 5 pages sans correspondance (250 publications). Vous pouvez continuer.':summary.reason==='paused'?'Recherche mise en pause. Vous pouvez continuer.':'Des archives restent à parcourir.'}`;
  }catch(error){
    if(generation!==youtubeGeneration)return;
    progress.error=error.message||'La recherche YouTube a échoué.';progress.message=progress.error;
  }finally{if(generation===youtubeGeneration){progress.busy=false;render();renderImportPreview(showId);}}
}
async function confirmYoutubeImport(){
  const showId=activeImportId,progress=youtubeImports.get(showId);
  if(!canEdit()||!progress||progress.busy||progress.committing||progress.success)return;
  const selected=importCandidates(progress).filter(episode=>progress.selected.has(episode.id)&&canImportVideo(episode.id));
  if(!selected.length)return;
  const existingPayload=privateModel.pack(state,catalogue);
  const extra=selected.filter(episode=>!state.episodes.some(existing=>existing.id===episode.id)).length;
  if(existingPayload.episodes.length+extra>1000){progress.error='La limite de 1 000 ajouts et retraits personnels est atteinte. Réduisez la sélection.';renderImportPreview(showId);return;}
  const generation=youtubeGeneration,viewVersion=modalVersion;progress.committing=true;renderImportPreview(showId);
  for(const episode of selected){
    youtubeMetadata.set(episode.id,episode);
    const existing=state.episodes.find(item=>item.id===episode.id);
    if(existing){existing.hidden=false;Object.assign(existing,episode);}
    else state.episodes.push({...episode,showId,apiImported:true,added:Date.now(),note:''});
    const imported=state.episodes.find(item=>item.id===episode.id);if(imported)imported.newRelease=false;
    if(progress.watched.has(episode.id)){if(!state.watched.includes(episode.id))state.watched.push(episode.id);}else state.watched=state.watched.filter(id=>id!==episode.id);
    progress.selected.delete(episode.id);
  }
  const show=showFor(showId);if(show){updateAutomaticCover(show);show.includeShorts=progress.includeShorts===true;show.customRule=true;show.releaseAfter=new Date().toISOString();adoptSource(show,{channelId:progress.channelId});}
  applyYoutubeMetadata();
  const saved=await save();
  if(generation!==youtubeGeneration)return;
  progress.committing=false;
  if(saved){progress.success=true;progress.message=`${selected.length} vidéo${selected.length>1?'s':''} importée${selected.length>1?'s':''}. ${progress.next?'Des archives restent à parcourir.':'Dernière page atteinte.'}`;toast('Importation réussie.');}
  else progress.error='La sélection n’a pas pu être enregistrée. Rechargez votre bibliothèque.';
  render();renderImportPreview(showId);
  if(saved&&modalVersion===viewVersion&&activeImportId===showId&&modal.open){
    clearTimeout(importCloseTimer);
    importCloseTimer=setTimeout(()=>{
      if(generation===youtubeGeneration&&modalVersion===viewVersion&&activeImportId===showId&&youtubeImports.get(showId)===progress&&progress.success)closeModal();
    },1200);
  }
}
function cancelRemoval(){
  pendingRemoval=null;
  if(removalModal.open)removalModal.close();
}
function requestRemoval(id){
  if(!canEdit())return;
  const episode=state.episodes.find(item=>item.id===id&&!item.hidden);
  if(!episode)return;
  pendingRemoval={id,type:'episode',generation:youtubeGeneration};
  document.querySelector('#removalDescription').textContent='Êtes-vous sûr de vouloir supprimer cette vidéo de votre bibliothèque ? Elle ne sera plus affichée ni ajoutée automatiquement aux nouvelles sorties. Vous pourrez la réimporter manuellement.';
  document.querySelector('#removalTitle').textContent='Supprimer cette vidéo ?';
  document.querySelector('#removalEpisode').textContent=episode.title;
  if(!removalModal.open)removalModal.showModal();
}
async function confirmRemoval(){
  const pending=pendingRemoval;
  cancelRemoval();
  if(pending&&pending.generation===youtubeGeneration&&canEdit()){
    if(pending.type==='show')await removeShow(pending.id);else await removeEpisode(pending.id);
  }
}
function requestShowRemoval(id){
  if(!canEdit())return;
  const show=showFor(id);if(!show)return;
  pendingRemoval={id,type:'show',generation:youtubeGeneration};
  const count=visibleEpisodes().filter(episode=>episode.showId===id).length;
  document.querySelector('#removalTitle').textContent='Supprimer cette émission ?';
  document.querySelector('#removalEpisode').textContent=show.name;
  document.querySelector('#removalDescription').textContent=`Cette émission, ses ${count} épisode(s) importé(s) et leurs statuts de visionnage seront supprimés de votre bibliothèque. Ses nouvelles sorties ne seront plus recherchées. Vous pourrez suivre cette émission à nouveau.`;
  if(!removalModal.open)removalModal.showModal();
}
async function removeShow(id){
  if(!canEdit()||!showFor(id))return;
  const episodeIds=new Set(state.episodes.filter(episode=>episode.showId===id).map(episode=>episode.id));
  const progress=youtubeImports.get(id);if(progress)progress.stop=true;
  youtubeImports.delete(id);
  state.shows=state.shows.filter(show=>show.id!==id);
  state.following=state.following.filter(showId=>showId!==id);
  state.episodes=state.episodes.filter(episode=>episode.showId!==id);
  for(const key of ['watched','favorites','queue'])state[key]=state[key].filter(videoId=>!episodeIds.has(videoId));
  for(const videoId of episodeIds){youtubeMetadata.delete(videoId);youtubeRequested.delete(videoId);}
  if(filter.show===id)filter.show='all';
  const generation=youtubeGeneration;closeModal();location.hash='#/shows';render();
  if(await save()&&generation===youtubeGeneration)toast('Émission supprimée de votre bibliothèque.');
}
function markShowWatched(id){
  if(!canEdit()||!showFor(id))return;
  const episodes=visibleEpisodes().filter(episode=>episode.showId===id);
  const unseen=episodes.filter(episode=>!state.watched.includes(episode.id));
  if(!unseen.length)return;
  if(new Set([...state.watched,...unseen.map(episode=>episode.id)]).size>5000){toast('Limite de 5 000 épisodes vus atteinte.');return;}
  state.watched=[...new Set([...state.watched,...unseen.map(episode=>episode.id)])];
  for(const episode of episodes)episode.newRelease=false;
  save();render();toast(`${unseen.length} épisode(s) marqué(s) comme vu(s).`);
}
function publicationLabel(value){
  if(!value||!Number.isFinite(Date.parse(value)))return '';
  const date=new Date(value),zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const label=date.toLocaleString('fr-FR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  return `<time datetime="${escapeHtml(date.toISOString())}" title="${escapeHtml(`Publication YouTube · ${label} (${zone})`)}">${escapeHtml(label)}</time>`;
}
function episodeMetadata(episode,channel){
  const published=publicationLabel(episode.publishedAt);
  return `${escapeHtml(episode.author||channel)}${published?` · ${published}`:''}${episode.durationLabel?` · <span title="Durée de la vidéo">${icon('clock')} ${escapeHtml(episode.durationLabel)}</span>`:''}`;
}
async function removeEpisode(id){
  if(!canEdit())return;
  const episode=state.episodes.find(item=>item.id===id&&!item.hidden);
  if(!episode)return;
  const packed=privateModel.pack(state,catalogue);
  if(!packed.episodes.some(item=>item.id===id)&&packed.episodes.length>=1000){toast('Limite des modifications personnelles atteinte.');return;}
  const feedback=globalThis.YouTubeFavsDOM.captureEpisode(id);
  episode.hidden=true;
  // A private tombstone also hides bundled videos without modifying the shared catalogue.
  for(const key of ['favorites','queue'])state[key]=state[key].filter(value=>value!==id);
  for(const progress of youtubeImports.values())progress.selected.delete(id);
  const generation=youtubeGeneration,saving=save();
  render();if(activeImportId)renderImportPreview(activeImportId);
  globalThis.YouTubeFavsDOM.feedback(feedback,'removed',true);
  const saved=await saving;
  if(generation!==youtubeGeneration)return;
  if(saved)toast('Vidéo retirée. Vous pourrez la sélectionner à nouveau lors d’un import.');
}
let newsState={busy:false,message:'',errors:[]};
function releaseBoundary(show){
  if(show.releaseAfter)return Date.parse(show.releaseAfter);
  const known=state.episodes.filter(episode=>episode.showId===show.id).flatMap(episode=>[Date.parse(episode.publishedAt)||0,episode.added||0]);
  return Math.max(0,...known)||Date.now();
}
function adoptSource(show,result){
  if(/^UC[\w-]{22}$/.test(result.channelId||'')){
    show.channelId=result.channelId;show.channelSource=`https://www.youtube.com/channel/${result.channelId}`;
  }
}
async function checkNewReleases(){
  if(!canEdit()||newsState.busy)return;
  const generation=youtubeGeneration;
  newsState={busy:true,message:'Recherche des nouvelles sorties…',errors:[]};render();
  const programs=state.shows.map(show=>({...show}));let added=0,checked=0;
  for(const snapshot of programs){
    if(generation!==youtubeGeneration||!canEdit())return;
    const started=Date.now(),boundary=releaseBoundary(snapshot),candidates=new Map();
    newsState.message=`Vérification de ${snapshot.name} · ${checked+1}/${programs.length}`;render();
    try{
      let lastResult;
      await globalThis.YouTubeFavsLibrary.scan({
        mode:snapshot.mode,stopAtDate:boundary,emptyPageLimit:Infinity,
        shouldStop:()=>generation!==youtubeGeneration||!canEdit()||!showFor(snapshot.id),
        request:pageToken=>globalThis.youtubeFavsCloud.youtube({action:'catalog',mode:snapshot.mode,source:snapshot.source,keywords:snapshot.keywords,pageToken,refresh:true}),
        onPage(result,progress){
          lastResult=result;
          for(const episode of result.episodes){
            const published=Date.parse(episode.publishedAt);
            if((snapshot.includeShorts===true||!isShortVideo(episode))&&Number.isFinite(published)&&published>boundary&&published<=Date.now()&&!state.episodes.some(existing=>existing.id===episode.id))candidates.set(episode.id,episode);
          }
          if(generation===youtubeGeneration){newsState.message=`${snapshot.name} · ${progress.scanned} publications analysées`;render();}
        },
      });
      if(generation!==youtubeGeneration||!canEdit())return;
      const show=showFor(snapshot.id);
      if(!show||JSON.stringify([show.source,show.mode,show.keywords])!==JSON.stringify([snapshot.source,snapshot.mode,snapshot.keywords]))continue;
      const fresh=[...candidates.values()].filter(episode=>!state.episodes.some(existing=>existing.id===episode.id));
      if(privateModel.pack(state,catalogue).episodes.length+fresh.length>1000)throw new Error('Limite de 1 000 références personnelles atteinte.');
      for(const episode of fresh){youtubeMetadata.set(episode.id,episode);state.episodes.push({...episode,showId:show.id,apiImported:true,newRelease:true,added:Date.now(),note:''});}
      if(fresh.length)updateAutomaticCover(show);
      if(lastResult)adoptSource(show,lastResult);
      show.releaseAfter=new Date(Math.max(boundary,started-5*60000)).toISOString();show.customRule=true;
      applyYoutubeMetadata();
      if(!await save())return;
      added+=fresh.length;checked++;
    }catch(error){
      if(generation!==youtubeGeneration)return;
      newsState.errors.push(`${snapshot.name} : ${error.message||'Vérification impossible.'}`);
    }
  }
  if(generation!==youtubeGeneration)return;
  newsState.busy=false;
  newsState.message=programs.length?`${checked}/${programs.length} émissions vérifiées · ${added} nouvelle${added>1?'s':''} vidéo${added>1?'s':''}.`:'Importez une première émission pour retrouver ici ses nouvelles sorties.';
  render();
}
async function reloadYoutubeMetadata(){
  const generation=youtubeGeneration;
  const missing=state.episodes.filter(e=>!e.hidden&&e.apiImported&&!youtubeMetadata.has(e.id)&&!youtubeRequested.has(e.id)).map(e=>e.id);
  for(const id of missing)youtubeRequested.add(id);
  for(let offset=0;offset<missing.length;offset+=50){
    try{
      const ids=missing.slice(offset,offset+50);
      const result=await globalThis.youtubeFavsCloud.youtube({action:'videos',ids});
      if(generation!==youtubeGeneration||!canEdit())return;
      for(const episode of result.episodes)youtubeMetadata.set(episode.id,episode);
      // Missing API records may have become private or been deleted. Keep personal selections.
      for(const id of ids)if(!result.episodes.some(e=>e.id===id))youtubeMetadata.set(id,{id,title:'Vidéo indisponible sur YouTube'});
      applyYoutubeMetadata();render();
    }catch(error){
      if(generation!==youtubeGeneration)return;
      youtubeMessage=error.message||'Les métadonnées YouTube n’ont pas pu être rechargées.';render();return;
    }
  }
}
function safePhoto(value) {
  try {const url=new URL(value);return url.protocol==='https:'?url.href:'';}catch{return '';}
}
function avatar(user,large=false) {
  const photo=safePhoto(user?.photoURL);
  return photo ? `<img class="account-avatar ${large?'large':''}" src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="account-avatar initials ${large?'large':''}">${escapeHtml((user?.displayName||user?.email||'?').slice(0,1).toUpperCase())}</span>`;
}
function accountChrome() {
  const account=document.querySelector('#account');
  const ready=cloudStatus.phase==='ready';
  document.querySelector('header nav').hidden=!ready;
  document.querySelector('#queueCount').textContent=ready?(visibleEpisodes().filter(episode=>!state.watched.includes(episode.id)).length||''):'';
  account.innerHTML=cloudStatus.user ? `<a class="account-link" href="#/settings" aria-label="Mon profil">${avatar(cloudStatus.user)}</a>` : `<button class="account-login" data-action="sign-in" ${cloudStatus.phase==='loading'?'disabled':''}>${cloudStatus.phase==='loading'?'Connexion…':'Connexion'}</button>`;
  document.querySelector('#cloudStatus').textContent=ready?(cloudStatus.sync==='saving'?'Enregistrement…':'Synchronisé avec votre compte'):'';
}
function authPage() {
  const loading=cloudStatus.phase==='loading';
  const error=cloudStatus.phase==='error';
  return `<section class="auth-screen"><div class="auth-panel"><div class="eyebrow">Votre sélection. Votre rythme.</div><span class="auth-mark" aria-hidden="true">▶</span><h1>${loading?'Votre espace se prépare…':error?'Accès à votre espace interrompu':'Vos émissions. Votre espace.'}</h1><p>${loading?'Connexion à votre compte et chargement de votre bibliothèque.':error?escapeHtml(cloudStatus.message):'Connectez-vous avec Google pour retrouver vos émissions et vos épisodes vus sur tous vos appareils.'}</p>${loading?'<div class="auth-spinner" role="status" aria-label="Chargement"></div>':error?'<div class="actions"><button class="primary" data-action="retry-cloud">Réessayer</button><button data-action="sign-out">Changer de compte</button></div>':'<button class="primary google-login" data-action="sign-in"><span aria-hidden="true">G</span> Se connecter avec Google</button>'}<p id="loginError" class="form-error" role="alert">${!error?escapeHtml(cloudStatus.message):''}</p><p class="hint">Votre bibliothèque personnelle · Aucune émission ajoutée automatiquement</p>${error?'<a class="source-link" href="https://github.com/vchaillo/youtube-favs/blob/main/firestore.rules" target="_blank" rel="noopener noreferrer">Consulter les règles Firestore à publier ↗</a>':''}</div></section>`;
}
function applyPreferences() {
  document.documentElement.style.setProperty('--accent',state.accent);
  document.body.classList.toggle('light',state.theme === 'light');
}
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'),3500);
}
function route() {
  const [path,query='']=location.hash.replace(/^#\/?/,'').split('?');
  const parts=path.split('/'),params=new URL(`https://youtube-favs.invalid/?${query}`).searchParams;
  let id;try{id=decodeURIComponent(parts[1]||'');}catch{id='';}
  return {page:['explore','favorites'].includes(parts[0])?'shows':parts[0]||'shows',id,channelId:params.get('channel')||'',showId:params.get('show')||''};
}
const watchContext=()=>route().page==='watchlist';
const browseKind=()=>watchContext()?(['channels','shows','episodes'].includes(route().id)?route().id:'episodes'):route().page;
function categoryName(show){return show?.category?.trim()||'Personnel';}
function categories(){return [...new Map(state.shows.map(show=>[normalize(categoryName(show)),categoryName(show)])).values()].sort((a,b)=>a.localeCompare(b,'fr'));}
function categoryInput(value='Personnel'){
  return `<label>Catégorie<input name="category" maxlength="60" list="showCategories" value="${escapeHtml(value)}" placeholder="Ex. Jeux vidéo, Actualité, Culture…"><datalist id="showCategories">${categories().map(category=>`<option value="${escapeHtml(category)}"></option>`).join('')}</datalist></label>`;
}
function matchesCategory(show){return filter.category==='all'||normalize(categoryName(show))===normalize(filter.category);}
function channelKey(show){return show.channelId||normalize(show.channel);}
function showHref(id){return watchContext()?`#/watchlist/episodes?show=${encodeURIComponent(id)}`:`#/show/${id}`;}
function channelHref(id){return watchContext()?`#/watchlist/shows?channel=${encodeURIComponent(id)}`:`#/channel/${encodeURIComponent(id)}`;}
const showFor = id => state.shows.find(s => s.id === id);
const image = id => /^[\w-]{11}$/.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
function imageTag(id, alt = '') {
  return image(id) ? `<img src="${image(id)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin">` : '';
}
function heading(eyebrow,title,description,action='') {
  return `<div class="title-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="sub">${description}</p></div>${action}</div>`;
}
function libraryTabs(){
  const page=browseKind(),prefix=watchContext()?'watchlist/':'';
  return `<nav class="library-tabs" aria-label="Explorer ${watchContext()?'les épisodes à voir':'ma bibliothèque'}">${[['channels','Chaînes'],['shows','Émissions'],['episodes','Épisodes']].map(([id,label])=>`<a href="#/${prefix}${id}" class="${page===id?'active':''}">${label}</a>`).join('')}</nav>`;
}
function latestEpisode(show){
  return state.episodes.filter(episode=>episode.showId===show.id&&!episode.hidden).sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||(b.added||0)-(a.added||0))[0];
}
function updateAutomaticCover(show){
  if(show.coverMode!=='manual'){show.cover=latestEpisode(show)?.id||show.cover||'';show.coverMode='auto';show.coverUrl='';}
}
function showCover(show){return show.cover||latestEpisode(show)?.id||'';}
function channels(shows=state.shows){
  const groups=new Map();
  for(const show of shows){
    const key=channelKey(show);
    if(!groups.has(key))groups.set(key,{id:key,name:show.channel,shows:[],cover:showCover(show),coverShow:show,source:show.channelSource||(show.mode!=='playlist'?show.source:'')});
    const group=groups.get(key);group.shows.push(show);if(!group.cover)group.cover=showCover(show);
  }
  return [...groups.values()];
}
function toolbar(kind){
  const groups=kind==='shows'||kind==='channels',current=route();
  const selectedShow=current.page==='watchlist'?current.showId||filter.show:filter.show;
  return `<div class="toolbar"><label class="search">${icon('search')}<input id="search" aria-label="Rechercher une chaîne, une émission ou un épisode" placeholder="Rechercher une chaîne, une émission, un épisode…" value="${escapeHtml(filter.query)}" autocomplete="off"></label><select id="categoryFilter" aria-label="Catégorie"><option value="all">Toutes les catégories</option>${categories().map(category=>`<option value="${escapeHtml(category)}" ${normalize(filter.category)===normalize(category)?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select>${!groups?`<select id="showFilter" aria-label="Émission"><option value="all">Toutes les émissions</option>${state.shows.map(show=>`<option value="${show.id}" ${selectedShow===show.id?'selected':''}>${escapeHtml(show.name)}</option>`).join('')}</select>`:''}<select id="sort" aria-label="Trier"><option value="newest" ${filter.sort==='newest'?'selected':''}>Plus récents</option><option value="oldest" ${filter.sort==='oldest'?'selected':''}>Plus anciens</option><option value="title" ${filter.sort==='title'?'selected':''}>Titre A → Z</option></select><div class="view-switch">${['grid','list'].map(view=>`<button data-view="${view}" class="${state.view===view?'active':''}" aria-label="Vue ${view==='grid'?'galerie':'liste'}">${icon(view)}</button>`).join('')}</div></div>`;
}
function coverMarkup(show){
  if(show.coverMode==='manual'&&show.coverUrl)return `<img src="${escapeHtml(show.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return imageTag(showCover(show))||`<span class="cover-placeholder" aria-hidden="true">${escapeHtml(show.initials||show.name.slice(0,2))}</span>`;
}
function showCard(show){
  const episodes=(watchContext()?filteredEpisodes():visibleEpisodes()).filter(episode=>episode.showId===show.id),watched=episodes.filter(episode=>state.watched.includes(episode.id)).length;
  return `<article class="card show-card" data-key="show-${show.id}"><a class="cover" href="${showHref(show.id)}" aria-label="${escapeHtml(show.name)}">${coverMarkup(show)}<span class="cover-title"><small>${escapeHtml(show.channel)}</small>${escapeHtml(show.name)}</span></a><div class="card-body"><div class="channel"><span class="channel-avatar">${escapeHtml(show.initials)}</span>${escapeHtml(show.channel)}<span class="small muted" style="margin-left:auto">${episodes.length} épisodes</span></div><span class="category-tag">${escapeHtml(categoryName(show))}</span>${watchContext()?`<p class="small">${episodes.length} à voir · ${episodes.filter(episode=>episode.newRelease).length} nouveautés</p>`:`<div class="progress"><span style="width:${episodes.length?watched/episodes.length*100:0}%"></span></div><p class="small">${watched} vus · ${episodes.length-watched} à voir</p>`}<div class="card-bottom"><a href="${showHref(show.id)}" class="text-button">Explorer les épisodes ${icon('arrow')}</a><button data-youtube="${show.id}" aria-label="Importer des épisodes de ${escapeHtml(show.name)}">${icon('plus')} Importer</button></div></div></article>`;
}
function channelCard(channel){
  const episodes=(watchContext()?filteredEpisodes():visibleEpisodes()).filter(episode=>channel.shows.some(show=>show.id===episode.showId));
  return `<article class="card show-card" data-key="channel-${escapeHtml(channel.id)}"><a class="cover" href="${channelHref(channel.id)}">${channel.coverShow?coverMarkup(channel.coverShow):imageTag(channel.cover)}<span class="cover-title"><small>Chaîne YouTube</small>${escapeHtml(channel.name)}</span></a><div class="card-body"><p>${channel.shows.length} émissions · ${episodes.length} épisodes${watchContext()?' à voir':''}</p><a href="${channelHref(channel.id)}" class="text-button">Explorer la chaîne ${icon('arrow')}</a></div></article>`;
}
function watchedButton(episode,player=false){
  const watched=state.watched.includes(episode.id);
  return `<button class="icon-button ${watched?'selected':''}" ${player?'data-player-watched':'data-toggle="watched" data-id'}="${episode.id}" aria-pressed="${watched}" aria-label="${watched?'Marquer comme non vu':'Marquer comme vu'} : ${escapeHtml(episode.title)}" title="${watched?'Vu — marquer non vu':'Marquer comme vu'}">${icon('check')}</button>`;
}
function episodeCard(episode){
  const show=showFor(episode.showId);
  return `<article class="card episode" data-key="episode-${episode.id}"><button class="cover" data-play="${episode.id}" aria-label="Regarder ${escapeHtml(episode.title)}">${imageTag(episode.id)}${episode.newRelease?'<span class="tag red">NOUVEAUTÉ</span>':''}<span class="play-overlay"><span>▶</span></span>${state.watched.includes(episode.id)?'<span class="tag">✓ VU</span>':''}</button><div class="card-body"><a class="episode-show" href="${showHref(show.id)}">${escapeHtml(show.name)}</a><span class="category-tag episode-category">${escapeHtml(categoryName(show))}</span><h3><button class="text-button" data-play="${episode.id}">${escapeHtml(episode.title)}</button></h3><span class="small">${episodeMetadata(episode,show.channel)}</span><div class="actions"><button class="text-button" data-play="${episode.id}">▶ Regarder</button><div class="actions">${watchedButton(episode)}<button class="icon-button danger" data-remove-video="${episode.id}" aria-label="Supprimer ${escapeHtml(episode.title)} de ma bibliothèque" title="Supprimer de ma bibliothèque">${icon('trash')}</button></div></div></div></article>`;
}
function filteredEpisodes(){
  const current=route(),channel=current.page==='channel-episodes'?current.id:current.page==='watchlist'?current.channelId:'';
  return visibleEpisodes().filter(episode=>{
    const show=showFor(episode.showId);if(!show||!matchesCategory(show))return false;
    return (current.page!=='show'||episode.showId===current.id)&&(!channel||channelKey(show)===channel)&&(current.page!=='watchlist'||!state.watched.includes(episode.id))&&(!current.showId||episode.showId===current.showId)&&(filter.show==='all'||episode.showId===filter.show)&&normalize(`${episode.title} ${show.name} ${show.channel}`).includes(normalize(filter.query));
  }).sort((a,b)=>filter.sort==='title'?a.title.localeCompare(b.title,'fr'):filter.sort==='oldest'?(Date.parse(a.publishedAt)||a.added||0)-(Date.parse(b.publishedAt)||b.added||0):(Date.parse(b.publishedAt)||b.added||0)-(Date.parse(a.publishedAt)||a.added||0));
}
function resultShows(){
  const current=route(),episodes=filteredEpisodes(),channel=current.page==='channel'?current.id:current.page==='watchlist'?current.channelId:'';
  return state.shows.filter(show=>matchesCategory(show)&&(!channel||channelKey(show)===channel)&&(!current.showId||show.id===current.showId)&&(filter.show==='all'||show.id===filter.show)&&(!watchContext()||episodes.some(episode=>episode.showId===show.id))&&(normalize(`${show.name} ${show.channel}`).includes(normalize(filter.query))||episodes.some(episode=>episode.showId===show.id)));
}
function sortGroups(records,isChannels,episodes){
  const ids=record=>new Set(isChannels?record.shows.map(show=>show.id):[record.id]);
  const time=record=>{
    const shows=ids(record),dates=episodes.filter(episode=>shows.has(episode.showId)).map(episode=>Date.parse(episode.publishedAt)||episode.added||0);
    return dates.length?(filter.sort==='oldest'?Math.min(...dates):Math.max(...dates)):0;
  };
  return records.sort((a,b)=>filter.sort==='title'?a.name.localeCompare(b.name,'fr'):filter.sort==='oldest'?time(a)-time(b):time(b)-time(a));
}
function updateResults(){
  const node=document.querySelector('#results');if(!node)return;
  const current=route(),kind=browseKind(),shows=['shows','channel'].includes(kind),isChannels=kind==='channels';
  const episodes=filteredEpisodes(),programmes=resultShows();
  const records=isChannels?sortGroups(channels(programmes),true,episodes):shows?sortGroups(programmes,false,episodes):episodes;
  document.querySelector('#resultCount').textContent=String(records.length);
  const className=state.view==='grid'?`grid ${shows||isChannels?'show-grid':''}`:'list';
  node.className=watchContext()&&!shows&&!isChannels?'':className;
  const empty=`<div class="empty"><h2>${state.shows.length?'Aucun résultat pour le moment':'Votre bibliothèque commence ici'}</h2><p>${state.shows.length?'Essayez un autre filtre ou importez des épisodes.':'Importez votre première émission ou une chaîne YouTube.'}</p><button class="primary" data-action="add-show">${icon('plus')} Suivre une émission</button></div>`;
  if(watchContext()&&!shows&&!isChannels){
    const fresh=records.filter(episode=>episode.newRelease),backlog=records.filter(episode=>!episode.newRelease);
    syncMarkup(node,`<section class="watch-section" data-key="new-releases"><h2>Nouvelles sorties <span class="count">${fresh.length}</span></h2><div class="${className}">${fresh.map(episodeCard).join('')||'<p class="muted">Aucune nouvelle sortie à regarder pour le moment.</p>'}</div></section><section class="watch-section" data-key="backlog"><h2>Épisodes non vus <span class="count">${backlog.length}</span></h2><div class="${className}">${backlog.map(episodeCard).join('')||'<p class="muted">Tous vos épisodes importés sont vus.</p>'}</div></section>`);
    if(!state.shows.length)syncMarkup(node,empty);
  }else syncMarkup(node,records.map(isChannels?channelCard:shows?showCard:episodeCard).join('')||empty);
}
function showPage(){
  const title={shows:'Mes émissions',channels:'Mes chaînes',episodes:'Mes épisodes'}[route().page]||'Ma bibliothèque';
  return heading('Ma bibliothèque',title,`${state.shows.length} émissions · ${channels().length} chaînes · ${visibleEpisodes().length} épisodes`,`<button class="primary top-action" data-action="add-show">${icon('plus')} Suivre une émission</button>`)+libraryTabs()+toolbar(route().page)+`<div class="section-line"><h2>Votre sélection <span id="resultCount" class="count"></span></h2></div><div id="results"></div>`;
}
function channelPage(id,episodes=false){
  const channel=channels().find(group=>group.id===id);
  if(!channel)return heading('Bibliothèque','Chaîne introuvable','')+'<a href="#/channels">Mes chaînes</a>';
  return `<a class="back" href="#/channels">← Mes chaînes</a>`+heading('Chaîne YouTube',escapeHtml(channel.name),`${channel.shows.length} émissions`,channel.source?`<a class="link-button" href="${escapeHtml(channel.source)}" target="_blank" rel="noopener noreferrer">Voir sur YouTube ↗</a>`:'')+`<nav class="library-tabs"><a href="#/channel/${encodeURIComponent(id)}" class="${!episodes?'active':''}">Émissions</a><a href="#/channel-episodes/${encodeURIComponent(id)}" class="${episodes?'active':''}">Épisodes</a></nav>`+toolbar(episodes?'episodes':'shows')+`<span id="resultCount" class="count"></span><div id="results"></div>`;
}
function detailPage(id){
  const show=showFor(id);if(!show)return heading('Bibliothèque','Émission introuvable','')+'<a href="#/shows">Mes émissions</a>';
  const episodes=visibleEpisodes().filter(episode=>episode.showId===id);
  return `<a href="#/shows" class="back">← Mes émissions</a><section class="detail-hero"><div><div class="eyebrow"><a href="#/channel/${encodeURIComponent(show.channelId||normalize(show.channel))}">${escapeHtml(show.channel)}</a></div><h1>${escapeHtml(show.name)}</h1><p class="sub">${escapeHtml(show.description)}</p><button class="category-tag" data-edit-appearance="${id}" title="Modifier la catégorie et la couverture">${escapeHtml(categoryName(show))} ${icon('settings')}</button><div class="stats"><div><strong>${episodes.length}</strong>épisodes importés</div><div><strong>${episodes.filter(episode=>!state.watched.includes(episode.id)).length}</strong>à voir</div></div><div class="actions"><button data-edit-show="${id}">${icon('settings')} Règles d’importation</button><button data-add-video="${id}">${icon('plus')} Ajouter une vidéo</button><button data-mark-show-watched="${id}" ${episodes.every(episode=>state.watched.includes(episode.id))?'disabled':''}>${icon('check')} Tout marquer comme vu</button><button class="danger" data-remove-show="${id}">${icon('trash')} Supprimer l’émission</button></div></div><button class="show-cover-editor" data-edit-appearance="${id}" aria-label="Modifier la couverture de ${escapeHtml(show.name)}">${coverMarkup(show)}<span>${icon('settings')} Modifier la couverture</span></button></section>${youtubePanel(show)}${toolbar('episodes')}<span id="resultCount" class="count"></span><div id="results"></div>`;
}
function watchPage(){
  const current=route(),scope=current.showId?showFor(current.showId)?.name:current.channelId?channels().find(channel=>channel.id===current.channelId)?.name:'';
  const scopeLabel=scope?`<p class="scope-label">${escapeHtml(scope)} <a class="text-button" href="#/watchlist/${browseKind()}">Retirer ce filtre</a></p>`:'';
  return heading('Votre prochaine séance','À voir','Les nouvelles sorties et tous les épisodes que vous n’avez pas encore vus.',`<button data-action="check-releases" ${newsState.busy?'disabled':''}>${newsState.busy?'Recherche en cours…':'Vérifier les nouveautés'}</button>`)+`<section class="panel"><p role="status" aria-live="polite">${escapeHtml(newsState.message||'Recherche des nouvelles sorties à l’ouverture de cet onglet.')}</p>${newsState.errors.length?`<details><summary>${newsState.errors.length} source(s) à vérifier</summary><ul>${newsState.errors.map(message=>`<li>${escapeHtml(message)}</li>`).join('')}</ul></details>`:''}</section>`+scopeLabel+libraryTabs()+toolbar(browseKind())+`<span id="resultCount" class="count"></span><div id="results"></div>`;
}
function settingsPage() {
  const colors=['#f15a61','#e7bc75','#80bfa3','#83aaff','#ba9af1'];
  const user=cloudStatus.user;
  return heading('Votre espace','Mon profil','Vos émissions et vos préférences vous accompagnent sur tous vos appareils.') + `<section class="panel"><div class="profile-identity">${avatar(user,true)}<div><h2>${escapeHtml(user.displayName||'Mon compte')}</h2><p>${escapeHtml(user.email)}</p><span class="small muted">Connexion Google · ${cloudStatus.sync==='saving'?'Enregistrement en cours':'Compte synchronisé'}</span></div><button data-action="sign-out">Se déconnecter</button></div><div class="settings-row"><div><strong>Couleur d’accentuation</strong><p>Le rouge par défaut, ou une autre ambiance.</p></div><div class="swatches">${colors.map(c=>`<button data-accent="${c}" style="--swatch:${c}" class="${state.accent===c?'active':''}" aria-label="Accent ${c}" aria-pressed="${state.accent===c}"></button>`).join('')}</div></div><div class="settings-row"><div><strong>Shorts et vidéos courtes</strong><p>Afficher les vidéos de trois minutes ou moins dans la bibliothèque et À voir. La durée ne permet pas de distinguer tous les Shorts des vidéos classiques.</p><p class="hint">Réglage d’affichage enregistré pour ce compte sur ce navigateur. Les vidéos masquées restent dans votre bibliothèque.</p></div><label class="shorts-profile"><input type="checkbox" data-show-shorts ${showShortVideos?'checked':''}> Afficher les formats courts</label></div><div class="settings-row"><div><strong>Apparence</strong><p>Choisissez votre thème.</p></div><button data-action="theme">Passer au thème ${state.theme==='dark'?'clair':'sombre'}</button></div></section><section class="panel"><h2>Connexion YouTube</h2><p>Importez les vidéos d’une émission depuis sa fiche, avec prévisualisation et sélection avant ajout. Les archives se parcourent par pages de 50. Aucun accès à vos abonnements ou vidéos privés n’est demandé.</p><p class="small" role="status">${escapeHtml(youtubeMessage||'Les demandes passent par votre Worker Cloudflare.')}</p><form id="workerForm" class="form-grid"><label>URL du Worker Cloudflare<input name="origin" type="url" required value="${escapeHtml(globalThis.youtubeFavsCloud?.workerOrigin?.()||globalThis.YouTubeFavsApi?.DEFAULT_ORIGIN||'')}" placeholder="https://youtube-favs.votre-compte.workers.dev"></label><p class="hint">Renseignez uniquement l’URL publique. La clé YouTube se configure dans Cloudflare.</p><p id="workerStatus" class="small" role="status" aria-live="polite">${escapeHtml(workerMessage)}</p><div class="actions"><button class="primary">Tester et enregistrer</button></div></form><div class="actions"><button data-action="test-youtube">Tester l’accès à YouTube</button><button data-action="retry-youtube">Recharger les titres YouTube</button><a class="link-button" href="https://github.com/vchaillo/youtube-favs/blob/main/YOUTUBE_SETUP.md" target="_blank" rel="noopener noreferrer">Guide de configuration ↗</a></div></section><section class="panel"><h2>Votre bibliothèque</h2><div class="settings-row"><div><strong>Vos données personnelles</strong><p>${state.shows.length} émissions · ${visibleEpisodes().length} épisodes · ${state.watched.length} épisodes vus. Les ajouts et règles personnalisées restent propres à votre compte.</p></div></div>${legacyState()?'<div class="settings-row"><div><strong>Ancienne démo détectée</strong><p>Vous pouvez importer les choix de ce navigateur dans ce compte Google. Rien n’est importé automatiquement.</p></div><button data-action="import-legacy">Importer l’ancienne démo</button></div>':''}<div class="settings-row"><div><strong>Réinitialiser ma bibliothèque</strong><p>Retire les émissions, épisodes et états de visionnage de ce compte.</p></div><button class="danger" data-action="reset">Réinitialiser</button></div></section>`;
}
function aboutPage(){
  return heading('youtube-favs','Votre bibliothèque YouTube','Chaînes, émissions et épisodes réunis dans votre compte.')+`<section class="panel"><h2>Votre bibliothèque</h2><p>Importez une chaîne, une playlist ou une émission recherchée par son nom. Choisissez les vidéos et leur statut vu ou non vu avant de confirmer. Toutes les émissions importées sont suivies automatiquement.</p><h2>À voir</h2><p>À chaque ouverture de cet onglet, les sources sont interrogées pour rechercher des publications plus récentes que votre import. Les nouvelles sorties apparaissent séparément des autres épisodes non vus. Les vidéos retirées ne sont pas réimportées automatiquement.</p><h2>Recherche d’une émission</h2><p>Les pages de 50 publications sont parcourues automatiquement. La recherche s’arrête après cinq pages consécutives sans correspondance ; vous pouvez continuer manuellement. Les appels sont espacés pour respecter les limites du Worker.</p><h2>Lecture YouTube</h2><p>Ouvrir un épisode charge immédiatement le lecteur YouTube. Certaines restrictions d’âge, de pays ou d’intégration peuvent empêcher la lecture ici ; le lien YouTube reste disponible. Le statut vu se gère avec l’icône de validation.</p></section>`;
}
let newsVisit=false;
function render(){
  accountChrome();if(cloudStatus.phase!=='ready'){app.innerHTML=authPage();return;}
  const current=route(),key=`${current.page}/${current.id||''}/${current.channelId}/${current.showId}`;
  if(key!==lastRoute){const sameScope=lastRoute&&lastRoute.startsWith('watchlist/')===(current.page==='watchlist')&&['shows','channels','episodes','watchlist'].includes(current.page);if(!sameScope)filter={query:'',category:'all',status:'all',sort:'newest',show:'all'};lastRoute=key;if(modal.open)closeModal();}
  document.querySelectorAll('[data-nav]').forEach(link=>{const active=link.dataset.nav===(current.page==='watchlist'?'watchlist':'library');link.classList.toggle('active',active);});
  if(['shows','channels','episodes'].includes(current.page))syncMarkup(app,showPage(),{preserveResults:true});
  else if(current.page==='show')syncMarkup(app,detailPage(current.id),{preserveResults:true});
  else if(['channel','channel-episodes'].includes(current.page))syncMarkup(app,channelPage(current.id,current.page==='channel-episodes'),{preserveResults:true});
  else if(current.page==='watchlist')syncMarkup(app,watchPage(),{preserveResults:true});
  else if(current.page==='settings')app.innerHTML=settingsPage();
  else app.innerHTML=aboutPage();
  updateResults();applyPreferences();
  if(current.page!=='watchlist')newsVisit=false;
  else if(!newsVisit){newsVisit=true;Promise.resolve().then(()=>checkNewReleases());}
}
function openModal(content,player=false) {
  clearTimeout(importCloseTimer);modalVersion++;modal.classList.remove('import-dialog');
  activeImportId=null;
  modal.classList.toggle('player-dialog',player);
  modalContent.innerHTML = content;
  if(!modal.open)modal.showModal();
}
function closeModal() { clearTimeout(importCloseTimer);modalVersion++;modal.classList.remove('import-dialog');clearChannelSearch();cancelRemoval();if(activeImportId){const progress=youtubeImports.get(activeImportId);if(progress)progress.stop=true;}activeImportId=null;modal.close(); modalContent.innerHTML=''; }
function modalHeading(title) { return `<div class="modal-head"><h2 id="modalTitle">${title}</h2><button class="icon-button" data-close aria-label="Fermer">${icon('close')}</button></div>`; }
let channelMatches=[],selectedChannel=null,channelSearchTimer,channelSearchVersion=0;
function clearChannelSearch(){
  clearTimeout(channelSearchTimer);channelSearchVersion++;
}
function showForm(id){
  const show=showFor(id);clearChannelSearch();channelMatches=[];
  selectedChannel=show?(knownChannel(show.channel)||null):null;
  openModal(modalHeading(show?'Règles d’importation':'Suivre une émission')+`<form id="showForm" data-id="${escapeHtml(id||'')}" data-method="${show?.mode||'keywords'}" class="form-grid"><label>Nom de l’émission<input name="name" required maxlength="100" value="${escapeHtml(show?.name||'')}" placeholder="Ex. Papy Grenier"></label>${categoryInput(categoryName(show))}<div class="channel-field"><label>Chaîne YouTube<input name="channel" required maxlength="100" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="channelMatches" aria-expanded="false" value="${escapeHtml(show?.channel||'')}" placeholder="Rechercher un nom ou @identifiant"></label><div id="channelMatches" role="listbox" aria-label="Chaînes YouTube proposées" hidden></div><p id="channelSearchStatus" class="hint" role="status" aria-live="polite">Recherchez une chaîne ou choisissez une chaîne déjà importée.</p></div><label>Méthode d’import<select name="mode"><option value="keywords" ${show?.mode==='keywords'?'selected':''}>Émission dans une chaîne</option><option value="playlist" ${show?.mode==='playlist'?'selected':''}>Playlist YouTube</option><option value="channel" ${show?.mode==='channel'?'selected':''}>Chaîne entière</option></select></label><label><span id="sourceLabel">Lien de la chaîne</span><input name="source" type="url" value="${escapeHtml(show?.source||'')}" placeholder="https://www.youtube.com/…"><span class="hint">Le lien de la chaîne est rempli lors de votre choix. Pour une playlist, collez son lien.</span></label><div class="rule-preview" id="rulePreview"></div><p class="hint">Prévisualisez les vidéos, choisissez lesquelles importer et indiquez si vous les avez déjà vues.</p><p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" data-close>Annuler</button><button class="primary">Prévisualiser les vidéos</button></div></form>`);
  updateRulePreview();
}
function appearanceForm(id){
  const show=showFor(id);if(!show)return;
  const episodes=visibleEpisodes().filter(episode=>episode.showId===id).sort((a,b)=>(Date.parse(b.publishedAt)||b.added||0)-(Date.parse(a.publishedAt)||a.added||0)).slice(0,12);
  const manual=show.coverMode==='manual';
  openModal(modalHeading('Personnaliser l’émission')+`<form id="appearanceForm" data-id="${id}" class="form-grid"><p>${escapeHtml(show.name)}</p>${categoryInput(categoryName(show))}<label>Couverture<select name="coverMode"><option value="auto" ${!manual?'selected':''}>Automatique · dernière vidéo importée</option><option value="manual" ${manual?'selected':''}>Choisir mon image</option></select></label><label>Image ou vidéo YouTube<input type="url" name="coverSource" maxlength="2000" value="${escapeHtml(show.coverUrl||(show.cover?`https://www.youtube.com/watch?v=${show.cover}`:''))}" placeholder="Lien HTTPS d’une image ou d’une vidéo YouTube"><span class="hint">Choisissez une miniature ci-dessous ou collez le lien d’une image. Une couverture manuelle sera conservée lors des nouvelles sorties.</span></label><div id="coverPreview" class="cover-preview"></div>${episodes.length?`<div class="cover-options" aria-label="Miniatures des épisodes">${episodes.map(episode=>`<button type="button" data-cover-video="${episode.id}" aria-label="Choisir la miniature de ${escapeHtml(episode.title)}" title="${escapeHtml(episode.title)}">${imageTag(episode.id)}<span>${escapeHtml(episode.title)}</span></button>`).join('')}</div>`:''}<p id="appearanceError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" data-close>Annuler</button><button class="primary">Enregistrer</button></div></form>`);
  updateCoverPreview();
}
function chooseCoverVideo(id){
  const form=document.querySelector('#appearanceForm');if(!form)return;
  const episode=state.episodes.find(item=>item.id===id&&item.showId===form.dataset.id&&!item.hidden);if(!episode)return;
  form.querySelector('[name="coverMode"]').value='manual';
  form.querySelector('[name="coverSource"]').value=`https://www.youtube.com/watch?v=${id}`;
  updateCoverPreview();
}
function updateCoverPreview(){
  const form=document.querySelector('#appearanceForm');if(!form)return;
  const show=showFor(form.dataset.id);if(!show)return;
  const manual=form.querySelector('[name="coverMode"]').value==='manual',input=form.querySelector('[name="coverSource"]');input.disabled=!manual;
  const source=input.value.trim(),id=manual?videoId(source):latestEpisode(show)?.id||showCover(show);
  const url=manual&&!id?privateModel.cleanCoverUrl(source):image(id);
  document.querySelector('#coverPreview').innerHTML=url?`<img src="${escapeHtml(url)}" alt="Aperçu de la couverture" referrerpolicy="no-referrer">`:'<p class="hint">Choisissez une image pour afficher son aperçu.</p>';
}
async function saveAppearance(form,values){
  const show=showFor(form.dataset.id);if(!show)return;
  const mode=values.get('coverMode'),source=String(values.get('coverSource')||'').trim(),category=String(values.get('category')||'').trim().slice(0,60)||'Personnel';
  if(!['auto','manual'].includes(mode))return;
  if(mode==='manual'){
    const id=videoId(source),url=id?'':privateModel.cleanCoverUrl(source);
    if(!id&&!url){document.querySelector('#appearanceError').textContent='Choisissez une miniature ou un lien HTTPS valide vers une image.';return;}
    if(!id&&youtubeUrl(source)){document.querySelector('#appearanceError').textContent='Utilisez un lien de vidéo YouTube ou un lien direct vers une image.';return;}
    show.cover=id||'';show.coverUrl=url;show.coverMode='manual';
  }else{show.coverMode='auto';updateAutomaticCover(show);}
  show.category=category;show.customRule=true;
  const generation=youtubeGeneration;closeModal();render();
  if(await save()&&generation===youtubeGeneration)toast('Catégorie et couverture enregistrées.');
}
function knownChannel(name){
  const show=state.shows.find(item=>normalize(item.channel)===normalize(name));
  if(!show)return null;
  const source=show.channelSource||(show.channelId?`https://www.youtube.com/channel/${show.channelId}`:show.mode!=='playlist'?show.source:'');
  return source?{name:show.channel,url:source,id:show.channelId||''}:null;
}
function localChannels(query){
  return [...new Map(state.shows.filter(show=>normalize(show.channel).includes(normalize(query))).map(show=>knownChannel(show.channel)).filter(Boolean).map(channel=>[channel.url,channel])).values()];
}
function channelSuggestions(items,message=''){
  channelMatches=items;
  const list=document.querySelector('#channelMatches'),input=document.querySelector('#showForm [name="channel"]');
  list.hidden=!items.length;
  list.innerHTML=items.map((channel,index)=>`<button type="button" role="option" aria-selected="false" data-select-channel="${index}"><strong>${escapeHtml(channel.name)}</strong><small>${escapeHtml(channel.id||channel.url.replace('https://www.youtube.com/',''))}</small></button>`).join('');
  input.setAttribute('aria-expanded',String(Boolean(items.length)));
  document.querySelector('#channelSearchStatus').textContent=message;
}
async function searchChannels(query,form=document.querySelector('#showForm')){
  clearChannelSearch();
  const version=channelSearchVersion,generation=youtubeGeneration;
  const locals=localChannels(query);channelSuggestions(locals,query.trim().length<2?'Saisissez au moins 2 caractères pour rechercher sur YouTube.':'Recherche sur YouTube…');
  if(query.trim().length<2)return;
  try{
    const result=await globalThis.youtubeFavsCloud.youtube({action:'channels',query:query.trim()});
    if(version!==channelSearchVersion||generation!==youtubeGeneration||!canEdit()||!modal.open||document.querySelector('#showForm')!==form)return;
    const all=[...locals,...(result.channels||[])];
    const merged=[...new Map(all.map(channel=>[channel.id||channel.url,channel])).values()];
    channelSuggestions(merged,merged.length?'Choisissez la chaîne correspondante.':'Aucune chaîne trouvée. Essayez son @identifiant ou collez son lien.');
  }catch(error){
    if(version===channelSearchVersion&&generation===youtubeGeneration&&modal.open&&document.querySelector('#showForm')===form)channelSuggestions(locals,error.message||'Recherche indisponible. Vous pouvez coller le lien de la chaîne.');
  }
}
function queueChannelSearch(input){
  clearChannelSearch();
  const form=document.querySelector('#showForm'),source=form.querySelector('[name="source"]'),mode=form.querySelector('[name="mode"]').value;
  if(selectedChannel&&mode!=='playlist'&&source.value===selectedChannel.url)source.value='';
  selectedChannel=null;
  const query=input.value;channelSuggestions(localChannels(query),'');
  channelSearchTimer=setTimeout(()=>searchChannels(query,form),650);
}
function selectChannel(index){
  const channel=channelMatches[index],form=document.querySelector('#showForm');
  if(!channel||!form||!modal.open)return;
  clearChannelSearch();selectedChannel=channel;
  form.querySelector('[name="channel"]').value=channel.name;
  if(form.querySelector('[name="mode"]').value!=='playlist')form.querySelector('[name="source"]').value=channel.url;
  channelSuggestions([],`Chaîne sélectionnée : ${channel.name}`);updateRulePreview();
  form.querySelector('[name="channel"]').focus?.();
}
function updateRulePreview(){
  const form=document.querySelector('#showForm');if(!form)return;
  const data=new FormData(form),mode=data.get('mode'),name=String(data.get('name')||'').trim();
  const source=form.querySelector?.('[name="source"]');if(source){
    source.required=mode!=='keywords';
    if(form.dataset.method&&form.dataset.method!==mode){
      if(mode==='playlist')source.value='';else source.value=selectedChannel?.url||'';
    }
  }
  form.dataset.method=mode;
  document.querySelector('#sourceLabel').textContent=mode==='playlist'?'Lien de la playlist':'Lien de la chaîne';
  document.querySelector('#rulePreview').textContent=mode==='playlist'?'Importer les vidéos de cette playlist.':mode==='channel'?'Importer les publications publiques de cette chaîne.':`Rechercher « ${name||'nom de l’émission'} » dans les titres et descriptions de cette chaîne. Parcours par pages de 50 ; pause après 5 pages sans correspondance.`;
}
function youtubeUrl(value) {
  try { const url = new URL(value); return url.protocol==='https:' && !url.username&&!url.password&&!url.port&&['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname) ? url : null; } catch { return null; }
}
function videoId(value) {
  const url = youtubeUrl(value);
  if(!url)return null;
  const id = url.hostname==='youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}
function videoForm(showId) {
  openModal(modalHeading('Ajouter une vidéo') + `<form id="videoForm" data-show="${escapeHtml(showId)}" class="form-grid"><p class="hint">Ajout manuel dans ${escapeHtml(showFor(showId).name)}. L’API récupérera plus tard le titre et les métadonnées.</p><label>Lien YouTube<input type="url" name="url" required placeholder="https://www.youtube.com/watch?v=…"></label><label>Titre de l’épisode<input name="title" required maxlength="200" placeholder="Le titre de la vidéo"></label><div class="form-error" id="formError" role="alert"></div><div class="form-footer"><button type="button" data-close>Annuler</button><button class="primary">Ajouter à l’émission</button></div></form>`);
}
function playEpisode(id){
  const episode=visibleEpisodes().find(item=>item.id===id);if(!episode)return;
  openModal(modalHeading(escapeHtml(episode.title))+`<iframe class="player" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="${escapeHtml(episode.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><div class="player-actions"><a class="link-button" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube ↗</a>${watchedButton(episode,true)}</div>`,true);
}
function toggle(key,id){
  if(!canEdit()||key!=='watched')return;
  const episode=visibleEpisodes().find(item=>item.id===id);if(!episode)return;
  const watched=state.watched.includes(id);
  const feedback=watched?[]:globalThis.YouTubeFavsDOM.captureEpisode(id);
  state.watched=watched?state.watched.filter(value=>value!==id):[...state.watched,id];
  if(!watched)episode.newRelease=false;
  save();render();
  if(!watched)globalThis.YouTubeFavsDOM.feedback(feedback,'watched',route().page==='watchlist');
  toast(watched?'Épisode marqué non vu':'Épisode marqué comme vu');
}
document.addEventListener('click',async event=>{
  const button = event.target.closest('button');
  if(!button)return;
  const data = button.dataset;
  if(data.action==='cancel-removal')return cancelRemoval();
  if(data.action==='confirm-removal')return confirmRemoval();
  if('close' in data) return closeModal();
  if(data.action==='sign-in'){if(globalThis.youtubeFavsCloud)await globalThis.youtubeFavsCloud.signIn();return;}
  if(data.action==='sign-out'){if(globalThis.youtubeFavsCloud)await globalThis.youtubeFavsCloud.signOut();return;}
  if(data.action==='retry-cloud'){if(globalThis.youtubeFavsCloud)globalThis.youtubeFavsCloud.retry();else location.reload();return;}
  if(!canEdit())return;
  if(data.action==='check-releases')return checkNewReleases();
  if(data.action==='stop-scan'){const progress=youtubeImports.get(activeImportId);if(progress)progress.stop=true;return;}
  if(data.importWatched){const progress=youtubeImports.get(activeImportId);if(!progress||progress.committing||progress.success)return;if(progress.watched.has(data.importWatched))progress.watched.delete(data.importWatched);else progress.watched.add(data.importWatched);renderImportPreview(activeImportId);return;}
  if(data.removeVideo)return requestRemoval(data.removeVideo);
  if(data.action==='confirm-youtube-import')return confirmYoutubeImport();
  if(['import-select-all','import-select-none'].includes(data.action)){
    const progress=youtubeImports.get(activeImportId);if(!progress||progress.committing||progress.success)return;
    progress.selected=data.action==='import-select-all'?new Set(importCandidates(progress).filter(episode=>canImportVideo(episode.id)).map(episode=>episode.id)):new Set();
    renderImportPreview(activeImportId);return;
  }
  if(data.youtube)return refreshYoutube(data.youtube,data.continue==='true',data.scanAll==='true');
  if(data.action==='test-youtube'){const generation=youtubeGeneration;button.disabled=true;youtubeMessage='Vérification de l’accès à YouTube…';render();try{await globalThis.youtubeFavsCloud.youtube({action:'videos',ids:[seedEpisodes[0].id]});if(generation===youtubeGeneration)youtubeMessage='Connexion à YouTube confirmée. La clé autorise la lecture des vidéos publiques.';}catch(error){if(generation===youtubeGeneration)youtubeMessage=error.message;}finally{if(generation===youtubeGeneration)render();}return;}
  if(data.action==='retry-youtube'){youtubeRequested.clear();youtubeMessage='';return reloadYoutubeMetadata();}
  if(data.action==='import-legacy')return openModal(modalHeading('Importer l’ancienne démo ?')+`<p>Les choix conservés sur ce navigateur ne sont associés à aucun compte. Ils seront ajoutés au compte <strong>${escapeHtml(cloudStatus.user.email)}</strong> : émissions, épisodes vus et ajouts personnels. Ils ne remplaceront pas les autres choix déjà enregistrés dans le cloud.</p><div class="form-footer"><button data-close>Annuler</button><button class="primary" data-action="confirm-import">Importer dans ce compte</button></div>`);
  if(data.action==='confirm-import'){
    const uid=cloudStatus.user.uid,legacy=legacyState();
    if(!legacy)return closeModal();
    const imported=privateModel.pack(privateModel.hydrate(legacy,catalogue),catalogue);
    state=privateModel.hydrate(privateModel.applyPatch(privateModel.pack(state,catalogue),privateModel.diff(privateModel.empty(),imported)),catalogue);
    button.disabled=true;closeModal();render();
    if(await save() && cloudStatus.user?.uid===uid){try{localStorage.removeItem(STORAGE_KEY);}catch{}render();toast('Ancienne démo importée dans votre compte.');}
    return;
  }

  if(data.play) return playEpisode(data.play);
  if(data.playerWatched){toggle('watched',data.playerWatched);const episode=state.episodes.find(item=>item.id===data.playerWatched);button.outerHTML=watchedButton(episode,true);if(state.watched.includes(episode.id))globalThis.YouTubeFavsDOM.watchedIcon(document.querySelector(`[data-player-watched="${episode.id}"]`));return;}
  if(data.toggle) return toggle(data.toggle,data.id);
  if(data.removeShow)return requestShowRemoval(data.removeShow);
  if(data.markShowWatched)return markShowWatched(data.markShowWatched);
  if(data.selectChannel!==undefined)return selectChannel(Number(data.selectChannel));
  if(data.editAppearance)return appearanceForm(data.editAppearance);
  if(data.coverVideo)return chooseCoverVideo(data.coverVideo);
  if(data.editShow) return showForm(data.editShow);
  if(data.addVideo) return videoForm(data.addVideo);
  if(data.view) {state.view=data.view;save();render();return;}
  if(data.filter) {filter[data.filter]=data.value;render();return;}
  if(data.accent) {state.accent=data.accent;save();render();return;}
  if(data.action==='add-show')return showForm();
  if(data.action==='theme'){state.theme=state.theme==='dark'?'light':'dark';save();render();return;}
  if(data.action==='clear-filters'){filter={query:'',category:'all',status:'all',sort:'newest',show:'all'};render();return;}
  if(data.action==='reset')return openModal(modalHeading('Réinitialiser ma bibliothèque ?')+'<p>Toutes vos émissions, vidéos et informations de visionnage seront retirées de ce compte.</p><div class="form-footer"><button data-close>Annuler</button><button class="primary" data-action="confirm-reset">Réinitialiser</button></div>');
  if(data.action==='confirm-reset'){youtubeGeneration++;youtubeMetadata.clear();youtubeImports.clear();youtubeRequested.clear();newsState={busy:false,message:'',errors:[]};newsVisit=false;state=initialState();save();closeModal();render();toast('Bibliothèque réinitialisée.');}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){filter.query=event.target.value;updateResults();}
  if(event.target.closest?.('#appearanceForm'))updateCoverPreview();
  if(event.target.closest('#showForm')){
    if(event.target.name==='channel')queueChannelSearch(event.target);
    updateRulePreview();
  }
});
document.addEventListener('focusin',event=>{
  if(event.target.name==='channel'&&event.target.closest('#showForm')&&(!selectedChannel||selectedChannel.name!==event.target.value))channelSuggestions(localChannels(event.target.value),'Choisissez une chaîne connue ou saisissez un nom pour rechercher.');
});
document.addEventListener('keydown',event=>{
  const form=event.target.closest?.('#showForm');if(!form||!(event.target.name==='channel'||event.target.closest?.('#channelMatches')))return;
  const options=[...form.querySelectorAll('[data-select-channel]')];
  if(event.key==='Escape'&&!document.querySelector('#channelMatches').hidden){event.preventDefault();channelSuggestions([],'');return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    if(!options.length)return;
    event.preventDefault();const index=options.indexOf(event.target),step=event.key==='ArrowDown'?1:-1;
    options[(index+step+options.length)%options.length].focus();
  }
});
document.addEventListener('change',event=>{
  if(event.target.dataset&&'showShorts' in event.target.dataset){if(canEdit())setShortVideosPreference(event.target.checked);return;}
  if(event.target.dataset&&'importShorts' in event.target.dataset){
    const progress=youtubeImports.get(activeImportId);if(!progress||progress.committing||progress.success)return;
    progress.includeShorts=event.target.checked;
    for(const episode of progress.candidates.filter(isShortVideo)){
      if(!progress.includeShorts)progress.selected.delete(episode.id);
      else if(canImportVideo(episode.id)){progress.selected.add(episode.id);if(progress.defaultWatched)progress.watched.add(episode.id);}
    }
    renderImportPreview(activeImportId);return;
  }
  if(event.target.closest?.('#appearanceForm'))updateCoverPreview();
  if(event.target.closest?.('#showForm'))updateRulePreview();
  if(event.target.dataset&&'importWatchedAll' in event.target.dataset){const progress=youtubeImports.get(activeImportId);if(!progress||progress.committing||progress.success)return;progress.defaultWatched=event.target.checked;progress.watched=event.target.checked?new Set(progress.candidates.map(episode=>episode.id)):new Set();renderImportPreview(activeImportId);return;}
  if(event.target.dataset?.importVideo){const progress=youtubeImports.get(activeImportId);if(!progress||progress.committing||progress.success)return;const id=event.target.dataset.importVideo;if(event.target.checked&&canImportVideo(id))progress.selected.add(id);else progress.selected.delete(id);renderImportPreview(activeImportId);return;}
  if(event.target.id==='categoryFilter'){filter.category=event.target.value;updateResults();}
  if(event.target.id==='showFilter'){if(watchContext()){filter.show='all';location.hash='#/watchlist/episodes'+(event.target.value==='all'?'':`?show=${encodeURIComponent(event.target.value)}`);render();}else{filter.show=event.target.value;updateResults();}}
  if(event.target.id==='sort'){filter.sort=event.target.value;updateResults();}
});
document.addEventListener('submit',async event=>{
  if(!['showForm','videoForm','workerForm','appearanceForm'].includes(event.target.id))return;
  event.preventDefault();
  if(!canEdit())return;
  const form=event.target;
  const values=new FormData(form);
  if(form.id==='appearanceForm')return saveAppearance(form,values);
  if(form.id==='workerForm'){
    const generation=youtubeGeneration,button=form.querySelector('button');
    button.disabled=true;workerMessage='Vérification du Worker…';document.querySelector('#workerStatus').textContent=workerMessage;
    try{
      const result=await globalThis.youtubeFavsCloud.configureWorker(values.get('origin'));
      if(generation!==youtubeGeneration||!canEdit())return;
      youtubeGeneration++;youtubeImports.clear();youtubeRequested.clear();youtubeMessage='';newsState={busy:false,message:'',errors:[]};newsVisit=false;
      workerMessage=result.persisted?'Worker connecté. L’URL est enregistrée dans ce navigateur.':'Worker connecté pour cette session. Le navigateur bloque la mémorisation de l’URL.';
      render();reloadYoutubeMetadata();
    }catch(error){if(generation===youtubeGeneration){workerMessage=error.message;document.querySelector('#workerStatus').textContent=workerMessage;}}
    finally{button.disabled=false;}
    return;
  }
  const error=message=>{document.querySelector('#formError').textContent=message;};
  if(form.id==='showForm'){
    const name=String(values.get('name')||'').trim();
    let channel=String(values.get('channel')||'').trim();
    const mode=values.get('mode'),keywords=mode==='keywords'?name.replace(/,/g,' '):'';
    const enteredSource=String(values.get('source')||'').trim();
    let source=enteredSource?youtubeUrl(enteredSource):null;
    if(!name||!channel)return error('Renseignez le nom de l’émission et de la chaîne.');
    if(!['keywords','playlist','channel'].includes(mode))return error('Choisissez une méthode d’import.');
    let resolved=selectedChannel&&normalize(selectedChannel.name)===normalize(channel)?selectedChannel:null;
    if(!resolved)resolved=knownChannel(channel);
    if(!enteredSource&&mode!=='playlist'){
      if(!resolved){
        await searchChannels(channel,form);
        return error('Choisissez la chaîne proposée sous le champ Chaîne YouTube ou collez son lien.');
      }
      source=youtubeUrl(resolved.url);channel=resolved.name;
    }
    if(resolved&&mode!=='playlist'&&source?.href!==youtubeUrl(resolved.url)?.href)resolved=null;
    if(!source)return error(mode==='keywords'?'Le lien saisi est invalide. Laissez-le vide pour rechercher la chaîne.':'Renseignez un lien HTTPS YouTube valide.');
    if(mode==='playlist'&&!/^[\w-]{10,150}$/.test(source.searchParams.get('list')||''))return error('Le lien de la playlist doit contenir son identifiant list=.');
    if(mode!=='playlist'&&!/^\/(?:@[^/]+|channel\/UC[\w-]{22}|user\/[^/]+)\/?$/.test(source.pathname))return error('Utilisez un lien de chaîne, par exemple youtube.com/@blastinfo.');
    const existing=showFor(form.dataset.id);
    if(!existing&&state.shows.length>=200)return error('La limite de 200 émissions est atteinte.');
    if(state.shows.some(show=>show.id!==existing?.id&&normalize(show.name)===normalize(name)&&normalize(show.channel)===normalize(channel)))return error('Cette émission existe déjà dans votre bibliothèque.');
    const channelId=resolved?.id||source.pathname.match(/^\/channel\/(UC[\w-]{22})/)?.[1]||(existing?.source===source.href?existing.channelId:'')||'';
    const record={...(existing||{}),id:existing?.id||crypto.randomUUID(),name,channel,source:source.href,mode,keywords,initials:existing?.initials||channel.slice(0,2).toUpperCase(),description:existing?.description||'Votre émission YouTube.',category:String(values.get('category')||existing?.category||'Personnel').trim().slice(0,60)||'Personnel',cover:existing?.cover||'',channelId,channelSource:mode!=='playlist'?source.href:resolved?.url||existing?.channelSource||'',releaseAfter:existing?.releaseAfter||new Date().toISOString(),customRule:true};
    youtubeImports.delete(record.id);
    if(existing)state.shows=state.shows.map(s=>s.id===existing.id?record:s);else state.shows.push(record);
    if(!state.following.includes(record.id))state.following.push(record.id);
    const generation=youtubeGeneration;closeModal();location.hash=`/show/${record.id}`;render();
    if(await save()&&generation===youtubeGeneration&&canEdit())await refreshYoutube(record.id);
  }else{
    const id=videoId(values.get('url').trim());
    const title=values.get('title').trim();
    if(!id)return error('Utilisez un lien valide vers une vidéo YouTube.');
    if(!title)return error('Renseignez le titre de la vidéo.');
    if(state.episodes.some(e=>e.id===id))return error('Cette vidéo est déjà dans votre bibliothèque.');
    state.episodes.push({id,showId:form.dataset.show,title,note:'Vidéo ajoutée manuellement.',added:Date.now()});
    const show=showFor(form.dataset.show);if(!show.cover){show.cover=id;show.customRule=true;}
    save();closeModal();render();toast('Vidéo ajoutée à votre émission.');
  }
});
removalModal.addEventListener('cancel',()=>{pendingRemoval=null;});
removalModal.addEventListener('close',()=>{if(!removalModal.open)pendingRemoval=null;});
modal.addEventListener('close',()=>{if(!modal.open){clearTimeout(importCloseTimer);modalVersion++;modal.classList.remove('import-dialog');clearChannelSearch();activeImportId=null;modalContent.innerHTML='';}});
modal.addEventListener('click',event=>{if(event.target===modal){const box=modal.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeModal();}});
window.addEventListener('hashchange',()=>{render();window.scrollTo({top:0,behavior:'instant'});});
function armLoadingTimeout() {
  clearTimeout(loadingTimer);
  if(cloudStatus.phase!=='loading')return;
  loadingTimer=setTimeout(()=>{
    if(cloudStatus.phase==='loading'){
      cloudStatus.phase='error';cloudStatus.message='Le chargement prend plus de temps que prévu. Vérifiez votre connexion puis réessayez.';render();
    }
  },25000);
}
window.addEventListener('youtube-favs:auth',event=>{
  globalThis.YouTubeFavsDOM.clearFeedback();closeModal();
  youtubeGeneration++;youtubeMetadata.clear();youtubeImports.clear();youtubeRequested.clear();youtubeMessage='';newsState={busy:false,message:'',errors:[]};newsVisit=false;
  state=initialState();lastSaved=privateModel.empty();
  cloudStatus={phase:event.detail.status,user:event.detail.user,message:event.detail.message||'',sync:'ready'};
  filter={query:'',category:'all',status:'all',sort:'newest',show:'all'};lastRoute='';
  loadShortVideosPreference();applyPreferences();render();armLoadingTimeout();
});
window.addEventListener('youtube-favs:data',event=>{
  if(event.detail.uid!==cloudStatus.user?.uid)return;
  state=privateModel.hydrate(event.detail.data,catalogue);
  applyYoutubeMetadata();
  lastSaved=privateModel.pack(state,catalogue);
  cloudStatus.phase='ready';cloudStatus.message='';
  clearTimeout(loadingTimer);applyPreferences();render();
  if(activeImportId)renderImportPreview(activeImportId);
  reloadYoutubeMetadata();
});
window.addEventListener('youtube-favs:sync',event=>{
  if(event.detail.uid!==cloudStatus.user?.uid)return;
  cloudStatus.sync=event.detail.status;
  if(event.detail.status==='error'){cloudStatus.phase='error';cloudStatus.message=event.detail.message;closeModal();render();}
  else accountChrome();
});
window.addEventListener('youtube-favs:login-error',event=>{cloudStatus.message=event.detail.message;render();});
armLoadingTimeout();
if(!location.hash)history.replaceState(null,'','#/shows');
render();
