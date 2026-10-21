import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,onAuthStateChanged,signInWithPopup,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore,doc,onSnapshot,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';


// Firebase Web configuration is public. Firestore rules enforce access to each user's data.
const firebaseConfig={
  apiKey:'AIzaSyDkNI6foyeLpfEtda47pVMV8AzYGXCcvno',
  authDomain:'yt-favs-b05e1.firebaseapp.com',
  projectId:'yt-favs-b05e1',
  storageBucket:'yt-favs-b05e1.firebasestorage.app',
  messagingSenderId:'1063386161668',
  appId:'1:1063386161668:web:4e058b2d3f9b3083228b51',
};
const firebase=initializeApp(firebaseConfig);
const auth=getAuth(firebase);
const youtubeClient=globalThis.YouTubeFavsApi.createClient();
auth.languageCode='fr';
// Keep Firestore's default memory cache. Personal application data is never persisted to browser storage.
const db=getFirestore(firebase);
const provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});
const model=globalThis.YouTubeFavsState;
let session=null,unsubscribe=null,generation=0;
function emit(type,detail){window.dispatchEvent(new CustomEvent(`youtube-favs:${type}`,{detail}));}
function identity(user){return user?{uid:user.uid,displayName:user.displayName||'',email:user.email||'',photoURL:user.photoURL||''}:null;}
function errorMessage(error){
  const messages={
    'auth/unauthorized-domain':'Le domaine vchaillo.github.io doit être ajouté aux domaines autorisés de Firebase Authentication.',
    'auth/operation-not-allowed':'La connexion Google doit être activée dans Firebase Authentication.',
    'auth/popup-blocked':'Le navigateur a bloqué la fenêtre Google. Autorisez les popups pour ce site et réessayez.',
    'auth/popup-closed-by-user':'Connexion annulée. Vous pouvez réessayer.',
    'auth/cancelled-popup-request':'Une fenêtre de connexion est déjà ouverte.',
    'auth/network-request-failed':'Connexion à Google impossible. Vérifiez votre connexion et réessayez.',
    'permission-denied':'Firestore refuse l’accès. Les règles du dépôt doivent être publiées dans la console Firebase.',
    'unavailable':'Le service de sauvegarde est momentanément indisponible. Vérifiez votre connexion et réessayez.',
    'library-too-large':'Votre bibliothèque personnelle est trop volumineuse pour cette version.',
  };
  return messages[error?.code]||'La connexion ou la sauvegarde cloud a échoué. Réessayez dans un instant.';
}
function stopSession(){generation++;if(unsubscribe)unsubscribe();unsubscribe=null;if(session)session.stop();session=null;}
function connect(user){
  stopSession();
  const current=generation;
  if(!user){emit('auth',{status:'signed-out',user:null});return;}
  const account=identity(user);
  emit('auth',{status:'loading',user:account});
  const reference=doc(db,'users',user.uid,'app','state');
  session=model.createSession({
    async transact(update){
      return runTransaction(db,async transaction=>{
        if(current!==generation||auth.currentUser?.uid!==user.uid)throw Object.assign(new Error('Session changed.'),{code:'session-changed'});
        const snapshot=await transaction.get(reference);
        const revision=snapshot.exists()?snapshot.data().revision+1:0;
        const data=update(snapshot.exists()?snapshot.data():model.empty());
        transaction.set(reference,{...data,revision,updatedAt:serverTimestamp()});
        return {data,revision};
      });
    },
    onData(data){if(current===generation)emit('data',{uid:user.uid,data});},
    onStatus(status,error){if(current===generation)emit('sync',{uid:user.uid,status,message:error?errorMessage(error):''});},
  });
  unsubscribe=onSnapshot(reference,{includeMetadataChanges:true},snapshot=>{
    // Wait for server authorization. An empty local cache must not become a writable signed-in screen.
    if(current!==generation||snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
    session.receive(snapshot.exists()?snapshot.data():model.empty(),snapshot.exists()?snapshot.data().revision:-1);
  },error=>{
    if(current!==generation)return;
    if(session)session.stop();
    emit('auth',{status:'error',user:account,message:errorMessage(error)});
  });
}
globalThis.youtubeFavsCloud={
  workerOrigin:()=>youtubeClient.getOrigin(),
  configureWorker:value=>youtubeClient.configure(value),
  async youtube(data){
    const owner=auth.currentUser,current=generation;
    if(!owner)throw Object.assign(new Error('Connectez-vous pour actualiser YouTube.'),{code:'session-changed'});
    return youtubeClient.call(data,{
      getToken:refresh=>owner.getIdToken(refresh),
      isCurrent:()=>generation===current&&auth.currentUser?.uid===owner.uid,
    });
  },
  async signIn(){try{await signInWithPopup(auth,provider);}catch(error){emit('login-error',{message:errorMessage(error)});}},
  async signOut(){
    stopSession();emit('auth',{status:'loading',user:null});
    try{await signOut(auth);connect(null);}catch(error){emit('login-error',{message:errorMessage(error)});connect(auth.currentUser);}
  },
  retry(){connect(auth.currentUser);},
  save(previous,next){
    if(!session||!session.isActive()||!auth.currentUser)return Promise.reject(Object.assign(new Error('Sign in first.'),{code:'session-changed'}));
    return session.save(previous,next);
  },
};
onAuthStateChanged(auth,connect,error=>emit('auth',{status:'error',user:null,message:errorMessage(error)}));
