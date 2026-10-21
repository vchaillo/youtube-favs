// Verify Firebase ID tokens using Google's public RSA keys. No service-account secret is needed.
export const PROJECT_ID='yt-favs-b05e1';
const JWKS_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const decode=value=>{
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Malformed token');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
};
export function createTokenVerifier({fetchKeys=fetch,now=Date.now}={}){
  let keys=[],expiresAt=0,lastRefresh=-Infinity,refreshing=null;
  const imported=new Map();
  async function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      lastRefresh=now();
      const response=await fetchKeys(JWKS_URL,{signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Public keys unavailable');
      const body=await response.json();
      if(!Array.isArray(body.keys)||!body.keys.length)throw Error('Public keys unavailable');
      keys=body.keys;imported.clear();
      const maxAge=Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]||300);
      expiresAt=now()+Math.min(Math.max(maxAge,60),3600)*1000;
    })();
    try{await refreshing;}finally{refreshing=null;}
  }
  return async function verifyFirebaseToken(token){
    if(typeof token!=='string'||token.length>8192)throw Error('Invalid token');
    const parts=token.split('.');if(parts.length!==3)throw Error('Malformed token');
    let header,payload;
    try{
      header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
      payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    }catch{throw Error('Malformed token');}
    if(!header||header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>200||header.crit)throw Error('Invalid algorithm');
    const seconds=Math.floor(now()/1000);
    if(!payload||payload.aud!==PROJECT_ID||payload.iss!==`https://securetoken.google.com/${PROJECT_ID}`||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||!Number.isFinite(payload.exp)||payload.exp<=seconds||!Number.isFinite(payload.iat)||payload.iat>seconds||!Number.isFinite(payload.auth_time)||payload.auth_time>seconds||(payload.nbf!==undefined&&(!Number.isFinite(payload.nbf)||payload.nbf>seconds)))throw Error('Invalid claims');
    if(now()>=expiresAt)await refresh();
    let key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
    // Allow key rotation, but do not let arbitrary kid values trigger repeated Google requests.
    if(!key&&now()-lastRefresh>=60000){await refresh();key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');}
    if(!key)throw Error('Signing key not found');
    if(!imported.has(key.kid))imported.set(key.kid,await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']));
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported.get(key.kid),decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if(!valid)throw Error('Invalid signature');
    return {uid:payload.sub};
  };
}
export const verifyFirebaseToken=createTokenVerifier();
