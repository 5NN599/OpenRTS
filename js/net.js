'use strict';
/* =====================================================================
   OpenRTS net: P2P(WebRTC via PeerJS) + 공개 방 목록(MQTT retained) + 로비 프로토콜
   - 방장(호스트)이 권위를 가집니다. 방 코드는 8자리 숫자이며 PeerJS ID 로 쓰입니다.
   - 공개 방: 호스트가 공개 MQTT 브로커에 방 정보를 올립니다 (목록용 메타데이터만).
   - 비밀 방: 어디에도 게시하지 않고, 8자리 코드를 아는 사람만 입장할 수 있습니다.
   ===================================================================== */

/* ---------- 라이브러리 로더 (vendor/ → CDN 순) ---------- */
const Libs={ready:null,peer:false,mqtt:false};
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=()=>res();s.onerror=()=>rej(new Error('load '+src));document.head.appendChild(s)})}
Libs.load=function(){if(Libs.ready)return Libs.ready;
 Libs.ready=(async()=>{
  const need=[['Peer','vendor/peerjs.min.js',CONFIG.libs.peer],['mqtt','vendor/mqtt.min.js',CONFIG.libs.mqtt]];
  await Promise.all(need.map(async([g,local,cdn])=>{
   if(typeof window[g]!=='undefined')return;
   try{await loadScript(local)}catch(e){}
   if(typeof window[g]==='undefined'){try{await loadScript(cdn)}catch(e){}}}));
  Libs.peer=typeof window.Peer!=='undefined';Libs.mqtt=typeof window.mqtt!=='undefined'})();
 return Libs.ready};

/* ---------- 공통 유틸 ---------- */
function cleanName(s,fb){s=String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>&"'`]/g,'').trim().slice(0,16);return s||fb||'Player'}
function cleanText(s,n){return String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n||120)}
function genCode(){let v;try{const a=new Uint32Array(1);crypto.getRandomValues(a);v=a[0]%100000000}catch(e){v=Math.floor(Math.random()*100000000)}return String(v).padStart(8,'0')}
const isCode=s=>typeof s==='string'&&/^\d{8}$/.test(s);

/* ---------- 연결 래퍼 ---------- */
function normData(d,cb){
 if(d instanceof ArrayBuffer)return cb(d);
 if(ArrayBuffer.isView(d))return cb(d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength));
 if(typeof Blob!=='undefined'&&d instanceof Blob){d.arrayBuffer().then(cb);return}
 cb(d)}
function wrapConn(conn,peer){
 const L={raw:conn,peer,open:true,lastMsg:performance.now(),onmessage:null,onclose:null,slot:undefined,
  send(d){try{if(conn.open)conn.send(d)}catch(e){}},
  close(){L.open=false;try{conn.close()}catch(e){}},
  buffered(){try{return conn.dataChannel?conn.dataChannel.bufferedAmount:0}catch(e){return 0}}};
 conn.on('data',d=>{L.lastMsg=performance.now();normData(d,x=>{if(L.onmessage)L.onmessage(x)})});
 conn.on('close',()=>{if(!L.open&&L.closedOnce)return;L.open=false;L.closedOnce=true;if(L.onclose)L.onclose()});
 conn.on('error',()=>{});
 return L}
function peerListen(code,onConn){
 return new Promise((resolve,reject)=>{let settled=false;
  const peer=new Peer(CONFIG.peer.prefix+code,CONFIG.peer.options);
  peer.on('open',()=>{settled=true;resolve(peer)});
  peer.on('connection',conn=>onConn(wrapConn(conn,peer)));
  peer.on('disconnected',()=>{try{peer.reconnect()}catch(e){}});   // 시그널링 서버와 끊겨도 기존 연결은 유지
  peer.on('error',e=>{if(!settled){settled=true;reject(e)}})})}
function peerDial(code){
 return new Promise((resolve,reject)=>{const peer=new Peer(undefined,CONFIG.peer.options);let done=false,t=0;
  const fail=e=>{if(done)return;done=true;clearTimeout(t);try{peer.destroy()}catch(x){}reject(e)};
  t=setTimeout(()=>fail(new Error('timeout')),20000);
  peer.on('error',e=>fail(e));
  peer.on('open',()=>{const conn=peer.connect(CONFIG.peer.prefix+code,{reliable:true,serialization:'binary'});
   conn.on('open',()=>{if(done)return;done=true;clearTimeout(t);resolve(wrapConn(conn,peer))});
   conn.on('error',e=>fail(e));conn.on('close',()=>fail(new Error('closed')))})})}

