'use strict';
/* ===== OpenRTS render/input/HUD: 2.5D 고도 렌더링, 입체 건물·유닛, 안개, 미니맵, 명령 입력 ===== */
const cv=$('game'),ctx=cv.getContext('2d'),mini=$('mini'),mctx=mini.getContext('2d');
let W=innerWidth,H=innerHeight;const cam={x:0,y:0};
const FB=8,fogSm=document.createElement('canvas'),fsx=fogSm.getContext('2d');let fogSmImg=null;
function resize(){W=cv.width=innerWidth;H=cv.height=innerHeight;fogSm.width=Math.ceil(W/FB)+2;fogSm.height=Math.ceil(H/FB)+2;
 fogSmImg=fsx.createImageData(fogSm.width,fogSm.height);for(let i=0;i<fogSmImg.data.length;i+=4){fogSmImg.data[i]=4;fogSmImg.data[i+1]=8;fogSmImg.data[i+2]=14}}
const fogCv=document.createElement('canvas');fogCv.width=MW;fogCv.height=MH;
const fctx=fogCv.getContext('2d'),fogImg=fctx.createImageData(MW,MH);
for(let i=0;i<MW*MH;i++){fogImg.data[i*4]=4;fogImg.data[i*4+1]=8;fogImg.data[i*4+2]=14}
addEventListener('resize',resize);resize();

/* ---------- 입력 ---------- */
let mx=-9999,my=-9999,drag=null,imode=null,place=null,minDrag=false;const keys={};
const typing=e=>{const t=e.target;return t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)};
const canCmd=()=>running&&!over&&players[me]&&!players[me].spec;
const mworld=()=>s2w(mx+cam.x,my+cam.y);
const ringColor=e=>e.team===me?'#5f5':ally(e.team,me)?'#6cf':'#f55';
function pick(sx,sy){let best=null,bd=1e9;
 for(const u of units){if(u.dead||!shown(u))continue;const p=spos(u),dd=Math.hypot(p.x-sx,p.y-sy);if(dd<u.d.r+9&&dd<bd){bd=dd;best=u}}
 if(best)return best;
 for(const b of blds){if(b.dead||!shown(b))continue;const x=b.tx*TS,w=b.d.w*TS,h=b.d.h*TS,gy=b.ty*TS-b.ez*EH;if(sx>=x&&sx<=x+w&&sy>=gy-b.d.hgt&&sy<=gy+h)return b}
 return null}
function nodeAtS(sx,sy){for(const n of nodes){if(n.dead||!nodeOK(n,me))continue;const cy=n.y-n.ez*EH-8;if(Math.abs(sx-n.x)<n.w*TS/2+8&&Math.abs(sy-cy)<n.h*TS/2+14)return n}return null}
function pingFx(wx,wy,c){fx.push({k:'ping',x:wx,y:wy-elevAt(wx,wy)*EH,t:0,m:.6,c})}
function cmdAt(sx,sy,am,wp){
 if(!canCmd())return;
 const mine=sel.filter(e=>e.team===me&&!e.dead);if(!mine.length)return;
 const w=wp||s2w(sx,sy),wx=w[0],wy=w[1];
 if(mine[0].kind==='b'){const b=mine[0];if(!['hq','barracks','foundry','airfield'].includes(b.type))return;const n=sx!=null?nodeAtS(sx,sy):null;
  sendCmd({c:'rally',bid:b.id,x:wx,y:wy,nid:n?n.idx:-1});pingFx(wx,wy,'#9f9');sfx('click');return}
 const us=mine.filter(e=>e.kind==='u');if(!us.length)return;sfx('ack');
 const ids=us.map(u=>u.id),wids=us.filter(u=>u.type==='worker').map(u=>u.id),oids=us.filter(u=>u.type!=='worker').map(u=>u.id);
 if(am){sendCmd({c:'order',ids,o:'amove',x:wx,y:wy});pingFx(wx,wy,'#fb4');return}
 const t=sx!=null?pick(sx,sy):null;
 if(t&&isEnemy(me,t.team)){sendCmd({c:'order',ids,o:'attack',tid:t.id});pingFx(wx,wy,'#f55');return}
 const n=sx!=null?nodeAtS(sx,sy):null;
 if(n&&wids.length){sendCmd({c:'order',ids:wids,o:'gather',nid:n.idx});if(oids.length)sendCmd({c:'order',ids:oids,o:'move',x:wx,y:wy});pingFx(wx,wy,'#fd6');return}
 if(t&&t.team===me&&t.kind==='b'&&wids.length){sendCmd({c:'order',ids:wids,o:'help',tid:t.id});if(oids.length)sendCmd({c:'order',ids:oids,o:'move',x:wx,y:wy});pingFx(wx,wy,'#9f9');return}
 sendCmd({c:'order',ids,o:'move',x:wx,y:wy});pingFx(wx,wy,'#7f7')}
function selectBox(dr,x2,y2,shift){
 const x1=dr.x,y1=dr.y;let s;
 if(Math.abs(x2-x1)<5&&Math.abs(y2-y1)<5){const e=pick(x1+cam.x,y1+cam.y);s=e?[e]:[];
  if(shift&&e&&e.team===me&&e.kind==='u')s=sel.includes(e)?sel.filter(q=>q!==e):sel.filter(q=>q.team===me&&q.kind==='u').concat(e);sfx('click')}
 else{const a=Math.min(x1,x2)+cam.x,b=Math.min(y1,y2)+cam.y,c=Math.max(x1,x2)+cam.x,d=Math.max(y1,y2)+cam.y,inR=p=>p.x>=a&&p.x<=c&&p.y>=b&&p.y<=d;
  s=units.filter(u=>!u.dead&&u.team===me&&inR(spos(u)));
  if(shift)s=sel.filter(q=>q.team===me&&q.kind==='u').concat(s.filter(q=>!sel.includes(q)));
  if(!s.length){const bb=blds.find(q=>!q.dead&&q.team===me&&inR(spos(q)));if(bb)s=[bb]}}
 sel=s;imode=null;updateUI(true)}
cv.addEventListener('mousedown',e=>{if(!running)return;audio();mx=e.clientX;my=e.clientY;
 if(e.button===0){if(place){tryPlace(e.shiftKey);return}if(imode==='amove'){cmdAt(mx+cam.x,my+cam.y,true);imode=null;return}drag={x:mx,y:my}}
 else if(e.button===2){if(place){place=null;return}if(imode){imode=null;return}cmdAt(mx+cam.x,my+cam.y,false)}});
addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;if(minDrag)miniGo(e)});
addEventListener('mouseup',e=>{if(e.button===0&&drag){selectBox(drag,mx,my,e.shiftKey);drag=null}minDrag=false});
document.addEventListener('mouseleave',()=>{mx=my=-9999});
cv.addEventListener('contextmenu',e=>e.preventDefault());mini.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('dblclick',e=>{const t=pick(e.clientX+cam.x,e.clientY+cam.y);if(t&&t.team===me&&t.kind==='u'){sel=units.filter(u=>!u.dead&&u.team===me&&u.type===t.type&&u.x>cam.x&&u.x<cam.x+W&&u.y>cam.y&&u.y<cam.y+H+80)}});
function miniPos(e){const r=mini.getBoundingClientRect();return[(e.clientX-r.left)/160*WW,(e.clientY-r.top)/160*WH]}
function miniGo(e){const[x,y]=miniPos(e);cam.x=x-W/2;cam.y=y-H/2}
mini.addEventListener('mousedown',e=>{if(!running)return;audio();if(e.button===0){if(imode==='amove'){const[x,y]=miniPos(e);cmdAt(null,null,true,[x,y]);imode=null;return}minDrag=true;miniGo(e)}else{const[x,y]=miniPos(e);cmdAt(null,null,false,[x,y])}});
addEventListener('keydown',e=>{if(!running||typing(e))return;audio();const k=e.key.toUpperCase();keys[k]=true;
 if(k==='ENTER'){UI.openChat();e.preventDefault();return}
 if(k==='ESCAPE'){if(place||imode){place=null;imode=null}else UI.toggleMenu();return}
 if(k==='P'){if(ROLE==='solo'){paused=!paused;msg(paused?'일시정지':'')}else msg('온라인 게임은 일시정지할 수 없습니다');return}
 if(k==='M'){muted=!muted;msg(muted?'음소거':'소리 켬');return}
 if(k==='N'){musicOn=!musicOn;msg(musicOn?'음악 켬':'음악 끔');return}
 if(k==='DELETE'){const b=sel[0];if(b&&b.kind==='b'&&b.team===me&&!b.done&&b.type!=='hq'&&canCmd())sendCmd({c:'del',bid:b.id});return}
 if(k==='BACKSPACE'||k==='HOME'){const h=blds.find(b=>b.team===me&&b.type==='hq');if(h){cam.x=h.x-W/2;cam.y=h.y-H/2}e.preventDefault();return}
 if(k==='TAB'){e.preventDefault();const a=units.filter(u=>!u.dead&&u.team===me&&u.type!=='worker');if(a.length)sel=a;return}
 if(k==='.'){const w=units.filter(u=>!u.dead&&u.team===me&&u.type==='worker'&&u.o.t==='idle');if(w.length){sel=[w[0]];cam.x=w[0].x-W/2;cam.y=w[0].y-H/2}return}
 if(/^[1-9]$/.test(k)){e.preventDefault();if(e.ctrlKey||e.metaKey){groups[k]=sel.filter(q=>q.team===me&&!q.dead)}else if(groups[k]){const g=groups[k].filter(q=>!q.dead);if(g.length){if(sel.length===g.length&&g.every(q=>sel.includes(q))){cam.x=g[0].x-W/2;cam.y=g[0].y-H/2}sel=g}}return}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 for(const c of cmdList)if(c.k===k&&!e.repeat){c.fn();updateUI(true);break}});
addEventListener('keyup',e=>{keys[e.key.toUpperCase()]=false});
function ghostPos(){const d=BD[place.type],w=mworld();let tx=Math.round(w[0]/TS-d.w/2),ty=Math.round(w[1]/TS-d.h/2);
 if(place.type==='refinery'){let best=null,bd=170;for(const n of nodes)if(n.kind==='plasma'&&!n.dead&&!n.ref){const dd=Math.hypot(n.x-w[0],n.y-w[1]);if(dd<bd){bd=dd;best=n}}if(best){tx=best.tx;ty=best.ty}}return[tx,ty]}
function tryPlace(keep){if(!canCmd()){place=null;return}const[tx,ty]=ghostPos();
 if(!canPlace(me,place.type,tx,ty)){msg('여기에는 지을 수 없습니다 (평지·탐색된 곳만 가능)');sfx('err');return}
 const d=BD[place.type],R=res[me];if(R.ore<d.cost[0]||R.plasma<d.cost[1]){msg(R.ore<d.cost[0]?'광석 부족':'플라즈마 부족');sfx('err');place=null;return}
 const ws=sel.filter(u=>u.team===me&&u.kind==='u'&&u.type==='worker'&&!u.dead);if(!ws.length){place=null;return}
 sendCmd({c:'place',type:place.type,tx,ty,ids:ws.map(u=>u.id)});sfx('ack');if(!keep)place=null}
function startPlace(type){const d=BD[type],R=res[me];
 if(d.req&&!hasBld(me,d.req)){msg(BD[d.req].name+' 필요');sfx('err');return}
 if(R.ore<d.cost[0]||R.plasma<d.cost[1]){msg(R.ore<d.cost[0]?'광석 부족':'플라즈마 부족');sfx('err');return}
 place={type};imode=null}

/* ---------- HUD ---------- */
let cmdList=[],lastInfo='',lastCmd='';
function getCmds(){if(!canCmd())return[];const mine=sel.filter(e=>e.team===me&&!e.dead);if(!mine.length)return[];const c=[],R=res[me];
 if(mine[0].kind==='u'){
  const ids=mine.filter(u=>u.kind==='u').map(u=>u.id);
  if(mine.some(u=>u.type==='worker'))for(const t of['hq','gen','barracks','foundry','lab','airfield','refinery','turret']){const d=BD[t];
   c.push({l:d.name,k:d.hot,cost:d.cost[0]+(d.cost[1]?'/'+d.cost[1]:''),dis:(d.req&&!hasBld(me,d.req))||R.ore<d.cost[0]||R.plasma<d.cost[1],fn:()=>startPlace(t)})}
  c.push({l:'공격이동',k:'A',cost:'',fn:()=>{imode='amove';place=null}});
  c.push({l:'정지',k:'S',cost:'',fn:()=>{sendCmd({c:'order',ids,o:'stop'})}});
  if(mine.some(u=>u.type==='soldier'))c.push({l:'자극제',k:'E',cost:'HP -10',dis:!tech[me].stim,fn:()=>{sendCmd({c:'stim',ids})}})}
 else{const b=mine[0];
  if(!b.done)c.push({l:'건설 취소',k:'DELETE',cost:'75% 환급',fn:()=>{sendCmd({c:'del',bid:b.id})}});
  else{let i=0;for(const t in UD){const d=UD[t];if(d.by!==b.type)continue;
    c.push({l:d.name,k:'QWER'[i++],cost:d.cost[0]+(d.cost[1]?'/'+d.cost[1]:''),dis:(d.req&&!hasBld(me,d.req))||R.ore<d.cost[0]||R.plasma<d.cost[1],fn:()=>sendCmd({c:'train',bid:b.id,item:t})})}
   if(b.type==='lab')for(const k in RD){const lv=tech[me][k];if(lv>=RD[k].max){c.push({l:RD[k].name,k:'QWER'[i++],cost:'완료',dis:true,fn:()=>{}});continue}
    const t='r:'+k+':'+(lv+1),d=qDef(t);c.push({l:RD[k].name+' Lv'+(lv+1),k:'QWER'[i++],cost:d.cost[0]+'/'+d.cost[1],dis:R.ore<d.cost[0]||R.plasma<d.cost[1]||b.q.some(q=>q.startsWith('r:'+k)),fn:()=>sendCmd({c:'train',bid:b.id,item:t})})}}}
 return c}
