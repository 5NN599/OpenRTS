'use strict';
/* =====================================================================
   OpenRTS sim: 호스트 권한 시뮬레이션
   - 게임의 모든 규칙은 호스트(방장)의 브라우저에서만 계산됩니다.
   - 다른 플레이어는 '의도(명령)'만 보내고, 호스트가 검증한 뒤 반영합니다.
   - 호스트는 각 플레이어에게 '그 플레이어가 볼 수 있는 것'만 보냅니다 (맵핵 방지).
   ===================================================================== */
let ROLE='solo';                     // 'solo' | 'host' | 'client'
const emap=new Map();                // id -> 엔티티 (호스트)
let units=[],blds=[],fx=[],uid=1,sel=[],groups={},pings=[];
let gt=0,over=false,running=false,paused=false,shake=0,stepN=0,lastAlert=-99,pathBudget=0;
let stats={kills:0,lost:0,made:0,mined:0};
let msgT=0,curMode='ffa';
const DIFFS=[{inc:.7,w0:300,tg:8,wk:10},{inc:1,w0:210,tg:11,wk:14},{inc:1.25,w0:160,tg:14,wk:18}];
const FXC=['#ffb050','#ff9040','#ff8040','#ff6a50'],DEBC=['#a96','#889','#778'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

/* ---------- 메시지 / 알림 ---------- */
function msg(t){const e=$('msg');if(e)e.textContent=t;msgT=3}
/* 플레이어 p 에게 알림. 로컬이면 직접, 원격이면 네트워크로 */
function notify(p,text,s){
 if(p===me){if(text)msg(text);if(s)sfx(s)}
 else{const pl=players[p];if(pl&&pl.human&&pl.conn)pl.conn.send({t:'note',m:text||'',s:s||''})}}

/* ---------- 이벤트(이펙트·소리) 방송: 보이는 플레이어에게만 ---------- */
function emitVis(ev,ax,ay,bx,by){
 const ia=tileAt(ax,ay),ib=bx===undefined?ia:tileAt(bx,by);
 for(let p=0;p<4;p++){const pl=players[p];if(!pl||!pl.human)continue;
  const v=visT[p];if(!(pl.spec||v[ia]||v[ib]))continue;
  if(p===me)applyEvent(ev);else if(pl.conn)pl.evq.push(ev)}}
function debris(x,y,n,c){for(let i=0;i<n;i++){const a=rnd()*6.28,s=40+rnd()*120;fx.push({k:'part',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-90,t:0,m:.5+rnd()*.5,c:c||'#aaa',sz:2+rnd()*2.5})}}
/* 이벤트 종류: 0 사격, 1 폭발, 2 치료광선, 3 피격경보, 4 건물폭발, 5 효과음 */
function applyEvent(ev){
 switch(ev[0]){
 case 0:{const ty=ev[1],x1=ev[2],y1=ev[3],x2=ev[4],y2=ev[5],spl=ev[6],heavy=ty==='rocket'||ty==='walker';
  const col=ty==='rocket'?'#ffb060':ty==='walker'?'#ff7040':ty==='turret'?'#9ff':ty==='wasp'?'#d9f':ty==='worker'?'#fff':'#ffe9a0';
  fx.push({k:'tr',x:x1,y:y1,x2,y2,t:0,m:heavy?.25:.12,c:col,w:ty==='walker'?4:ty==='rocket'?3:1.6});
  fx.push({k:'boom',x:x2,y:y2,t:0,m:.2,r:6,c:col});
  sfx(ty==='rocket'?'rocket':ty==='walker'?'cannon':ty==='turret'?'turret':ty==='wasp'?'laser':'rifle',x1,y1);
  if(spl)fx.push({k:'boom',x:x2,y:y2,t:0,m:.3,r:spl*.8,c:'#ff8040'});break}
 case 1:{const x=ev[1],y=ev[2];fx.push({k:'boom',x,y,t:-(ev[9]||0)/1000,m:.45,r:ev[3],c:FXC[ev[4]]||FXC[0]});
  if(ev[7])debris(x,y,ev[7],DEBC[ev[8]]);if(ev[5]===1)sfx('boomS',x,y);else if(ev[5]===2)sfx('boom',x,y);if(ev[6])shake=Math.max(shake,ev[6]);break}
 case 2:fx.push({k:'beam',x:ev[1],y:ev[2],x2:ev[3],y2:ev[4],t:0,m:.3,c:'#7f9'});sfx('heal',ev[1],ev[2]);break;
 case 3:pings.push({x:ev[1],y:ev[2],t:0});if(gt-lastAlert>6){lastAlert=gt;sfx('alert');msg('공격받는 중!')}break;
 case 4:{const x=ev[1],y=ev[2],w=ev[3],h=ev[4];for(let i=0;i<7;i++)fx.push({k:'boom',x:x+(rnd()-.5)*w*.8,y:y+(rnd()-.5)*h*.6,t:-i*.08,m:.6,r:32,c:FXC[1]});
  debris(x,y,22,DEBC[2]);sfx('boom',x,y);shake=Math.max(shake,ev[5]);break}
 case 5:sfx(ev[1],ev[2],ev[3]);break}}

/* ---------- 기본 헬퍼 ---------- */
const rectB=b=>({x:b.tx*TS,y:b.ty*TS,w:b.d.w*TS,h:b.d.h*TS});
const rectN=n=>({x:n.tx*TS,y:n.ty*TS,w:n.w*TS,h:n.h*TS});
function distToRect(px,py,r){const dx=Math.max(r.x-px,0,px-(r.x+r.w)),dy=Math.max(r.y-py,0,py-(r.y+r.h));return Math.hypot(dx,dy)}
function approachPoint(u,r){return{x:clamp(u.x,r.x-12,r.x+r.w+12),y:clamp(u.y,r.y-12,r.y+r.h+12)}}
/* team 플레이어가 e 를 볼 수 있는가 */
function canSee(team,e){if(e.team===team)return true;const pl=players[team];if(pl&&pl.spec)return true;
 const i=tileAt(e.x,e.y);return visT[team][i]===1||(pl&&pl.human&&e.kind==='b'&&(e.seenBy&(1<<team))!==0)}
/* 이 화면의 플레이어에게 보이는가(그려도 되는가) */
function shown(e){if(ROLE==='client')return true;const pl=players[me];if(!pl)return true;if(pl.spec||ally(e.team,me))return true;
 return vis[tileAt(e.x,e.y)]===1||(e.kind==='b'&&(e.seenBy&(1<<me))!==0)}
const isVisT=e=>vis[tileAt(e.x,e.y)]===1;
function spos(e){if(e.kind==='u')return{x:e.x,y:e.y-e.ez*EH-(e.d.air?AIRH:0)-10};return{x:e.x,y:e.y-e.ez*EH-e.d.hgt*.6}}
function edgeDist(u,t){return t.kind==='u'?Math.hypot(t.x-u.x,t.y-u.y)-t.d.r:distToRect(u.x,u.y,rectB(t))}
function nearRamp(tx,ty,w,h,m){for(let y=ty-m;y<ty+h+m;y++)for(let x=tx-m;x<tx+w+m;x++)if(x>=0&&y>=0&&x<MW&&y<MH&&ramp[y*MW+x])return true;return false}
const rx=v=>Math.round(v);

/* ---------- 엔티티 ---------- */
function mkUnit(team,type,x,y){const d=UD[type],pl=players[team],mh=Math.round(d.hp*(pl?pl.hpMul:1));
 const u={kind:'u',id:uid++,team,type,d,x,y,ez:elevAt(x,y),hp:mh,mhp:mh,ang:team%2?2.3:-.8,o:{t:'idle'},path:null,pi:0,tg:null,cd:0,at:rnd()*.3,rt:0,ht:0,carry:0,ct:'ore',gt:0,flash:0,flashT:-9,lastShot:-9,stim:0,lx:x,ly:y,sT:0,rp:0,dead:false};
 units.push(u);emap.set(u.id,u);if(team===me)stats.made++;return u}
function mkBld(team,type,tx,ty,done){const d=BD[type],pl=players[team],mh=Math.round(d.hp*(pl?pl.hpMul:1));
 const b={kind:'b',id:uid++,team,type,d,tx,ty,x:(tx+d.w/2)*TS,y:(ty+d.h/2)*TS,ez:tileE[(ty+(d.h>>1))*MW+(tx+(d.w>>1))],hp:done?mh:mh*.1,mhp:mh,done,prog:done?1:0,bld:0,bw:false,q:[],qp:0,rally:null,cd:0,at:0,ang:0,flash:0,flashT:-9,seenBy:0,dead:false,node:null,tg:null};
 blds.push(b);emap.set(b.id,b);setOcc(b,1);return b}
function supply(team){
 if(ROLE==='client')return SUP;
 const pl=players[team];let cap=0,used=0;
 for(const b of blds)if(b.team===team&&!b.dead){if(b.done)cap+=b.d.supply||0;for(const q of b.q)used+=qDef(q).supply}
 for(const u of units)if(u.team===team&&!u.dead)used+=u.d.supply;
 return{cap:Math.min(cap,100+(pl?pl.capBonus:0)),used}}
let SUP={cap:0,used:0};
const hasBld=(team,type)=>blds.some(b=>b.team===team&&b.type===type&&b.done&&!b.dead);
function nodeOK(n,team){return n&&!n.dead&&n.amt>0&&(n.kind==='ore'||(n.ready&&n.ref&&n.ref.team===team))}
function findNode(u,kind,ex){let best=null,bd=1e9;for(const n of nodes){if(n===ex||n.kind!==kind||!nodeOK(n,u.team))continue;const d=Math.hypot(n.x-u.x,n.y-u.y);if(d<bd&&d<1100){bd=d;best=n}}return best}
function nearestHQ(u){let best=null,bd=1e9;for(const b of blds){if(b.team!==u.team||b.type!=='hq'||!b.done||b.dead)continue;const d=Math.hypot(b.x-u.x,b.y-u.y);if(d<bd){bd=d;best=b}}return best}

/* ---------- 생산 / 연구 ---------- */
function queueItem(b,t){const d=qDef(t),R=res[b.team],p=b.team;
 if(d.req&&!hasBld(p,d.req)){notify(p,BD[d.req].name+' 필요','err');return false}
 if(d.res){const key='r:'+t.split(':')[1];if(blds.some(bb=>bb.team===p&&!bb.dead&&bb.q.some(q=>q.startsWith(key))))return false}
 if(R.ore<d.cost[0]||R.plasma<d.cost[1]){notify(p,R.ore<d.cost[0]?'광석 부족':'플라즈마 부족','err');return false}
 if(d.supply){const s=supply(p);if(s.used+d.supply>s.cap){notify(p,'인구 한도 — 발전기가 필요합니다','err');return false}}
 if(b.q.length>=5)return false;R.ore-=d.cost[0];R.plasma-=d.cost[1];b.q.push(t);notify(p,null,'click');return true}
function cancelQ(b,i){const t=b.q[i];if(!t)return;const d=qDef(t);res[b.team].ore+=d.cost[0];res[b.team].plasma+=d.cost[1];b.q.splice(i,1);if(i===0)b.qp=0}
function spawnFrom(b,type){const d=UD[type],r=rectB(b),tg=b.rally||{x:b.x,y:b.y+r.h};let u;
 if(d.air){u=mkUnit(b.team,type,b.x,b.y+r.h/2+8)}
 else{const p=approachPoint({x:tg.x,y:tg.y},r);const f=nearestFree(clamp(p.x/TS|0,0,MW-1),clamp(p.y/TS|0,0,MH-1))||[b.tx,b.ty+b.d.h];u=mkUnit(b.team,type,(f[0]+.5)*TS,(f[1]+.5)*TS)}
 if(b.rally){const n=b.rally.nid>=0?nodes[b.rally.nid]:null;if(n&&type==='worker'&&nodeOK(n,b.team))order(u,{t:'gather',node:n,ph:'go'});else order(u,{t:'move',x:b.rally.x,y:b.rally.y})}
 notify(b.team,null,'ready')}
function applyTech(team,t){const p=t.split(':'),lv=+p[2];if(lv>tech[team][p[1]])tech[team][p[1]]=lv;notify(team,RD[p[1]].name+' 완료','research')}
function useStim(u){if(u.type!=='soldier'||!tech[u.team].stim||u.stim>0||u.hp<=20)return;u.stim=8;u.hp-=10;
 const sp=spos(u);emitVis([1,rx(sp.x),rx(sp.y),16,3,0,0,0,0],u.x,u.y);emitVis([5,'stim',rx(sp.x),rx(sp.y)],u.x,u.y)}

/* ---------- 건설 ---------- */
function canPlace(team,type,tx,ty){const d=BD[type];let L=-1;const pl=players[team],ex=exploredP[team];
 for(let y=ty;y<ty+d.h;y++)for(let x=tx;x<tx+d.w;x++){if(blocked(x,y))return false;const i=y*MW+x;if(ramp[i])return false;if(L<0)L=lvl[i];else if(lvl[i]!==L)return false;if(pl&&pl.human&&!ex[i])return false}
 if(type==='refinery')return nodes.some(n=>n.kind==='plasma'&&!n.dead&&!n.ref&&n.tx===tx&&n.ty===ty);
 for(const n of nodes)if(n.kind==='plasma'&&!n.dead&&tx<n.tx+2&&tx+d.w>n.tx&&ty<n.ty+2&&ty+d.h>n.ty)return false;
 return true}
function placeBuilding(team,type,tx,ty,w){const d=BD[type],R=res[team];R.ore-=d.cost[0];R.plasma-=d.cost[1];const b=mkBld(team,type,tx,ty,false);
 if(type==='refinery'){const n=nodes.find(n=>n.kind==='plasma'&&n.tx===tx&&n.ty===ty&&!n.ref);b.node=n;n.ref=b}
 for(const u of units){if(u.dead||u.d.air)continue;const ux=u.x/TS|0,uy=u.y/TS|0;if(ux>=tx&&ux<tx+d.w&&uy>=ty&&uy<ty+d.h){const f=nearestFree(ux,uy);if(f){u.x=(f[0]+.5)*TS;u.y=(f[1]+.5)*TS;u.path=null}}}
 if(w)order(w,{t:'build',b});return b}

/* ---------- 이동 / 명령 ---------- */
function setPath(u,x,y){if(u.d.air){u.path=[{x:clamp(x,20,WW-20),y:clamp(y,20,WH-20)}];u.pi=0;return}u.path=findPath(u.x,u.y,x,y);u.pi=0;if(!u.path||!u.path.length)u.path=null}
function order(u,o){u.o=o;u.tg=null;u.path=null;u.rp=0;u.rt=0;if(o.t==='move'||o.t==='amove')setPath(u,o.x,o.y)}
function moveTo(u,nx,ny){if(u.d.air){u.x=clamp(nx,20,WW-20);u.y=clamp(ny,20,WH-20);return}const r=u.d.r*.55;if(walk(nx,ny,r)){u.x=nx;u.y=ny;return}if(walk(nx,u.y,r)){u.x=nx;return}if(walk(u.x,ny,r))u.y=ny}
function stepPath(u,dt){if(!u.path||u.pi>=u.path.length)return true;const w=u.path[u.pi],dx=w.x-u.x,dy=w.y-u.y,d=Math.hypot(dx,dy),st=u.d.speed*(u.stim>0?1.5:1)*dt;
 if(d<=st+1){moveTo(u,w.x,w.y);u.pi++;return u.pi>=u.path.length}
 u.ang=Math.atan2(dy,dx);moveTo(u,u.x+dx/d*st,u.y+dy/d*st);return false}
function formation(us,x,y,fn){const n=us.length,cols=Math.ceil(Math.sqrt(n)),rows=Math.ceil(n/cols),sp=26;us.forEach((u,i)=>fn(u,clamp(x+(i%cols-(cols-1)/2)*sp,40,WW-40),clamp(y+((i/cols|0)-(rows-1)/2)*sp,40,WH-40)))}

/* ---------- 전투 ---------- */
function findEnemy(u,R){let best=null,bs=1e9;const team=u.team;
 for(const e of units){if(e.dead||!isEnemy(team,e.team)||!canSee(team,e)||!canHit(u,e))continue;const d=Math.hypot(e.x-u.x,e.y-u.y)-e.d.r;if(d>R)continue;const sc=d-(e.d.dmg?80:0);if(sc<bs){bs=sc;best=e}}
 for(const b of blds){if(b.dead||!isEnemy(team,b.team)||!canSee(team,b)||!canHit(u,b))continue;const d=distToRect(u.x,u.y,rectB(b));if(d>R)continue;const sc=d+(b.type==='turret'?-60:20);if(sc<bs){bs=sc;best=b}}
 return best}
function alertAt(p,x,y){const pl=players[p];if(!pl||!pl.human||gt-pl.alertT<1)return;pl.alertT=gt;
 if(p===me)applyEvent([3,rx(x),rx(y)]);else if(pl.conn)pl.evq.push([3,rx(x),rx(y)])}
function hit(t,dmg,src){if(t.dead)return;let a=dmg;if(src&&src.team!==undefined)a=dmg*(1+.15*tech[src.team].weapons);
 a=Math.max(1,a-(t.d.armor||0)-tech[t.team].armor);t.hp-=a;t.flash=.08;t.flashT=gt;
 const pl=players[t.team];if(pl){if(pl.human)alertAt(t.team,t.x,t.y);else if(pl.aiS)pl.aiS.alert={x:t.x,y:t.y,t:gt}}
 if(t.hp<=0)kill(t,src)}
function kill(t,src){t.dead=true;const p=spos(t);
 if(t.team===me)stats.lost++;else if(src&&src.team===me)stats.kills++;
 if(t.kind==='u'){emitVis([1,rx(p.x),rx(p.y),rx(t.d.r*2.2),0,1,0,t.d.air?14:8,t.d.air?1:0,0],t.x,t.y);
  if(t.d.air)emitVis([1,rx(t.x),rx(t.y-t.ez*EH),34,1,0,0,0,0,0],t.x,t.y)}
 else{setOcc(t,0);if(t.node){t.node.ref=null;t.node.ready=false}
  emitVis([4,rx(t.x),rx(p.y),t.d.w*TS,t.d.h*TS,t.type==='hq'?14:6],t.x,t.y)}}
function fire(s,t){const d=s.d,ty=s.type,a=s.ang||0,sp=spos(s),tp=spos(t);
 s.lastShot=gt;
 emitVis([0,ty,rx(sp.x+Math.cos(a)*10),rx(sp.y),rx(tp.x+(rnd()-.5)*8),rx(tp.y+(rnd()-.5)*8),d.splash?d.splash:0],s.x,s.y,t.x,t.y);
 hit(t,d.dmg,s);
 if(d.splash)for(const e of units)if(!e.dead&&e!==t&&!e.d.air&&isEnemy(s.team,e.team)&&Math.hypot(e.x-t.x,e.y-t.y)<d.splash)hit(e,d.dmg*.5,s)}
function engage(u,dt,t){if(!canHit(u,t))return false;
 if(edgeDist(u,t)<=u.d.range){u.path=null;u.ang=Math.atan2(t.y-u.y,t.x-u.x);if(u.cd<=0){fire(u,t);u.cd=u.d.cd*(u.stim>0?.6:1)}return true}
 u.rt-=dt;if(!u.path||u.rt<=0){if(pathBudget<=0)return false;pathBudget--;u.rt=.6;let gx=t.x,gy=t.y;if(t.kind==='b'){const p=approachPoint(u,rectB(t));gx=p.x;gy=p.y}setPath(u,gx,gy)}
 if(u.path)stepPath(u,dt);return false}
function healNear(u){let best=null,bd=u.d.hrange;for(const a of units){if(a===u||a.dead||a.team!==u.team||!a.d.bio||a.hp>=a.mhp)continue;const dd=Math.hypot(a.x-u.x,a.y-u.y);if(dd<bd){bd=dd;best=a}}
 if(best){best.hp=Math.min(best.mhp,best.hp+u.d.heal*.5);const a=spos(u),b=spos(best);emitVis([2,rx(a.x),rx(a.y),rx(b.x),rx(b.y)],u.x,u.y)}}

/* ---------- 유닛 업데이트 ---------- */
function updateUnit(u,dt){
 const d=u.d,o=u.o,air=!!d.air;
 u.cd-=dt;u.flash-=dt;u.ez=elevAt(u.x,u.y);if(u.stim>0)u.stim-=dt;
 if(!air&&!walk(u.x,u.y,d.r*.5)){const f=nearestFree(u.x/TS|0,u.y/TS|0);if(f){u.x=(f[0]+.5)*TS;u.y=(f[1]+.5)*TS;u.path=null}}
 if(d.heal){u.ht-=dt;if(u.ht<=0){u.ht=.5;healNear(u)}}
 const acq=d.range?d.range+90:0;
 switch(o.t){
 case'idle':
  if(d.heal){u.rt-=dt;if(u.rt<=0){u.rt=.6;let best=null,bd=300;for(const a of units){if(a===u||a.dead||a.team!==u.team||!a.d.bio||a.hp>=a.mhp*.999)continue;const dd=Math.hypot(a.x-u.x,a.y-u.y);if(dd<bd){bd=dd;best=a}}
   if(best&&bd>55){if(pathBudget>0){pathBudget--;setPath(u,best.x,best.y)}}else u.path=null}
   if(u.path&&stepPath(u,dt))u.path=null;break}
  if(d.dmg&&u.type!=='worker'){
   if(u.tg&&(u.tg.dead||!canSee(u.team,u.tg)||edgeDist(u,u.tg)>d.range+170)){u.tg=null;u.path=null}
   if(!u.tg){u.at-=dt;if(u.at<=0){u.at=.3+rnd()*.1;u.tg=findEnemy(u,d.range+60)}}
   if(u.tg)engage(u,dt,u.tg)}
  break;
 case'move':if(!u.path||stepPath(u,dt)){u.o={t:'idle'};u.path=null}break;
 case'amove':
  if(u.tg&&(u.tg.dead||!canSee(u.team,u.tg))){u.tg=null;u.path=null}
  if(!u.tg&&d.dmg&&u.type!=='worker'){u.at-=dt;if(u.at<=0){u.at=.3;u.tg=findEnemy(u,acq);if(u.tg)u.path=null}}
  if(u.tg){if(edgeDist(u,u.tg)>acq+120){u.tg=null;u.path=null}else engage(u,dt,u.tg)}
  else{if(!u.path)setPath(u,o.x,o.y);if(!u.path||stepPath(u,dt)){u.o={t:'idle'};u.path=null}}
  break;
 case'attack':{const t=o.tg;if(!t||t.dead||!canHit(u,t)||!canSee(u.team,t)){u.o={t:'idle'};u.path=null;break}engage(u,dt,t);break}
 case'build':{const b=o.b;if(!b||b.dead||b.done){u.o={t:'idle'};u.path=null;break}const r=rectB(b);
  if(distToRect(u.x,u.y,r)<=26){u.path=null;u.ang=Math.atan2(b.y-u.y,b.x-u.x);b.bld++}
  else{if(!u.path){const p=approachPoint(u,r);setPath(u,p.x,p.y);if(!u.path){if(++u.rp>5)u.o={t:'idle'};break}}
   if(stepPath(u,dt)){u.path=null;if(++u.rp>6)u.o={t:'idle'}}}
  break}
 case'repair':{const b=o.b;if(!b||b.dead||!b.done||b.hp>=b.mhp){u.o={t:'idle'};u.path=null;break}const r=rectB(b);
  if(distToRect(u.x,u.y,r)<=26){u.path=null;u.ang=Math.atan2(b.y-u.y,b.x-u.x);u.rt-=dt;
   if(u.rt<=0){u.rt=.5;if(res[u.team].ore>=1){res[u.team].ore-=1;b.hp=Math.min(b.mhp,b.hp+18);const p=spos(b);emitVis([1,rx(b.x+(rnd()-.5)*b.d.w*TS*.6),rx(p.y),7,0,0,0,0,0,0],b.x,b.y)}else u.o={t:'idle'}}}
  else{if(!u.path){const p=approachPoint(u,r);setPath(u,p.x,p.y);if(!u.path){if(++u.rp>5)u.o={t:'idle'};break}}
   if(stepPath(u,dt)){u.path=null;if(++u.rp>6)u.o={t:'idle'}}}
  break}
 case'gather':{
  let n=o.node;
  if(o.ph==='go'||o.ph==='mine'){if(!nodeOK(n,u.team)){n=o.node=findNode(u,u.ct||'ore',n);if(!n){if(u.carry>0)o.ph='back';else{u.o={t:'idle'};break}}}}
  if(o.ph==='go'){const r=rectN(n);
   if(distToRect(u.x,u.y,r)<=26){o.ph='mine';u.gt=2.2;u.path=null;u.ct=n.kind;u.rp=0}
   else{if(!u.path){const p=approachPoint(u,r);setPath(u,p.x,p.y);if(!u.path){if(++u.rp>6)u.o={t:'idle'};break}}
    if(stepPath(u,dt)){u.path=null;if(++u.rp>8)u.o={t:'idle'}}}}
  else if(o.ph==='mine'){u.ang=Math.atan2(n.y-u.y,n.x-u.x);u.gt-=dt;
   if(u.gt<=0){const amt=Math.min(n.kind==='ore'?6:4,n.amt);n.amt-=amt;u.carry=amt;u.ct=n.kind;if(n.amt<=0)removeNode(n);o.ph='back';u.path=null;u.rp=0}}
  else{const h=nearestHQ(u);if(!h){u.o={t:'idle'};break}const r=rectB(h);
   if(distToRect(u.x,u.y,r)<=26){res[u.team][u.ct]+=u.carry*players[u.team].inc;if(u.team===me)stats.mined+=u.carry;u.carry=0;if(u.team===me)sfx('mine');o.ph='go';u.path=null;u.rp=0}
   else{if(!u.path){const p=approachPoint(u,r);setPath(u,p.x,p.y)}if(stepPath(u,dt)){u.path=null;if(++u.rp>8)u.o={t:'idle'}}}}
  break}
 }
 if(!air){u.sT+=dt;
  if(u.sT>.7){if(u.path&&u.pi<u.path.length&&Math.hypot(u.x-u.lx,u.y-u.ly)<5){u.rp++;if(u.rp>4){u.path=null;if(o.t==='move')u.o={t:'idle'}}else if(pathBudget>0){pathBudget--;const w=u.path[u.path.length-1];setPath(u,w.x,w.y)}}else if(u.path)u.rp=0;u.lx=u.x;u.ly=u.y;u.sT=0}}
}
function separate(dt){const n=units.length;for(let i=0;i<n;i++){const a=units[i];if(a.dead)continue;for(let j=i+1;j<n;j++){const b=units[j];if(b.dead||!!a.d.air!==!!b.d.air)continue;
 const dx=b.x-a.x,dy=b.y-a.y,m=a.d.r+b.d.r-2;if(Math.abs(dx)>m||Math.abs(dy)>m)continue;const d=Math.hypot(dx,dy);if(d>=m)continue;
 let nx,ny;if(d<.01){nx=rnd()-.5;ny=rnd()-.5}else{nx=dx/d;ny=dy/d}const p=Math.min((m-d)*.5,70*dt);
 if(a.d.air){a.x-=nx*p;a.y-=ny*p;b.x+=nx*p;b.y+=ny*p;continue}
 if(walk(a.x-nx*p,a.y-ny*p,a.d.r*.5)){a.x-=nx*p;a.y-=ny*p}if(walk(b.x+nx*p,b.y+ny*p,b.d.r*.5)){b.x+=nx*p;b.y+=ny*p}}}}
function updateBuilding(b,dt){b.flash-=dt;
 if(!b.done){b.bw=b.bld>0;if(b.bld>0){b.prog+=dt*b.bld/b.d.time;b.hp=Math.min(b.mhp,b.hp+dt*b.bld*b.mhp*.9/b.d.time)}b.bld=0;
  if(b.prog>=1){b.done=true;b.bw=false;b.prog=1;b.hp=Math.max(b.hp,b.mhp*.9);if(b.node)b.node.ready=true;notify(b.team,b.d.name+' 건설 완료','done')}return}
 if(b.q.length){const t=b.q[0],d=qDef(t);b.qp+=dt/d.time;if(b.qp>=1){b.q.shift();b.qp=0;if(d.res)applyTech(b.team,t);else spawnFrom(b,t)}}
 if(b.type==='turret'){b.cd-=dt;b.at-=dt;if(!b.tg||b.tg.dead||edgeDist(b,b.tg)>b.d.range)b.tg=null;
  if(!b.tg&&b.at<=0){b.at=.3;b.tg=findEnemy(b,b.d.range)}
  if(b.tg){b.ang=Math.atan2(b.tg.y-b.y,b.tg.x-b.x);if(b.cd<=0){fire(b,b.tg);b.cd=b.d.cd}}}}

/* ---------- 안개 / 고도 시야 (동맹은 시야 공유) ---------- */
const visG=[0,1,2,3].map(()=>new Uint8Array(MW*MH));
function reveal(v,x,y,r,srcE,ign){const tr=r/TS,cx=x/TS,cy=y/TS;
 for(let ty=Math.max(0,Math.floor(cy-tr));ty<=Math.min(MH-1,Math.ceil(cy+tr));ty++)for(let tx=Math.max(0,Math.floor(cx-tr));tx<=Math.min(MW-1,Math.ceil(cx+tr));tx++){
  const dx=tx+.5-cx,dy=ty+.5-cy;if(dx*dx+dy*dy>tr*tr)continue;const i=ty*MW+tx;if(ign||tileE[i]<=srcE+.6)v[i]=1}}
function updateViewerFog(){const E=explored,V=vis;for(let i=0;i<MW*MH;i++){if(V[i])E[i]=1;ft[i]=V[i]?0:E[i]?.45:.96}}
function updateFog(){
 for(const v of visG)v.fill(0);
 for(const u of units)if(!u.dead){const pl=players[u.team];if(pl)reveal(visG[pl.grp],u.x,u.y,u.d.sight,u.d.air?9:u.ez,false)}
 for(const b of blds)if(!b.dead){const pl=players[b.team];if(pl)reveal(visG[pl.grp],b.x,b.y,b.d.sight,b.ez+.5,false)}
 for(const tw of towers){const cnt=[0,0,0,0],who=[-1,-1,-1,-1];
  for(const u of units)if(!u.dead&&!u.d.air&&Math.hypot(u.x-tw.x,u.y-tw.y)<64){const g=players[u.team].grp;cnt[g]++;if(who[g]<0)who[g]=u.team}
  const gs=[0,1,2,3].filter(g=>cnt[g]>0);tw.owner=gs.length===1?who[gs[0]]:-1;if(tw.owner>=0)reveal(visG[gs[0]],tw.x,tw.y,540,9,true)}
 for(let p=0;p<4;p++){const pl=players[p];if(!pl)continue;if(pl.spec)visT[p].fill(1);else visT[p].set(visG[pl.grp]);
  const E=exploredP[p],V=visT[p];for(let i=0;i<MW*MH;i++)if(V[i])E[i]=1}
 for(const b of blds)if(!b.dead){const i=tileAt(b.x,b.y);for(let p=0;p<4;p++)if(players[p]&&visT[p][i])b.seenBy|=1<<p}
 updateViewerFog()}

/* ---------- 적 AI (플레이어마다 독립, 난이도 개별) ---------- */
function aiSpot(type,hq,p){const d=BD[type];
 if(type==='refinery'){let best=null,bd=1e9;for(const n of nodes)if(n.kind==='plasma'&&!n.ref&&!n.dead){const dd=Math.hypot(n.x-hq.x,n.y-hq.y);if(dd<bd&&dd<900){bd=dd;best=n}}return best?[best.tx,best.ty]:null}
 const cand=[],htx=hq.tx+hq.d.w/2,hty=hq.ty+hq.d.h/2;
 for(let ty=hq.ty-14;ty<=hq.ty+hq.d.h+14;ty++)for(let tx=hq.tx-14;tx<=hq.tx+hq.d.w+14;tx++){
  const dd=Math.hypot(tx+d.w/2-htx,ty+d.h/2-hty);if(dd<4.2||dd>15)continue;cand.push([tx,ty,dd+rnd()*3])}
 cand.sort((a,b)=>a[2]-b[2]);
 for(const[tx,ty]of cand){
  if(!canPlace(p,type,tx,ty)||nearRamp(tx,ty,d.w,d.h,1))continue;const cx=(tx+d.w/2)*TS,cy=(ty+d.h/2)*TS;let ok=true;
  for(const n of nodes)if(!n.dead&&Math.hypot(n.x-cx,n.y-cy)<(n.kind==='ore'?96:110)){ok=false;break}
  if(ok)for(const b of blds){if(b.dead||b.team!==p)continue;if(Math.abs(b.x-cx)<(b.d.w+d.w)*TS/2+TS*.9&&Math.abs(b.y-cy)<(b.d.h+d.h)*TS/2+TS*.9){ok=false;break}}
  if(ok)return[tx,ty]}
 return null}
function aiBuild(p,type,hq,workers){const d=BD[type],R=res[p];
 if(R.ore<d.cost[0]||R.plasma<d.cost[1])return false;if(d.req&&!hasBld(p,d.req))return false;
 const s=aiSpot(type,hq,p);if(!s)return false;const cand=workers.filter(w=>w.o.t!=='build'&&!w.carry);if(!cand.length)return false;
 const cx=(s[0]+d.w/2)*TS,cy=(s[1]+d.h/2)*TS;cand.sort((a,b)=>Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy));
 placeBuilding(p,type,s[0],s[1],cand[0]);return true}
