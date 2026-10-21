import {PROJECT_ID,verifyFirebaseToken} from './firebase-auth.js';
import {createService} from './youtube.js';
const ALLOWED_ORIGIN='https://vchaillo.github.io';
const statuses={'invalid-argument':400,unauthenticated:401,'not-found':404,'failed-precondition':503,'resource-exhausted':429,unavailable:502};
export function createWorker({verifyToken=verifyFirebaseToken,fetchImpl=fetch}={}){
  const services=new WeakMap();
  return {async fetch(request,env){
    const cors={'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'86400','Vary':'Origin'};
    const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
    const error=(code,message,status=statuses[code]||500)=>json({error:{code,message}},status,code==='resource-exhausted'?{'Retry-After':'60'}:{});
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==ALLOWED_ORIGIN)return error('forbidden','Origine non autorisée.',403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET')return json({ok:true,service:'youtube-favs',projectId:PROJECT_ID,youtubeConfigured:Boolean(env.YOUTUBE_API_KEY),rateLimitConfigured:Boolean(env.USER_LIMITER&&env.GLOBAL_LIMITER)});
    if(path!=='/api/youtube')return error('not-found','Route introuvable.');
    if(request.method!=='POST')return json({error:{code:'method-not-allowed',message:'Utilisez POST.'}},405,{Allow:'POST, OPTIONS'});
    const authorization=request.headers.get('Authorization')||'';
    if(!authorization.startsWith('Bearer '))return error('unauthenticated','Connectez-vous pour accéder à YouTube.');
    let auth;
    try{auth=await verifyToken(authorization.slice(7));}catch{return error('unauthenticated','Session Firebase invalide ou expirée. Reconnectez-vous.');}
    if(!env.YOUTUBE_API_KEY)return error('failed-precondition','Ajoutez le secret YOUTUBE_API_KEY dans les paramètres Cloudflare du Worker.');
    if(!env.USER_LIMITER||!env.GLOBAL_LIMITER)return error('failed-precondition','Les limites du Worker sont absentes. Déployez le dossier worker avec son fichier wrangler.toml.');
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return error('invalid-argument','Un corps JSON est nécessaire.');
    // Limit the stream itself, including requests without Content-Length.
    let data;
    try{
      if(Number(request.headers.get('Content-Length'))>16384)throw Error('Too large');
      const reader=request.body?.getReader();if(!reader)throw Error('Missing body');
      const chunks=[];let length=0;
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw Error('Too large');}chunks.push(value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      data=JSON.parse(new TextDecoder().decode(bytes));
    }catch{return error('invalid-argument','Requête JSON invalide ou trop volumineuse.');}
    try{
      if(!services.has(env))services.set(env,createService({apiKey:()=>env.YOUTUBE_API_KEY,fetchImpl,async consume(uid,cost){
        if(!(await env.USER_LIMITER.limit({key:uid})).success)throw Object.assign(new Error('Trop de demandes pour ce compte. Réessayez dans une minute.'),{code:'resource-exhausted'});
        if(cost&&!(await env.GLOBAL_LIMITER.limit({key:'youtube'})).success)throw Object.assign(new Error('Le service reçoit trop de demandes. Réessayez dans une minute.'),{code:'resource-exhausted'});
      }}));
      return json(await services.get(env)({auth,data}));
    }catch(cause){
      const status=statuses[cause.code];
      return error(status?cause.code:'internal',status?cause.message:'Le service YouTube est momentanément indisponible.',status||500);
    }
  }};
}
export default createWorker();