function relTag(e){return e.team===me?'':ally(e.team,me)?'<span style="color:#7cf">[동맹]</span> ':'<span style="color:#ff7a6a">[적]</span> '}
function updateUI(force){
 if(!players[me])return;
 const s=supply(me);$('rOre').innerHTML='◆ 광석 <b>'+(res[me].ore|0)+'</b>';$('rPl').innerHTML='✦ 플라즈마 <b>'+(res[me].plasma|0)+'</b>';
 $('rSup').innerHTML='▣ 인구 <b style="color:'+(s.used>=s.cap?'#ff6a5a':'#fff')+'">'+s.used+'/'+s.cap+'</b>';
 const m=gt/60|0,sc=gt%60|0;$('rT').innerHTML='⏱ '+m+':'+(sc<10?'0':'')+sc;
 $('rTech').innerHTML='⚔ '+tech[me].weapons+' · 🛡 '+tech[me].armor+(tech[me].stim?' · 💉':'');
 sel=sel.filter(e=>!e.dead);cmdList=getCmds();
 const sig=cmdList.map(c=>c.l+c.dis).join('|');
 if(sig!==lastCmd||force){lastCmd=sig;$('cmds').innerHTML=cmdList.map((c,i)=>`<button class="cb${c.dis?' dis':''}" data-i="${i}"><b>${c.k==='DELETE'?'Del':c.k}</b>${c.l}<small>${c.cost}</small></button>`).join('')}
 let h;
 if(!sel.length)h='<div style="color:#789">선택된 대상 없음<br>좌클릭/드래그: 선택 · 우클릭: 이동·공격·채굴·수리 · A: 공격이동 · S: 정지 · E: 자극제<br>Ctrl+숫자: 부대지정 · Tab: 전투부대 전체 · .: 놀고 있는 일꾼 · Enter: 채팅 · N: 음악 · M: 음소거 · Esc: 메뉴</div>';
 else if(sel.length===1){const e=sel[0],f=e.hp/e.mhp,pl=players[e.team];
  h=`<b style="font-size:16px">${relTag(e)}${e.d.name}</b> <span style="color:${TC[e.team]}">● ${pl?pl.name:''}</span><br>체력 ${Math.ceil(e.hp)} / ${e.mhp}<div class="bar"><i style="width:${f*100}%;background:${f>.5?'#4c6':f>.25?'#ca4':'#c44'}"></i></div>`;
  if(e.kind==='u'){const t=tech[e.team];h+=(e.d.dmg?`공격 ${(e.d.dmg*(1+.15*t.weapons)).toFixed(0)} · 사거리 ${e.d.range} · `:'')+`방어 ${(e.d.armor||0)+t.armor} · 인구 ${e.d.supply}`+(e.d.air?' · <span style="color:#d9f">공중</span>':'')+(e.d.aa?' · 대공':'')+(e.stim>0?' · <span style="color:#f66">자극제 활성</span>':'')+(e.carry?`<br>운반 중: ${e.carry} ${e.ct==='ore'?'광석':'플라즈마'}`:'')+(e.d.heal?'<br>주변 아군 보병을 자동 치료':'')}
  else{if(!e.done)h+='건설 중 '+(e.prog*100|0)+'%';else if(e.team===me&&e.q.length){h+='진행 '+(e.qp*100|0)+'%<div class="bar"><i style="width:'+e.qp*100+'%"></i></div>'+e.q.map((t,i)=>`<span class="q" data-q="${i}" title="클릭하면 취소">${qDef(t).sym}</span>`).join('')}else if(e.type==='turret')h+=`공격 ${e.d.dmg} · 사거리 ${e.d.range} · 대공`}}
 else{const cnt={};sel.forEach(e=>{cnt[e.d.name]=(cnt[e.d.name]||0)+1});h='<b>'+sel.length+'기 선택</b><br>'+Object.entries(cnt).map(([k,v])=>`<span class="bd">${k} ×${v}</span>`).join('')}
 if(h!==lastInfo){lastInfo=h;$('info').innerHTML=h}
 UI.refreshPlayers()}
$('cmds').addEventListener('mousedown',e=>{const b=e.target.closest('.cb');if(!b)return;const c=cmdList[+b.dataset.i];if(c){c.fn();updateUI(true)}e.preventDefault()});
$('info').addEventListener('mousedown',e=>{const q=e.target.closest('.q');if(!q)return;const b=sel[0];if(b&&b.kind==='b'&&b.team===me&&canCmd()){sendCmd({c:'cancelq',bid:b.id,i:+q.dataset.q});updateUI(true)}});

/* ---------- 렌더: 도형 ---------- */
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
function bar(x,y,w,f){ctx.fillStyle='#000a';ctx.fillRect(x-1,y-1,w+2,6);ctx.fillStyle=f>.5?'#5d6':f>.25?'#db4':'#e44';ctx.fillRect(x,y,w*clamp(f,0,1),4)}
const WALL=[['#4d4f45','#2b2d27'],['#5d5848','#34302a'],['#4c515b','#2a2e35']];
function drawTerrain(minL,x0,x1,y0,y1){
 for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){const i=ty*MW+tx;if(tileL[i]<minL)continue;
  const x=tx*TS,y=ty*TS,c=i*4,e0=cornerE[c],e1=cornerE[c+1],e2=cornerE[c+2],e3=cornerE[c+3];
  ctx.fillStyle=tcol[i];
  if(e0===e1&&e1===e2&&e2===e3)ctx.fillRect(x,y-e0*EH,TS+.5,TS+.5);
  else{ctx.beginPath();ctx.moveTo(x,y-e0*EH);ctx.lineTo(x+TS,y-e1*EH);ctx.lineTo(x+TS,y+TS-e3*EH);ctx.lineTo(x,y+TS-e2*EH);ctx.closePath();ctx.fill();
   const sl=(e0+e1-e2-e3)/2;if(sl>.04){ctx.fillStyle='rgba(255,240,200,'+Math.min(.18,sl*.25)+')';ctx.fill()}else if(sl<-.04){ctx.fillStyle='rgba(0,0,0,'+Math.min(.18,-sl*.25)+')';ctx.fill()}
   ctx.strokeStyle='rgba(0,0,0,.12)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y+TS/2-(e0+e2)/2*EH);ctx.lineTo(x+TS,y+TS/2-(e1+e3)/2*EH);ctx.stroke()}
  if(terr[i]===2){const e=e0,L=i-1,R=i+1,U=i-MW,D=i+MW;ctx.strokeStyle='rgba(225,235,210,.32)';ctx.lineWidth=3;ctx.beginPath();
   if(ty>0&&lvl[U]<lvl[i]){ctx.moveTo(x,y-e*EH+1.5);ctx.lineTo(x+TS,y-e*EH+1.5)}
   if(tx>0&&lvl[L]<lvl[i]){ctx.moveTo(x+1.5,y-e*EH);ctx.lineTo(x+1.5,y+TS-e*EH)}
   if(tx<MW-1&&lvl[R]<lvl[i]){ctx.moveTo(x+TS-1.5,y-e*EH);ctx.lineTo(x+TS-1.5,y+TS-e*EH)}
   if(ty<MH-1&&lvl[D]<lvl[i]){ctx.moveTo(x,y+TS-e*EH-1.5);ctx.lineTo(x+TS,y+TS-e*EH-1.5)}ctx.stroke()}
  if(ty<MH-1){const j=i+MW,b0=cornerE[j*4],b1=cornerE[j*4+1],h0=e2-b0,h1=e3-b1;
   if(h0>.08||h1>.08){const L=Math.min(2,Math.max(1,Math.round(Math.max(e2,e3)))),pal=WALL[L],ya=y+TS-e2*EH,yb=y+TS-e3*EH,yc=y+TS-b1*EH,yd=y+TS-b0*EH;
    const g=ctx.createLinearGradient(0,Math.min(ya,yb),0,Math.max(yc,yd));g.addColorStop(0,pal[0]);g.addColorStop(1,pal[1]);ctx.fillStyle=g;
    ctx.beginPath();ctx.moveTo(x,ya);ctx.lineTo(x+TS,yb);ctx.lineTo(x+TS,yc);ctx.lineTo(x,yd);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.16)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,ya+1);ctx.lineTo(x+TS,yb+1);ctx.stroke();
    ctx.strokeStyle='rgba(0,0,0,.22)';ctx.lineWidth=1;const hs=(h0+h1)*EH/2;for(let k=1;k<3;k++){const o=hs*k/3;ctx.beginPath();ctx.moveTo(x,ya+o);ctx.lineTo(x+TS,yb+o+((tx*7+ty)%3-1));ctx.stroke()}
    const hh=(tx*131+ty*71)&15;if(hh<5){ctx.beginPath();ctx.moveTo(x+4+hh*5,ya+2);ctx.lineTo(x+7+hh*5,(ya+yd)/2);ctx.lineTo(x+3+hh*5,yd);ctx.stroke()}}}}}