/* ---------- 공개 방 디렉터리 (MQTT retained 메시지) ---------- */
const Dir={pub:null};
Dir._connect=function(will){
 return new Promise((resolve,reject)=>{
  if(typeof mqtt==='undefined')return reject(new Error('mqtt missing'));
  const urls=CONFIG.mqtt.brokers.slice();
  const next=()=>{const url=urls.shift();if(!url)return reject(new Error('no broker'));
   let c,adv=false,ok=false,to=0;
   const fail=()=>{if(adv||ok)return;adv=true;clearTimeout(to);try{c&&c.end(true)}catch(e){}next()};
   try{c=mqtt.connect(url,{clientId:'orts-'+Math.random().toString(16).slice(2,10),clean:true,connectTimeout:7000,reconnectPeriod:0,keepalive:30,will:will||undefined})}catch(e){return next()}
   to=setTimeout(fail,8000);
   c.on('connect',()=>{if(adv)return;ok=true;clearTimeout(to);resolve(c)});
   c.on('error',fail);c.on('close',fail)};
  next()})};
function sanitizeRoom(raw){
 let o;try{o=JSON.parse(raw)}catch(e){return null}
 if(!o||typeof o!=='object'||!isCode(o.c)||o.v!==CONFIG.protocol||!own(MODES,o.m))return null;
 const t=Number(o.t);if(!isFinite(t)||Date.now()-t>CONFIG.mqtt.ttl||t-Date.now()>60000)return null;
 return{c:o.c,n:cleanText(o.n,24)||'이름 없는 방',m:o.m,p:clamp(o.p|0,0,4),h:clamp(o.h|0,0,4),s:o.s?1:0,t}}
Dir.publish=async function(getInfo){
 await Libs.load();if(!Libs.mqtt)return false;
 const info=getInfo(),topic=CONFIG.mqtt.topic+'/'+info.c;
 try{const c=await Dir._connect({topic,payload:'',qos:0,retain:true});
  if(Net.role!=='host'||!Net.room){try{c.end(true)}catch(e){}return false}
  Dir.pub={c,topic,getInfo,timer:setInterval(()=>Dir.beat(),CONFIG.mqtt.beat)};Dir.beat();return true}
 catch(e){return false}};
Dir.beat=function(){const p=Dir.pub;if(!p||!p.c.connected)return;const info=p.getInfo();info.t=Date.now();try{p.c.publish(p.topic,JSON.stringify(info),{retain:true,qos:0})}catch(e){}};
Dir.unpublish=function(){const p=Dir.pub;if(!p)return;Dir.pub=null;clearInterval(p.timer);
 try{p.c.publish(p.topic,'',{retain:true,qos:0})}catch(e){}setTimeout(()=>{try{p.c.end(true)}catch(e){}},700)};
Dir.list=function(onUpdate,onStatus){
 let stop=false,client=null,timer=0;const rooms=new Map();
 const emit=()=>{const now=Date.now(),arr=[];for(const r of rooms.values())if(now-r.t<=CONFIG.mqtt.ttl)arr.push(r);arr.sort((a,b)=>a.s-b.s||b.t-a.t);onUpdate(arr)};
 (async()=>{try{await Libs.load();if(!Libs.mqtt)throw new Error('mqtt missing');client=await Dir._connect(null);if(stop){client.end(true);return}
   client.on('message',(topic,payload)=>{const id=topic.split('/').pop();let s;try{s=typeof payload==='string'?payload:new TextDecoder().decode(payload)}catch(e){return}
    if(!s){rooms.delete(id)}else{const r=sanitizeRoom(s);if(r&&r.c===id)rooms.set(id,r);else rooms.delete(id)}emit()});
   client.subscribe(CONFIG.mqtt.topic+'/+');timer=setInterval(emit,3000);if(onStatus)onStatus('ok')}
  catch(e){if(onStatus&&!stop)onStatus('error')}})();
 return{stop(){stop=true;clearInterval(timer);try{client&&client.end(true)}catch(e){}}}};

