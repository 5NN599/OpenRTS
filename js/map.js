'use strict';
/* ===== OpenRTS map: 고도 지형(고지대/절벽/경사로), 4개 시작 지점, 자원, 관측탑, A* ===== */
const terr=new Uint8Array(MW*MH);   // 0 평지, 1 바위, 2 절벽 가장자리(통행불가)
const occ=new Uint8Array(MW*MH);    // 건물/자원 점유
const lvl=new Uint8Array(MW*MH);    // 고도 단계 0~2
const ramp=new Uint8Array(MW*MH);   // 경사로 타일
const tileL=new Uint8Array(MW*MH);  // 렌더 레이어
const tileE=new Float32Array(MW*MH);
const cornerE=new Float32Array(MW*MH*4); // [tl,tr,bl,br]
const exploredP=[0,1,2,3].map(()=>new Uint8Array(MW*MH));   // 플레이어별 탐색 기록
const visT=[0,1,2,3].map(()=>new Uint8Array(MW*MH));         // 플레이어별 현재 시야
let explored=exploredP[0],vis=visT[0];                        // 이 화면의 플레이어 기준
function setViewer(p){explored=exploredP[p];vis=visT[p]}
const fa=new Float32Array(MW*MH),ft=new Float32Array(MW*MH);
let nodes=[],towers=[],props=[],tcol=[];
const miniTerr=document.createElement('canvas');

/* 시작 지점: 0 좌하, 1 우상, 2 좌상, 3 우하 (c: 중심 타일, hq: 사령부 좌상단 타일) */
const START=[
 {c:[12,68],hq:[10,66],ang:2.356,vent:[18,72]},
 {c:[68,12],hq:[66,10],ang:-.785,vent:[60,6]},
 {c:[12,12],hq:[10,10],ang:-2.356,vent:[18,6]},
 {c:[68,68],hq:[66,66],ang:.785,vent:[60,72]}
];

function blocked(x,y){return x<0||y<0||x>=MW||y>=MH||terr[y*MW+x]>0||occ[y*MW+x]===1}
function walk(x,y,r){const a=Math.floor((x-r)/TS),b=Math.floor((y-r)/TS),c=Math.floor((x+r)/TS),d=Math.floor((y+r)/TS);return!blocked(a,b)&&!blocked(c,b)&&!blocked(a,d)&&!blocked(c,d)}
function nearestFree(tx,ty){for(let r=0;r<=22;r++){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;if(!blocked(tx+dx,ty+dy))return[tx+dx,ty+dy]}}return null}
function setOcc(b,v){for(let y=b.ty;y<b.ty+b.d.h;y++)for(let x=b.tx;x<b.tx+b.d.w;x++)occ[y*MW+x]=v}
function elevAt(x,y){const tx=clamp(Math.floor(x/TS),0,MW-1),ty=clamp(Math.floor(y/TS),0,MH-1),i=(ty*MW+tx)*4,fx=clamp(x/TS-tx,0,1),fy=clamp(y/TS-ty,0,1);
 const a=cornerE[i]+(cornerE[i+1]-cornerE[i])*fx,b=cornerE[i+2]+(cornerE[i+3]-cornerE[i+2])*fx;return a+(b-a)*fy}
function s2w(sx,sy){let wy=sy;for(let k=0;k<4;k++)wy=sy+elevAt(sx,wy)*EH;return[sx,wy]}
function tileAt(x,y){return clamp(Math.floor(y/TS),0,MH-1)*MW+clamp(Math.floor(x/TS),0,MW-1)}

/* ---------- 자원 / 관측탑 ---------- */
function makeNode(kind,tx,ty,amt,max){const i=ty*MW+tx,w=kind==='ore'?1:2;
 const n={kind,idx:nodes.length,tx,ty,w,h:w,amt,max,x:(tx+w/2)*TS,y:(ty+w/2)*TS,r:kind==='ore'?14:22,ready:kind==='ore',dead:amt<=0,ez:tileE[i],l:tileL[i],sd:rnd()};
 if(kind==='plasma')n.ref=null;nodes.push(n);if(kind==='ore'&&!n.dead)occ[i]=1;return n}
function addOre(tx,ty,amt){if(blocked(tx,ty)||tx<3||ty<3||tx>MW-4||ty>MH-4)return;makeNode('ore',tx,ty,amt,amt)}
function addVent(tx,ty){for(let y=ty;y<ty+2;y++)for(let x=tx;x<tx+2;x++){terr[y*MW+x]=0;occ[y*MW+x]=0}makeNode('plasma',tx,ty,2500,2500)}
function arc(cx,cy,ang,spread,rad,n,amt){for(let k=0;k<n;k++){const a=ang+(k/(n-1)-.5)*spread;addOre(Math.round(cx+Math.cos(a)*rad),Math.round(cy+Math.sin(a)*rad),amt)}}
function makeTower(tx,ty){const i=ty*MW+tx;terr[i]=0;occ[i]=1;const t={tx,ty,x:(tx+.5)*TS,y:(ty+.5)*TS,ez:tileE[i],l:tileL[i],owner:-1};towers.push(t);return t}
function removeNode(n){n.dead=true;if(n.kind==='ore')occ[n.ty*MW+n.tx]=0}