function drawProp(p){const x=p.x,y=p.y-p.ez*EH,s=p.s;ctx.save();
 switch(p.k){
 case 0:ctx.strokeStyle='#5f8a4a';ctx.lineWidth=1.6;for(let k=-1;k<=1;k++){ctx.beginPath();ctx.moveTo(x+k*3,y);ctx.lineTo(x+k*5,y-6*s);ctx.stroke()}break;
 case 1:ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(x+1,y+1,5*s,2.5*s,0,0,7);ctx.fill();ctx.fillStyle='#7d8288';ctx.beginPath();ctx.ellipse(x,y-1,4*s,3*s,0,0,7);ctx.fill();break;
 case 2:ctx.fillStyle='rgba(120,230,255,.9)';ctx.beginPath();ctx.moveTo(x,y-10*s);ctx.lineTo(x+3*s,y);ctx.lineTo(x-3*s,y);ctx.closePath();ctx.fill();ctx.fillStyle='rgba(255,255,255,.6)';ctx.beginPath();ctx.moveTo(x,y-10*s);ctx.lineTo(x-3*s,y);ctx.lineTo(x-1,y);ctx.closePath();ctx.fill();break;
 default:ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(x+1,y+1,7*s,3*s,0,0,7);ctx.fill();ctx.fillStyle='#456b3a';ctx.beginPath();ctx.arc(x-3,y-3,4.5*s,0,7);ctx.arc(x+3,y-4,5*s,0,7);ctx.fill();ctx.fillStyle='#5b8749';ctx.beginPath();ctx.arc(x,y-6,3.5*s,0,7);ctx.fill()}
 ctx.restore()}
function drawNode(n){const x=n.x,gy=n.y-n.ez*EH;
 if(n.kind==='ore'){const f=n.amt/n.max,s=8+f*10;ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(x+4,gy+7,13,5,0,0,7);ctx.fill();
  for(const[ox,oy,k]of[[-7,5,.7],[7,6,.6],[0,2,1]]){const h=s*k*1.7,w=s*k*.55,bx=x+ox,by=gy+oy;
   ctx.fillStyle='#ffd27a';ctx.beginPath();ctx.moveTo(bx-w,by);ctx.lineTo(bx,by-h);ctx.lineTo(bx,by+3);ctx.closePath();ctx.fill();
   ctx.fillStyle='#d98a22';ctx.beginPath();ctx.moveTo(bx+w,by);ctx.lineTo(bx,by-h);ctx.lineTo(bx,by+3);ctx.closePath();ctx.fill();
   ctx.fillStyle='rgba(255,255,255,.55)';ctx.beginPath();ctx.moveTo(bx-w*.5,by-h*.35);ctx.lineTo(bx,by-h);ctx.lineTo(bx-1,by-h*.45);ctx.closePath();ctx.fill()}}
 else if(!n.ref||n.ref.dead){const p=.5+.5*Math.sin(gt*2+n.sd*6);ctx.fillStyle='#0e1418';ctx.beginPath();ctx.ellipse(x,gy,24,13,0,0,7);ctx.fill();
  ctx.strokeStyle='rgba(90,255,150,'+(.4+p*.5)+')';ctx.lineWidth=3;ctx.stroke();const g=ctx.createRadialGradient(x,gy,2,x,gy,22);g.addColorStop(0,'rgba(130,255,180,'+(.5+p*.3)+')');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,gy,22,12,0,0,7);ctx.fill();
  for(let k=0;k<3;k++){const t=(gt*.6+k/3+n.sd)%1;ctx.fillStyle='rgba(170,255,200,'+(.35*(1-t))+')';ctx.beginPath();ctx.arc(x+Math.sin(t*6+k)*5,gy-t*40,3+t*6,0,7);ctx.fill()}}}
function drawTower(tw){const x=tw.x,gy=tw.y-tw.ez*EH+10,c=tw.owner>=0?TC[tw.owner]:'#99aaaa';
 ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(x+8,gy+4,18,7,0,0,7);ctx.fill();
 const g=ctx.createLinearGradient(x-8,0,x+8,0);g.addColorStop(0,'#69747e');g.addColorStop(1,'#2b333a');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x-11,gy);ctx.lineTo(x+11,gy);ctx.lineTo(x+6,gy-62);ctx.lineTo(x-6,gy-62);ctx.closePath();ctx.fill();
 ctx.fillStyle='#38424b';ctx.fillRect(x-12,gy-70,24,9);ctx.fillStyle=c;ctx.fillRect(x-12,gy-62,24,2);
 const p=.5+.5*Math.sin(gt*3);ctx.fillStyle=c;ctx.globalAlpha=.5+p*.5;ctx.beginPath();ctx.arc(x,gy-78,6,0,7);ctx.fill();ctx.globalAlpha=1;
 const rg=ctx.createRadialGradient(x,gy-78,1,x,gy-78,24);rg.addColorStop(0,c+'88');rg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=rg;ctx.beginPath();ctx.arc(x,gy-78,24,0,7);ctx.fill()}