function aiTick(p){
 const pl=players[p],S=pl.aiS,df=DIFFS[pl.diff],R=res[p],hq=blds.find(b=>b.team===p&&b.type==='hq'&&!b.dead&&b.done);if(!hq||!pl.alive)return;
 const mine=units.filter(u=>u.team===p&&!u.dead),workers=mine.filter(u=>u.type==='worker'),army=mine.filter(u=>u.type!=='worker');
 const B=t=>blds.filter(b=>b.team===p&&b.type===t&&!b.dead),done=t=>B(t).filter(b=>b.done);
 const sp=supply(p),pNode=nodes.find(n=>n.kind==='plasma'&&nodeOK(n,p)&&Math.hypot(n.x-hq.x,n.y-hq.y)<1100);
 let pw=workers.filter(w=>w.o.t==='gather'&&w.o.node&&w.o.node.kind==='plasma').length;
 for(const w of workers)if(w.o.t==='idle'){let n=null;if(pNode&&pw<3){n=pNode;pw++}else n=findNode(w,'ore',null);if(n)order(w,{t:'gather',node:n,ph:'go'})}
 if(hq.q.length<1&&workers.length<df.wk)queueItem(hq,'worker');
 if(sp.cap-sp.used<=4&&sp.cap<100+pl.capBonus&&!B('gen').some(b=>!b.done))aiBuild(p,'gen',hq,workers);
 if(B('barracks').length<1)aiBuild(p,'barracks',hq,workers);
 else if(done('barracks').length){
  if(B('refinery').length<1)aiBuild(p,'refinery',hq,workers);
  if(workers.length>=9&&B('barracks').length<(df.wk>14?3:2))aiBuild(p,'barracks',hq,workers);
  if(B('foundry').length<1&&R.plasma>=50)aiBuild(p,'foundry',hq,workers);
  if(B('lab').length<1&&R.plasma>=100)aiBuild(p,'lab',hq,workers);
  if(done('foundry').length&&B('airfield').length<1&&R.plasma>=100)aiBuild(p,'airfield',hq,workers);
  if(B('turret').length<2&&R.ore>350)aiBuild(p,'turret',hq,workers)}
 for(const b of done('lab'))if(b.q.length<1)for(const k of['weapons','armor','stim']){const lv=tech[p][k];if(lv<RD[k].max&&queueItem(b,'r:'+k+':'+(lv+1)))break}
 for(const b of done('barracks'))if(b.q.length<2){const r=rnd();if(hasBld(p,'lab')&&R.plasma>=25&&r<.15)queueItem(b,'medic');else if(R.plasma>=25&&R.ore>=100&&r<.5)queueItem(b,'rocket');else queueItem(b,'soldier')}
 for(const b of done('foundry'))if(b.q.length<1)queueItem(b,'walker');
 for(const b of done('airfield'))if(b.q.length<1)queueItem(b,'wasp');
 const rally={x:hq.x+(WW/2-hq.x)*.15,y:hq.y+(WH/2-hq.y)*.15};
 if(S.alert&&gt-S.alert.t<8)for(const u of army)if(u.o.t==='idle')order(u,{t:'amove',x:S.alert.x,y:S.alert.y});
 if(!S.attacking&&gt>=S.next&&army.length>=S.target){S.attacking=true;S.target+=3;S.next=gt+100}
 if(S.attacking){if(army.length<3)S.attacking=false;
  else{const pb=blds.filter(b=>!b.dead&&isEnemy(p,b.team));
   if(pb.length)for(const u of army)if(u.o.t==='idle'){let bt=null,bd=1e9;for(const b of pb){const dd=Math.hypot(b.x-u.x,b.y-u.y);if(dd<bd){bd=dd;bt=b}}order(u,{t:'amove',x:bt.x,y:bt.y})}}}
 else for(const u of army)if(u.o.t==='idle'&&!u.d.air&&Math.hypot(u.x-rally.x,u.y-rally.y)>220)order(u,{t:'move',x:rally.x+(rnd()-.5)*150,y:rally.y+(rnd()-.5)*150})}

