// Decorative activity follower. No wallet access, order submission or synthetic fills.
const spider=document.getElementById('spider-companion'),label=document.getElementById('spider-label');
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),seen=new Set(),queue=[];
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
let position=null,animation=null,active=false,generation=0,lastActivity=0,current=null,highlight=null,resizeFrame=0;
function remember(id){if(!id)return true;if(seen.has(id))return false;seen.add(id);if(seen.size>500)seen.delete(seen.values().next().value);return true;}
function targetFor(event){
 if(event.target?.isConnected)return event.target;
 if(event.mint){
  const candidates=[...document.querySelectorAll('[data-spider-mint]')].filter(el=>el.dataset.spiderMint===event.mint);
  const visible=candidates.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;});
  const role=event.side==='SELL'?'position':event.side==='BUY'?'candidate':'decision';
  const match=visible.find(el=>el.dataset.spiderRole===role)??visible[0];if(match)return match;
 }
 return document.querySelector(event.anchor??(event.side==='SELL'?'#live-position-list':event.side==='BUY'?'#candidates':'#activity-message'))??document.getElementById('decision-log');
}
function transform(p){return `translate3d(${p.x}px,${p.y}px,0)`;}
function bounds(){return {w:document.documentElement.clientWidth,h:innerHeight,sw:spider.offsetWidth,sh:spider.offsetHeight};}
function fit(p){const {w,h,sw,sh}=bounds();return {x:clamp(p.x,6,Math.max(6,w-sw-6)),y:clamp(p.y,8,Math.max(8,h-sh-8))};}
function initialize(){
 if(position)return;
 const r=spider.getBoundingClientRect();position=fit({x:r.left,y:r.top});
 spider.classList.add('spider-roaming');spider.style.transform=transform(position);
}
function stop(){
 if(animation){const r=spider.getBoundingClientRect();animation.cancel();animation=null;position=fit({x:r.left,y:r.top});spider.style.transform=transform(position);}
 spider.classList.remove('spider-crawling');spider.style.removeProperty('will-change');active=false;
}
function destination(target){
 const {w,h,sw,sh}=bounds(),r=target?.getBoundingClientRect();
 if(!r)return fit(position);
 // Visit the visible edge of the actual working region; never scroll the user's page.
 // An off-screen region is represented by the nearest viewport edge.
 const x=r.width>sw*2?r.right-sw-12:r.right+8;
 const y=r.top<0?8:r.top>h?h-sh-8:r.top+Math.min(18,Math.max(0,r.height/4));
 return fit({x:clamp(x,6,w-sw-6),y});
}
async function play(){
 if(active||!queue.length||document.hidden)return;
 initialize();active=true;current=queue.shift();const mine=++generation,event=current;
 const target=targetFor(event),end=destination(target),start={...position};
 highlight?.classList.remove('spider-working');highlight=target;highlight?.classList.add('spider-working');
 spider.className='spider-roaming '+(event.side==='SELL'?'spider-sell':event.side==='BUY'?'spider-buy':'spider-action');
 label.textContent=event.text??`${event.side==='BUY'?'Đã mua':'Đã bán'} ${String(event.symbol??'token').slice(0,20)}`;
 const distance=Math.hypot(end.x-start.x,end.y-start.y);
 if(!reduced.matches&&distance>2){
  spider.classList.add('spider-crawling');spider.style.willChange='transform';
  const mid=fit({x:(start.x+end.x)/2+Math.sign(end.y-start.y)*Math.min(14,distance*.035),y:(start.y+end.y)/2});
  animation=spider.animate([{transform:transform(start)},{transform:transform(mid),offset:.5},{transform:transform(end)}],{duration:clamp(distance/0.55,420,1800),easing:'cubic-bezier(.3,.08,.25,1)',fill:'both'});
  try{await animation.finished;}catch{}
  if(generation!==mine)return;
  position=fit(end);spider.style.transform=transform(position);animation.cancel();animation=null;
 }else{position=fit(end);spider.style.transform=transform(position);}
 if(generation!==mine)return;
 spider.classList.remove('spider-crawling');spider.style.removeProperty('will-change');active=false;
 // Stay beside the work. Only a new real UI activity chooses a new destination.
 play();
}
function enqueue(event){
 if(!event||!remember(event.id))return;
 if(event.side||event.priority){queue.unshift(event);if(active){generation++;stop();}}
 else{if(Date.now()-lastActivity<1500)return;lastActivity=Date.now();queue.splice(0,queue.length,...queue.filter(e=>e.side),event);}
 if(queue.length>4)queue.splice(4);play();
}
window.addEventListener('meme-trade',({detail:t})=>{if(t&&['BUY','SELL'].includes(t.side)&&['paper','live'].includes(t.mode))enqueue(t);});
window.addEventListener('meme-activity',({detail})=>enqueue(detail));
document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&!button.disabled)enqueue({target:button,text:'Đang xử lý thao tác…'});},{passive:true});
function reposition(){
 cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
  if(!position)return;generation++;stop();position=fit(position);spider.style.transform=transform(position);
  if(current){queue.unshift({...current,id:undefined});if(queue.length>4)queue.splice(4);play();}
 });
}
for(const name of ['resize','orientationchange','scroll'])window.addEventListener(name,reposition,{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;stop();queue.length=0;}else reposition();});
reduced.addEventListener('change',reposition);
