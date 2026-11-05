import sys,os
from PIL import Image,ImageDraw
names=sys.argv[2].split(','); th=sys.argv[3] if len(sys.argv)>3 else 'light'
ims=[Image.open(f'shots/{n}-{th}.png') for n in names]
W=900; cols=2; sc=0.5
cw=int(W*sc)
rows=[ims[i:i+cols] for i in range(0,len(ims),cols)]
H=sum(int(max(i.height for i in r)*sc)+20 for r in rows)
out=Image.new('RGB',(cw*cols+10,H),'white');d=ImageDraw.Draw(out);y=0
for r,rn in zip(rows,[names[i:i+cols] for i in range(0,len(names),cols)]):
  x=0;mh=0
  for im,n in zip(r,rn):
    t=im.resize((int(im.width*sc),int(im.height*sc)));out.paste(t,(x,y+16));d.text((x+4,y+2),n,fill='red');x+=cw+10;mh=max(mh,t.height)
  y+=mh+20
out.save(sys.argv[1])
