'use strict';
/* =====================================================================
   OpenRTS snapshot: 호스트 → 클라이언트 상태 전송 (이진 포맷)
   - 호스트는 '해당 플레이어가 볼 수 있는' 엔티티만 담습니다 (맵핵 방지).
   - 클라이언트는 받은 내용을 그대로 그리기만 합니다.
   ===================================================================== */
function itemCode(t){if(t.charAt(1)===':'){const p=t.split(':');return 16+RK.indexOf(p[1])*4+(+p[2])}return UT.indexOf(t)}
function codeItem(c){if(c>=16){const k=c-16;return 'r:'+RK[k>>2]+':'+(k&3)}return UT[c]}

function buildSnapshot(p){
 const pl=players[p],spec=!!pl.spec,vp=visT[p],U=[],B=[];
 for(const u of units)if(!u.dead&&(spec||ally(p,u.team)||vp[tileAt(u.x,u.y)]))U.push(u);
 for(const b of blds)if(!b.dead&&(spec||ally(p,b.team)||vp[tileAt(b.x,b.y)]))B.push(b);
 const cap=96+MW*MH/8+2*nodes.length+towers.length+16*U.length+36*B.length;
 const buf=new ArrayBuffer(cap),dv=new DataView(buf);let o=0;
 const w8=v=>{dv.setUint8(o,v);o+=1},w16=v=>{dv.setUint16(o,v,true);o+=2},wi16=v=>{dv.setInt16(o,v,true);o+=2},w32=v=>{dv.setUint32(o,v,true);o+=4},wf=v=>{dv.setFloat32(o,v,true);o+=4},wi8=v=>{dv.setInt8(o,v);o+=1};
 w8(1);w32(stepN);wf(gt);wf(res[p].ore);wf(res[p].plasma);const s=supply(p);w16(s.used);w16(s.cap);
 w8(tech[p].weapons);w8(tech[p].armor);w8(tech[p].stim);
 let st=0;for(let i=0;i<4;i++)if(players[i]&&players[i].alive)st|=1<<i;w8(st);
 for(let i=0;i<MW*MH;i+=8){let b=0;for(let k=0;k<8;k++)if(spec||vp[i+k])b|=1<<k;w8(b)}
 w8(towers.length);for(const t of towers)w8(t.owner+1);
 w16(nodes.length);for(const n of nodes)w16(clamp(Math.round(n.amt),0,65535));
 w16(U.length);
 for(const u of U){w32(u.id);w8(UT.indexOf(u.type));w8(u.team);wi16(Math.round(u.x*10));wi16(Math.round(u.y*10));w16(clamp(Math.round(u.hp),0,65535));wi8(clamp(Math.round(u.ang/Math.PI*127),-127,127));
  w8((u.path&&u.pi<u.path.length?1:0)|(gt-u.lastShot<.15?2:0)|(u.stim>0?4:0)|(gt-u.flashT<.12?8:0)|(u.o.t==='idle'?16:0)|(u.carry>0?32:0)|(u.ct==='plasma'?64:0))}
 w16(B.length);
 for(const b of B){w32(b.id);w8(BT.indexOf(b.type));w8(b.team);w8(b.tx);w8(b.ty);w16(clamp(Math.round(b.hp),0,65535));w8(Math.round(clamp(b.prog,0,1)*255));
  w8((b.done?1:0)|(gt-b.flashT<.12?2:0)|(b.bw?4:0));wi8(clamp(Math.round((b.ang||0)/Math.PI*127),-127,127));
  if(ally(p,b.team)){w8(b.q.length);for(const q of b.q)w8(itemCode(q));w8(Math.round(clamp(b.qp,0,1)*255));
   if(b.rally){w8(1);wi16(Math.round(b.rally.x*10));wi16(Math.round(b.rally.y*10));wi16(b.rally.nid)}else w8(0)}}
 return buf.slice(0,o)}

/* ---------- 클라이언트 측 ---------- */
const CU=new Map(),CB=new Map(),MV=[{x:0,y:0}];
let snapNo=0,needCam=true,lastSnapAt=0;
function clientReset(){CU.clear();CB.clear();units=[];blds=[];fx=[];pings=[];sel=[];groups={};emap.clear();snapNo=0;needCam=true;over=false}

