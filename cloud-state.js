'use strict';

// Only private selections and custom records belong in Firestore. The public catalogue stays bundled.
globalThis.YouTubeFavsState = (() => {
  const listFields = ['following','favorites','watched','queue'];
  const recordFields = ['shows','episodes'];
  const preferenceFields = ['view','accent','theme'];
  const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
  const videoPattern = /^[a-zA-Z0-9_-]{11}$/;
  const cleanText = (value,max=200) => typeof value === 'string' ? value.slice(0,max) : '';
  function empty() {
    return {schemaVersion:1,following:[],favorites:[],watched:[],queue:[],shows:[],episodes:[],view:'grid',accent:'#f15a61',theme:'dark'};
  }
  function safeSource(value) {
    try {const url=new URL(value);return url.protocol==='https:' && ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname) ? url.href : '';}catch{return '';}
  }
  function unique(items,key) {
    return [...new Map(items.map(item=>[key ? item[key] : item,item])).values()];
  }
  function sanitize(raw={}) {
    const value = raw && typeof raw==='object' ? raw : {};
    const result=empty();
    for(const key of listFields) {
      const pattern=key==='following'?idPattern:videoPattern;
      result[key]=unique((Array.isArray(value[key])?value[key]:[]).filter(id=>typeof id==='string'&&pattern.test(id))).slice(0,key==='following'?1000:5000);
    }
    result.shows=unique((Array.isArray(value.shows)?value.shows:[]).filter(show=>show&&typeof show.id==='string'&&idPattern.test(show.id)&&typeof show.name==='string'&&typeof show.channel==='string'&&['keywords','playlist','channel'].includes(show.mode)&&safeSource(show.source)).map(show=>({id:show.id,name:cleanText(show.name,100),channel:cleanText(show.channel,100),source:safeSource(show.source),mode:show.mode,keywords:cleanText(show.keywords),description:cleanText(show.description,500),initials:cleanText(show.initials,8),category:cleanText(show.category,60)||'Personnel',cover:videoPattern.test(show.cover||'')?show.cover:'',customRule:true})),'id').slice(0,200);
    result.episodes=unique((Array.isArray(value.episodes)?value.episodes:[]).filter(episode=>episode&&typeof episode.id==='string'&&typeof episode.showId==='string'&&videoPattern.test(episode.id)&&idPattern.test(episode.showId)&&typeof episode.title==='string').map(episode=>({id:episode.id,showId:episode.showId,title:episode.apiImported===true?'Vidéo YouTube':cleanText(episode.title),...(episode.apiImported===true?{apiImported:true}:{}),note:cleanText(episode.note,500),added:Number.isSafeInteger(episode.added)?episode.added:0})),'id').slice(0,1000);
    result.view=value.view==='list'?'list':'grid';
    result.theme=value.theme==='light'?'light':'dark';
    result.accent=/^#[a-fA-F0-9]{6}$/.test(value.accent||'')?value.accent:result.accent;
    return result;
  }
  function pack(state,catalogue) {
    const showIds=new Set(catalogue.shows.map(show=>show.id));
    const episodeIds=new Set(catalogue.episodes.map(episode=>episode.id));
    return sanitize({...state,shows:(Array.isArray(state?.shows)?state.shows:[]).filter(show=>show&&(!showIds.has(show.id)||show.customRule)),episodes:(Array.isArray(state?.episodes)?state.episodes:[]).filter(episode=>episode&&!episodeIds.has(episode.id))});
  }
  function hydrate(raw,catalogue) {
    const privateState=sanitize(raw);
    const overrides=new Map(privateState.shows.map(show=>[show.id,show]));
    const shows=catalogue.shows.map(show=>({...structuredClone(show),...(overrides.get(show.id)||{})}));
    const ids=new Set(shows.map(show=>show.id));
    shows.push(...privateState.shows.filter(show=>!ids.has(show.id)));
    const episodeIds=new Set(catalogue.episodes.map(episode=>episode.id));
    const episodes=[...structuredClone(catalogue.episodes),...privateState.episodes.filter(episode=>!episodeIds.has(episode.id))].filter(episode=>shows.some(show=>show.id===episode.showId));
    return {...privateState,shows,episodes};
  }
  function diff(previous,next) {
    const before=sanitize(previous),after=sanitize(next),patch={lists:{},records:{},preferences:{}};
    for(const key of listFields) {
      patch.lists[key]={add:after[key].filter(id=>!before[key].includes(id)),remove:before[key].filter(id=>!after[key].includes(id))};
    }
    for(const key of recordFields) {
      const beforeMap=new Map(before[key].map(record=>[record.id,record]));
      patch.records[key]={upsert:after[key].filter(record=>JSON.stringify(record)!==JSON.stringify(beforeMap.get(record.id))),remove:before[key].filter(record=>!after[key].some(item=>item.id===record.id)).map(record=>record.id)};
    }
    for(const key of preferenceFields)if(before[key]!==after[key])patch.preferences[key]=after[key];
    return patch;
  }
  function applyPatch(remote,patch) {
    const result=sanitize(remote);
    for(const key of listFields) {
      const {add,remove}=patch.lists[key];
      result[key]=unique([...result[key].filter(id=>!remove.includes(id)),...add]);
    }
    for(const key of recordFields) {
      const {upsert,remove}=patch.records[key];
      const records=new Map(result[key].filter(record=>!remove.includes(record.id)).map(record=>[record.id,record]));
      for(const record of upsert)records.set(record.id,record);
      result[key]=[...records.values()];
    }
    return sanitize({...result,...patch.preferences});
  }
  function hasChanges(patch) {
    return Object.values(patch.lists).some(part=>part.add.length||part.remove.length)||Object.values(patch.records).some(part=>part.upsert.length||part.remove.length)||Object.keys(patch.preferences).length>0;
  }
  function cancellation() {return Object.assign(new Error('Session changed.'),{code:'session-changed'});}
  // Capture the account's document outside this queue. Never retarget pending work after account changes.
  function createSession({transact,onData,onStatus}) {
    let active=true,failed=false,pending=0,tail=Promise.resolve(),latest=empty(),revision=-1;
    function receive(value,version=-1) {
      if(!active||version<revision)return;
      latest=sanitize(value);revision=version;
      if(!pending&&!failed)onData(structuredClone(latest));
    }
    function save(previous,next) {
      const patch=diff(previous,next);
      if(!active||failed)return Promise.reject(cancellation());
      if(!hasChanges(patch))return Promise.resolve();
      pending++;onStatus('saving');
      const operation=tail.then(async()=>{
        if(!active||failed)throw cancellation();
        const saved=await transact(remote=>{
          if(!active||failed)throw cancellation();
          const payload=applyPatch(remote,patch);
          if(JSON.stringify(payload).length>240000)throw Object.assign(new Error('Personal library is too large.'),{code:'library-too-large'});
          return payload;
        });
        if(!active)throw cancellation();
        receive(saved.data,saved.revision);
      });
      tail=operation.catch(error=>{if(active){failed=true;onStatus('error',error);}});
      return operation.finally(()=>{
        pending--;
        if(active&&!pending&&!failed){onData(structuredClone(latest));onStatus('ready');}
      });
    }
    return {receive,save,stop(){active=false;latest=empty();},isActive:()=>active};
  }
  return {empty,sanitize,pack,hydrate,diff,applyPatch,createSession};
})();
