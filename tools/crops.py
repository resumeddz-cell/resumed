from PIL import Image, ImageDraw, ImageFilter
import json
HI='/home/claude/pdf/hi/p-%02d.png'
OUT='/home/claude/app/public/assets'
def page(p):
    im=Image.open(HI%p).convert('RGB'); return im, im.width/480
# lesson/row icon positions in 480-wide thumbnail coords
rows={
 9:(183,572,6,50,62),10:(210,607,6,48,62),11:(243,518,4,50,70),12:(213,466,4,42,70),
 13:(207,625,6,55,70),14:(192,610,6,65,70),16:(165,580,9,50,50),17:(184,543,6,63,68),
 20:(237,455,9,30,22),21:(243,460,10,35,22),24:(131,593,11,63,42),26:(192,518,6,62,58),
 27:(175,365,4,72,55),28:(240,488,4,75,60),29:(215,512,5,62,52),34:(182,610,10,60,42),
 39:(205,513,5,60,62),40:(210,613,7,57,60),41:(213,612,8,60,50),
 7:(192,570,7,71,46),23:(178,584,9,92,46),8:(220,610,6,70,62),25:(212,570,6,87,54),
}
explicit={
 18:[(70,230),(70,398),68],19:[(45,y) for y in (150,203,257,308,363,415,468,516,558,597,630)]+[46],
 22:[(75,196),(75,280),64],30:[(75,240),(75,322),62],32:[(65,180),(65,250),50],
 33:[(68,180),(68,253),(68,325),58],35:[(73,272),(73,385),66],38:[(63,y) for y in (232,318,403,488,572)]+[66],
 42:[(55,186),(55,275),66],15:[(52,225),(52,318),62],31:[(85,272),(78,375),(78,485),75],
 36:[(83,262),(83,378),80],37:[(77,y) for y in (238,333,428,520)]+[66],
}
def positions(p):
    if p in rows:
        f,l,n,x,s=rows[p]; return [(x, f+(l-f)*i/(n-1) if n>1 else f) for i in range(n)], s
    e=explicit[p]; return e[:-1], e[-1]
def circ(im,cx,cy,r,size=160):
    c=im.crop((int(cx-r),int(cy-r),int(cx+r),int(cy+r))).resize((size,size),Image.LANCZOS)
    m=Image.new('L',(size*4,size*4),0); ImageDraw.Draw(m).ellipse((4,4,size*4-4,size*4-4),fill=255)
    m=m.resize((size,size),Image.LANCZOS); c.putalpha(m); return c
icons={}
for p in sorted(set(rows)|set(explicit)):
    im,k=page(p); pos,s=positions(p); icons[p]=[]
    for i,(x,y) in enumerate(pos):
        fn=f'icons/p{p:02d}_{i+1:02d}.webp'
        circ(im,x*k,y*k,s*k/2*1.04).save(f'{OUT}/{fn}',quality=88); icons[p].append(fn)
def feather(img,rad=0.08):
    w,h=img.size; m=Image.new('L',(w,h),0); b=int(min(w,h)*rad)
    ImageDraw.Draw(m).rounded_rectangle((b,b,w-b,h-b),radius=b*2,fill=255)
    m=m.filter(ImageFilter.GaussianBlur(b*0.7)); img=img.convert('RGBA'); img.putalpha(m); return img
def box(p,x0,x1,y0,y1,off=0):
    im,k=page(p); return im.crop((int((x0)*k),int(y0*k),int(x1*k),int(y1*k)))
hero={8:(260,470,25,185),9:(270,470,0,150),10:(0,90,100,170),11:(0,70,70,175),12:(280,470,5,170),
 13:(280,470,0,165),14:(0,70,5,135),16:(260,470,5,140),17:(280,470,0,140),18:(270,470,20,190),
 19:(250,470,0,125),20:(270,360,160,232),21:(285,360,172,232),22:(270,470,15,160),24:(250,470,0,115),
 26:(240,470,0,165),27:(270,470,0,140),28:(250,470,25,195),29:(250,470,0,180),30:(260,470,20,200),
 31:(250,470,30,215),32:(260,470,0,140),33:(260,470,0,140),34:(250,470,10,160),35:(250,470,15,215),
 36:(270,470,15,200),37:(260,470,10,185),38:(275,470,0,190),39:(250,470,0,170),40:(250,470,0,175),
 41:(265,470,15,180),42:(260,470,0,150),7:(250,470,0,170),23:(240,470,0,170),15:(250,470,0,180),25:(260,470,15,185)}
heroes={}
for p,b in hero.items():
    fn=f'art/hero_p{p:02d}.webp'; feather(box(p,*b)).save(f'{OUT}/{fn}',quality=88); heroes[p]=fn
misc={
 'mascot/mascot_login.webp':(1,0,235,150,555,False),
 'mascot/mascot_wave.webp':(6,40,250,30,275,True),
 'mascot/mascot_wave_small.webp':(2,40,185,70,245,True),
 'mascot/mascot_study.webp':(4,85,370,200,345,False),
 'art/feat_planner.webp':(2,10,110,255,370,True),'art/feat_pomodoro.webp':(2,255,340,270,355,True),
 'art/feat_lessons.webp':(2,10,105,395,505,True),'art/feat_notes.webp':(2,255,345,405,505,True),
 'art/sem_s1.webp':(6,95,175,415,480,True),'art/sem_s2.webp':(6,320,400,415,480,True),
 'art/books.webp':(6,35,110,290,350,True),'art/clipboard.webp':(6,400,450,285,355,True),
 'art/notes_books.webp':(5,15,105,10,80,True),'art/notes_pens.webp':(5,375,425,5,75,True),
 'art/notes_microscope.webp':(5,362,445,595,678,True),'art/notes_youcan.webp':(5,20,110,620,670,True),
 'art/logo_teal.webp':(1,230,470,55,275,False),'art/logo_light.webp':(6,305,460,5,100,True),
 'art/tomato.webp':(4,160,185,320,345,True),'art/planner_header.webp':(3,0,480,0,40,False),
}
for fn,(p,x0,x1,y0,y1,f) in misc.items():
    c=box(p,x0,x1,y0,y1); (feather(c) if f else c).save(f'{OUT}/{fn}',quality=90)
json.dump({'icons':icons,'heroes':heroes},open('assets.json','w'),indent=1)
print('done', sum(len(v) for v in icons.values()),'icons', len(heroes),'heroes')
