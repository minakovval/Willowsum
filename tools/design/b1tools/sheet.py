import sys
from PIL import Image
out=sys.argv[1]; box=tuple(map(int,sys.argv[2].split(','))); names=sys.argv[3:]
ims=[Image.open(n+'.png').crop(box) for n in names]
w=sum(i.width for i in ims)+10*(len(ims)-1); h=max(i.height for i in ims)
S=Image.new('RGB',(w,h),'white'); x=0
for i in ims: S.paste(i,(x,0)); x+=i.width+10
S.save(out)
