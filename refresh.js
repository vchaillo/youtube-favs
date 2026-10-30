'use strict';
// A visible, signed-in tab refreshes independently of routing. Store timings, never video data.
globalThis.YouTubeFavsRefresh={
  BASE_INTERVAL:15*60*1000,
  interval(units){return Math.max(this.BASE_INTERVAL,Math.ceil(Math.max(1,units)*86400000/2000));},
  create({run,ready,visible,read=()=>null,write=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,lock=task=>task()}){
    let active=true,busy=false,timer=null,nextAt=0,lastUnits=0;
    const readState=()=>{try{const value=read();if(Number.isFinite(value?.nextAt))nextAt=Math.max(nextAt,Math.min(value.nextAt,now()+7*86400000));if(Number.isFinite(value?.units))lastUnits=Math.max(0,value.units);}catch{}};
    function schedule(delay){clearTimer(timer);if(active)timer=setTimer(()=>{void check(false);},Math.max(0,delay));}
    async function check(force=false){
      if(!active||busy)return false;
      readState();
      if(!ready()||(!force&&!visible())){schedule(60000);return false;}
      if(!force&&now()<nextAt){schedule(nextAt-now());return false;}
      busy=true;clearTimer(timer);
      try{
        await lock(async()=>{
          if(!active||!ready())return;
          readState();if(!force&&now()<nextAt)return;
          nextAt=now()+globalThis.YouTubeFavsRefresh.interval(lastUnits);
          try{write({nextAt,units:lastUnits});}catch{}
          const report=await run({automatic:!force});
          if(!active)return;
          lastUnits=report?.units||lastUnits||1;
          nextAt=now()+Math.max(globalThis.YouTubeFavsRefresh.interval(lastUnits),report?.retryAfter||0);
          try{write({nextAt,units:lastUnits});}catch{}
        });
      }catch{nextAt=now()+Math.max(globalThis.YouTubeFavsRefresh.BASE_INTERVAL,60000);}
      finally{busy=false;if(active)schedule(Math.max(1000,nextAt-now()));}
      return true;
    }
    return {start(){readState();schedule(Math.max(0,nextAt-now()));},poke(){if(active&&!busy)schedule(Math.max(0,nextAt-now()));},checkNow(){return check(true);},stop(){active=false;clearTimer(timer);},getNextAt:()=>nextAt};
  },
};