/* ---------- 로비 규칙 (호스트가 권위) ---------- */
const Lobby={
 newRoom(o){const r={code:o.code||'',name:cleanText(o.name,24)||'OpenRTS 방',vis:o.vis,mode:o.mode||'ffa',seed:'',phase:'lobby',
   slots:[{kind:'human',name:cleanName(o.nick,'방장'),diff:1,grp:0,link:null},
    o.vis==='solo'?{kind:'ai',name:'AI',diff:1,grp:1,link:null}:{kind:'open',name:'',diff:1,grp:1,link:null},
    {kind:o.vis==='solo'?'closed':'open',name:'',diff:1,grp:0,link:null},{kind:o.vis==='solo'?'closed':'open',name:'',diff:1,grp:1,link:null}]};
  Lobby.setMode(r,r.mode);return r},
 norm(r){r.slots.forEach((s,i)=>{
   if(s.kind==='ai')s.name='AI '+DIFFN[s.diff==null?1:s.diff];
   if(s.kind==='open'||s.kind==='closed')s.name='';
   if(r.mode==='ffa')s.grp=i;else if(r.mode==='aivh')s.grp=s.kind==='ai'?1:0;else s.grp=s.grp?1:0})},
 setMode(r,m){if(!own(MODES,m))return;r.mode=m;
  if(m==='team'||m==='asym'){const def=m==='team'?[0,1,0,1]:[0,1,1,1];const act=r.slots.filter(s=>s.kind==='human'||s.kind==='ai'||s.kind==='open');
   if(new Set(act.map(s=>s.grp)).size<2||r._modeChanged!==m)r.slots.forEach((s,i)=>{s.grp=def[i]})}
  r._modeChanged=m;Lobby.norm(r)},
 active(r){return r.slots.filter(s=>s.kind==='human'||s.kind==='ai')},
 validate(r){const a=Lobby.active(r);if(a.length<2)return '플레이어가 2명 이상 필요합니다 (AI 슬롯을 추가하거나 친구를 기다리세요)';
  if(new Set(a.map(s=>s.grp)).size<2)return r.mode==='aivh'?'사람과 AI가 모두 필요합니다':'서로 다른 팀이 필요합니다 (팀 버튼으로 나누세요)';
  if(r.mode==='aivh'&&!a.some(s=>s.kind==='ai'))return 'AI 슬롯이 필요합니다';return ''},
 pub(r){return{code:r.code,name:r.name,vis:r.vis,mode:r.mode,phase:r.phase,seed:r.seed,slots:r.slots.map(s=>({kind:s.kind,name:s.name,diff:s.diff,grp:s.grp}))}}
};

/* ---------- Net: 방 생성/입장/동기화 ---------- */
const Net={role:'none',room:null,you:0,peer:null,beatT:0,watchT:0,hostPeerErr:null};

/* 호스트: 방 만들기 */
Net.createRoom=async function(o){
 Net.leave(true);
 const r=Lobby.newRoom(o);
 if(o.vis==='solo'){r.code='';Net.room=r;Net.role='host';Net.you=0;ROLE='solo';return r}
 await Libs.load();if(!Libs.peer)throw new Error('P2P 라이브러리를 불러오지 못했습니다. 네트워크를 확인하세요.');
 let peer=null,lastErr=null;
 for(let k=0;k<6&&!peer;k++){const code=genCode();
  try{peer=await peerListen(code,link=>Net._incoming(link));r.code=code}
  catch(e){lastErr=e;if(!(e&&e.type==='unavailable-id'))break}}
 if(!peer)throw new Error('방을 만들지 못했습니다 ('+(lastErr&&lastErr.type||lastErr&&lastErr.message||'signal')+')');
 Net.peer=peer;Net.room=r;Net.role='host';Net.you=0;
 Net.watchT=setInterval(Net._watch,5000);
 if(r.vis==='public')Dir.publish(()=>Net._dirInfo());
 return r};
Net._dirInfo=function(){const r=Net.room;const act=Lobby.active(r);return{c:r.code,n:r.name,m:r.mode,p:act.length,h:r.slots.filter(s=>s.kind==='human').length,x:4,s:r.phase==='game'?1:0,v:CONFIG.protocol,t:Date.now()}};
Net._watch=function(){if(Net.role!=='host')return;const now=performance.now();
 for(let i=1;i<4;i++){const s=Net.room.slots[i];if(s.link&&now-s.link.lastMsg>30000){const l=s.link;Net._left(l)}}};