function carveRamp(c,R,L,a){
 const dx=Math.cos(a),dy=Math.sin(a),px=-dy,py=dx,set=new Set();
 for(let t=R-4;t<=R+4.5;t+=.4)for(let s=-1.8;s<=1.8;s+=.4){const x=Math.floor(c[0]+dx*t+px*s),y=Math.floor(c[1]+dy*t+py*s);if(x>=2&&y>=2&&x<MW-2&&y<MH-2)set.add(y*MW+x)}
 const f=(X,Y)=>{const u=clamp(((X-c[0])*dx+(Y-c[1])*dy-(R-3))/6,0,1);return L*(1-u)};
 for(const i of set){const x=i%MW,y=(i/MW)|0;ramp[i]=1;terr[i]=0;cornerE[i*4]=f(x,y);cornerE[i*4+1]=f(x+1,y);cornerE[i*4+2]=f(x,y+1);cornerE[i*4+3]=f(x+1,y+1)}}
function computeTileE(){for(let i=0;i<MW*MH;i++){tileE[i]=(cornerE[i*4]+cornerE[i*4+1]+cornerE[i*4+2]+cornerE[i*4+3])/4;tileL[i]=Math.floor(tileE[i]+.4)}}

/* 맵 생성. 모든 시작 지점이 서로 연결되면 true */
function genMap(){
 terr.fill(0);occ.fill(0);lvl.fill(0);ramp.fill(0);fa.fill(1);ft.fill(1);
 for(let p=0;p<4;p++){exploredP[p].fill(0);visT[p].fill(0)}
 nodes=[];towers=[];props=[];
 const exps=[[14,40],[40,66],[66,40],[40,14],[40,40]];
 const pl=START.map(s=>({c:s.c,R:12,L:2}));exps.forEach(c=>pl.push({c,R:9,L:1}));
 for(let n=0,tr=0;n<6&&tr<300;tr++){const c=[(10+rnd()*60)|0,(10+rnd()*60)|0],R=4+rnd()*1.3;
  if(pl.every(p=>Math.hypot(p.c[0]-c[0],p.c[1]-c[1])>p.R+R+7)){pl.push({c,R,L:1,mesa:true});n++}}
 for(const p of pl)for(let y=0;y<MH;y++)for(let x=0;x<MW;x++)if(Math.hypot(x+.5-p.c[0],y+.5-p.c[1])<=p.R)lvl[y*MW+x]=Math.max(lvl[y*MW+x],p.L);
 const border=(x,y)=>x<2||y<2||x>=MW-2||y>=MH-2;
 for(let y=0;y<MH;y++)for(let x=0;x<MW;x++)if(border(x,y)){lvl[y*MW+x]=0;terr[y*MW+x]=1}
 const far=(x,y)=>pl.every(p=>Math.hypot(x+.5-p.c[0],y+.5-p.c[1])>p.R+3);
 for(let i=0;i<40;i++){const cx=rnd()*MW,cy=rnd()*MH,r=1.2+rnd()*2.6;
  for(let y=Math.floor(cy-r-1);y<=cy+r+1;y++)for(let x=Math.floor(cx-r-1);x<=cx+r+1;x++){if(x<0||y<0||x>=MW||y>=MH)continue;
   if(Math.hypot(x-cx,y-cy)+(rnd()-.5)*1.2<r&&far(x,y))terr[y*MW+x]=1}}
 const clr=(cx,cy,r)=>{for(let y=Math.floor(cy-r);y<=cy+r;y++)for(let x=Math.floor(cx-r);x<=cx+r;x++){if(x<0||y<0||x>=MW||y>=MH||border(x,y))continue;const i=y*MW+x;if(lvl[i]===0&&terr[i]===1&&Math.hypot(x+.5-cx,y+.5-cy)<=r)terr[i]=0}};
 const carve=(a,b)=>{const n=Math.hypot(b[0]-a[0],b[1]-a[1])*2|0,ph=rnd()*6,amp=3+rnd()*4,nx=-(b[1]-a[1]),ny=b[0]-a[0],L=Math.hypot(nx,ny)||1;
  for(let i=0;i<=n;i++){const t=i/n,w=Math.sin(t*Math.PI)*amp*Math.sin(t*5+ph);clr(a[0]+(b[0]-a[0])*t+nx/L*w,a[1]+(b[1]-a[1])*t+ny/L*w,1.9)}};
 pl.filter(p=>!p.mesa).forEach(p=>carve(p.c,[40,40]));
 carve(START[0].c,START[1].c);carve(START[2].c,START[3].c);
 // 절벽 가장자리
 for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){const i=y*MW+x;if(!lvl[i])continue;
  for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=MW||ny>=MH)continue;if(lvl[ny*MW+nx]<lvl[i]){terr[i]=2;break}}}
 for(let i=0;i<MW*MH;i++){cornerE[i*4]=cornerE[i*4+1]=cornerE[i*4+2]=cornerE[i*4+3]=lvl[i]}
 // 경사로
 for(const p of pl){
  const others=pl.filter(q=>q!==p&&!q.mesa).sort((a,b)=>Math.hypot(a.c[0]-p.c[0],a.c[1]-p.c[1])-Math.hypot(b.c[0]-p.c[0],b.c[1]-p.c[1]));
  const angs=p.mesa?[Math.atan2(40-p.c[1],40-p.c[0])+(rnd()-.5)*1.4]:[0,1].map(k=>Math.atan2(others[k].c[1]-p.c[1],others[k].c[0]-p.c[0]));
  angs.forEach(a=>carveRamp(p.c,p.R,p.L,a))}
 computeTileE();
 // 자원: 시작 지점마다 광석 + 플라즈마 분출구
 for(const s of START){arc(s.c[0],s.c[1],s.ang,1.9,7.5,7,1500);addVent(s.vent[0],s.vent[1])}
 exps.forEach(c=>{const a=Math.atan2(c[1]-40,c[0]-40)+(c[0]===40&&c[1]===40?.5:0);arc(c[0],c[1],a,1.6,5,6,1500);addVent(Math.round(c[0]+Math.cos(a+2.3)*5),Math.round(c[1]+Math.sin(a+2.3)*5))});
 // 관측탑
 for(const[tx,ty]of[[28,48],[52,32],[28,32],[52,48]]){clr(tx,ty,3);const i=ty*MW+tx;if(blocked(tx,ty)&&terr[i]!==1)continue;makeTower(tx,ty)}
 // 도달 불가 구역 메우기 (좌하 시작 지점 기준)
 const seen=new Uint8Array(MW*MH),q=[START[0].c[1]*MW+START[0].c[0]];seen[q[0]]=1;
 while(q.length){const c=q.pop(),cx=c%MW,cy=(c/MW)|0;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;if(blocked(nx,ny))continue;const ni=ny*MW+nx;if(!seen[ni]){seen[ni]=1;q.push(ni)}}}
 for(let i=0;i<MW*MH;i++)if(!seen[i]&&terr[i]===0&&!occ[i])terr[i]=1;
 genProps();buildVisuals();
 return START.every(s=>seen[s.c[1]*MW+s.c[0]]===1&&!blocked(s.c[0],s.c[1]));
}
function genProps(){props=[];
 for(let n=0,tr=0;n<420&&tr<3000;tr++){const x=(2+rnd()*(MW-4))|0,y=(2+rnd()*(MH-4))|0,i=y*MW+x;if(blocked(x,y)||ramp[i])continue;
  if(nodes.some(o=>Math.abs(o.tx-x)<3&&Math.abs(o.ty-y)<3))continue;
  props.push({x:(x+.2+rnd()*.6)*TS,y:(y+.2+rnd()*.6)*TS,k:(rnd()*4)|0,s:.6+rnd()*.8,i,ez:tileE[i],l:tileL[i]});n++}}

