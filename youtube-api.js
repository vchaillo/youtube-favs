'use strict';
// Only a public Worker URL is stored in this browser. API keys and ID tokens are never stored here.
globalThis.YouTubeFavsApi=(()=>{
  const DEFAULT_ORIGIN='https://youtube-favs.valentinchaillou89.workers.dev';
  const STORAGE_KEY='youtube-favs:worker-origin';
  const fail=(code,message)=>Object.assign(new Error(message),{code});
  function normalizeOrigin(value){
    let url;try{url=new URL(value.trim());}catch{throw fail('invalid-origin','Saisissez une URL HTTPS valide pour le Worker.');}
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw fail('invalid-origin','Utilisez uniquement l’origine HTTPS du Worker, sans chemin, identifiants ni paramètres.');
    return url.origin;
  }
  function createClient({storage=globalThis.localStorage,fetchImpl=(...args)=>fetch(...args)}={}){
    let origin=DEFAULT_ORIGIN;
    try{const saved=storage?.getItem(STORAGE_KEY);if(saved)origin=normalizeOrigin(saved);}catch{}
    async function check(value){
      const target=normalizeOrigin(value);
      let response,body;
      try{
        response=await fetchImpl(`${target}/health`,{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
        body=await response.json();
      }catch{throw fail('worker-unavailable','Worker inaccessible. Vérifiez son URL, son déploiement et la configuration Cloudflare.');}
      if(!response.ok||body.service!=='youtube-favs'||body.projectId!=='yt-favs-b05e1')throw fail('wrong-worker','Cette URL ne correspond pas au Worker youtube-favs attendu.');
      if(!body.youtubeConfigured)throw fail('missing-key','Le Worker répond : ajoutez le secret YOUTUBE_API_KEY dans Cloudflare.');
      if(!body.rateLimitConfigured)throw fail('missing-limits','Le Worker répond : redéployez-le avec le fichier worker/wrangler.toml du dépôt.');
      return target;
    }
    return {
      getOrigin:()=>origin,
      async configure(value){
        const target=await check(value);let persisted=true;
        try{storage?.setItem(STORAGE_KEY,target);}catch{persisted=false;}
        origin=target;return {origin,persisted};
      },
      check:()=>check(origin),
      async call(data,{getToken,isCurrent}){
        const target=origin;
        const valid=()=>isCurrent()&&origin===target;
        for(let attempt=0;attempt<2;attempt++){
          const token=await getToken(attempt===1);
          if(!valid())throw fail('session-changed','La session a changé.');
          let response,body;
          try{
            response=await fetchImpl(`${target}/api/youtube`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(45000)});
            body=await response.json();
          }catch{
            if(!valid())throw fail('session-changed','La session a changé.');
            throw fail('worker-unavailable','Le service YouTube est inaccessible. Vérifiez l’URL du Worker dans Mon profil.');
          }
          if(!valid())throw fail('session-changed','La session a changé.');
          if(response.status===401&&attempt===0)continue;
          if(!response.ok)throw fail(body.error?.code||'worker-error',body.error?.message||'La récupération YouTube a échoué.');
          if(!Array.isArray(data.action==='channels'?body.channels:body.episodes))throw fail('worker-error','Réponse du Worker invalide.');
          return body;
        }
      },
    };
  }
  return {createClient,normalizeOrigin,DEFAULT_ORIGIN};
})();
