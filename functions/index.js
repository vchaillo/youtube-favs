'use strict';
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {createHash}=require('node:crypto');
const {createService,nextLimits}=require('./youtube.cjs');
initializeApp();
const db=getFirestore();
const youtubeKey=defineSecret('YOUTUBE_API_KEY');
const service=createService({
  apiKey:()=>youtubeKey.value(),
  async consume(uid,cost){
    const userRef=db.doc(`_youtubeLimits/user-${createHash('sha256').update(uid).digest('hex')}`);
    const globalRef=db.doc('_youtubeLimits/global');
    await db.runTransaction(async tx=>{
      const [user,global]=await Promise.all([tx.get(userRef),tx.get(globalRef)]);
      const limits=nextLimits(user.data(),global.data(),cost,Date.now());
      const expiresAt=Timestamp.fromMillis(Date.now()+2*86400000);
      tx.set(userRef,{...limits.user,expiresAt});
      if(cost)tx.set(globalRef,{...limits.global,expiresAt});
    });
  },
});
exports.youtubeCatalog=onCall({
  region:'europe-west1',secrets:[youtubeKey],timeoutSeconds:60,
  memory:'256MiB',minInstances:0,maxInstances:2,concurrency:10,
  cors:['https://vchaillo.github.io'],
},async request=>{
  try{return await service(request);}catch(error){
    const codes=['invalid-argument','unauthenticated','not-found','failed-precondition','resource-exhausted','unavailable'];
    if(codes.includes(error.code))throw new HttpsError(error.code,error.message);
    // Do not log request URLs, tokens, or upstream errors containing credentials.
    throw new HttpsError('internal','Le service YouTube est momentanément indisponible.');
  }
});
