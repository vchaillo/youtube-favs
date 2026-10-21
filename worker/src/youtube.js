const VIDEO=/^[\w-]{11}$/;
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function fail(code,message){return Object.assign(new Error(message),{code});}
// Only known reason codes are reflected. Google messages may contain credentials or request URLs.
export function googleFailure(body,status){
  const legacy=body?.error?.errors?.[0]?.reason;
  const detail=body?.error?.details?.find(item=>typeof item?.reason==='string')?.reason;
  const reasons=[detail,legacy];
  const messages=[
    [['SERVICE_DISABLED','accessNotConfigured'],'YouTube Data API v3 est désactivée ou non autorisée pour le projet auquel appartient cette clé. Activez-la dans ce projet, puis réessayez après quelques minutes.'],
    [['API_KEY_INVALID','keyInvalid'],'La clé YouTube est invalide ou a été supprimée. Remplacez le secret YOUTUBE_API_KEY dans Cloudflare par la clé complète, sans guillemets.'],
    [['API_KEY_SERVICE_BLOCKED'],'Les restrictions de cette clé bloquent YouTube Data API v3. Autorisez cette API dans les restrictions relatives aux API de la clé Google Cloud.'],
    [['API_KEY_HTTP_REFERRER_BLOCKED','ipRefererBlocked'],'La clé est restreinte à un site web. Le Worker appelle Google côté serveur : utilisez une clé dédiée avec restrictions d’application sur « Aucune » et restreinte à YouTube Data API v3.'],
    [['API_KEY_IP_ADDRESS_BLOCKED'],'La restriction IP de la clé bloque les serveurs Cloudflare. Vérifiez les restrictions d’application de la clé serveur.'],
    [['API_KEY_EXPIRED'],'La clé YouTube a expiré. Créez une nouvelle clé et remplacez le secret YOUTUBE_API_KEY dans Cloudflare.'],
  ];
  if(reasons.some(reason=>['quotaExceeded','dailyLimitExceeded','rateLimitExceeded','RATE_LIMIT_EXCEEDED'].includes(reason)))return fail('resource-exhausted','Le quota YouTube est atteint. Réessayez plus tard.');
  for(const [codes,message] of messages){const reason=reasons.find(value=>codes.includes(value));if(reason)return fail('failed-precondition',`${message} (${reason})`);}
  if(status===404)return fail('not-found','Cette chaîne ou playlist est introuvable ou privée.');
  if(legacy==='forbidden')return fail('failed-precondition','Google refuse l’accès à cette ressource (forbidden). Vérifiez que la source est publique et que la clé autorise YouTube Data API v3.');
  if(['invalidPageToken','pageTokenInvalid'].includes(legacy))return fail('invalid-argument','Cette page YouTube a expiré. Relancez « Importer depuis YouTube » pour recommencer.');
  return fail('unavailable','YouTube a refusé la requête. Vérifiez la source ou relancez l’import.');
}
export function parseRequest(data){
  if(!data||typeof data!=='object')throw fail('invalid-argument','Requête invalide.');
  if(data.action==='videos'){
    if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>50||data.ids.some(id=>typeof id!=='string'||!VIDEO.test(id)))throw fail('invalid-argument','Entre 1 et 50 identifiants vidéo sont nécessaires.');
    return {action:'videos',ids:[...new Set(data.ids)].sort()};
  }
  if(data.action!=='catalog'||!['playlist','channel','keywords'].includes(data.mode))throw fail('invalid-argument','Méthode de suivi invalide.');
  let source;try{source=new URL(data.source);}catch{throw fail('invalid-argument','Lien YouTube invalide.');}
  if(source.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com'].includes(source.hostname)||source.username||source.password||source.port)throw fail('invalid-argument','Utilisez un lien HTTPS youtube.com.');
  const result={action:'catalog',mode:data.mode,pageToken:data.pageToken||'',keywords:[]};
  if(typeof result.pageToken!=='string'||result.pageToken.length>512||!/^[-\w=]*$/.test(result.pageToken))throw fail('invalid-argument','Page invalide. Recommencez l’import.');
  if(data.mode==='playlist'){
    result.playlistId=source.searchParams.get('list');
    if(!/^[\w-]{10,150}$/.test(result.playlistId||''))throw fail('invalid-argument','Identifiant de playlist invalide.');
  }else{
    let pathname;try{pathname=decodeURIComponent(source.pathname).replace(/\/$/,'');}catch{throw fail('invalid-argument','Lien de chaîne invalide.');}
    if(/^\/channel\/UC[\w-]{22}$/.test(pathname))result.channel={id:pathname.split('/')[2]};
    else if(/^\/@[^\s/?#]{1,100}$/u.test(pathname))result.channel={forHandle:pathname.slice(1)};
    else if(/^\/user\/[\w-]{1,100}$/.test(pathname))result.channel={forUsername:pathname.split('/')[2]};
    else throw fail('invalid-argument','Utilisez le lien @identifiant ou /channel/ de la chaîne.');
    if(data.mode==='keywords'){
      if(typeof data.keywords!=='string'||data.keywords.length>200)throw fail('invalid-argument','Mots-clés invalides.');
      result.keywords=data.keywords.split(',').map(s=>normalize(s.trim())).filter(Boolean);
      if(!result.keywords.length)throw fail('invalid-argument','Ajoutez au moins un mot-clé.');
    }
  }
  return result;
}
export function durationLabel(value=''){
  const m=/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if(!m)return '';
  const seconds=Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0);
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),last=String(seconds%60).padStart(2,'0');
  return hours?`${hours}:${String(minutes).padStart(2,'0')}:${last}`:`${minutes}:${last}`;
}
function metadata(video){
  return {id:video.id,title:(video.snippet?.title||'Vidéo YouTube').slice(0,200),author:(video.snippet?.channelTitle||'').slice(0,100),publishedAt:video.snippet?.publishedAt||'',durationLabel:durationLabel(video.contentDetails?.duration),embeddable:video.status?.embeddable!==false};
}
export function createService({apiKey,consume,fetchImpl=fetch,now=Date.now}){
  const cache=new Map();
  async function google(resource,params){
    const url=new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for(const [key,value] of Object.entries({...params,key:apiKey()}))if(value)url.searchParams.set(key,String(value));
    let response,body;
    try{response=await fetchImpl(url,{signal:AbortSignal.timeout(12000)});body=await response.json();}
    catch{throw fail('unavailable','YouTube est momentanément inaccessible. Réessayez.');}
    if(!response.ok)throw googleFailure(body,response.status);
    return body;
  }
  async function videos(ids){
    if(!ids.length)return [];
    const data=await google('videos',{part:'snippet,contentDetails,status',id:ids.join(','),fields:'items(id,snippet(title,description,channelTitle,publishedAt),contentDetails(duration),status(embeddable))'});
    return data.items||[];
  }
  return async function handle(request){
    // The HTTP handler verifies the Firebase ID token before supplying request.auth.
    if(!request.auth?.uid)throw fail('unauthenticated','Connectez-vous pour importer depuis YouTube.');
    const input=parseRequest(request.data);
    if(!apiKey())throw fail('failed-precondition','La clé YouTube doit être configurée dans les secrets Cloudflare.');
    const key=JSON.stringify(input);
    const hit=cache.get(key);
    const cached=hit&&hit.expires>now();
    // Reserve an upper bound before requests, including failed upstream calls.
    await consume(request.auth.uid,cached?0:input.action==='videos'?1:input.channel?3:2);
    if(cached)return {...structuredClone(hit.value),cached:true};
    let result;
    if(input.action==='videos')result={episodes:(await videos(input.ids)).map(metadata),nextPageToken:null,scanned:input.ids.length};
    else{
      let playlistId=input.playlistId;
      if(input.channel){
        const channels=await google('channels',{part:'contentDetails',...input.channel,fields:'items(contentDetails(relatedPlaylists(uploads)))'});
        playlistId=channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if(!playlistId)throw fail('not-found','Cette chaîne est introuvable ou ne publie pas de vidéos.');
      }
      const page=await google('playlistItems',{part:'contentDetails',playlistId,maxResults:50,pageToken:input.pageToken,fields:'nextPageToken,pageInfo(totalResults),items(contentDetails(videoId))'});
      const ids=[...new Set((page.items||[]).map(item=>item.contentDetails?.videoId).filter(id=>VIDEO.test(id||'')))];
      const items=await videos(ids);
      const selected=input.mode==='keywords'?items.filter(v=>input.keywords.some(keyword=>normalize(`${v.snippet?.title||''} ${v.snippet?.description||''}`).includes(keyword))):items;
      result={episodes:selected.map(metadata),nextPageToken:page.nextPageToken||null,scanned:(page.items||[]).length,total:page.pageInfo?.totalResults||0};
    }
    result.fetchedAt=new Date(now()).toISOString();
    // Metadata is held in memory for 15 minutes only; no API titles in Firestore.
    for(const [entry,value] of cache)if(value.expires<=now())cache.delete(entry);
    if(cache.size>=128)cache.delete(cache.keys().next().value);
    cache.set(key,{value:result,expires:now()+15*60*1000});
    return {...result,cached:false};
  };
}
