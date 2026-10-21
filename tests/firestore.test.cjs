'use strict';
const {test,before,after,beforeEach}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc,collection,getDocs,serverTimestamp,runTransaction}=require('firebase/firestore');
let environment;
const state=(overrides={})=>({schemaVersion:1,following:[],favorites:[],watched:[],queue:[],shows:[],episodes:[],view:'grid',accent:'#f15a61',theme:'dark',revision:0,updatedAt:serverTimestamp(),...overrides});
const reference=(database,uid='alice')=>doc(database,'users',uid,'app','state');
before(async()=>{environment=await initializeTestEnvironment({projectId:'demo-youtube-favs',firestore:{rules:fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8')}});});
beforeEach(async()=>{await environment.clearFirestore();});
after(async()=>{await environment?.cleanup();});

test('signed-out clients cannot read, query or write private state',async()=>{
 const db=environment.unauthenticatedContext().firestore();
 await assertFails(getDoc(reference(db)));await assertFails(setDoc(reference(db),state()));
 await assertFails(getDocs(collection(db,'users','alice','app')));
});
test('owners can create and read only their exact state document',async()=>{
 const db=environment.authenticatedContext('alice').firestore();
 await assertSucceeds(setDoc(reference(db),state()));await assertSucceeds(getDoc(reference(db)));
 await assertFails(getDoc(reference(db,'bob')));await assertFails(setDoc(reference(db,'bob'),state()));
 await assertFails(setDoc(doc(db,'users','alice','app','other'),state()));
 await assertFails(setDoc(doc(db,'catalogue','shared'),state()));
});
test('another account cannot read, modify or delete existing private data',async()=>{
 const alice=environment.authenticatedContext('alice').firestore();
 const bob=environment.authenticatedContext('bob').firestore();
 await setDoc(reference(alice),state({favorites:['V34x1CxlAZ0']}));
 await assertFails(getDoc(reference(bob)));await assertFails(updateDoc(reference(bob),{favorites:[],revision:1,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(reference(bob)));
});
test('profile state writes reject extra fields, invalid types and invalid timestamps',async()=>{
 const db=environment.authenticatedContext('alice').firestore();
 await assertFails(setDoc(reference(db),state({admin:true})));
 await assertFails(setDoc(reference(db),state({favorites:'all'})));
 await assertFails(setDoc(reference(db),state({theme:'unsafe'})));
 await assertFails(setDoc(reference(db),state({accent:'url(evil)'})));
 await assertFails(setDoc(reference(db),state({updatedAt:new Date(0)})));
 await assertFails(setDoc(reference(db),state({following:Array(1001).fill('papy')})));
 await assertFails(setDoc(reference(db),state({schemaVersion:2})));
});
test('updates require a new revision and accept the transaction used by the app',async()=>{
 const db=environment.authenticatedContext('alice').firestore();
 await setDoc(reference(db),state());
 await assertFails(updateDoc(reference(db),{favorites:['V34x1CxlAZ0'],updatedAt:serverTimestamp()}));
 await assertSucceeds(runTransaction(db,async transaction=>{
  const snapshot=await transaction.get(reference(db));
  transaction.set(reference(db),state({...snapshot.data(),favorites:['V34x1CxlAZ0'],revision:snapshot.data().revision+1,updatedAt:serverTimestamp()}));
 }));
 await assertSucceeds(deleteDoc(reference(db)));
});

test('the existing rules accept private library source watermarks and episode novelty flags',async()=>{
 const db=environment.authenticatedContext('alice').firestore();
 await assertSucceeds(setDoc(reference(db),state({following:['program'],shows:[{id:'program',name:'Programme',channel:'Channel',mode:'keywords',source:'https://www.youtube.com/@example',keywords:'show',releaseAfter:'2026-10-21T00:00:00.000Z',cover:'AAAAAAAAAAA'}],episodes:[{id:'AAAAAAAAAAA',showId:'program',title:'Vidéo YouTube',apiImported:true,newRelease:true,added:1}]})));
 await assertSucceeds(getDoc(reference(db)));
 const bob=environment.authenticatedContext('bob').firestore();await assertFails(getDoc(reference(bob)));
});