function buildVisuals(){
 tcol=new Array(MW*MH);
 const m=miniTerr;m.width=160;m.height=160;const g=m.getContext('2d');
 for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){const i=y*MW+x,n=(((x*73856093)^(y*19349663))&255)/255,e=tileE[i]/2;
  let h=lerp(100,38,e),s=lerp(17,10,e),l=lerp(27,44,e)+n*4-2;if(ramp[i]){h-=8;l+=5}if(terr[i]===2)l+=3;
  tcol[i]=`hsl(${h|0},${s|0}%,${l.toFixed(1)}%)`;
  g.fillStyle=terr[i]===1?'#1d2228':tcol[i];g.fillRect(x*2,y*2,2,2)}
}

/* ---------- 네트워크 전송용 맵 직렬화 (일반 배열 → 바이너리 직렬화 방식에 영향받지 않음) ---------- */
function exportMap(){
 const rc=new Array(MW*MH*4);for(let i=0;i<rc.length;i++)rc[i]=Math.round(cornerE[i]*100);
 return{terr:Array.from(terr),lvl:Array.from(lvl),ramp:Array.from(ramp),rc,
  nodes:nodes.map(n=>[n.kind==='ore'?0:1,n.tx,n.ty,Math.round(n.amt),n.max]),towers:towers.map(t=>[t.tx,t.ty])}}