/* =====================================================================
   명령 검증 (치트·핵 방지의 핵심)
   - 클라이언트가 보내는 모든 것은 '요청'일 뿐입니다. 호스트가 소유권·자원·위치·시야를 직접 확인합니다.
   - 남의 유닛 조작, 형식 오류, 명령 폭주는 '경고'로 집계되고, 누적되면 강제 퇴장합니다.
   ===================================================================== */
const MAXIDS=300;
function strike(p,why){const pl=players[p];if(!pl||p===me||!pl.strikes)return;pl.strikes=pl.strikes.filter(t=>gt-t<60);pl.strikes.push(gt);
 Net.sys('⚠ '+pl.name+': 부정 요청 차단 — '+why+' ('+pl.strikes.length+'/30)');
 if(pl.strikes.length>=30)Net.kick(p,'치팅 의심(비정상 요청 반복)')}
const okNum=v=>typeof v==='number'&&isFinite(v);
function cleanIds(p,ids,kind){const out=[];if(!Array.isArray(ids)||ids.length>MAXIDS){strike(p,'비정상 선택 목록');return out}
 for(const id of ids){if(!Number.isInteger(id))continue;const e=emap.get(id);if(!e||e.dead)continue;
  if(e.team!==p){strike(p,'남의 유닛/건물 조작 시도');continue}if(kind&&e.kind!==kind)continue;out.push(e)}
 return out}