function drawRock(tx,ty){const i=ty*MW+tx,x=tx*TS,e=tileE[i],gy=ty*TS-e*EH,bd=tx<2||ty<2||tx>=MW-2||ty>=MH-2,hh=(bd?30:16)+((tx*7+ty*13)%5)*5,top=gy-hh;
 const g=ctx.createLinearGradient(0,top+TS,0,gy+TS);g.addColorStop(0,'#3c444d');g.addColorStop(1,'#1c2127');ctx.fillStyle=g;ctx.fillRect(x,top+TS,TS+.5,hh);
 const v=((tx*83492791)^(ty*2971215073))&255;ctx.fillStyle=`rgb(${74+v%18},${82+v%18},${92+v%20})`;
 ctx.beginPath();ctx.moveTo(x+2,top+TS);ctx.lineTo(x+4+(v&3),top+3);ctx.lineTo(x+TS*.5,top-2-(v&3));ctx.lineTo(x+TS-3,top+4);ctx.lineTo(x+TS,top+TS);ctx.closePath();ctx.fill();
 ctx.fillStyle='rgba(255,255,255,.1)';ctx.beginPath();ctx.moveTo(x+4,top+TS-4);ctx.lineTo(x+6,top+6);ctx.lineTo(x+TS*.5,top+2);ctx.lineTo(x+TS*.5,top+TS*.55);ctx.closePath();ctx.fill();
 ctx.strokeStyle='rgba(0,0,0,.25)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+9,top+TS);ctx.lineTo(x+11,gy+TS);ctx.moveTo(x+22,top+TS);ctx.lineTo(x+20,gy+TS);ctx.stroke()}

/* ---------- 렌더: 건물 (압출 박스) ---------- */
function drawBld(b){
 const d=b.d,x=b.tx*TS,w=d.w*TS,h=d.h*TS,gy=b.ty*TS-b.ez*EH,full=d.hgt,hgt=b.done?full:full*(.3+.7*b.prog),c=TC[b.team],y=gy-hgt,cx=x+w/2,cy=y+h/2;
 const pulse=.5+.5*Math.sin(gt*3+b.id);
 ctx.save();
 ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.moveTo(x+3,gy+h);ctx.lineTo(x+w+3,gy+h);ctx.lineTo(x+w+hgt*.6+6,gy+h+hgt*.4);ctx.lineTo(x+hgt*.6+6,gy+h+hgt*.4);ctx.closePath();ctx.fill();
 ctx.globalAlpha=b.done?1:.55+.4*b.prog;
 const g=ctx.createLinearGradient(0,y+h,0,gy+h);g.addColorStop(0,'#46535e');g.addColorStop(1,'#1c242b');ctx.fillStyle=g;ctx.fillRect(x,y+h,w,hgt);
 ctx.strokeStyle='#10151a';ctx.lineWidth=1.5;ctx.strokeRect(x+.5,y+h,w-1,hgt);
 const rows=Math.max(1,Math.floor(hgt/12)),cols=Math.max(2,d.w*2);
 for(let r=0;r<rows-0;r++)for(let k=0;k<cols;k++){if(b.type==='barracks'&&r===rows-1&&k>=1&&k<cols-1)continue;
  const lit=((b.id+r*3+k*5)%4)!==0;ctx.fillStyle=lit?`rgba(255,226,140,${.35+.3*Math.sin(gt+k+r+b.id)})`:'rgba(10,15,20,.6)';ctx.fillRect(x+6+k*(w-12)/cols,y+h+4+r*11,(w-12)/cols-4,5)}
 if(b.type==='barracks'||b.type==='airfield'||b.type==='hq'){ctx.fillStyle='#0b1014';const dw=w*.36;ctx.fillRect(cx-dw/2,gy+h-Math.min(hgt-2,15),dw,Math.min(hgt-2,15));ctx.strokeStyle='#4e6270';ctx.lineWidth=1;for(let k=1;k<4;k++){ctx.beginPath();ctx.moveTo(cx-dw/2,gy+h-Math.min(hgt-2,15)+k*4);ctx.lineTo(cx+dw/2,gy+h-Math.min(hgt-2,15)+k*4);ctx.stroke()}}
 ctx.fillStyle=c;ctx.fillRect(x,gy+h-4,w,3);
 const gr=ctx.createLinearGradient(x,y,x+w,y+h);gr.addColorStop(0,'#6b7d8a');gr.addColorStop(1,'#34414b');ctx.fillStyle=gr;rr(x,y,w,h,7);ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#12181d';ctx.stroke();
 ctx.strokeStyle=c;ctx.lineWidth=2;rr(x+5,y+5,w-10,h-10,5);ctx.stroke();
 switch(b.type){
 case'hq':{const g2=ctx.createRadialGradient(cx,cy,3,cx,cy,w*.3);g2.addColorStop(0,'#d6efff');g2.addColorStop(1,'#35566e');ctx.fillStyle=g2;ctx.beginPath();ctx.arc(cx,cy,w*.3,0,7);ctx.fill();ctx.strokeStyle='#0c1a25';ctx.stroke();
  ctx.fillStyle=c;for(const[ox,oy]of[[9,9],[w-21,9],[9,h-21],[w-21,h-21]])ctx.fillRect(x+ox,y+oy,12,12);
  ctx.fillStyle='rgba(255,255,255,'+(.4+pulse*.5)+')';ctx.beginPath();ctx.arc(cx,cy,7,0,7);ctx.fill();ctx.strokeStyle='#9bd';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx,cy-18);ctx.stroke();ctx.fillStyle=c;ctx.beginPath();ctx.arc(cx,cy-19,3,0,7);ctx.fill();break}
 case'gen':ctx.fillStyle='#1a232b';ctx.beginPath();ctx.arc(cx,cy,w*.28,0,7);ctx.fill();ctx.fillStyle='rgba(120,220,255,'+(.5+pulse*.5)+')';ctx.beginPath();ctx.moveTo(cx+3,cy-13);ctx.lineTo(cx-7,cy+2);ctx.lineTo(cx,cy+2);ctx.lineTo(cx-3,cy+13);ctx.lineTo(cx+8,cy-3);ctx.lineTo(cx+1,cy-3);ctx.closePath();ctx.fill();break;
 case'barracks':ctx.fillStyle='#252f37';rr(x+14,y+14,w-28,h-28,4);ctx.fill();ctx.fillStyle=c;ctx.fillRect(cx-9,y+9,18,6);ctx.strokeStyle='#5c6e7c';ctx.lineWidth=1;for(let k=1;k<4;k++){ctx.beginPath();ctx.moveTo(x+14,y+14+k*(h-28)/4);ctx.lineTo(x+w-14,y+14+k*(h-28)/4);ctx.stroke()}break;
 case'foundry':ctx.fillStyle='#1c242b';ctx.fillRect(x+10,y+8,14,22);ctx.fillRect(x+w-24,y+8,14,22);ctx.fillStyle='rgba(255,150,60,'+(.5+pulse*.4)+')';ctx.beginPath();ctx.arc(cx,cy+8,16,0,7);ctx.fill();ctx.strokeStyle='#0c1015';ctx.lineWidth=3;ctx.stroke();
  if(b.done)for(const k of[0,1]){const t=(gt*.5+k*.5)%1;ctx.fillStyle='rgba(200,200,200,'+(.3*(1-t))+')';ctx.beginPath();ctx.arc(x+17+k*(w-34),y+4-t*34,4+t*8,0,7);ctx.fill()}break;
 case'lab':ctx.fillStyle='#1b2a35';ctx.beginPath();ctx.arc(cx,cy,w*.3,0,7);ctx.fill();ctx.strokeStyle='#7fe';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(cx,cy,w*.24,w*.1,gt*.8,0,7);ctx.stroke();ctx.beginPath();ctx.ellipse(cx,cy,w*.24,w*.1,gt*.8+1.6,0,7);ctx.stroke();ctx.fillStyle='rgba(140,255,240,'+(.5+pulse*.5)+')';ctx.beginPath();ctx.arc(cx,cy,5,0,7);ctx.fill();break;
 case'airfield':ctx.fillStyle='#1d2730';rr(x+10,y+10,w-20,h-20,6);ctx.fill();ctx.strokeStyle='#e7c04a';ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(cx,y+14);ctx.lineTo(cx,y+h-14);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=c;ctx.beginPath();ctx.arc(cx,cy,9,0,7);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillText('H',cx,cy+4);break;
 case'refinery':ctx.fillStyle='#202b33';ctx.beginPath();ctx.arc(x+18,y+20,11,0,7);ctx.arc(x+w-18,y+h-20,11,0,7);ctx.fill();ctx.fillStyle='rgba(110,255,160,'+(.4+pulse*.5)+')';ctx.beginPath();ctx.arc(x+18,y+20,6,0,7);ctx.arc(x+w-18,y+h-20,6,0,7);ctx.fill();break;
 case'turret':{ctx.fillStyle='#1a232b';ctx.beginPath();ctx.arc(cx,cy,w*.3,0,7);ctx.fill();const hx=cx,hy=cy-8,fxv=Math.cos(b.ang),fyv=Math.sin(b.ang)*.6;
  ctx.fillStyle='#2f3a44';ctx.beginPath();ctx.arc(hx,hy,11,0,7);ctx.fill();ctx.strokeStyle='#9fb';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+fxv*26,hy+fyv*26);ctx.stroke();ctx.fillStyle=c;ctx.beginPath();ctx.arc(hx,hy,5,0,7);ctx.fill();break}}
 if(!b.done){ctx.globalAlpha=.7;ctx.strokeStyle='#fd6';ctx.lineWidth=1;ctx.save();ctx.beginPath();ctx.rect(x,y+h,w,hgt);ctx.clip();ctx.beginPath();for(let k=-hgt;k<w;k+=9){ctx.moveTo(x+k,gy+h);ctx.lineTo(x+k+hgt,y+h)}ctx.stroke();ctx.restore()}
 if(b.flash>0){ctx.globalAlpha=.5;ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h+hgt)}
 ctx.restore();
 if(!b.done){ctx.fillStyle='#000a';ctx.fillRect(x+6,gy+h+3,w-12,5);ctx.fillStyle='#fd6';ctx.fillRect(x+6,gy+h+3,(w-12)*b.prog,5)}
 if(sel.includes(b)){ctx.strokeStyle=ringColor(b);ctx.lineWidth=2;ctx.strokeRect(x-2,gy-2,w+4,h+4)}}

