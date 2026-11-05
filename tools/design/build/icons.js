const L=require('/home/user/willowsum/node_modules/.pnpm/lucide@1.59.0/node_modules/lucide/dist/cjs/lucide.js');
const out={};
for(const [k,v] of Object.entries(L.icons||{})){
  const kebab=k.replace(/([a-z0-9])([A-Z])/g,'$1-$2').replace(/([A-Z])([A-Z][a-z])/g,'$1-$2').toLowerCase();
  out[kebab]=v.map(([t,a])=>'<'+t+' '+Object.entries(a).map(([x,y])=>x+'="'+y+'"').join(' ')+'/>').join('');
}
require('fs').writeFileSync('icons.json',JSON.stringify(out));
console.log(Object.keys(out).length, out['wallet'], out['arrow-left-right']);
