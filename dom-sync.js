'use strict';
// Reconcile existing cards so state changes do not reload thumbnails or lose focus.
const motionAllowed=()=>!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function animateSafely(element,frames,options){
  if(!element?.animate||!motionAllowed())return null;
  try{return element.animate(frames,options);}catch{return null;}
}
function watchedIconFeedback(button){
  animateSafely(button,[{transform:'scale(1)'},{transform:'scale(1.22)',color:'#80bfa3',borderColor:'#80bfa3',offset:.45},{transform:'scale(1)'}],{duration:360,easing:'ease-out'});
  animateSafely(button?.querySelector('svg'),[{strokeDasharray:'32',strokeDashoffset:'32',opacity:0},{strokeDasharray:'32',strokeDashoffset:'0',opacity:1}],{duration:300,easing:'ease-out'});
}
globalThis.YouTubeFavsDOM={
  captureEpisode(id){
    if(!motionAllowed())return [];
    return [...document.querySelectorAll(`[data-key="episode-${id}"],.import-row[data-episode-id="${id}"]`)].flatMap(element=>{
      if(!element.animate||!element.getBoundingClientRect)return [];
      const rect=element.getBoundingClientRect();
      if(!rect.width||!rect.height)return [];
      return [{element,rect,clone:element.cloneNode(true),isList:Boolean(element.closest('.list')),host:element.closest('dialog')||document.body}];
    });
  },
  feedback(snapshots,kind,departing=false){
    for(const {element,rect,clone,isList,host} of snapshots){
      if(!motionAllowed())continue;
      if(kind==='watched'&&!departing){
        animateSafely(element,[{boxShadow:'0 0 0 0 #80bfa300'},{boxShadow:'0 0 0 3px #80bfa380',offset:.4},{boxShadow:'0 0 0 0 #80bfa300'}],{duration:430,easing:'ease-out'});
        watchedIconFeedback(element.querySelector('[data-toggle="watched"]'));
        continue;
      }
      // An inert visual copy can finish its exit after the real card is removed.
      clone.removeAttribute('id');clone.removeAttribute('data-key');
      for(const child of clone.querySelectorAll('[id]'))child.removeAttribute('id');
      const overlay=document.createElement('div');
      overlay.className=isList?'list':'';
      overlay.setAttribute('data-animation-overlay','');overlay.setAttribute('aria-hidden','true');overlay.setAttribute('inert','');
      Object.assign(overlay.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',zIndex:'100',pointerEvents:'none',overflow:'hidden',transformOrigin:'50% 50%'});
      Object.assign(clone.style,{width:'100%',height:'100%',margin:'0'});
      overlay.appendChild(clone);host.appendChild(overlay);
      const watched=kind==='watched';
      const animation=animateSafely(overlay,watched?[
        {opacity:1,transform:'translateY(0) scale(1)',boxShadow:'0 0 0 2px #80bfa3'},
        {opacity:.9,transform:'translateY(-5px) scale(.98)',offset:.3},
        {opacity:0,transform:'translateY(-22px) scale(.94)',boxShadow:'0 0 0 4px #80bfa300'},
      ]:[
        {opacity:1,transform:'translateX(0) rotate(0deg) scale(1)',boxShadow:'0 0 0 2px #ff9298'},
        {opacity:0,transform:'translateX(38px) rotate(4deg) scale(.88)',boxShadow:'0 0 0 3px #ff929800'},
      ],{duration:watched?340:280,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'});
      if(watched)watchedIconFeedback(clone.querySelector('[data-toggle="watched"]'));
      if(animation)animation.finished.then(()=>overlay.remove(),()=>overlay.remove());else overlay.remove();
    }
  },
  watchedIcon:watchedIconFeedback,
  clearFeedback(){for(const overlay of document.querySelectorAll('[data-animation-overlay]'))overlay.remove();},
  update(target,html,{preserveResults=false}={}){
    if(!document.createElement){target.innerHTML=html;return;}
    const template=document.createElement('template');template.innerHTML=html;
    const key=node=>node.nodeType===1?(node.id||node.getAttribute('data-key')||''):'';
    const compatible=(left,right)=>left&&left.nodeType===right.nodeType&&left.nodeName===right.nodeName&&key(left)===key(right);
    function patch(current,next){
      if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
      for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
      if(preserveResults&&current.id==='results')return;
      children(current,next);
      if(['INPUT','SELECT'].includes(current.tagName)&&current.value!==next.value)current.value=next.value;
    }
    function children(parent,next){
      const keyed=new Map([...parent.childNodes].filter(node=>key(node)).map(node=>[key(node),node]));
      let position=0;
      for(const desired of [...next.childNodes]){
        let current=parent.childNodes[position],existing=key(desired)?keyed.get(key(desired)):null;
        if(existing&&compatible(existing,desired)){
          if(existing!==current)parent.insertBefore(existing,current||null);
          current=existing;
        }else if(!compatible(current,desired)){
          current=desired.cloneNode(true);parent.insertBefore(current,parent.childNodes[position]||null);
        }
        patch(current,desired);position++;
      }
      while(parent.childNodes.length>position)parent.lastChild.remove();
    }
    children(target,template.content);
  },
};