/* ---------- 렌더: 유닛 (입체 스프라이트) ---------- */
function legs(ph,h,wd,col){ctx.fillStyle=col;const a=Math.max(0,ph)*.5,b=Math.max(0,-ph)*.5;ctx.fillRect(-wd-1.5,-h+a,wd,h-a);ctx.fillRect(1.5,-h+b,wd,h-b)}
function rot(a,l,w){return[Math.cos(a)*l-Math.sin(a)*w,(Math.sin(a)*l+Math.cos(a)*w)*.55]}
function drawUnit(u){
 const d=u.d,c=TC[u.team],air=!!d.air,gx=u.x,gy=u.y-u.ez*EH,mv=u.path&&u.pi<u.path.length,t=gt*(u.stim>0?16:11)+u.id;
 const fxv=Math.cos(u.ang),fyv=Math.sin(u.ang)*.55,side=fxv>=0?1:-1,ph=mv&&!air?Math.sin(t)*3:0,bob=mv&&!air?Math.abs(Math.sin(t))*1.5:0,shot=u.cd>d.cd-.07&&d.cd>0;
 ctx.save();
 ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(gx+(air?12:2),gy+(air?5:3),d.r*(air?.95:1),d.r*(air?.45:.55),0,0,7);ctx.fill();
 if(sel.includes(u)){ctx.strokeStyle=ringColor(u);ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(gx,gy+2,d.r+4,(d.r+4)*.55,0,0,7);ctx.stroke()}
 if(u.stim>0){ctx.fillStyle='rgba(255,60,60,'+(.18+.1*Math.sin(gt*14))+')';ctx.beginPath();ctx.ellipse(gx,gy+2,d.r+8,(d.r+8)*.55,0,0,7);ctx.fill()}
 ctx.translate(gx,gy-(air?AIRH+Math.sin(gt*3+u.id)*3:0));
 switch(u.type){
 case'worker':legs(ph,6,3.5,'#2a333c');ctx.translate(0,-bob);ctx.fillStyle='#d1a23d';rr(-6,-15,12,9,3);ctx.fill();ctx.fillStyle=c;ctx.fillRect(-6,-10,12,2);
  ctx.fillStyle='#e7ecef';ctx.beginPath();ctx.arc(0,-18,4.5,0,Math.PI,true);ctx.fill();ctx.fillStyle='#8896a3';ctx.fillRect(-3.5,-18,7,3);
  ctx.strokeStyle='#cfd6db';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(side*4,-11);ctx.lineTo(side*4+fxv*9,-11+fyv*7);ctx.stroke();
  if(u.carry>0){ctx.fillStyle=u.ct==='ore'?'#e8a93a':'#6fe39a';ctx.beginPath();ctx.moveTo(-side*7,-16);ctx.lineTo(-side*10,-10);ctx.lineTo(-side*5,-9);ctx.closePath();ctx.fill()}break;
 case'soldier':legs(ph,8,4,'#2a333c');ctx.translate(0,-bob);ctx.fillStyle='#5b6a78';rr(-6,-18,12,11,3);ctx.fill();ctx.fillStyle=c;ctx.fillRect(-6,-13,12,3);
  ctx.fillStyle='#8896a3';ctx.beginPath();ctx.arc(0,-21,4.7,0,7);ctx.fill();ctx.fillStyle=c;ctx.fillRect(side>0?0:-4.5,-22.5,4.5,2.6);
  ctx.strokeStyle='#161b20';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(side*3,-13);ctx.lineTo(side*3+fxv*13,-13+fyv*9);ctx.stroke();
  if(shot){ctx.fillStyle='#ffe38a';ctx.beginPath();ctx.arc(side*3+fxv*15,-13+fyv*10,3.2,0,7);ctx.fill()}break;
 case'medic':legs(ph,8,4,'#38444f');ctx.translate(0,-bob);ctx.fillStyle='#dfe7ec';rr(-6,-18,12,11,3);ctx.fill();ctx.fillStyle='#34c768';ctx.fillRect(-1.5,-16.5,3,7);ctx.fillRect(-4,-14.5,8,3);
  ctx.fillStyle=c;ctx.fillRect(-6,-9,12,2);ctx.fillStyle='#9fb0bd';ctx.beginPath();ctx.arc(0,-21,4.7,0,7);ctx.fill();ctx.fillStyle='#34c768';ctx.fillRect(side>0?0:-4.5,-22.5,4.5,2.6);
  ctx.fillStyle='#c9d4db';ctx.fillRect(-side*9,-17,4,9);break;
 case'rocket':legs(ph,8,5,'#2a333c');ctx.translate(0,-bob);ctx.fillStyle='#4f5b66';rr(-8,-19,16,12,3);ctx.fill();ctx.fillStyle=c;ctx.fillRect(-8,-13,16,3);
  ctx.fillStyle='#8896a3';ctx.beginPath();ctx.arc(0,-22,4.7,0,7);ctx.fill();ctx.fillStyle=c;ctx.fillRect(side>0?0:-4.5,-23.5,4.5,2.6);
  ctx.strokeStyle='#22282e';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-side*2,-20);ctx.lineTo(-side*2+fxv*15,-24+fyv*10);ctx.stroke();ctx.strokeStyle='#ff9a4a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-side*2+fxv*13,-23.5+fyv*9);ctx.lineTo(-side*2+fxv*16,-24+fyv*10.5);ctx.stroke();
  if(shot){ctx.fillStyle='#ffd070';ctx.beginPath();ctx.arc(-side*2+fxv*18,-24+fyv*12,4,0,7);ctx.fill()}break;
 case'walker':{ctx.strokeStyle='#262e35';ctx.lineWidth=4;for(let k=0;k<4;k++){const sx=k<2?-1:1,off=(k%2?1:-1),sw=mv?Math.sin(t*.8+k*1.7)*5:0;ctx.beginPath();ctx.moveTo(sx*6,-13);ctx.lineTo(sx*(14+off*2)+sw*.3,-6);ctx.lineTo(sx*(17+off*3)+sw,0);ctx.stroke()}
  ctx.translate(0,-bob*.5);const g=ctx.createLinearGradient(0,-28,0,-10);g.addColorStop(0,'#6d7b88');g.addColorStop(1,'#39444e');ctx.fillStyle=g;rr(-13,-26,26,16,6);ctx.fill();ctx.strokeStyle='#161c21';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle=c;ctx.fillRect(-13,-15,26,3);ctx.fillStyle='#1b2630';ctx.beginPath();ctx.arc(-side*3,-27,6,0,7);ctx.fill();ctx.fillStyle=c;ctx.beginPath();ctx.arc(-side*3,-27,3,0,7);ctx.fill();
  ctx.strokeStyle='#1d2329';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(side*4,-21);ctx.lineTo(side*4+fxv*21,-21+fyv*13);ctx.stroke();
  if(shot){ctx.fillStyle='#ff9a50';ctx.beginPath();ctx.arc(side*4+fxv*24,-21+fyv*15,6,0,7);ctx.fill()}break}
 case'wasp':{const A=u.ang,n=rot(A,15,0),wr=rot(A,-6,14),wl=rot(A,-6,-14),tl=rot(A,-11,0),nt=rot(A,-5,0);
  ctx.fillStyle='#4d5b73';ctx.beginPath();ctx.moveTo(n[0],n[1]);ctx.lineTo(wr[0],wr[1]);ctx.lineTo(nt[0],nt[1]);ctx.lineTo(wl[0],wl[1]);ctx.closePath();ctx.fill();ctx.strokeStyle='#141a22';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(wr[0],wr[1]);ctx.lineTo(rot(A,-8,12)[0],rot(A,-8,12)[1]);ctx.lineTo(rot(A,-3,6)[0],rot(A,-3,6)[1]);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(wl[0],wl[1]);ctx.lineTo(rot(A,-8,-12)[0],rot(A,-8,-12)[1]);ctx.lineTo(rot(A,-3,-6)[0],rot(A,-3,-6)[1]);ctx.closePath();ctx.fill();
  const cp=rot(A,5,0);ctx.fillStyle='#bfe9ff';ctx.beginPath();ctx.ellipse(cp[0],cp[1]-1,4,2.6,0,0,7);ctx.fill();
  ctx.fillStyle='rgba(255,170,90,'+(.6+.4*Math.sin(gt*30))+')';ctx.beginPath();ctx.arc(tl[0],tl[1],3.3,0,7);ctx.fill();
  if(shot){ctx.fillStyle='#f0b0ff';ctx.beginPath();ctx.arc(n[0],n[1],3,0,7);ctx.fill()}break}}
 if(u.flash>0){ctx.fillStyle='rgba(255,255,255,.55)';ctx.beginPath();ctx.arc(0,-12,d.r,0,7);ctx.fill()}
 ctx.restore()}