function execCmd(p,c){const pl=players[p];if(!pl||pl.spec||over||!running)return;
 if(!c||typeof c!=='object'||typeof c.c!=='string'){strike(p,'형식 오류');return}
 if(p!==me){pl.tok=Math.min(100,pl.tok+(gt-pl.tokT)*60);pl.tokT=gt;if(pl.tok<1){pl.drops=(pl.drops||0)+1;if(pl.drops%25===1)strike(p,'명령 폭주');return}pl.tok--}
 switch(c.c){
 case'order':{const us=cleanIds(p,c.ids,'u');if(!us.length)return;const o=c.o;
  if(o==='stop'){us.forEach(u=>order(u,{t:'idle'}));return}
  if(o==='move'||o==='amove'){if(!okNum(c.x)||!okNum(c.y)){strike(p,'좌표 오류');return}const x=clamp(c.x,20,WW-20),y=clamp(c.y,20,WH-20);formation(us,x,y,(u,fx,fy)=>order(u,{t:o,x:fx,y:fy}));return}
  if(o==='attack'){const t=emap.get(c.tid);if(!t||t.dead||!isEnemy(p,t.team)||!canSee(p,t))return;us.forEach(u=>{if(canHit(u,t))order(u,{t:'attack',tg:t})});return}
  if(o==='gather'){const n=Number.isInteger(c.nid)?nodes[c.nid]:null;if(!n||!nodeOK(n,p)||!exploredP[p][n.ty*MW+n.tx])return;us.forEach(u=>{if(u.type==='worker')order(u,{t:'gather',node:n,ph:'go'})});return}
  if(o==='help'){const b=emap.get(c.tid);if(!b||b.dead||b.kind!=='b')return;if(b.team!==p){strike(p,'남의 건물 조작 시도');return}
   us.forEach(u=>{if(u.type!=='worker')return;if(!b.done)order(u,{t:'build',b});else if(b.hp<b.mhp)order(u,{t:'repair',b})});return}
  strike(p,'알 수 없는 명령');return}
 case'place':{if(typeof c.type!=='string'||!own(BD,c.type)||!Number.isInteger(c.tx)||!Number.isInteger(c.ty)){strike(p,'건설 요청 오류');return}
  const d=BD[c.type],ws=cleanIds(p,c.ids,'u').filter(u=>u.type==='worker');if(!ws.length)return;
  if(d.req&&!hasBld(p,d.req)){notify(p,BD[d.req].name+' 필요','err');return}
  const R=res[p];if(R.ore<d.cost[0]||R.plasma<d.cost[1]){notify(p,R.ore<d.cost[0]?'광석 부족':'플라즈마 부족','err');return}
  if(blds.reduce((n,b)=>n+(b.team===p&&!b.dead?1:0),0)>=150){notify(p,'건물 수 한도','err');return}
  if(!canPlace(p,c.type,c.tx,c.ty)){notify(p,'여기에는 지을 수 없습니다 (평지·탐색된 곳만 가능)','err');return}
  const cx=(c.tx+d.w/2)*TS,cy=(c.ty+d.h/2)*TS;ws.sort((a,b)=>Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy));
  placeBuilding(p,c.type,c.tx,c.ty,ws[0]);notify(p,null,'ack');return}
 case'train':{const b=emap.get(c.bid);if(!b||b.dead||b.kind!=='b')return;if(b.team!==p){strike(p,'남의 건물 조작 시도');return}if(!b.done)return;
  const it=c.item;if(typeof it!=='string'||it.length>20)return;
  if(it.charAt(1)===':'){const pr=it.split(':');if(pr.length!==3||pr[0]!=='r'||!own(RD,pr[1])||b.type!=='lab')return;const lv=+pr[2];if(lv!==tech[p][pr[1]]+1||lv>RD[pr[1]].max)return;queueItem(b,it);return}
  if(!own(UD,it)||UD[it].by!==b.type){strike(p,'생산할 수 없는 유닛');return}
  queueItem(b,it);return}
 case'cancelq':{const b=emap.get(c.bid);if(!b||b.dead||b.kind!=='b')return;if(b.team!==p){strike(p,'남의 건물 조작 시도');return}if(Number.isInteger(c.i)&&c.i>=0&&c.i<b.q.length)cancelQ(b,c.i);return}
 case'rally':{const b=emap.get(c.bid);if(!b||b.dead||b.kind!=='b')return;if(b.team!==p){strike(p,'남의 건물 조작 시도');return}
  if(!['hq','barracks','foundry','airfield'].includes(b.type)||!okNum(c.x)||!okNum(c.y))return;
  b.rally={x:clamp(c.x,20,WW-20),y:clamp(c.y,20,WH-20),nid:Number.isInteger(c.nid)&&nodes[c.nid]?c.nid:-1};return}
 case'stim':{cleanIds(p,c.ids,'u').forEach(useStim);return}
 case'del':{const b=emap.get(c.bid);if(!b||b.dead||b.kind!=='b')return;if(b.team!==p){strike(p,'남의 건물 조작 시도');return}
  if(!b.done&&b.type!=='hq'){res[p].ore+=b.d.cost[0]*.75;res[p].plasma+=b.d.cost[1]*.75;kill(b,null)}return}
 default:strike(p,'알 수 없는 명령')}}