function applySnapshot(buf){
 const dv=new DataView(buf);let o=0;
 const r8=()=>dv.getUint8(o++),r16=()=>{const v=dv.getUint16(o,true);o+=2;return v},ri16=()=>{const v=dv.getInt16(o,true);o+=2;return v},r32=()=>{const v=dv.getUint32(o,true);o+=4;return v},rf=()=>{const v=dv.getFloat32(o,true);o+=4;return v},ri8=()=>dv.getInt8(o++);
 if(r8()!==1)return;
 snapNo++;lastSnapAt=performance.now();
 stepN=r32();gt=rf();res[me].ore=rf();res[me].plasma=rf();const used=r16(),cap=r16();SUP={used,cap};
 tech[me].weapons=r8();tech[me].armor=r8();tech[me].stim=r8();
 const st=r8();for(let i=0;i<4;i++)if(players[i])players[i].alive=!!(st&(1<<i));
 const V=visT[me];for(let i=0;i<MW*MH;i+=8){const b=r8();for(let k=0;k<8;k++)V[i+k]=(b>>k)&1}
 const nt=r8();for(let i=0;i<nt;i++){const ow=r8()-1;if(towers[i])towers[i].owner=ow}
 const nn=r16();for(let i=0;i<nn;i++){const a=r16();const n=nodes[i];if(!n)continue;n.amt=a;if(a<=0&&!n.dead)removeNode(n)}
 updateViewerFog();
 // 유닛
 const nu=[],nU=r16();
 for(let i=0;i<nU;i++){
  const id=r32(),ty=r8(),team=r8(),x=ri16()/10,y=ri16()/10,hp=r16(),ang=ri8()/127*Math.PI,fl=r8(),type=UT[ty],d=UD[type];
  if(!d||!players[team])continue;
  let u=CU.get(id);
  if(!u){u={kind:'u',id,team,type,d,x,y,nx:x,ny:y,ez:elevAt(x,y),hp,mhp:Math.round(d.hp*players[team].hpMul),ang,o:{t:'idle'},path:null,pi:0,cd:0,carry:0,ct:'ore',stim:0,flash:0,dead:false,sn:0};CU.set(id,u)}
  u.nx=x;u.ny=y;u.hp=hp;u.ang=ang;u.sn=snapNo;
  u.path=(fl&1)?MV:null;u.pi=0;u.cd=(fl&2)&&d.cd?d.cd:0;u.stim=(fl&4)?1:0;if(fl&8)u.flash=.08;u.o.t=(fl&16)?'idle':'busy';
  u.carry=(fl&32)?((fl&64)?4:6):0;u.ct=(fl&64)?'plasma':'ore';
  nu.push(u)}
 for(const[id,u]of CU)if(u.sn!==snapNo){u.dead=true;CU.delete(id)}
 units=nu;
 // 건물
 const nB=r16();
 for(let i=0;i<nB;i++){
  const id=r32(),ty=r8(),team=r8(),tx=r8(),tyy=r8(),hp=r16(),prog=r8()/255,fl=r8(),ang=ri8()/127*Math.PI,type=BT[ty],d=BD[type];
  if(!d||!players[team])continue;
  let b=CB.get(id);
  if(!b){const mh=Math.round(d.hp*players[team].hpMul);b={kind:'b',id,team,type,d,tx,ty:tyy,x:(tx+d.w/2)*TS,y:(tyy+d.h/2)*TS,ez:tileE[(tyy+(d.h>>1))*MW+(tx+(d.w>>1))],hp,mhp:mh,done:false,prog:0,q:[],qp:0,rally:null,flash:0,ang:0,seenBy:1<<me,ghost:false,dead:false,bw:false,sn:0};CB.set(id,b);setOcc(b,1)}
  b.hp=hp;b.prog=prog;b.done=!!(fl&1);if(fl&2)b.flash=.08;b.bw=!!(fl&4);b.ang=ang;b.sn=snapNo;b.ghost=false;
  if(ally(me,team)){const qn=r8();b.q=[];for(let k=0;k<qn;k++)b.q.push(codeItem(r8()));b.qp=r8()/255;
   if(r8()===1){const rx_=ri16()/10,ry_=ri16()/10,nid=ri16();b.rally={x:rx_,y:ry_,nid}}else b.rally=null}}
 for(const[id,b]of CB)if(b.sn!==snapNo){
  if(ally(me,b.team)||vis[tileAt(b.x,b.y)]){b.dead=true;setOcc(b,0);CB.delete(id)}else b.ghost=true}
 blds=[...CB.values()];
 // 정제소 ↔ 분출구 연결
 for(const n of nodes)if(n.kind==='plasma'){n.ref=null;n.ready=false}
 for(const b of blds)if(b.type==='refinery'){const n=nodes.find(q=>q.kind==='plasma'&&q.tx===b.tx&&q.ty===b.ty);if(n){n.ref=b;n.ready=b.done}}
 for(const e of blds)emap.set(e.id,e);
 if(needCam){const hq=blds.find(b=>b.team===me&&b.type==='hq');if(hq){cam.x=hq.x-W/2;cam.y=hq.y-H/2+60;sel=[hq];needCam=false}}
}
