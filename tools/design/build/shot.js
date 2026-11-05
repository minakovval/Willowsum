const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{
 const tok=fs.readFileSync(__dirname+'/tokens.css','utf8');
 const base=(process.env.BASE||__dirname+'/out/project/components');
 const names=process.argv[2]?process.argv[2].split(','):fs.readdirSync(base);
 const themes=(process.argv[3]||'light').split(',');
 const b=await chromium.launch();
 const res={};
 for(const th of themes){
 const p=await b.newPage({viewport:{width:Number(process.env.W||900),height:Number(process.env.VH||400)},deviceScaleFactor:1});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 for(const n of names){
  let html=fs.readFileSync(path.join(base,n,'preview.html'),'utf8');
  html=html.replace(/<head>/,'<head><style>'+tok+'</style>').replace('<html lang="uk">','<html lang="uk" data-theme="'+th+'">');
  await p.setContent(html,{waitUntil:'networkidle',timeout:20000}).catch(e=>errs.push('load '+e.message));
  await p.evaluate(()=>document.fonts.ready);
  const h=await p.evaluate(()=>Math.ceil(document.documentElement.scrollHeight));
  const ow=await p.evaluate(()=>document.documentElement.scrollWidth);
  fs.mkdirSync(__dirname+'/shots',{recursive:true});
  await p.screenshot({path:`${__dirname}/shots/${n}-${th}.png`,fullPage:true});
  res[n]={h,ow,errs:errs.splice(0)};
 }}
 fs.writeFileSync(__dirname+'/res.json',JSON.stringify(res,null,1));
 for(const [n,r] of Object.entries(res)) if(r.errs.length||r.ow>Number(process.env.W||900)) console.log(n,r);
 await b.close();
})();