/* UI 가 부르는 단일 진입점: 호스트/솔로는 즉시 실행, 클라이언트는 호스트에게 전송 */
function sendCmd(c){if(ROLE==='client')Net.sendCmd(c);else execCmd(me,c)}

/* ---------- 메인 루프 ---------- */
let accFog=0,accAI=0,accUI=0,pumpLast=0,pumpAcc=0,tickW=null,tickI=null;
function simStep(dt){
 gt+=dt;stepN++;pathBudget=16;
 for(const u of units)if(!u.dead)updateUnit(u,dt);
 separate(dt);
 for(const b of blds)if(!b.dead)updateBuilding(b,dt);
 for(const u of units)if(u.dead)emap.delete(u.id);for(const b of blds)if(b.dead)emap.delete(b.id);
 units=units.filter(u=>!u.dead);blds=blds.filter(b=>!b.dead);
 for(const e of units)if(e.tg&&e.tg.dead)e.tg=null;
 accFog+=dt;if(accFog>.2){accFog=0;updateFog()}
 accAI+=dt;if(accAI>1){accAI=0;for(let p=0;p<4;p++){const pl=players[p];if(pl&&pl.ai&&pl.alive)aiTick(p)}checkEnd()}
 if(ROLE==='host'&&stepN%3===0)Net.broadcastSnapshots()}
