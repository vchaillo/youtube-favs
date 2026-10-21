'use strict';
// Shared page traversal for archive previews and new-release checks.
globalThis.YouTubeFavsLibrary={
  async scan({request,mode,pageToken='',onPage=()=>{},shouldStop=()=>false,stopAtDate=null,singlePage=false,emptyPageLimit=5}){
    let next=pageToken,emptyPages=0,pages=0,scanned=0,reason='end';
    const tokens=new Set();
    while(true){
      if(shouldStop()){reason='paused';break;}
      if(tokens.has(next))throw new Error('YouTube a renvoyé la même page. Relancez la recherche.');
      tokens.add(next);
      const result=await request(next);
      if(shouldStop()){reason='paused';break;}
      pages++;scanned+=result.scanned||0;
      emptyPages=result.episodes.length?0:emptyPages+1;
      next=result.nextPageToken||null;
      await onPage(result,{pages,scanned,emptyPages,next});
      if(!next)break;
      if(stopAtDate&&mode!=='playlist'&&result.oldestPublishedAt&&Date.parse(result.oldestPublishedAt)<=stopAtDate){reason='caught-up';break;}
      if(mode==='keywords'&&emptyPages>=emptyPageLimit){reason='five-empty';break;}
      if(singlePage){reason='page';break;}
    }
    return {next,pages,scanned,emptyPages,reason};
  },
};
