const spider=document.getElementById('spider-companion'),label=document.getElementById('spider-label');
const seen=new Set(),queue=[];let active=false;
function play(){
 if(active||!queue.length)return;active=true;
 const trade=queue.shift(),buy=trade.side==='BUY';
 spider.className=buy?'spider-buy':'spider-sell';
 label.textContent=`${trade.mode==='live'?'MAINNET':'PAPER'} · ${buy?'Mua':'Bán'} ${String(trade.symbol??'token').slice(0,20)}`;
 setTimeout(()=>{spider.className='spider-idle';label.textContent='Đang theo dõi thị trường';active=false;play();},1800);
}
window.addEventListener('meme-trade',event=>{const t=event.detail;if(!t||!['BUY','SELL'].includes(t.side)||!['paper','live'].includes(t.mode))return;if(t.id&&seen.has(t.id))return;if(t.id){seen.add(t.id);if(seen.size>500)seen.delete(seen.values().next().value);}queue.push(t);if(queue.length>5)queue.shift();play();});