function pump(){const n=performance.now();let d=(n-pumpLast)/1000;pumpLast=n;if(d>2)d=2;
 if(!running||over||ROLE==='client'||paused)return;pumpAcc+=d;let k=0;while(pumpAcc>=1/30&&k<60){simStep(1/30);pumpAcc-=1/30;k++}if(pumpAcc>.25)pumpAcc=.25}
function startTicker(){stopTicker();pumpLast=performance.now();
 try{const url=URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},40)'],{type:'application/javascript'}));tickW=new Worker(url);tickW.onmessage=pump}
 catch(e){tickI=setInterval(pump,50)}}
function stopTicker(){if(tickW){tickW.terminate();tickW=null}if(tickI){clearInterval(tickI);tickI=null}}
/* 화면 갱신용(모든 역할 공통): 이펙트·핑·안개 보간·UI */
function visualStep(dt){
 for(const f of fx){f.t+=dt;if(f.k==='part'&&f.t>0){f.x+=f.vx*dt;f.y+=f.vy*dt;f.vy+=380*dt}}fx=fx.filter(f=>f.t<f.m);
 for(const p of pings)p.t+=dt;pings=pings.filter(p=>p.t<2);
 shake=Math.max(0,shake-dt*30);
 for(const b of blds)if(b.bw&&!b.done&&rnd()<dt*8){const p=spos(b);fx.push({k:'part',x:b.x+(rnd()-.5)*b.d.w*TS,y:p.y,vx:(rnd()-.5)*60,vy:-60-rnd()*60,t:0,m:.4,c:'#ffd870',sz:2})}
 if(ROLE==='client'){const k=Math.min(1,dt*14);for(const u of units){const dx=u.nx-u.x,dy=u.ny-u.y;if(dx*dx+dy*dy>14400){u.x=u.nx;u.y=u.ny}else{u.x+=dx*k;u.y+=dy*k}u.ez=elevAt(u.x,u.y);if(u.flash>0)u.flash-=dt}
  for(const b of blds)if(b.flash>0)b.flash-=dt}
 sel=sel.filter(e=>!e.dead);
 const k2=Math.min(1,dt*8);for(let i=0;i<MW*MH;i++)fa[i]+=(ft[i]-fa[i])*k2;
 if(msgT>0){msgT-=dt;if(msgT<=0){const e=$('msg');if(e)e.textContent=''}}
 accUI+=dt;if(accUI>.2){accUI=0;updateUI()}}