function importMap(m){
 if(!m||!Array.isArray(m.terr)||m.terr.length!==MW*MH||m.rc.length!==MW*MH*4)throw new Error('bad map');
 terr.set(m.terr);lvl.set(m.lvl);ramp.set(m.ramp);for(let i=0;i<m.rc.length;i++)cornerE[i]=m.rc[i]/100;
 occ.fill(0);fa.fill(1);ft.fill(1);for(let p=0;p<4;p++){exploredP[p].fill(0);visT[p].fill(0)}
 computeTileE();nodes=[];towers=[];
 for(const n of m.nodes)makeNode(n[0]===0?'ore':'plasma',n[1],n[2],n[3],n[4]);
 for(const t of m.towers)makeTower(t[0],t[1]);
 genProps();buildVisuals()}

/* ---------- A* ---------- */
const NN=MW*MH,gS=new Float32Array(NN),came=new Int32Array(NN),stampA=new Uint32Array(NN),closedA=new Uint32Array(NN);let stampN=0;
const hI=[],hF=[];
function hpush(i,f){hI.push(i);hF.push(f);let k=hI.length-1;while(k>0){const p=(k-1)>>1;if(hF[p]<=hF[k])break;[hI[p],hI[k]]=[hI[k],hI[p]];[hF[p],hF[k]]=[hF[k],hF[p]];k=p}}
function hpop(){const top=hI[0],li=hI.pop(),lf=hF.pop();if(hI.length){hI[0]=li;hF[0]=lf;let k=0;const n=hI.length;for(;;){let l=k*2+1,r=l+1,m=k;if(l<n&&hF[l]<hF[m])m=l;if(r<n&&hF[r]<hF[m])m=r;if(m===k)break;[hI[m],hI[k]]=[hI[k],hI[m]];[hF[m],hF[k]]=[hF[k],hF[m]];k=m}}return top}
const DIRS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function los(a,b){const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<1)return true;const n=Math.ceil(d/8),px=-dy/d*9,py=dx/d*9;
 for(let i=1;i<n;i++){const x=a.x+dx*i/n,y=a.y+dy*i/n;if(blocked(x/TS|0,y/TS|0)||blocked((x+px)/TS|0,(y+py)/TS|0)||blocked((x-px)/TS|0,(y-py)/TS|0))return false}return true}
function findPath(sx,sy,gx,gy){
 const stx=clamp(sx/TS|0,0,MW-1),sty=clamp(sy/TS|0,0,MH-1),gtx=clamp(gx/TS|0,0,MW-1),gty=clamp(gy/TS|0,0,MH-1);
 const s=nearestFree(stx,sty),g=nearestFree(gtx,gty);if(!s||!g)return null;
 const si=s[1]*MW+s[0],gi=g[1]*MW+g[0],ggx=g[0],ggy=g[1],exact=!blocked(gtx,gty);
 if(si===gi)return[{x:exact?gx:(ggx+.5)*TS,y:exact?gy:(ggy+.5)*TS}];
 const h=i=>{const dx=Math.abs(i%MW-ggx),dy=Math.abs((i/MW|0)-ggy);return dx+dy-.586*Math.min(dx,dy)};
 stampN++;hI.length=0;hF.length=0;gS[si]=0;stampA[si]=stampN;came[si]=-1;hpush(si,h(si));
 let best=si,bestH=h(si),n=0,found=false;
 while(hI.length&&n<7000){const c=hpop();if(closedA[c]===stampN)continue;closedA[c]=stampN;n++;if(c===gi){found=true;break}
  const cx=c%MW,cy=(c/MW)|0,hc=h(c);if(hc<bestH){bestH=hc;best=c}
  for(const[dx,dy]of DIRS){const nx=cx+dx,ny=cy+dy;if(blocked(nx,ny))continue;if(dx&&dy&&(blocked(cx+dx,cy)||blocked(cx,cy+dy)))continue;const ni=ny*MW+nx;if(closedA[ni]===stampN)continue;const ng=gS[c]+(dx&&dy?1.414:1);if(stampA[ni]!==stampN||ng<gS[ni]){stampA[ni]=stampN;gS[ni]=ng;came[ni]=c;hpush(ni,ng+h(ni))}}}
 const end=found?gi:best,pts=[];for(let c=end;c!==-1&&c!==si;c=came[c])pts.push({x:(c%MW+.5)*TS,y:((c/MW|0)+.5)*TS});pts.reverse();
 if(found&&exact&&pts.length)pts[pts.length-1]={x:gx,y:gy};
 const full=[{x:sx,y:sy}].concat(pts),out=[];let i=0;
 while(i<full.length-1){let j=full.length-1;while(j>i+1&&!los(full[i],full[j]))j--;out.push(full[j]);i=j}
 return out;
}