/* 호스트: 새 접속 처리 */
Net._incoming=function(link){
 const to=setTimeout(()=>{if(link.slot===undefined)link.close()},10000);
 link.onmessage=d=>{if(link.slot===undefined){clearTimeout(to);Net._hello(link,d)}else Net._hostMsg(link,d)};
 link.onclose=()=>Net._left(link)};
Net._hello=function(link,d){
 const r=Net.room;if(!r||!d||typeof d!=='object'||d.t!=='hello'){link.close();return}
 if(d.v!==CONFIG.protocol){link.send({t:'reject',m:'버전이 다릅니다. 페이지를 새로고침하세요.'});setTimeout(()=>link.close(),300);return}
 if(r.phase!=='lobby'){link.send({t:'reject',m:'이미 게임이 시작된 방입니다.'});setTimeout(()=>link.close(),300);return}
 const i=r.slots.findIndex((s,k)=>k>0&&s.kind==='open');
 if(i<0){link.send({t:'reject',m:'방이 가득 찼습니다.'});setTimeout(()=>link.close(),300);return}
 let nm=cleanName(d.name,'손님'),base=nm,k=2;while(r.slots.some(s=>s.kind==='human'&&s.name===nm))nm=base+' '+(k++);
 r.slots[i]={kind:'human',name:nm,diff:1,grp:r.slots[i].grp,link};link.slot=i;link.chatT=0;
 Lobby.norm(r);link.send({t:'welcome',you:i});Net.sys(nm+' 님이 입장했습니다');Net.pushLobby()};
Net._hostMsg=function(link,d){
 if(!d||typeof d!=='object'||d instanceof ArrayBuffer)return;const r=Net.room;if(!r)return;
 switch(d.t){
 case'cmd':if(r.phase==='game'&&running)execCmd(link.slot,d.c);break;
 case'chat':{const now=performance.now();if(now-link.chatT<700)return;link.chatT=now;const m=cleanText(d.m,120);if(!m)return;Net.chat(link.slot,m);break}
 case'ping':break;
 case'bye':Net._left(link);break}};
Net._left=function(link){
 const r=Net.room;if(!r||link.slot===undefined)return;const i=link.slot;link.slot=undefined;link.onclose=null;link.onmessage=null;try{link.close()}catch(e){}
 const s=r.slots[i];if(!s||s.link!==link)return;
 if(r.phase==='lobby'){const nm=s.name;r.slots[i]={kind:'open',name:'',diff:1,grp:s.grp,link:null};Lobby.norm(r);Net.sys(nm+' 님이 나갔습니다');Net.pushLobby()}
 else{const pl=players[i];if(pl&&pl.human){pl.human=false;pl.ai=true;pl.diff=1;pl.conn=null;pl.name+=' (AI)';pl.aiS={alert:null,attacking:false,next:gt+30,target:DIFFS[1].tg};
   Net.sys(s.name+' 님의 연결이 끊어졌습니다 — AI가 대신 플레이합니다')}
  r.slots[i]=Object.assign({},s,{link:null,kind:'closed'})}};
Net.kick=function(p,reason){const r=Net.room;if(!r)return;const pl=players[p];const link=pl&&pl.conn;
 if(link){link.send({t:'kick',m:reason||'방장이 내보냈습니다'});setTimeout(()=>{try{link.close()}catch(e){}},300);Net._left(link)}};
Net.kickSlot=function(i){const r=Net.room;if(!r||Net.role!=='host'||i<1)return;const s=r.slots[i];if(s&&s.link){const l=s.link;l.send({t:'kick',m:'방장이 내보냈습니다'});setTimeout(()=>{try{l.close()}catch(e){}},300);Net._left(l)}};

/* 호스트: 로비 조작 (UI 에서 호출) */
Net.setSlot=function(i,kind,diff){const r=Net.room;if(!r||Net.role!=='host'||i<1||i>3||r.phase!=='lobby')return;const s=r.slots[i];
 if(s.kind==='human'){if(kind!=='human')Net.kickSlot(i);return}
 if(!['open','ai','closed'].includes(kind))return;if(r.vis==='solo'&&kind==='open')kind='ai';
 s.kind=kind;if(kind==='ai')s.diff=clamp(diff==null?(s.diff==null?1:s.diff):diff|0,0,2);Lobby.norm(r);Net.pushLobby()};
