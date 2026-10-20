'use strict';

const STORAGE_KEY = 'youtube-favs:v1';
const icons = {
  search: '<circle cx="7.5" cy="7.5" r="5.5"/><path d="m12 12 4 4"/>',
  grid: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="11" y="2" width="5" height="5" rx="1"/><rect x="2" y="11" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/>',
  list: '<path d="M6 4h10M6 9h10M6 14h10M2 4h.1M2 9h.1M2 14h.1"/>',
  heart: '<path d="M9 16S1 11 1 6a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-8 10-8 10Z"/>',
  check: '<path d="m3 9 4 4 8-9"/>',
  clock: '<circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2"/>',
  plus: '<path d="M9 3v12M3 9h12"/>',
  close: '<path d="m4 4 10 10M14 4 4 14"/>',
  info: '<circle cx="9" cy="9" r="7"/><path d="M9 8v5M9 5h.01"/>',
  settings: '<path d="M2 5h14M2 13h14"/><circle cx="6" cy="5" r="2"/><circle cx="12" cy="13" r="2"/>',
  arrow: '<path d="M3 9h12m-5-5 5 5-5 5"/>',
};
const icon = name => `<svg viewBox="0 0 18 18" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const catalogue = globalThis.YOUTUBE_FAVS_CATALOG || {version:'empty', importedAt:null, shows:[], episodes:[]};
const seedShows = catalogue.shows;
const seedEpisodes = catalogue.episodes;
const privateModel = globalThis.YouTubeFavsState;
function initialState() { return privateModel.hydrate(privateModel.empty(),catalogue); }
let state = initialState();
let cloudStatus = {phase:'loading',user:null,message:'',sync:'ready'};
let lastSaved = privateModel.empty();
function legacyState() {
  try {const raw=localStorage.getItem(STORAGE_KEY);return raw?JSON.parse(raw):null;}catch{return null;}
}
let filter = {query:'',category:'all',status:'all',sort:'newest',show:'all'};
let lastRoute = '';
let toastTimer;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modalContent');
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
  document.querySelector('#queueCount').textContent=ready?(state.queue.length||''):'';
  account.innerHTML=cloudStatus.user ? `<a class="account-link" href="#/settings" aria-label="Mon profil">${avatar(cloudStatus.user)}</a>` : `<button class="account-login" data-action="sign-in" ${cloudStatus.phase==='loading'?'disabled':''}>${cloudStatus.phase==='loading'?'Connexion…':'Connexion'}</button>`;
  document.querySelector('#cloudStatus').textContent=ready?(cloudStatus.sync==='saving'?'Enregistrement…':'Synchronisé avec votre compte'):'';
}
function authPage() {
  const loading=cloudStatus.phase==='loading';
  const error=cloudStatus.phase==='error';
  return `<section class="auth-screen"><div class="auth-panel"><div class="eyebrow">Votre sélection. Votre rythme.</div><span class="auth-mark" aria-hidden="true">▶</span><h1>${loading?'Votre espace se prépare…':error?'Accès à votre espace interrompu':'Vos émissions. Votre espace.'}</h1><p>${loading?'Connexion à votre compte et chargement de votre bibliothèque.':error?escapeHtml(cloudStatus.message):'Connectez-vous avec Google pour retrouver vos suivis, favoris et épisodes vus sur tous vos appareils.'}</p>${loading?'<div class="auth-spinner" role="status" aria-label="Chargement"></div>':error?'<div class="actions"><button class="primary" data-action="retry-cloud">Réessayer</button><button data-action="sign-out">Changer de compte</button></div>':'<button class="primary google-login" data-action="sign-in"><span aria-hidden="true">G</span> Se connecter avec Google</button>'}<p id="loginError" class="form-error" role="alert">${!error?escapeHtml(cloudStatus.message):''}</p><p class="hint">${seedShows.length} sélections · ${seedEpisodes.length} vidéos à explorer · Aucun suivi imposé</p>${error?'<a class="source-link" href="https://github.com/vchaillo/youtube-favs/blob/main/firestore.rules" target="_blank" rel="noopener noreferrer">Consulter les règles Firestore à publier ↗</a>':''}</div></section>`;
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
  const parts = location.hash.replace(/^#\/?/,'').split('/');
  return {page:parts[0] || 'shows',id:parts[1]};
}
const showFor = id => state.shows.find(s => s.id === id);
const image = id => /^[\w-]{11}$/.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
function imageTag(id, alt = '') {
  return image(id) ? `<img src="${image(id)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin">` : '';
}
function catalogueDate() {
  return catalogue.importedAt ? new Date(catalogue.importedAt).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'}) : 'non disponible';
}
function demoNote() {
  return `<div class="demo-note">${icon('info')}<span>Catalogue importé le ${catalogueDate()} · Actualisation automatique non activée. Vos choix sont sauvegardés sur votre compte.</span><a href="#/about">Comment ça marche ? ↗</a></div>`;
}
function heading(eyebrow,title,description,action='') {
  return `<div class="title-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="sub">${description}</p></div>${action}</div>`;
}
function toolbar(kind) {
  const categories = kind === 'shows' ? ['Toutes',...new Set(state.shows.map(show => show.category))] : ['Tous','Non vus','Vus'];
  return `<div class="toolbar"><label class="search"><span class="sr-only" hidden>Rechercher</span>${icon('search')}<input id="search" aria-label="Rechercher ${kind === 'shows' ? 'une émission' : 'un épisode'}" placeholder="${kind === 'shows' ? 'Rechercher une émission, une chaîne…' : 'Rechercher un épisode…'}" value="${escapeHtml(filter.query)}" autocomplete="off"></label><div class="filters" role="group" aria-label="${kind === 'shows' ? 'Catégories' : 'Statut de visionnage'}">${categories.map((label,i) => `<button class="chip ${(kind === 'shows' ? filter.category : filter.status) === (i === 0 ? 'all' : label) ? 'active' : ''}" data-filter="${kind === 'shows' ? 'category' : 'status'}" data-value="${escapeHtml(i === 0 ? 'all' : label)}" aria-pressed="${(kind === 'shows' ? filter.category : filter.status) === (i === 0 ? 'all' : label)}">${escapeHtml(label)}</button>`).join('')}</div>${kind !== 'shows' ? `<select id="showFilter" aria-label="Filtrer par émission"><option value="all">Toutes les émissions</option>${state.shows.map(s => `<option value="${escapeHtml(s.id)}" ${filter.show === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select><select id="sort" aria-label="Trier les épisodes"><option value="newest" ${filter.sort === 'newest'?'selected':''}>Plus récents</option><option value="oldest" ${filter.sort === 'oldest'?'selected':''}>Plus anciens</option><option value="title" ${filter.sort === 'title'?'selected':''}>Titre A → Z</option></select>` : ''}<div class="view-switch" role="group" aria-label="Type de vue">${['grid','list'].map(v => `<button data-view="${v}" class="${state.view === v ? 'active' : ''}" aria-pressed="${state.view === v}" aria-label="Vue ${v === 'grid' ? 'galerie' : 'liste'}">${icon(v)}</button>`).join('')}</div></div>`;
}
function showCard(show) {
  const episodes = state.episodes.filter(e => e.showId === show.id);
  const watched = episodes.filter(e => state.watched.includes(e.id)).length;
  const following = state.following.includes(show.id);
  return `<article class="card show-card"><a href="#/show/${escapeHtml(show.id)}" class="cover" aria-label="Explorer ${escapeHtml(show.name)}">${imageTag(show.cover)}<span class="tag">${escapeHtml(show.category)}</span><span class="cover-title"><small>${escapeHtml(show.channel)}</small>${escapeHtml(show.name)}</span></a><div class="card-body"><div class="channel"><span class="channel-avatar ${show.id === 'rhino' ? 'blast' : ''}">${escapeHtml(show.initials)}</span><span>${escapeHtml(show.channel)}</span><span class="muted small" style="margin-left:auto">${episodes.length} épisode${episodes.length>1?'s':''}</span></div><p class="card-description">${escapeHtml(show.description)}</p><div class="progress" aria-label="${watched} épisodes vus sur ${episodes.length}"><span style="width:${episodes.length?watched/episodes.length*100:0}%"></span></div><p class="small" style="margin:0 0 16px">${watched} / ${episodes.length} vus <span style="float:right">${show.catalogCount ? 'Catalogue importé' : 'Ajout personnel'}</span></p><div class="card-bottom"><a href="#/show/${escapeHtml(show.id)}" class="text-button">Explorer les épisodes ${icon('arrow')}</a><button data-follow="${escapeHtml(show.id)}" aria-pressed="${following}">${following ? '✓ Suivie' : '+ Suivre'}</button></div></div></article>`;
}
function episodeCard(episode) {
  const show = showFor(episode.showId);
  return `<article class="card episode"><button class="cover" data-play="${episode.id}" aria-label="Regarder ${escapeHtml(episode.title)}">${imageTag(episode.id)}${episode.isNew ? '<span class="tag red">AJOUT DÉMO</span>' : ''}<span class="play-overlay"><span>▶</span></span>${state.watched.includes(episode.id) ? '<span class="tag" style="left:auto;right:10px;top:auto;bottom:10px">✓ VU</span>' : ''}</button><div class="card-body"><a class="episode-show" href="#/show/${escapeHtml(show.id)}">${escapeHtml(show.name)}</a><h3><button class="text-button" data-play="${episode.id}" style="color:inherit;text-align:left;font-size:inherit;line-height:inherit">${escapeHtml(episode.title)}</button></h3><span class="small">${escapeHtml(episode.author || show.channel)}${episode.publishedAt ? ` · ${new Date(episode.publishedAt).toLocaleDateString('fr-FR')}` : episode.year ? ` · ${escapeHtml(episode.year)}` : ''}${episode.durationLabel ? ` · ${escapeHtml(episode.durationLabel)}` : ''}</span><div class="actions"><button class="text-button" data-play="${episode.id}">▶ Regarder</button><div class="actions" style="margin:0;gap:5px">${[['favorites','heart','Favori'],['queue','clock','À voir'],['watched','check','Vu']].map(([key,graphic,label]) => `<button class="icon-button ${state[key].includes(episode.id)?'selected':''}" data-toggle="${key}" data-id="${episode.id}" aria-pressed="${state[key].includes(episode.id)}" aria-label="${escapeHtml(label)} : ${escapeHtml(episode.title)}" title="${label}">${icon(graphic)}</button>`).join('')}</div></div></div></article>`;
}
function filteredEpisodes() {
  const current = route();
  let episodes = state.episodes.filter(e => current.page === 'show' ? e.showId === current.id : current.page === 'favorites' ? state.favorites.includes(e.id) : current.page === 'watchlist' ? state.queue.includes(e.id) : state.following.includes(e.showId));
  episodes = episodes.filter(e => normalize(`${e.title} ${showFor(e.showId)?.name} ${showFor(e.showId)?.channel}`).includes(normalize(filter.query)) && (filter.status === 'all' || state.watched.includes(e.id) === (filter.status === 'Vus')) && (filter.show === 'all' || e.showId === filter.show));
  return episodes.sort((a,b) => filter.sort === 'title' ? a.title.localeCompare(b.title,'fr') : filter.sort === 'oldest' ? (Date.parse(a.publishedAt)||a.year*31557600000||Number.MAX_SAFE_INTEGER)-(Date.parse(b.publishedAt)||b.year*31557600000||Number.MAX_SAFE_INTEGER) || a.added-b.added : (Date.parse(b.publishedAt)||b.year*31557600000||0)-(Date.parse(a.publishedAt)||a.year*31557600000||0) || b.added-a.added);
}
function updateResults() {
  const results = document.querySelector('#results');
  if (!results) return;
  const isShows = ['shows','explore'].includes(route().page);
  const records = isShows ? state.shows.filter(s => (route().page==='explore'||state.following.includes(s.id)) && normalize(`${s.name} ${s.channel}`).includes(normalize(filter.query)) && (filter.category === 'all' || s.category === filter.category)) : filteredEpisodes();
  document.querySelector('#resultCount').textContent = String(records.length);
  results.className = records.length ? (state.view === 'grid' ? `grid ${isShows?'show-grid':''}` : 'list') : '';
  results.innerHTML = records.length ? records.map(isShows ? showCard : episodeCard).join('') : `<div class="empty"><h2>${isShows ? (route().page==='shows'?'Aucune émission suivie pour le moment':'Aucune émission trouvée') : 'Aucun épisode ici, pour le moment'}</h2><p>${route().page === 'favorites' ? 'Cliquez sur le cœur d’un épisode pour le retrouver ici.' : route().page === 'watchlist' ? 'Cliquez sur l’horloge d’un épisode pour le garder pour plus tard.' : 'Essayez un autre filtre ou ajoutez du contenu à votre bibliothèque.'}</p><a class="primary link-button" href="#/explore">Explorer le catalogue</a><button data-action="clear-filters">Réinitialiser les filtres</button></div>`;
}
function showPage() {
  const following = state.following.length;
  const explore=route().page==='explore';
  return heading(explore?'Le catalogue':'Votre bibliothèque',explore?'Explorer':'Mes suivis',explore?'Choisissez les émissions et les chaînes qui vous intéressent.':'Les programmes que vous suivez. Le reste peut attendre.',`<button class="primary top-action" data-action="add-show">${icon('plus')} Suivre une émission</button>`) + `<section class="hero"><div class="hero-copy"><div class="eyebrow">Moins de bruit. Plus de favoris.</div><h2>Suivez une émission.<br>Pas toute la chaîne.</h2><p>Retrouvez les anciens épisodes et gardez une place pour les prochaines sorties. Tout, au même endroit.</p><div class="actions"><a class="primary link-button" href="#/episodes">Explorer mes épisodes ${icon('arrow')}</a><span class="small muted">${following} émissions suivies</span></div></div><a href="#/show/papy" class="hero-art" aria-label="Découvrir Papy Grenier">${imageTag('MatN8AsTDCs')}<span class="hero-play">▶</span></a></section>` + demoNote() + `<div class="section-line"><h2>${explore?'Les sélections disponibles':'Vos programmes'} <span class="count" id="resultCount"></span></h2><span class="small muted">${seedEpisodes.length} vidéos référencées</span></div>` + toolbar('shows') + '<div id="results"></div>';
}
function detailPage(id) {
  const show = showFor(id);
  if (!show) return heading('Bibliothèque','Émission introuvable','Cette émission n’existe plus.') + '<a href="#/shows" class="link-button">Mes émissions</a>';
  const episodes = state.episodes.filter(e => e.showId === id);
  return `<a href="#/explore" class="back">← Explorer les émissions</a><section class="detail-hero"><div><div class="eyebrow">${escapeHtml(show.category)} · ${escapeHtml(show.channel)}</div><h1>${escapeHtml(show.name)}</h1><p class="sub">${escapeHtml(show.description)}</p><span class="source-rule">${show.mode === 'playlist' ? 'Playlist' : show.mode === 'channel' ? 'Chaîne entière' : 'Sélection par mots-clés'} · ${show.catalogCount ? 'Catalogue importé' : 'Suivi personnel'}</span><p class="small">${escapeHtml(show.sourceNote || 'Catalogue personnel.')}</p>${show.missingEntries?.length ? `<p class="small">${show.missingEntries.map(entry => `<a class="accent" href="${escapeHtml(entry.officialUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)} sur CANAL+ ↗</a>`).join(' · ')}</p>` : ''}<a class="source-link" href="${escapeHtml(show.source)}" target="_blank" rel="noopener noreferrer">Voir la source YouTube ↗</a><div class="stats"><div><strong>${episodes.length}</strong>vidéos référencées</div><div><strong>${episodes.filter(e=>state.watched.includes(e.id)).length}</strong>épisodes vus</div></div><div class="actions"><button class="primary" data-follow="${escapeHtml(id)}">${state.following.includes(id)?'✓ Émission suivie':'+ Suivre cette émission'}</button><button data-edit-show="${escapeHtml(id)}">${icon('settings')} Règle de suivi</button><button data-add-video="${escapeHtml(id)}">${icon('plus')} Ajouter une vidéo</button></div></div>${imageTag(show.cover)}</section><div class="section-line"><h2>Les épisodes <span class="count" id="resultCount"></span></h2></div>${toolbar('episodes')}<div id="results"></div>`;
}
function settingsPage() {
  const colors=['#f15a61','#e7bc75','#80bfa3','#83aaff','#ba9af1'];
  const user=cloudStatus.user;
  return heading('Votre espace','Mon profil','Vos suivis et vos préférences vous accompagnent sur tous vos appareils.') + `<section class="panel"><div class="profile-identity">${avatar(user,true)}<div><h2>${escapeHtml(user.displayName||'Mon compte')}</h2><p>${escapeHtml(user.email)}</p><span class="small muted">Connexion Google · ${cloudStatus.sync==='saving'?'Enregistrement en cours':'Compte synchronisé'}</span></div><button data-action="sign-out">Se déconnecter</button></div><div class="settings-row"><div><strong>Couleur d’accentuation</strong><p>Le rouge par défaut, ou une autre ambiance.</p></div><div class="swatches">${colors.map(c=>`<button data-accent="${c}" style="--swatch:${c}" class="${state.accent===c?'active':''}" aria-label="Accent ${c}" aria-pressed="${state.accent===c}"></button>`).join('')}</div></div><div class="settings-row"><div><strong>Apparence</strong><p>Choisissez votre thème.</p></div><button data-action="theme">Passer au thème ${state.theme==='dark'?'clair':'sombre'}</button></div></section><section class="panel"><h2>Votre bibliothèque</h2><div class="settings-row"><div><strong>Vos données personnelles</strong><p>${state.following.length} suivis · ${state.favorites.length} favoris · ${state.watched.length} épisodes vus. Les ajouts et règles personnalisées restent propres à votre compte.</p></div></div>${legacyState()?'<div class="settings-row"><div><strong>Ancienne démo détectée</strong><p>Vous pouvez importer les choix de ce navigateur dans ce compte Google. Rien n’est importé automatiquement.</p></div><button data-action="import-legacy">Importer l’ancienne démo</button></div>':''}<div class="settings-row"><div><strong>Catalogue importé le ${catalogueDate()}</strong><p>${seedEpisodes.length} vidéos réparties dans ${seedShows.length} sélections. L’actualisation YouTube n’est pas encore connectée.</p></div><a class="link-button" href="#/about">Consulter les sources</a></div><div class="settings-row"><div><strong>Réinitialiser ma bibliothèque</strong><p>Retire vos suivis, favoris et ajouts personnels de ce compte. Le catalogue commun reste disponible.</p></div><button class="danger" data-action="reset">Réinitialiser</button></div></section>`;
}
function catalogueOverview() {
  return `<section class="panel"><h2>Les sources du catalogue</h2><p>Relevé du ${catalogueDate()}. ${seedEpisodes.length} vidéos référencées ; aucune vidéo n’est téléchargée ou hébergée ici.</p><ul class="rule-list">${seedShows.map(show => `<li><strong>${escapeHtml(show.name)} · ${show.catalogCount} vidéos</strong><br>${escapeHtml(show.sourceNote)}<br><a class="accent" href="${escapeHtml(show.source)}" target="_blank" rel="noopener noreferrer">Ouvrir la source YouTube ↗</a></li>`).join('')}</ul></section>`;
}
function aboutPage() {
  return heading('Sous le capot','Le bon programme. Au bon endroit.','Un agrégateur d’émissions YouTube, pensé pour votre propre sélection.') + `<section class="panel"><h2>Ce que vous pouvez déjà tester</h2><p>Suivre ou ne plus suivre une émission, rechercher et filtrer les épisodes, passer de la galerie à la liste, lire une vidéo, conserver des favoris et une liste à voir, marquer les épisodes comme vus, ajouter manuellement une vidéo, personnaliser le thème et explorer les catalogues importés.</p><p>Les vidéos référencées proviennent de catalogues publics relevés le ${catalogueDate()}. Les playlists ont été parcourues jusqu’à leur dernière page. Les vidéos privées, supprimées ou absentes des sources peuvent manquer. Aucune mise à jour automatique n’est active pour le moment.</p></section>${catalogueOverview()}<section class="panel"><h2>Comment automatiser le suivi ?</h2><ul class="rule-list"><li><strong>1. Une playlist officielle, en priorité.</strong> On récupère tous ses éléments avec pagination. Les nouveaux épisodes apparaissent lorsque la chaîne les ajoute.</li><li><strong>2. Une chaîne et des règles de sélection.</strong> On parcourt les publications de la chaîne et on filtre le titre ou la description. Exemple : « papy grenier ». Pour Rhinocéros : « rhinocéros » ou « 🦏 ». Les accents et les majuscules sont ignorés.</li><li><strong>3. Une correction manuelle.</strong> Certaines émissions n’ont pas de nom dans le titre ou changent de présentation. Des exclusions et ajouts manuels permettront de corriger les erreurs.</li></ul></section><section class="panel"><h2>Les limites techniques</h2><ul class="rule-list"><li><strong>GitHub Pages héberge le frontend.</strong> Il n’exécute pas de serveur. Une GitHub Action planifiée peut alimenter un catalogue public JSON ; un service séparé peut gérer des suivis individuels. Une exécution planifiée peut être retardée.</li><li><strong>L’API YouTube permettra d’actualiser le catalogue.</strong> Elle demande un projet Google Cloud, une clé API et respecte des quotas. Les appels peuvent partir du navigateur avec une clé restreinte au domaine, ou d’un serveur avec une clé conservée dans ses secrets. Les appels par playlist sont plus adaptés qu’une recherche complète à chaque visite.</li><li><strong>La lecture reste celle de YouTube.</strong> Certaines vidéos interdisent l’intégration, sont privées, supprimées ou restreintes selon l’âge ou le pays. Le lien « Ouvrir sur YouTube » reste disponible. Les publicités et restrictions ne sont pas contournées.</li><li><strong>Firebase gère votre espace personnel.</strong> La connexion Google identifie votre compte ; Firestore conserve vos suivis, favoris et états de visionnage. Les règles limitent l’accès au propriétaire de ces données. Il ne remplace pas l’API de catalogue YouTube.</li><li><strong>Confidentialité.</strong> Les miniatures sont chargées depuis YouTube. Le lecteur youtube-nocookie.com n’est créé qu’après votre clic sur « Charger le lecteur » ; ce clic déclenche une connexion au service YouTube.</li></ul><p><a class="accent" href="https://developers.google.com/youtube/v3/getting-started" target="_blank" rel="noopener noreferrer">Documentation YouTube Data API ↗</a> · <a class="accent" href="https://developers.google.com/youtube/iframe_api_reference" target="_blank" rel="noopener noreferrer">Documentation du lecteur ↗</a></p></section>`;
}
function render() {
  accountChrome();
  if(cloudStatus.phase!=='ready'){app.innerHTML=authPage();return;}
  const current = route();
  const routeKey = `${current.page}/${current.id || ''}`;
  if (routeKey !== lastRoute) {
    filter = {query:'',category:'all',status:'all',sort:'newest',show:'all'};
    lastRoute = routeKey;
    if (modal.open) closeModal();
  }
  document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === current.page || (current.page==='show' && a.dataset.nav==='shows'); a.classList.toggle('active',active); if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current'); });
  document.querySelector('#queueCount').textContent = state.queue.length || '';
  if (['shows','explore'].includes(current.page)) app.innerHTML = showPage();
  else if (current.page === 'show') app.innerHTML = detailPage(current.id);
  else if (current.page === 'settings') app.innerHTML = settingsPage();
  else if (current.page === 'about') app.innerHTML = aboutPage();
  else if (['episodes','favorites','watchlist'].includes(current.page)) {
    const content = {episodes:['Le fil de vos programmes','Tous mes épisodes','Les épisodes des émissions que vous suivez.'],favorites:['Les incontournables','Mes favoris','Ces épisodes qu’on aime retrouver. Encore et encore.'],watchlist:['Pour votre prochaine pause','À voir','Votre petite réserve de bons programmes.']}[current.page];
    app.innerHTML = heading(...content) + (current.page==='episodes'?demoNote():'') + `<div class="section-line"><h2>${current.page==='episodes'?'Votre sélection':'Votre liste'} <span class="count" id="resultCount"></span></h2></div>` + toolbar('episodes') + '<div id="results"></div>';
  } else app.innerHTML = heading('Oups','Page introuvable','Retrouvez votre bibliothèque.') + '<a href="#/shows" class="link-button">Mes émissions</a>';
  updateResults();
  applyPreferences();
}
function openModal(content,player=false) {
  modal.classList.toggle('player-dialog',player);
  modalContent.innerHTML = content;
  if(!modal.open)modal.showModal();
}
function closeModal() { modal.close(); modalContent.innerHTML=''; }
function modalHeading(title) { return `<div class="modal-head"><h2 id="modalTitle">${title}</h2><button class="icon-button" data-close aria-label="Fermer">${icon('close')}</button></div>`; }
function showForm(id) {
  const show = showFor(id);
  openModal(modalHeading(show?'Règle de suivi':'Suivre une émission') + `<form id="showForm" data-id="${escapeHtml(id || '')}" class="form-grid"><label>Nom de l’émission<input name="name" required maxlength="100" placeholder="Ex. Papy Grenier" value="${escapeHtml(show?.name || '')}"></label><label>Chaîne YouTube<input name="channel" required maxlength="100" placeholder="Ex. Joueur du Grenier" value="${escapeHtml(show?.channel || '')}"></label><label>Méthode de suivi<select name="mode"><option value="keywords" ${show?.mode==='keywords'?'selected':''}>Chaîne + mots-clés</option><option value="playlist" ${show?.mode==='playlist'?'selected':''}>Playlist YouTube</option><option value="channel" ${show?.mode==='channel'?'selected':''}>Chaîne entière</option></select></label><label>Lien de la chaîne ou de la playlist<input name="source" type="url" required placeholder="https://www.youtube.com/…" value="${escapeHtml(show?.source || '')}"></label><label>Mots-clés, séparés par des virgules<input name="keywords" maxlength="200" placeholder="Ex. rhinocéros, 🦏" value="${escapeHtml(show?.keywords || '')}"><span class="hint">Au moins un mot-clé doit correspondre au titre ou à la description. Les mots-clés ne sont pas nécessaires avec une playlist ou une chaîne entière.</span></label><div class="rule-preview" id="rulePreview"></div><p class="hint">Prototype : cette règle est enregistrée, mais aucune récupération automatique n’est encore active. Vous pouvez ajouter des vidéos manuellement.</p><div class="form-error" id="formError" role="alert"></div><div class="form-footer"><button type="button" data-close>Annuler</button><button class="primary">${show?'Enregistrer la règle':'Suivre cette émission'}</button></div></form>`);
  updateRulePreview();
}
function updateRulePreview() {
  const form = document.querySelector('#showForm');
  if(!form)return;
  const data = new FormData(form);
  document.querySelector('#rulePreview').textContent = data.get('mode') === 'playlist' ? 'Règle : conserver les vidéos de la playlist choisie.' : data.get('mode') === 'channel' ? 'Règle : conserver toutes les publications publiques de la chaîne.' : `Règle : sur ${data.get('channel') || 'la chaîne choisie'}, conserver les titres ou descriptions contenant ${data.get('keywords') || 'vos mots-clés'}.`;
}
function youtubeUrl(value) {
  try { const url = new URL(value); return url.protocol==='https:' && ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname) ? url : null; } catch { return null; }
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
function playEpisode(id) {
  const episode = state.episodes.find(e=>e.id===id);
  if(!episode)return;
  openModal(modalHeading(escapeHtml(episode.title)) + `<div id="playerSlot" class="player-placeholder"><div style="font-size:35px;color:var(--accent)">▶</div><h3>Votre épisode, ici.</h3><p>Le lecteur sera chargé depuis YouTube après votre clic. Certaines vidéos doivent être regardées directement sur YouTube.</p><button class="primary" data-load-player="${id}">Charger le lecteur</button></div><p class="small">${escapeHtml(episode.note || 'Vidéo ajoutée manuellement.')} Le statut « vu » se gère manuellement.</p><div class="player-actions"><a class="link-button" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube ↗</a><button data-player-watched="${id}" aria-pressed="${state.watched.includes(id)}">${state.watched.includes(id)?'✓ Vu':'Marquer comme vu'}</button></div>`,true);
}
function toggle(key,id) {
  if(!canEdit()||!['favorites','watched','queue'].includes(key) || !state.episodes.some(e=>e.id===id))return;
  const active = state[key].includes(id);
  state[key] = active ? state[key].filter(v=>v!==id) : [...state[key],id];
  save(); render();
  toast({favorites:active?'Retiré des favoris':'Ajouté aux favoris',queue:active?'Retiré de votre liste à voir':'Ajouté à votre liste à voir',watched:active?'Épisode marqué non vu':'Épisode marqué comme vu'}[key]);
}
document.addEventListener('click',async event=>{
  const button = event.target.closest('button');
  if(!button)return;
  const data = button.dataset;
  if('close' in data) return closeModal();
  if(data.action==='sign-in'){if(globalThis.youtubeFavsCloud)await globalThis.youtubeFavsCloud.signIn();return;}
  if(data.action==='sign-out'){if(globalThis.youtubeFavsCloud)await globalThis.youtubeFavsCloud.signOut();return;}
  if(data.action==='retry-cloud'){if(globalThis.youtubeFavsCloud)globalThis.youtubeFavsCloud.retry();else location.reload();return;}
  if(!canEdit())return;
  if(data.action==='import-legacy')return openModal(modalHeading('Importer l’ancienne démo ?')+`<p>Les choix conservés sur ce navigateur ne sont associés à aucun compte. Ils seront ajoutés au compte <strong>${escapeHtml(cloudStatus.user.email)}</strong> : suivis, favoris, liste à voir, épisodes vus et ajouts personnels. Ils ne remplaceront pas les autres choix déjà enregistrés dans le cloud.</p><div class="form-footer"><button data-close>Annuler</button><button class="primary" data-action="confirm-import">Importer dans ce compte</button></div>`);
  if(data.action==='confirm-import'){
    const uid=cloudStatus.user.uid,legacy=legacyState();
    if(!legacy)return closeModal();
    const imported=privateModel.pack({shows:[],episodes:[],...legacy},catalogue);
    state=privateModel.hydrate(privateModel.applyPatch(privateModel.pack(state,catalogue),privateModel.diff(privateModel.empty(),imported)),catalogue);
    button.disabled=true;closeModal();render();
    if(await save() && cloudStatus.user?.uid===uid){try{localStorage.removeItem(STORAGE_KEY);}catch{}render();toast('Ancienne démo importée dans votre compte.');}
    return;
  }

  if(data.play) return playEpisode(data.play);
  if(data.loadPlayer) {
    const slot = document.querySelector('#playerSlot');
    slot.className='';
    slot.innerHTML=`<iframe class="player" src="https://www.youtube-nocookie.com/embed/${data.loadPlayer}" title="Lecteur YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    return;
  }
  if(data.playerWatched) {
    const id=data.playerWatched;
    const active=state.watched.includes(id);
    state.watched=active?state.watched.filter(v=>v!==id):[...state.watched,id];
    save();render();button.textContent=active?'Marquer comme vu':'✓ Vu';button.setAttribute('aria-pressed',String(!active));return;
  }
  if(data.toggle) return toggle(data.toggle,data.id);
  if(data.follow) {
    state.following = state.following.includes(data.follow) ? state.following.filter(id=>id!==data.follow) : [...state.following,data.follow];
    save();render();return;
  }
  if(data.editShow) return showForm(data.editShow);
  if(data.addVideo) return videoForm(data.addVideo);
  if(data.view) {state.view=data.view;save();render();return;}
  if(data.filter) {filter[data.filter]=data.value;render();return;}
  if(data.accent) {state.accent=data.accent;save();render();return;}
  if(data.action==='add-show')return showForm();
  if(data.action==='theme'){state.theme=state.theme==='dark'?'light':'dark';save();render();return;}
  if(data.action==='clear-filters'){filter={query:'',category:'all',status:'all',sort:'newest',show:'all'};render();return;}
  if(data.action==='reset')return openModal(modalHeading('Réinitialiser ma bibliothèque ?')+'<p>Vos suivis, favoris, épisodes vus et ajouts personnels seront retirés de votre compte. Le catalogue commun restera disponible.</p><div class="form-footer"><button data-close>Annuler</button><button class="primary" data-action="confirm-reset">Réinitialiser</button></div>');
  if(data.action==='confirm-reset'){state=initialState();save();closeModal();render();toast('Bibliothèque réinitialisée.');}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){filter.query=event.target.value;updateResults();}
  if(event.target.closest('#showForm'))updateRulePreview();
});
document.addEventListener('change',event=>{
  if(event.target.id==='showFilter'){filter.show=event.target.value;updateResults();}
  if(event.target.id==='sort'){filter.sort=event.target.value;updateResults();}
});
document.addEventListener('submit',event=>{
  if(!['showForm','videoForm'].includes(event.target.id))return;
  event.preventDefault();
  if(!canEdit())return;
  const form=event.target;
  const values=new FormData(form);
  const error=message=>{document.querySelector('#formError').textContent=message;};
  if(form.id==='showForm'){
    const name=values.get('name').trim();
    const channel=values.get('channel').trim();
    const source=youtubeUrl(values.get('source').trim());
    const mode=values.get('mode');
    const keywords=values.get('keywords').trim();
    if(!name||!channel)return error('Renseignez le nom de l’émission et de la chaîne.');
    if(!source)return error('Utilisez un lien HTTPS youtube.com valide.');
    if(mode==='playlist' && (!['youtube.com','www.youtube.com','m.youtube.com'].includes(source.hostname) || !/^[\w-]{10,}$/.test(source.searchParams.get('list')||'')))return error('Le lien de la playlist doit contenir son identifiant list=.');
    if(mode!=='playlist' && (!['youtube.com','www.youtube.com','m.youtube.com'].includes(source.hostname) || !/^\/(?:@[^/]+|channel\/[^/]+|user\/[^/]+|c\/[^/]+)\/?$/.test(source.pathname)))return error('Utilisez un lien de chaîne, par exemple youtube.com/@blastinfo.');
    if(mode==='keywords'&&!keywords.split(',').some(v=>v.trim()))return error('Ajoutez au moins un mot-clé.');
    const existing=showFor(form.dataset.id);
    if(state.shows.some(s=>s.id!==existing?.id&&normalize(s.name)===normalize(name)&&normalize(s.channel)===normalize(channel)))return error('Cette émission existe déjà dans votre bibliothèque.');
    const record={...(existing||{}),id:existing?.id||crypto.randomUUID(),name,channel,source:source.href,mode,keywords,initials:existing?.initials||channel.slice(0,2).toUpperCase(),description:existing?.description||'Votre nouvelle émission. Ajoutez des épisodes pour commencer à explorer.',category:existing?.category||'Personnel',cover:existing?.cover||'',customRule:true};
    if(existing)state.shows=state.shows.map(s=>s.id===existing.id?record:s);else state.shows.push(record);
    if(!state.following.includes(record.id))state.following.push(record.id);
    save();closeModal();location.hash=`/show/${record.id}`;render();toast('Règle enregistrée. L’import automatique sera connecté dans une prochaine étape.');
  }else{
    const id=videoId(values.get('url').trim());
    const title=values.get('title').trim();
    if(!id)return error('Utilisez un lien valide vers une vidéo YouTube.');
    if(!title)return error('Renseignez le titre de la vidéo.');
    if(state.episodes.some(e=>e.id===id))return error('Cette vidéo est déjà dans votre bibliothèque.');
    state.episodes.push({id,showId:form.dataset.show,title,note:'Vidéo ajoutée manuellement.',added:Date.now()});
    const show=showFor(form.dataset.show);if(!show.cover)show.cover=id;
    save();closeModal();render();toast('Vidéo ajoutée à votre émission.');
  }
});
modal.addEventListener('close',()=>{modalContent.innerHTML='';});
modal.addEventListener('click',event=>{if(event.target===modal){const box=modal.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeModal();}});
window.addEventListener('hashchange',()=>{render();window.scrollTo({top:0,behavior:'instant'});});
window.addEventListener('youtube-favs:auth',event=>{
  closeModal();
  state=initialState();lastSaved=privateModel.empty();
  cloudStatus={phase:event.detail.status,user:event.detail.user,message:event.detail.message||'',sync:'ready'};
  filter={query:'',category:'all',status:'all',sort:'newest',show:'all'};lastRoute='';
  applyPreferences();render();
});
window.addEventListener('youtube-favs:data',event=>{
  if(event.detail.uid!==cloudStatus.user?.uid)return;
  state=privateModel.hydrate(event.detail.data,catalogue);
  lastSaved=privateModel.pack(state,catalogue);
  cloudStatus.phase='ready';cloudStatus.message='';
  applyPreferences();render();
});
window.addEventListener('youtube-favs:sync',event=>{
  if(event.detail.uid!==cloudStatus.user?.uid)return;
  cloudStatus.sync=event.detail.status;
  if(event.detail.status==='error'){cloudStatus.phase='error';cloudStatus.message=event.detail.message;closeModal();render();}
  else accountChrome();
});
window.addEventListener('youtube-favs:login-error',event=>{cloudStatus.message=event.detail.message;render();});
setTimeout(()=>{
  if(cloudStatus.phase==='loading'){
    cloudStatus.phase='error';cloudStatus.message='Le chargement prend plus de temps que prévu. Vérifiez votre connexion puis réessayez.';render();
  }
},25000);
if(!location.hash)history.replaceState(null,'','#/explore');
render();
