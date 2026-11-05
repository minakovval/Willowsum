const {chromium}=require('playwright');
(async()=>{const names=process.argv.slice(2);const b=await chromium.launch();
for(const n of names){const p=await b.newPage({viewport:{width:1280,height:800}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/'+n+'.dc.html');await p.waitForTimeout(2500);
const r=await p.evaluate(()=>{const root=document.querySelector('x-dc')||document.body;
 const over=[];document.querySelectorAll('body *').forEach(e=>{const cs=getComputedStyle(e);if(e.children.length===0&&e.textContent.trim()&&e.scrollWidth>e.clientWidth+1&&cs.overflow!=='visible')over.push('clip:'+e.textContent.trim().slice(0,40));});
 const holes=(document.body.innerText.match(/\{\{[^}]*\}\}/g)||[]).slice(0,3);
 return {h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth,over:over.slice(0,6),holes,len:document.body.innerText.length}});
console.log(n,JSON.stringify(r),errs.slice(0,2).join('|'));
await p.screenshot({path:process.env.OUT+'/'+n+'.png',fullPage:true});await p.close();}
await b.close();})();