Net.toggleGrp=function(i){const r=Net.room;if(!r||Net.role!=='host'||r.phase!=='lobby')return;if(r.mode!=='team'&&r.mode!=='asym')return;r.slots[i].grp=r.slots[i].grp?0:1;Lobby.norm(r);Net.pushLobby()};
Net.setMode=function(m){const r=Net.room;if(!r||Net.role!=='host'||r.phase!=='lobby')return;Lobby.setMode(r,m);Net.pushLobby()};
Net.setSeed=function(s){const r=Net.room;if(!r||Net.role!=='host')return;r.seed=cleanText(s,24);Net.pushLobby()};
Net.pushLobby=function(){const r=Net.room;if(!r)return;
 for(let i=1;i<4;i++){const s=r.slots[i];if(s.link)s.link.send({t:'lobby',r:Lobby.pub(r),you:i})}
 if(Dir.pub)Dir.beat();UI.refreshLobby()};

/* 채팅 / 시스템 메시지 */
Net.chat=function(slot,text){const r=Net.room;if(!r)return;
 if(Net.role==='client'){Net.toHost({t:'chat',m:cleanText(text,120)});return}
 const nm=slot>=0&&r.slots[slot]?r.slots[slot].name:'';const m=cleanText(text,120);if(!m)return;
 UI.chat(slot,nm,m);for(let i=1;i<4;i++){const s=r.slots[i];if(s.link)s.link.send({t:'chat',s:slot,n:nm,m})}};
Net.sys=function(text){const r=Net.room;if(!r||Net.role!=='host')return;
 UI.chat(-1,'',text);for(let i=1;i<4;i++){const s=r.slots[i];if(s.link)s.link.send({t:'chat',s:-1,n:'',m:text})}};

/* 호스트: 게임 시작 / 종료 / 로비 복귀 */
Net.startGame=function(){
 const r=Net.room;if(!r||Net.role!=='host'||r.phase!=='lobby')return;
 const err=Lobby.validate(r);if(err){UI.toast(err);return}
 const cfg=r.slots.map(s=>({kind:s.kind,name:s.name,grp:s.grp,diff:s.diff,link:s.link}));
 setupMatch(cfg,r.mode,r.seed);r.phase='game';
 const pp=publicPlayers(),mp=exportMap();
 players.forEach((pl,i)=>{if(pl&&pl.human&&pl.conn)pl.conn.send({t:'start',you:i,players:pp,map:mp,mode:r.mode})});
 if(Dir.pub)Dir.beat();
 UI.enterGame()};
Net.broadcastSnapshots=function(){
 for(let p=0;p<4;p++){const pl=players[p];if(!pl||!pl.human||!pl.conn)continue;
  if(pl.conn.buffered()>200000){pl.evq.length=0;continue}
  pl.conn.send(buildSnapshot(p));if(pl.evq.length){pl.conn.send({t:'ev',e:pl.evq});pl.evq=[]}}};
Net.sendOver=function(g){for(let p=0;p<4;p++){const pl=players[p];if(pl&&pl.human&&pl.conn)pl.conn.send({t:'over',g})}};
Net.toLobby=function(){const r=Net.room;if(!r)return;
 if(Net.role==='client'){return}
 running=false;stopTicker();over=false;r.phase='lobby';
 for(let i=1;i<4;i++){const s=r.slots[i];
  if(s.kind==='human'&&(!s.link||!s.link.open)){r.slots[i]={kind:'open',name:'',diff:1,grp:s.grp,link:null}}
  else if(s.kind==='closed'&&s.name){r.slots[i]={kind:'open',name:'',diff:1,grp:s.grp,link:null}}}
 if(r.vis==='solo')for(let i=1;i<4;i++)if(r.slots[i].kind==='open')r.slots[i].kind='ai';
 Lobby.norm(r);
 for(let i=1;i<4;i++){const s=r.slots[i];if(s.link)s.link.send({t:'toLobby'})}
 Net.pushLobby();UI.showLobby()};

