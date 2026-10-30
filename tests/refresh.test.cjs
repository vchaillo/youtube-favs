'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../refresh.js');
const refresh=globalThis.YouTubeFavsRefresh;
function clock(){
  let now=1000000,id=0;const timers=new Map();
  return {now:()=>now,setTimer(fn,delay){const key=++id;timers.set(key,{fn,at:now+delay});return key;},clearTimer(key){timers.delete(key);},async advance(delay=0){now+=delay;for(let i=0;i<30;i++){for(const [key,timer] of timers)if(timer.at<=now){timers.delete(key);timer.fn();}await Promise.resolve();}},timers};
}
test('visible sessions poll without navigation and adapt the interval to estimated quota cost',async()=>{
  const time=clock();let calls=0;let shared=null;
  const scheduler=refresh.create({...time,ready:()=>true,visible:()=>true,run:async()=>{calls++;return {units:30};},read:()=>shared,write:value=>{shared=value;}});
  scheduler.start();await time.advance();assert.equal(calls,1);
  assert.ok(shared.nextAt-time.now()>refresh.BASE_INTERVAL);
  await time.advance(refresh.BASE_INTERVAL);assert.equal(calls,1);
  await time.advance(shared.nextAt-time.now());assert.equal(calls,2);
  scheduler.stop();assert.equal(time.timers.size,0);
});
test('hidden or unsaved sessions defer checks and resuming obeys the shared cooldown',async()=>{
  const time=clock();let visible=false,ready=true,calls=0,shared=null;
  const scheduler=refresh.create({...time,ready:()=>ready,visible:()=>visible,run:async()=>{calls++;return {units:3};},read:()=>shared,write:value=>{shared=value;}});
  scheduler.start();await time.advance();assert.equal(calls,0);
  visible=true;ready=false;scheduler.poke();await time.advance();assert.equal(calls,0);
  ready=true;scheduler.poke();await time.advance();assert.equal(calls,1);
  scheduler.stop();
  const reloaded=refresh.create({...time,ready:()=>true,visible:()=>true,run:async()=>{calls++;return {units:3};},read:()=>shared});
  reloaded.start();await time.advance();assert.equal(calls,1);
  await reloaded.checkNow();assert.equal(calls,2);reloaded.stop();
});
test('in-flight checks do not overlap and stopping cannot reschedule an old account',async()=>{
  const time=clock();let release,calls=0;
  const scheduler=refresh.create({...time,ready:()=>true,visible:()=>true,run:()=>{calls++;return new Promise(resolve=>{release=()=>resolve({units:3});});}});
  scheduler.start();await time.advance();await scheduler.checkNow();assert.equal(calls,1);
  scheduler.stop();release();await time.advance();assert.equal(time.timers.size,0);
});
test('quota failures produce a longer backoff',async()=>{
  const time=clock();const scheduler=refresh.create({...time,ready:()=>true,visible:()=>true,run:async()=>({units:3,retryAfter:3600000})});
  scheduler.start();await time.advance();assert.equal(scheduler.getNextAt()-time.now(),3600000);scheduler.stop();
});