/* ---------- 경기 종료 판정 (호스트) ---------- */
function checkEnd(){if(over)return;
 for(let p=0;p<4;p++){const pl=players[p];if(!pl||!pl.alive)continue;
  if(!blds.some(b=>b.team===p&&!b.dead)){pl.alive=false;pl.spec=true;Net.sys(pl.name+' 탈락');
   if(pl.human){if(p===me)UI.onEliminated();else if(pl.conn)pl.conn.send({t:'elim'})}}}
 const aliveG=new Set();for(const pl of players)if(pl&&pl.alive)aliveG.add(pl.grp);
 if(aliveG.size<=1){over=true;const g=aliveG.size?[...aliveG][0]:-1;Net.sendOver(g);UI.showEnd(g)}}

/* ---------- 경기 시작 (호스트/솔로) ---------- */
/* slots: [{kind:'human'|'ai'|'open'|'closed',name,grp,diff,link}] × 4 */
function setupMatch(slots,gameMode,seedText){
 curMode=gameMode;me=0;
 units=[];blds=[];fx=[];sel=[];groups={};uid=1;gt=0;stepN=0;over=false;paused=false;pings=[];shake=0;emap.clear();
 const act=slots.map((s,i)=>({s,i})).filter(x=>x.s.kind==='human'||x.s.kind==='ai');
 const gsz={};act.forEach(x=>{gsz[x.s.grp]=(gsz[x.s.grp]||0)+1});const maxSz=Math.max(...Object.values(gsz));
 for(let i=0;i<4;i++){players[i]=null;res[i].ore=300;res[i].plasma=0;tech[i].weapons=tech[i].armor=tech[i].stim=0}
 for(const{s,i}of act){const k=gameMode==='asym'?maxSz-gsz[s.grp]:0;
  const df=DIFFS[s.diff==null?1:s.diff];
  players[i]={slot:i,name:s.name,grp:s.grp,human:s.kind==='human',ai:s.kind==='ai',diff:s.diff==null?1:s.diff,conn:s.link||null,evq:[],strikes:[],tok:100,tokT:0,drops:0,alertT:-99,
   alive:true,spec:false,aiS:null,asym:k,
   hpMul:1+.2*k,inc:(s.kind==='ai'?df.inc:1)*(1+.35*k),capBonus:30*k};
  res[i].ore=300+250*k;res[i].plasma=100*k;
  if(s.kind==='ai')players[i].aiS={alert:null,attacking:false,next:df.w0+i*12,target:df.tg}}
 const remote=act.some(x=>x.s.kind==='human'&&x.i!==0);
 ROLE=remote?'host':'solo';
 const sv=(seedText||'').trim();seed=sv?hashStr(sv):((Math.random()*1e9)|0);
 let ok=false;for(let k=0;k<20&&!ok;k++)ok=genMap();
 // 시작 지점 배치: 같은 팀끼리 인접하게 (2인은 대각선)
 const order2=act.slice().sort((a,b)=>a.s.grp-b.s.grp||a.i-b.i),perim=act.length===2?[0,1]:[0,2,1,3];
 order2.forEach((x,k)=>{const st=START[perim[k]],i=x.i;x.start=st;
  const hq=mkBld(i,'hq',st.hq[0],st.hq[1],true);players[i].hqIdx=perim[k];
  for(let w=0;w<4;w++){const dir=(st.c[1]>40)?1:-1;const u=mkUnit(i,'worker',(hq.tx+w+.5)*TS,(hq.ty+(dir>0?4.6:-.6))*TS);
   const nn=findNode(u,'ore',null);if(nn)order(u,{t:'gather',node:nn,ph:'go'})}});
 stats={kills:0,lost:0,made:0,mined:0};
 setViewer(0);updateFog();for(let i=0;i<MW*MH;i++)fa[i]=ft[i];
 running=true;accFog=accAI=accUI=0;startTicker();
 return true}
function publicPlayers(){return players.map(pl=>pl?{slot:pl.slot,name:pl.name,grp:pl.grp,human:pl.human,hpMul:pl.hpMul,asym:pl.asym}:null)}
