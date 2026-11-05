'use strict';
/* =====================================================================
   OpenRTS UI: 랜딩 · 방 만들기/찾기/입장 · 로비 · 게임 HUD 보조 · 종료 화면
   sim/net/render 가 호출하는 전역 `UI` 객체를 제공합니다.
   ===================================================================== */
const UI=(function(){
 const U={view:'home'};
 const store={get(k,d){try{return localStorage.getItem('orts.'+k)||d}catch(e){return d}},set(k,v){try{localStorage.setItem('orts.'+k,v)}catch(e){}}};
 const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};
 const VISN={public:'🌐 공개 방',private:'🔒 비밀 방',solo:'🖥 혼자 하기'};

 /* ---------- 화면 전환 ---------- */
 U.show=function(v){U.view=v;
  $('site').hidden=v!=='home';$('lobbyView').hidden=v!=='lobby';$('gameView').hidden=v!=='game';
  document.body.classList.toggle('ingame',v!=='home');
  if(v==='home')window.scrollTo(0,0)};

 let toastT=0;
 U.toast=function(t){let e=document.querySelector('.toast');if(!e){e=el('div','toast');e.setAttribute('role','status');document.body.appendChild(e)}
  e.textContent=t;clearTimeout(toastT);toastT=setTimeout(()=>e.remove(),4200)};

 /* ---------- 모달 ---------- */
 let openDlgId=null,browser=null;
 function openDlg(id){closeDlg();openDlgId=id;const d=$(id);d.hidden=false;const f=d.querySelector('input[type=text]');if(f)setTimeout(()=>f.focus(),30)}
 function closeDlg(){if(!openDlgId)return;$(openDlgId).hidden=true;openDlgId=null;if(browser){browser.stop();browser=null}}
 document.querySelectorAll('.modal').forEach(m=>m.addEventListener('mousedown',e=>{if(e.target===m)closeDlg()}));
 document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeDlg));
 addEventListener('keydown',e=>{if(e.key==='Escape'&&openDlgId)closeDlg()});

 const nickOf=id=>{const v=cleanName($(id).value,'');if(v)store.set('nick',v);return v||store.get('nick','')||'플레이어'+(100+Math.floor(Math.random()*900))};
 const loadNick=()=>{const n=store.get('nick','');['cNick','bNick','jNick'].forEach(i=>{if(!$(i).value)$(i).value=n})};

 /* ---------- 방 만들기 ---------- */
 const cMode=$('cMode');for(const k in MODES){const o=el('option',null,MODES[k].name);o.value=k;cMode.appendChild(o)}
 const lMode=$('lModeSel');for(const k in MODES){const o=el('option',null,MODES[k].name);o.value=k;lMode.appendChild(o)}
 const cDesc=()=>{$('cModeDesc').textContent=MODES[cMode.value].desc};cMode.addEventListener('change',cDesc);cDesc();
 let busy=false;
 async function guard(btn,errEl,fn){if(busy)return;busy=true;const old=btn.textContent;btn.disabled=true;btn.textContent='연결 중…';errEl.textContent='';
  try{await fn();closeDlg()}catch(e){errEl.textContent=e&&e.message||String(e)}finally{busy=false;btn.disabled=false;btn.textContent=old}}
 $('fCreate').addEventListener('submit',e=>{e.preventDefault();audio();
  const vis=document.querySelector('input[name=cVis]:checked').value,nick=nickOf('cNick');
  const name=cleanText($('cName').value,24)||(nick+'의 방');
  guard($('cGo'),$('cErr'),async()=>{await Net.createRoom({vis,name,mode:cMode.value,nick});U.showLobby()})});
 $('fJoin').addEventListener('submit',e=>{e.preventDefault();audio();
  const code=$('jCode').value.trim();
  guard($('jGo'),$('jErr'),async()=>{await Net.joinRoom(code,nickOf('jNick'));U.showLobby()})});
 $('jCode').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,8)});

 /* ---------- 공개 방 목록 ---------- */
 function openBrowse(){loadNick();openDlg('dlgBrowse');$('bStat').textContent='방 목록을 불러오는 중…';$('bErr').textContent='';$('bList').replaceChildren();
  browser=Dir.list(rooms=>{
   $('bStat').textContent=rooms.length?'공개 방 '+rooms.length+'개 (실시간 갱신)':'지금 열려 있는 공개 방이 없습니다. 직접 만들어 보세요!';
   const wrapEl=$('bList');
   if(!rooms.length){wrapEl.replaceChildren(el('div','empty','방이 없습니다'));return}
   const t=el('table','rooms'),hd=el('tr');['방 이름','모드','인원','상태',''].forEach(x=>hd.appendChild(el('th',null,x)));t.appendChild(hd);
   for(const r of rooms){const tr=el('tr');tr.appendChild(el('td',null,r.n));tr.appendChild(el('td',null,MODES[r.m].name));
    tr.appendChild(el('td',null,r.p+' / 4'));tr.appendChild(el('td',null,r.s?'진행 중':'대기 중'));
    const td=el('td'),b=el('button','btn sm pri','입장');b.disabled=!!r.s||r.p>=4;b.title=r.s?'이미 시작된 방':r.p>=4?'가득 참':'';
    b.addEventListener('click',()=>{audio();guard(b,$('bErr'),async()=>{await Net.joinRoom(r.c,nickOf('bNick'));U.showLobby()})});
    td.appendChild(b);tr.appendChild(td);t.appendChild(tr)}
   wrapEl.replaceChildren(t)},
   st=>{if(st==='error'){$('bStat').textContent='';$('bErr').textContent='방 목록 서버에 연결하지 못했습니다. 8자리 코드로 직접 입장하거나 잠시 후 다시 시도하세요.'}})}

 /* ---------- 랜딩 버튼 ---------- */
 document.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{audio();const a=b.dataset.act;loadNick();
  if(a==='create')openDlg('dlgCreate');
  else if(a==='browse')openBrowse();
  else if(a==='join'){$('jErr').textContent='';openDlg('dlgJoin')}
  else if(a==='quick'){const nick=store.get('nick','')||'사령관';
   Net.createRoom({vis:'solo',name:'싱글',mode:'ffa',nick}).then(()=>{Net.startGame()}).catch(e=>U.toast(e.message))}}));

 /* ---------- 로비 ---------- */
 const isHost=()=>Net.role==='host';
 U.showLobby=function(){U.show('lobby');$('gchat').replaceChildren();U.refreshLobby()};
 function teamBtn(r,i,s,host){
  if(r.mode==='ffa')return null;
  if(r.mode==='aivh'){return el('span','pill',s.grp?'AI 팀':'인간 팀')}
  const b=el('button','tm t'+(s.grp?1:0),(s.grp?'B':'A')+'팀');b.dataset.team=i;b.disabled=!host;b.title=host?'클릭하면 팀 변경':'';return b}
 U.refreshLobby=function(){
  const r=Net.room,host=isHost();
  if(!r){$('lName').textContent='방에 연결됨 — 방 정보를 받는 중…';$('lSlots').replaceChildren();return}
  $('lName').textContent=r.name;$('lVis').textContent=VISN[r.vis]||'';$('lMode').textContent=MODES[r.mode]?MODES[r.mode].name:'';
  const code=$('lCode');code.hidden=!r.code;if(r.code)code.textContent=r.code;
  const box=$('lSlots');box.replaceChildren();
  r.slots.forEach((s,i)=>{
   const row=el('div','slot'+(i===Net.you?' me':'')),dot=el('span','dot');dot.style.background=TC[i];dot.style.color=TC[i];
   const mid=el('div'),nm=el('div','nm'),sub=el('div','sub'),ctl=el('div','ctl');
   if(s.kind==='human'){nm.textContent=s.name+(i===Net.you?' (나)':'');sub.textContent=(i===0?'방장 · ':'')+'플레이어 · '+TCN[i]}
   else if(s.kind==='ai'){nm.textContent='🤖 '+s.name;sub.textContent='인공지능 · '+TCN[i];
    const g=el('span','dsg');for(let d=0;d<3;d++){const b=el('button',d===s.diff?'on':'',DIFFN[d]);b.dataset.diff=d;b.dataset.slot=i;b.disabled=!host;g.appendChild(b)}ctl.appendChild(g)}
   else if(s.kind==='open'){nm.textContent='열린 자리';nm.style.color='var(--dim)';sub.textContent='플레이어를 기다리는 중…'}
   else{nm.textContent='닫힘';nm.style.color='var(--dim)';sub.textContent='사용하지 않는 슬롯'}
   const tb=(s.kind!=='closed'&&s.kind!=='open'||(s.kind==='open'&&r.mode!=='ffa'))?teamBtn(r,i,s,host):null;if(tb)ctl.appendChild(tb);
   if(host&&i>0){
    if(s.kind==='human'){const b=el('button','btn sm danger','내보내기');b.dataset.kick=i;ctl.appendChild(b)}
    else{const sel=el('select');sel.dataset.kind=i;sel.setAttribute('aria-label',(i+1)+'번 슬롯 종류');
     const opts=r.vis==='solo'?[['ai','AI'],['closed','닫기']]:[['open','사람 대기'],['ai','AI'],['closed','닫기']];
     for(const[v,t]of opts){const o=el('option',null,t);o.value=v;if(v===s.kind)o.selected=true;sel.appendChild(o)}ctl.appendChild(sel)}}
   mid.append(nm,sub);row.append(dot,mid,ctl);box.appendChild(row)});
  lMode.value=r.mode;lMode.disabled=!host;$('lModeDesc').textContent=MODES[r.mode]?MODES[r.mode].desc:'';
  const seed=$('lSeed');seed.disabled=!host;if(document.activeElement!==seed)seed.value=r.seed||'';
  const st=$('lStart');st.hidden=!host;
  let w='';if(host){w=Lobby.validate(r);
   if(!w&&r.mode==='asym'){const a=Lobby.active(r),n0=a.filter(s=>!s.grp).length,n1=a.length-n0;if(n0===n1)w='팀 인원이 같아 보너스가 적용되지 않습니다 (비대칭 팀전은 인원이 다를 때 의미가 있습니다)'}}
  else w='방장이 게임을 시작하기를 기다리는 중…';
  $('lWarn').textContent=w;st.disabled=host&&!!Lobby.validate(r);
  $('lLeave').textContent=host&&r.vis!=='solo'?'방 닫기':'나가기'};
 $('lSlots').addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
  if(t.dataset.team!=null)Net.toggleGrp(+t.dataset.team);
  else if(t.dataset.diff!=null)Net.setSlot(+t.dataset.slot,'ai',+t.dataset.diff);
  else if(t.dataset.kick!=null)Net.kickSlot(+t.dataset.kick)});
 $('lSlots').addEventListener('change',e=>{const s=e.target.closest('select');if(s&&s.dataset.kind!=null)Net.setSlot(+s.dataset.kind,s.value)});
 lMode.addEventListener('change',()=>Net.setMode(lMode.value));
 $('lSeed').addEventListener('change',e=>Net.setSeed(e.target.value));
 $('lStart').addEventListener('click',()=>{audio();Net.startGame()});
 $('lLeave').addEventListener('click',()=>U.goHome());
 $('lCode').addEventListener('click',()=>{const r=Net.room;if(!r||!r.code)return;const link=location.origin+location.pathname+'#join='+r.code;
  const done=()=>U.toast('초대 링크를 복사했습니다 (코드 '+r.code+')');
  try{navigator.clipboard.writeText(link).then(done,()=>U.toast('코드: '+r.code))}catch(e){U.toast('코드: '+r.code)}});

 /* ---------- 채팅 ---------- */
 const chatLine=(slot,name,text)=>{const d=el('div',slot<0?'sys':'');
  if(slot>=0){const n=el('b',null,name+': ');n.style.color=TC[slot]||'#fff';d.appendChild(n)}d.appendChild(document.createTextNode(text));return d};
 U.chat=function(slot,name,text){
  const log=$('lLog');log.appendChild(chatLine(slot,name,text));while(log.childNodes.length>80)log.firstChild.remove();log.scrollTop=log.scrollHeight;
  if(U.view==='game'){const g=$('gchat'),d=chatLine(slot,name,text);g.appendChild(d);while(g.childNodes.length>6)g.firstChild.remove();setTimeout(()=>d.remove(),9000)}};
 $('lChatF').addEventListener('submit',e=>{e.preventDefault();const i=$('lChatIn'),t=i.value.trim();i.value='';if(t&&Net.room)Net.chat(Net.you,t)});
 U.openChat=function(){const f=$('gchatIn');f.hidden=false;$('gchatTxt').value='';$('gchatTxt').focus()};
 $('gchatIn').addEventListener('submit',e=>{e.preventDefault();const i=$('gchatTxt'),t=i.value.trim();i.value='';$('gchatIn').hidden=true;i.blur();if(t&&Net.room)Net.chat(Net.you,t)});
 $('gchatTxt').addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){$('gchatIn').hidden=true;e.target.blur()}});

 /* ---------- 게임 진입 / 플레이어 목록 / 메뉴 ---------- */
 U.enterGame=function(){U.show('game');$('end').hidden=true;$('menu').hidden=true;$('gchatIn').hidden=true;lastP='';
  const online=Net.role==='client'||Net.room&&Net.room.vis!=='solo';
  resize();
  if(ROLE!=='client'){const hq=blds.find(b=>b.team===me&&b.type==='hq');if(hq){cam.x=hq.x-W/2;cam.y=hq.y-H/2+60;sel=[hq]}}
  updateUI(true);msg(online?'온라인 대전 시작! 채팅: Enter':'게임 시작')};
 let lastP='';
 U.refreshPlayers=function(){const box=$('plist');if(!box)return;
  const sig=players.map(p=>p?p.name+p.alive+p.grp:'').join('|')+curMode;if(sig===lastP)return;lastP=sig;
  box.replaceChildren();
  players.forEach((p,i)=>{if(!p)return;const d=el('div',p.alive?'':'x');const dot=el('span',null,'● ');dot.style.color=TC[i];
   d.append(dot,document.createTextNode(p.name+(p.ai?' 🤖':'')+(i===me?' (나)':'')+(curMode==='team'||curMode==='asym'?' ['+(p.grp?'B':'A')+']':'')));box.appendChild(d)})};
 U.toggleMenu=function(){const m=$('menu');m.hidden=!m.hidden};
 $('mResume').addEventListener('click',()=>{$('menu').hidden=true});
 $('mLeave').addEventListener('click',()=>{
  if(Net.role==='host'&&Net.room&&Net.room.vis!=='solo'&&!confirm('방장이 나가면 방이 닫히고 모든 참가자가 퇴장됩니다. 나갈까요?'))return;
  U.goHome()});
 U.onEliminated=function(){U.toast('기지가 모두 파괴되었습니다 — 관전 중입니다');msg('탈락 — 관전 중')};

 /* ---------- 종료 화면 ---------- */
 U.showEnd=function(g){
  const pl=players[me],win=g>=0&&pl&&pl.grp===g;
  $('endT').textContent=g<0?'무승부':win?'승리!':'패배';$('endT').style.color=win?'#ffd87a':g<0?'#fff':'#ff8a7a';
  const m=gt/60|0,s=gt%60|0,host=Net.role!=='client';
  $('endS').textContent='경기 시간 '+m+'분 '+s+'초'+(host?' · 처치 '+stats.kills+' · 손실 '+stats.lost+' · 생산 '+stats.made+' · 채굴 '+Math.round(stats.mined):'');
  $('endLobby').hidden=!host;$('end').hidden=false;$('menu').hidden=true;
  if(!host)$('endS').textContent+=' — 방장이 방으로 이동시키면 자동으로 로비로 돌아갑니다'};
 $('endLobby').addEventListener('click',()=>{Net.toLobby()});
 $('endHome').addEventListener('click',()=>U.goHome());

 /* ---------- 홈으로 ---------- */
 U.goHome=function(note){const wasOnline=Net.role!=='none';Net.leave(true);running=false;over=false;
  $('end').hidden=true;$('menu').hidden=true;$('gchatIn').hidden=true;$('lLog').replaceChildren();U.show('home');if(note)U.toast(note);void wasOnline};

 /* ---------- 초대 링크 (#join=12345678) ---------- */
 function readHash(){const m=/^#join=(\d{8})$/.exec(location.hash);if(!m||U.view!=='home')return;loadNick();$('jCode').value=m[1];$('jErr').textContent='';openDlg('dlgJoin');setTimeout(()=>$('jNick').focus(),40);
  try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}}
 addEventListener('hashchange',readHash);
 addEventListener('pagehide',()=>{try{Net.leave(true)}catch(e){}});

 /* ---------- 히어로 배경 (가벼운 육각 격자 + 별) ---------- */
 (function(){const c=$('heroBg');if(!c)return;const x=c.getContext('2d');let w=0,h=0,t=0,run=true;
  const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pts=Array.from({length:60},()=>({x:Math.random(),y:Math.random(),s:Math.random()*.6+.2,r:Math.random()*1.6+.4}));
  function size(){const b=c.getBoundingClientRect();w=c.width=b.width|0;h=c.height=b.height|0}
  function draw(){if(!run)return;t+=.004;x.clearRect(0,0,w,h);
   x.strokeStyle='rgba(62,166,255,.10)';x.lineWidth=1;const R=46,hh=R*.866;
   for(let j=-1;j<h/hh+1;j++)for(let i=-1;i<w/(R*1.5)+1;i++){const cx=i*R*1.5,cy=j*hh*2+(i&1?hh:0);x.beginPath();for(let k=0;k<6;k++){const a=Math.PI/3*k;x.lineTo(cx+R*.5*Math.cos(a),cy+R*.5*Math.sin(a))}x.closePath();x.stroke()}
   for(const p of pts){const px=(p.x*w+t*p.s*120)%w,py=p.y*h;x.fillStyle='rgba(160,215,255,'+(.25+.35*Math.sin(t*6+p.x*20))+')';x.beginPath();x.arc(px,py,p.r,0,7);x.fill()}
   if(!reduce)requestAnimationFrame(draw)}
  size();addEventListener('resize',size);draw();
  new IntersectionObserver(es=>{const v=es[0].isIntersecting;if(v&&!run){run=true;draw()}else if(!v)run=false}).observe(c)})();

 $('ver').textContent=CONFIG.version;
 loadNick();readHash();
 return U})();
