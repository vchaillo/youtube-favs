'use strict';
// Reconcile existing cards so state changes do not reload thumbnails or lose focus.
globalThis.YouTubeFavsDOM={
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