/* ---------- 렌더: 이펙트/안개/미니맵 ---------- */
function drawFx(){for(const f of fx){if(f.t<0)continue;const k=f.t/f.m;
 if(f.k==='tr'){ctx.strokeStyle=f.c;ctx.globalAlpha=1-k;ctx.lineWidth=f.w;ctx.beginPath();ctx.moveTo(f.x,f.y);ctx.lineTo(f.x+(f.x2-f.x)*Math.min(1,k*3),f.y+(f.y2-f.y)*Math.min(1,k*3));ctx.stroke();ctx.globalAlpha=1}
 else if(f.k==='boom'){const r=f.r*(.4+k*1.1),g=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,r);g.addColorStop(0,'rgba(255,255,220,'+(1-k)+')');g.addColorStop(.5,f.c.length===7?f.c+Math.round((1-k)*200).toString(16).padStart(2,'0'):f.c);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(f.x,f.y,r,0,7);ctx.fill()}
 else if(f.k==='ping'){ctx.strokeStyle=f.c;ctx.globalAlpha=1-k;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(f.x,f.y,6+k*18,(6+k*18)*.55,0,0,7);ctx.stroke();ctx.globalAlpha=1}
 else if(f.k==='part'){ctx.globalAlpha=Math.max(0,1-k);ctx.fillStyle=f.c;ctx.fillRect(f.x,f.y,f.sz,f.sz);ctx.globalAlpha=1}
 else if(f.k==='beam'){ctx.strokeStyle=f.c;ctx.globalAlpha=1-k;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(f.x,f.y);ctx.lineTo(f.x2,f.y2);ctx.stroke();ctx.globalAlpha=1}}}
function sampleFog(wx,wy){const px=wx/TS-.5,py=wy/TS-.5,x0=Math.floor(px),y0=Math.floor(py),tx=px-x0,ty=py-y0;
 const g=(x,y)=>fa[clamp(y,0,MH-1)*MW+clamp(x,0,MW-1)];return lerp(lerp(g(x0,y0),g(x0+1,y0),tx),lerp(g(x0,y0+1),g(x0+1,y0+1),tx),ty)}
