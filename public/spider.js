// Visual events only. This module never reads wallet secrets or calls trading APIs.
const spider=document.getElementById('spider-companion'),label=document.getElementById('spider-label');
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),seen=new Set(),queue=[];
const ns='http://www.w3.org/2000/svg',web=document.createElementNS(ns,'svg'),thread=document.createElementNS(ns,'path'),halo=document.createElementNS(ns,'circle');
web.id='spider-web';web.setAttribute('aria-hidden','true');thread.classList.add('spider-thread');halo.classList.add('spider-anchor');halo.setAttribute('r','7');web.append(thread,halo);document.body.append(web);
let active=false,animation=null,frame=0,lastActivity=0,generation=0;
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
function reset(){cancelAnimationFrame(frame);animation?.cancel();animation=null;spider.style.removeProperty('will-change');spider.style.removeProperty('transform');spider.className='spider-idle';web.classList.remove('web-active');label.textContent='Đang theo dõi thị trường';active=false;}
function targetFor(event){
 if(event.target?.isConnected)return event.target;
 const selector=event.side==='BUY'?'#candidates':event.side==='SELL'?'#trades':event.anchor??'#activity-message';
 return document.querySelector(selector)??document.getElementById('decision-log');
}
async function play(){
 if(active||!queue.length||document.hidden)return;
 active=true;const event=queue.shift(),ownGeneration=++generation;
 const buy=event.side==='BUY',sell=event.side==='SELL';spider.className=buy?'spider-buy spider-flight':sell?'spider-sell spider-flight':'spider-action spider-flight';
 label.textContent=event.text??`${buy?'Đã mua':'Đã bán'} ${String(event.symbol??'token').slice(0,20)}`;
 if(reduced.matches){await new Promise(r=>setTimeout(r,1100));if(generation===ownGeneration){reset();play();}return;}
 const box=spider.getBoundingClientRect(),target=targetFor(event)?.getBoundingClientRect();
 const width=document.documentElement.clientWidth,height=innerHeight;
 const visible=target&&target.bottom>36&&target.top<height-36;
 const anchor={x:visible?clamp(target.left+target.width*.75,35,width-35):clamp(box.left-140,35,width-35),y:visible?clamp(target.top+Math.min(target.height*.5,65),60,height-70):Math.max(65,box.top-160)};
 const origin={x:box.left+box.width/2,y:box.top+box.height*.68};
 const maxTravel=Math.min(380,height*.45),distance=Math.hypot(anchor.x-origin.x,anchor.y-origin.y),scale=Math.min(1,maxTravel/Math.max(1,distance));
 const dx=(anchor.x-origin.x)*scale,dy=(anchor.y-origin.y)*scale;
 web.setAttribute('viewBox',`0 0 ${width} ${height}`);halo.setAttribute('cx',anchor.x);halo.setAttribute('cy',anchor.y);web.style.color=getComputedStyle(spider).color;
 thread.setAttribute('d',`M${origin.x} ${origin.y} L${anchor.x} ${anchor.y}`);thread.style.setProperty('--thread-length',String(distance));web.classList.add('web-active');
 spider.style.willChange='transform';
 animation=spider.animate([
  {transform:'translate3d(0,0,0) rotate(0deg)',offset:0},
  {transform:'translate3d(0,5px,0) rotate(-4deg)',offset:.12},
  {transform:`translate3d(${dx*.55}px,${dy*.8-22}px,0) rotate(${dx<0?-12:12}deg)`,offset:.36},
  {transform:`translate3d(${dx}px,${dy}px,0) rotate(${dx<0?6:-6}deg)`,offset:.55},
  {transform:`translate3d(${dx*.92}px,${dy*.93+8}px,0) rotate(-3deg)`,offset:.66},
  {transform:`translate3d(${dx*.25}px,${dy*.35-18}px,0) rotate(5deg)`,offset:.84},
  {transform:'translate3d(0,0,0) rotate(0deg)',offset:1}
 ],{duration:1900,easing:'cubic-bezier(.4,0,.2,1)',fill:'both'});
 const update=()=>{if(!active||generation!==ownGeneration)return;const r=spider.getBoundingClientRect();thread.setAttribute('d',`M${r.left+r.width/2} ${r.top+r.height*.68} Q${(r.left+r.width/2+anchor.x)/2+12} ${(r.top+r.height*.68+anchor.y)/2+14} ${anchor.x} ${anchor.y}`);frame=requestAnimationFrame(update);};
 update();try{await animation.finished;}catch{}finally{if(generation===ownGeneration){reset();play();}}
}
function enqueue(event){
 if(event.id&&seen.has(event.id))return;
 if(event.id){seen.add(event.id);if(seen.size>500)seen.delete(seen.values().next().value);}
 if(event.side)queue.unshift(event);else{if(Date.now()-lastActivity<6500)return;lastActivity=Date.now();queue.push(event);}
 if(queue.length>4)queue.splice(4);play();
}
window.addEventListener('meme-trade',({detail:t})=>{if(t&&['BUY','SELL'].includes(t.side)&&['paper','live'].includes(t.mode))enqueue(t);});
window.addEventListener('meme-activity',({detail})=>{if(detail)enqueue(detail);});
document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&!button.disabled)enqueue({target:button,text:'Đang xử lý thao tác…'});},{passive:true});
for(const name of ['resize','orientationchange'])window.addEventListener(name,()=>{generation++;reset();play();},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;queue.length=0;reset();}else play();});
reduced.addEventListener('change',()=>{generation++;reset();play();});