/* 클라이언트: 입장 */
Net.joinRoom=async function(code,nick){
 Net.leave(true);
 if(!isCode(code))throw new Error('방 코드는 숫자 8자리입니다');
 await Libs.load();if(!Libs.peer)throw new Error('P2P 라이브러리를 불러오지 못했습니다. 네트워크를 확인하세요.');
 let link;try{link=await peerDial(code)}catch(e){throw new Error(e&&e.type==='peer-unavailable'?'해당 코드의 방을 찾을 수 없습니다':'방에 연결하지 못했습니다 ('+(e&&(e.type||e.message)||'오류')+')')}
 return await new Promise((resolve,reject)=>{let done=false;
  const t=setTimeout(()=>{if(!done){done=true;try{link.close()}catch(e){}reject(new Error('방장이 응답하지 않습니다'))}},10000);
  link.onclose=()=>{if(!done){done=true;clearTimeout(t);reject(new Error('연결이 끊어졌습니다'))}else Net._clientClosed()};
  link.onmessage=d=>{
   if(!done&&d&&d.t==='welcome'){done=true;clearTimeout(t);Net.link=link;Net.role='client';Net.you=d.you;Net.room=null;me=d.you;
    link.onmessage=Net._clientMsg;Net.beatT=setInterval(()=>link.send({t:'ping'}),4000);Net.watchT=setInterval(Net._clientWatch,3000);resolve(d)}
   else if(!done&&d&&d.t==='reject'){done=true;clearTimeout(t);try{link.close()}catch(e){}reject(new Error(d.m||'입장이 거부되었습니다'))}};
  link.send({t:'hello',v:CONFIG.protocol,name:cleanName(nick,'손님')})})};
Net.toHost=function(d){if(Net.link)Net.link.send(d)};
Net.sendCmd=function(c){if(Net.link)Net.link.send({t:'cmd',c})};
Net._clientWatch=function(){if(Net.role!=='client'||!Net.link)return;if(performance.now()-Net.link.lastMsg>15000)Net._clientClosed()};
Net._clientClosed=function(){if(Net.role!=='client')return;UI.goHome('방장과의 연결이 끊어졌습니다')};
Net._clientMsg=function(d){
 if(d instanceof ArrayBuffer){if(ROLE==='client'&&running)applySnapshot(d);return}
 if(!d||typeof d!=='object')return;
 switch(d.t){
 case'lobby':Net.room=d.r;Net.you=d.you;me=d.you;UI.refreshLobby();break;
 case'chat':UI.chat(d.s,d.n,d.m);break;
 case'note':if(d.m)msg(d.m);if(d.s)sfx(d.s);break;
 case'ev':if(running&&Array.isArray(d.e))for(const e of d.e)if(Array.isArray(e))applyEvent(e);break;
 case'start':Net._clientStart(d);break;
 case'elim':UI.onEliminated();break;
 case'over':over=true;UI.showEnd(d.g);break;
 case'kick':UI.goHome(d.m||'방에서 제외되었습니다');break;
 case'hostleft':UI.goHome('방장이 방을 닫았습니다');break;
 case'toLobby':running=false;over=false;ROLE='solo';UI.showLobby();break}};
Net._clientStart=function(d){
 for(let i=0;i<4;i++){const p=d.players&&d.players[i];players[i]=p?{slot:i,name:cleanName(p.name),grp:p.grp|0,human:!!p.human,hpMul:+p.hpMul||1,asym:p.asym|0,alive:true,spec:false}:null}
 me=d.you|0;curMode=d.mode;ROLE='client';
 importMap(d.map);clientReset();setViewer(me);
 for(let i=0;i<4;i++){res[i].ore=res[i].plasma=0;tech[i].weapons=tech[i].armor=tech[i].stim=0}
 stats={kills:0,lost:0,made:0,mined:0};SUP={cap:0,used:0};
 ft.fill(1);fa.fill(1);running=true;over=false;paused=false;UI.enterGame()};

/* 나가기 (방 닫기 / 방 나가기) */
Net.leave=function(silent){
 clearInterval(Net.beatT);clearInterval(Net.watchT);
 if(Net.role==='host'&&Net.room){for(let i=1;i<4;i++){const s=Net.room.slots[i];if(s.link){try{s.link.send({t:'hostleft'})}catch(e){}const l=s.link;setTimeout(()=>{try{l.close()}catch(e){}},300)}}Dir.unpublish()}
 if(Net.role==='client'&&Net.link){try{Net.link.send({t:'bye'})}catch(e){}const l=Net.link;setTimeout(()=>{try{l.close();l.peer&&l.peer.destroy()}catch(e){}},300)}
 if(Net.peer){const p=Net.peer;setTimeout(()=>{try{p.destroy()}catch(e){}},400);Net.peer=null}
 Net.link=null;Net.role='none';Net.room=null;running=false;stopTicker();ROLE='solo';over=false;
 for(let i=0;i<4;i++)players[i]=null};