function drawFog(cx,cy){const w=fogSm.width,h=fogSm.height,dd=fogSmImg.data;
 for(let by=0;by<h;by++)for(let bx=0;bx<w;bx++){const p=s2w(cx+bx*FB+FB/2,cy+by*FB+FB/2);dd[(by*w+bx)*4+3]=sampleFog(p[0],p[1])*255}
 fsx.putImageData(fogSmImg,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(fogSm,0,0,w,h,cx,cy,w*FB,h*FB)}
function drawMini(){const k=160/WW;mctx.drawImage(miniTerr,0,0);
 for(const n of nodes){if(n.dead||!explored[n.ty*MW+n.tx])continue;mctx.fillStyle=n.kind==='ore'?'#e8a93a':'#6fe39a';mctx.fillRect(n.x*k-1,n.y*k-1,3,3)}
 for(const tw of towers){if(!explored[tw.ty*MW+tw.tx])continue;mctx.fillStyle=tw.owner>=0?TC[tw.owner]:'#ccd';mctx.fillRect(tw.x*k-2,tw.y*k-2,4,4)}
 for(const b of blds){if(b.dead||!shown(b))continue;mctx.fillStyle=TC[b.team];mctx.fillRect(b.tx*TS*k,b.ty*TS*k,b.d.w*TS*k,b.d.h*TS*k)}
 for(const u of units){if(u.dead||!shown(u))continue;mctx.fillStyle=u.d.air?'#e6f':TC[u.team];mctx.fillRect(u.x*k-1,u.y*k-1,2.5,2.5)}
 for(let i=0;i<MW*MH;i++)fogImg.data[i*4+3]=fa[i]*255;fctx.putImageData(fogImg,0,0);mctx.drawImage(fogCv,0,0,160,160);
 for(const p of pings){mctx.strokeStyle='rgba(255,80,60,'+(1-p.t/2)+')';mctx.lineWidth=2;mctx.beginPath();mctx.arc(p.x*k,p.y*k,4+p.t*10,0,7);mctx.stroke()}
 mctx.strokeStyle='#fff';mctx.lineWidth=1;mctx.strokeRect(cam.x*k,cam.y*k,Math.min(W,WW)*k,Math.min(H,WH)*k)}

/* ---------- 메인 렌더 ---------- */
function render(){
 cam.x=clamp(cam.x,0,Math.max(0,WW-W));cam.y=clamp(cam.y,-EH*2,Math.max(-EH*2,WH-H+170));
 const cx=Math.floor(cam.x+(shake>0?(rnd()-.5)*shake:0)),cy=Math.floor(cam.y+(shake>0?(rnd()-.5)*shake:0));
 ctx.fillStyle='#04070b';ctx.fillRect(0,0,W,H);ctx.save();ctx.translate(-cx,-cy);
 const x0=Math.max(0,Math.floor(cx/TS)-1),x1=Math.min(MW-1,Math.ceil((cx+W)/TS)+1),y0=Math.max(0,Math.floor(cy/TS)-1),y1=Math.min(MH-1,Math.ceil((cy+H)/TS)+3);
 drawTerrain(0,x0,x1,y0,y1);
 const dl=[],inV=(x,y,m)=>x>cx-m&&x<cx+W+m&&y>cy-m-90&&y<cy+H+m+90;
 for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){const i=ty*MW+tx;if(terr[i]===1&&explored[i])dl.push({l:tileL[i],d:(ty+1)*TS,t:0,a:tx,b:ty})}
 for(const p of props)if(explored[p.i]&&inV(p.x,p.y,30))dl.push({l:p.l,d:p.y,t:1,o:p});
 for(const n of nodes)if(!n.dead&&explored[n.ty*MW+n.tx]&&inV(n.x,n.y,40))dl.push({l:n.l,d:n.y+n.h*TS/2-4,t:2,o:n});
 for(const tw of towers)if(explored[tw.ty*MW+tw.tx]&&inV(tw.x,tw.y,60))dl.push({l:tw.l,d:tw.y+8,t:3,o:tw});
 for(const b of blds){if(b.dead||!inV(b.x,b.y,140)||!shown(b))continue;dl.push({l:tileL[tileAt(b.x,b.y)],d:(b.ty+b.d.h)*TS,t:4,o:b})}
 for(const u of units){if(u.dead||!inV(u.x,u.y,50)||!shown(u))continue;
  dl.push({l:u.d.air?3:Math.max(tileL[tileAt(u.x,u.y)],Math.floor(u.ez+.4)),d:u.y,t:5,o:u})}
 dl.sort((a,b)=>a.l-b.l||a.d-b.d);
 let ov=1;
 for(const it of dl){while(it.l>=ov&&ov<=2){drawTerrain(ov,x0,x1,y0,y1);ov++}
  switch(it.t){case 0:drawRock(it.a,it.b);break;case 1:drawProp(it.o);break;case 2:drawNode(it.o);break;case 3:drawTower(it.o);break;case 4:drawBld(it.o);break;default:drawUnit(it.o)}}
 while(ov<=2){drawTerrain(ov,x0,x1,y0,y1);ov++}
 drawFx();
 for(const b of blds){if(b.dead||!inV(b.x,b.y,140)||!shown(b))continue;
  if(sel.includes(b)||b.hp<b.mhp){bar(b.tx*TS,b.ty*TS-b.ez*EH-b.d.hgt-9,b.d.w*TS,b.hp/b.mhp)}
  if(sel.includes(b)&&b.rally){const ry=b.rally.y-elevAt(b.rally.x,b.rally.y)*EH;ctx.strokeStyle='#9f9';ctx.setLineDash([5,5]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(b.x,b.y-b.ez*EH);ctx.lineTo(b.rally.x,ry);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#9f9';ctx.fillRect(b.rally.x-1,ry-14,2,14);ctx.fillRect(b.rally.x,ry-14,9,6)}}
 for(const u of units){if(u.dead||!inV(u.x,u.y,50)||!shown(u))continue;if(sel.includes(u)||u.hp<u.mhp)bar(u.x-u.d.r,u.y-u.ez*EH-(u.d.air?AIRH:0)-32,u.d.r*2,u.hp/u.mhp)}
 drawFog(cx,cy);
 if(place){const[tx,ty]=ghostPos(),d=BD[place.type],ok=canPlace(me,place.type,tx,ty),e=tileE[clamp(ty,0,MH-1)*MW+clamp(tx,0,MW-1)],gy=ty*TS-e*EH,x=tx*TS,w=d.w*TS,h=d.h*TS;
  ctx.fillStyle=ok?'rgba(80,255,120,.28)':'rgba(255,70,70,.3)';ctx.fillRect(x,gy,w,h);ctx.fillRect(x,gy-d.hgt,w,h+d.hgt);ctx.strokeStyle=ok?'#5f5':'#f55';ctx.lineWidth=2;ctx.strokeRect(x,gy,w,h);ctx.strokeRect(x,gy-d.hgt,w,h);
  if(place.type==='turret'){ctx.strokeStyle='rgba(255,255,255,.3)';ctx.beginPath();ctx.ellipse(x+w/2,gy+h/2,d.range,d.range*.55,0,0,7);ctx.stroke()}}
 ctx.restore();
 if(drag&&(Math.abs(mx-drag.x)>5||Math.abs(my-drag.y)>5)){ctx.strokeStyle='#5f5';ctx.lineWidth=1;ctx.fillStyle='rgba(80,255,120,.12)';ctx.fillRect(drag.x,drag.y,mx-drag.x,my-drag.y);ctx.strokeRect(drag.x,drag.y,mx-drag.x,my-drag.y)}
 cv.style.cursor=imode==='amove'?'crosshair':place?'copy':'default';
 drawMini()}
function camMove(dt){const sp=700*dt,on=mx>-1000&&!(mx===0&&my===0);if(keys['ARROWLEFT']||(on&&mx<8))cam.x-=sp;if(keys['ARROWRIGHT']||(on&&mx>W-8))cam.x+=sp;if(keys['ARROWUP']||(on&&my>=0&&my<8))cam.y-=sp;if(keys['ARROWDOWN'])cam.y+=sp}

let last=performance.now();
function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;
 if(running){pump();visualStep(dt);camMove(dt);render()}
 requestAnimationFrame(frame)}
requestAnimationFrame(frame);
