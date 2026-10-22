'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../library.js');
const {scan}=globalThis.YouTubeFavsLibrary;

test('five consecutive empty pages pause scanning and preserve the next page token',async()=>{
  let calls=0;
  const result=await scan({mode:'keywords',request:async token=>{assert.equal(token,calls?String(calls):'');calls++;return {episodes:[],scanned:50,nextPageToken:String(calls)};}});
  assert.equal(calls,5);assert.equal(result.scanned,250);assert.equal(result.next,'5');assert.equal(result.reason,'five-empty');
});
test('a match resets the empty-page counter and continuation starts where the previous scan stopped',async()=>{
  let calls=0;
  const result=await scan({mode:'keywords',pageToken:'resume',request:async token=>{if(!calls)assert.equal(token,'resume');calls++;return {episodes:calls===4?[{id:'AAAAAAAAAAA'}]:[],scanned:50,nextPageToken:String(calls)};}});
  assert.equal(calls,9);assert.equal(result.next,'9');
});
test('manual channel imports stop after one page while playlists can be traversed completely',async()=>{
  let calls=0;
  await scan({mode:'channel',singlePage:true,request:async()=>{calls++;return {episodes:[],nextPageToken:'NEXT'};}});assert.equal(calls,1);
  calls=0;await scan({mode:'playlist',request:async()=>({episodes:[],nextPageToken:++calls<7?String(calls):null})});assert.equal(calls,7);
});
test('new-release scans stop at the last known date only for chronological channel uploads',async()=>{
  let calls=0;
  const result=await scan({mode:'keywords',stopAtDate:Date.parse('2026-01-01'),request:async()=>{calls++;return {episodes:[],oldestPublishedAt:'2025-12-01',nextPageToken:'NEXT'};}});
  assert.equal(calls,1);assert.equal(result.reason,'caught-up');
});
test('cancellation ignores an in-flight response and repeated page tokens fail explicitly',async()=>{
  let stopped=false,delivered=0;
  await scan({mode:'keywords',shouldStop:()=>stopped,request:async()=>{stopped=true;return {episodes:[],nextPageToken:'NEXT'};},onPage:()=>delivered++});assert.equal(delivered,0);
  await assert.rejects(scan({mode:'keywords',request:async()=>({episodes:[],nextPageToken:'SAME'})}),/même page/);
});

test('short-video filtering uses an explicit three-minute threshold and never guesses missing durations',()=>{
  const {isShortVideo}=globalThis.YouTubeFavsLibrary;
  for(const durationLabel of ['0:01','0:59','1:00','2:59','3:00','0:03:00'])assert.equal(isShortVideo({durationLabel}),true,durationLabel);
  for(const durationLabel of ['3:01','1:00:00','','0:00','unknown','2:90'])assert.equal(isShortVideo({durationLabel}),false,durationLabel);
});
