'use strict';
/* OpenRTS 통합 테스트 (Playwright + 가짜 P2P).  실행:  node tests/run.js
   - 정적 서버를 직접 띄우고, 여러 탭을 한 브라우저 컨텍스트에 열어 BroadcastChannel 로 서로 연결합니다.
   - 실제 PeerJS/MQTT 의 네트워크 경로는 검증하지 않습니다 (tests/mock-p2p.js 참고). */
const path=require('path'),fs=require('fs'),http=require('http');
let chromium;try{({chromium}=require('playwright'))}catch(e){({chromium}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright'))}
const root=path.resolve(__dirname,'..'),PORT=+process.env.PORT||8191;
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.png':'image/png','.json':'application/json','.webmanifest':'application/json'};
const server=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(root,p);
 fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);return s.end()}s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});s.end(d)})});
let pass=0,fail=0;const errs=[];
function ok(c,msg){if(c){pass++;console.log('  ✓ '+msg)}else{fail++;console.log('  ✗ '+msg)}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(PORT,r));
 const browser=await chromium.launch();
 const ctx=await browser.newContext({viewport:{width:1100,height:700}});
 await ctx.addInitScript({path:path.join(__dirname,'mock-p2p.js')});
 const mk=async name=>{const p=await ctx.newPage();p.on('pageerror',e=>errs.push(name+' PAGEERR '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(name+' CONSOLE '+m.text())});await p.goto(`http://localhost:${PORT}/`);return p};
 const H=await mk('H'),A=await mk('A'),B=await mk('B');

 console.log('\n[1] 방 만들기 · 공개 방 목록 · 코드 입장');
 await H.click('.cta [data-act=create]');await H.fill('#cName','테스트 방');await H.fill('#cNick','방장');
 await H.selectOption('#cMode','team');await H.click('#fCreate button[type=submit]');
 await H.waitForFunction(()=>UI.view==='lobby'&&Net.room&&Net.room.code);
 const code=await H.evaluate(()=>Net.room.code);
 ok(/^\d{8}$/.test(code),'8자리 숫자 코드 생성: '+code);
 await sleep(600);
 await A.click('.cta [data-act=browse]');await A.fill('#bNick','손님A');
 await A.waitForSelector('#bList table.rooms tr:nth-child(2)',{timeout:8000});
 ok((await A.textContent('#bList')).includes('테스트 방'),'공개 방이 목록에 표시됨');
 await A.click('#bList button.btn');await A.waitForFunction(()=>UI.view==='lobby'&&Net.room);
 ok(await A.evaluate(()=>Net.role==='client'&&Net.you===1),'목록에서 입장 → 슬롯 1');
 await B.click('.cta [data-act=join]');await B.fill('#jCode',code);await B.fill('#jNick','손님B');await B.click('#fJoin button[type=submit]');
 await B.waitForFunction(()=>UI.view==='lobby'&&Net.room);
 ok(await B.evaluate(()=>Net.you===2),'코드로 입장 → 슬롯 2');
 await H.waitForFunction(()=>Net.room.slots.filter(s=>s.kind==='human').length===3);
 ok(true,'호스트 로비에 사람 3명');

 console.log('\n[2] 로비: 슬롯별 AI 난이도 · 팀 · 동기화');
 await H.selectOption('#lSlots select[data-kind="3"]','ai');
 await H.click('#lSlots button[data-slot="3"][data-diff="2"]');
 await A.waitForFunction(()=>Net.room.slots[3].kind==='ai'&&Net.room.slots[3].diff===2);
 ok(true,'슬롯 3 = AI 어려움, 클라이언트 로비에 반영');
 ok(await A.evaluate(()=>document.querySelector('#lStart').hidden&&document.querySelector('#lModeSel').disabled),'클라이언트는 시작/모드 변경 불가');
 await A.evaluate(()=>Net.setMode('ffa'));await sleep(200);
 ok(await H.evaluate(()=>Net.room.mode==='team'),'클라이언트의 모드 변경 시도는 무시됨');
 ok(await H.evaluate(()=>Lobby.validate(Net.room)===''),'시작 조건 충족 (A팀: 방장+B / B팀: 손님A+AI)');

 console.log('\n[3] 게임 시작 · 안개 필터 스냅샷');
 await H.click('#lStart');
 for(const p of[H,A,B])await p.waitForFunction(()=>UI.view==='game'&&running&&units.length>0,null,{timeout:10000});
 await sleep(1500);
 const hs=await H.evaluate(()=>({n:units.length,ids:units.map(u=>u.id),teams:[...new Set(units.map(u=>u.team))],mode:curMode,hp:players.map(p=>p&&p.hpMul)}));
 const as=await A.evaluate(()=>({me,role:ROLE,ids:units.map(u=>u.id),teams:[...new Set(units.map(u=>u.team))],blds:blds.map(b=>b.team+b.type),cam:cam.x|0}));
 const bs=await B.evaluate(()=>({me,ids:units.map(u=>u.id),teams:[...new Set(units.map(u=>u.team))],blds:blds.map(b=>b.team+b.type)}));
 ok(hs.n===16,'호스트는 유닛 16기 보유 (4명×4)');
 ok(as.role==='client'&&as.me===1,'클라이언트 역할/슬롯');
 ok(as.ids.every(i=>hs.ids.includes(i)),'클라이언트 유닛은 모두 호스트에 존재');
 ok(!as.teams.includes(0)&&!as.teams.includes(2),'A(B팀): 안개 속 적 유닛은 전송되지 않음 (보이는 팀: '+as.teams+')');
 ok(as.ids.length===8,'A: 자기 4기 + 동맹(AI) 4기만 수신 (시야 공유)');
 ok(!bs.teams.includes(1)&&!bs.teams.includes(3)&&bs.teams.includes(2),'B(A팀): 적은 안 보이고 자기/동맹 유닛만 수신 ('+bs.teams+')');
 ok(!as.blds.includes('0hq')&&as.blds.includes('1hq'),'A: 적 사령부는 안 보임, 자기 사령부는 보임');
 ok(bs.blds.includes('2hq'),'B: 자기 사령부');
 ok(as.cam>-500,'클라이언트 카메라가 기지로 이동');

 console.log('\n[4] 클라이언트 명령 → 호스트 실행');
 const mv=await A.evaluate(()=>{const w=units.filter(u=>u.team===me&&u.type==='worker').map(u=>u.id);sendCmd({c:'order',o:'move',ids:w,x:300,y:2200});return w});
 await sleep(1500);
 const mo=await H.evaluate(ids=>ids.map(i=>{const u=emap.get(i);return u&&u.o.t}),mv);
 ok(mo.every(t=>t==='move'||t==='idle'),'이동 명령이 호스트에서 실행됨: '+mo.join(','));
 const q0=await H.evaluate(()=>{const h=blds.find(b=>b.team===1&&b.type==='hq');return{id:h.id,ore:res[1].ore}});
 await A.evaluate(id=>sendCmd({c:'train',bid:id,item:'worker'}),q0.id);await sleep(800);
 ok(await H.evaluate(id=>emap.get(id).q.length>0,q0.id),'생산 명령 → 호스트 큐에 반영');
 await A.waitForFunction(()=>blds.find(b=>b.team===me&&b.type==='hq').q.length>0,null,{timeout:5000});
 ok(true,'클라이언트 스냅샷에 큐가 되돌아옴');
 const ore=await A.evaluate(()=>res[me].ore|0);ok(ore<300+10&&ore>=0,'클라이언트 자원 표시 갱신: '+ore);

 console.log('\n[5] 호스트 검증 (치팅 시도)');
 const hostUnit=hs.ids[0];
 const before=await H.evaluate(id=>{const u=emap.get(id);return{x:u.x,y:u.y,t:u.o.t,team:u.team}},hostUnit);
 await A.evaluate(id=>{Net.sendCmd({c:'order',o:'move',ids:[id],x:100,y:100})},hostUnit);
 await A.evaluate(()=>{Net.sendCmd({c:'train',bid:0,item:'worker'});Net.sendCmd({c:'nuke'});Net.sendCmd({c:5});Net.link.send('garbage');Net.link.send({t:'cmd'});Net.link.send(new ArrayBuffer(10))});
 await sleep(600);
 const after=await H.evaluate(id=>{const u=emap.get(id);return{t:u.o.t,x:u.x,y:u.y}},hostUnit);
 ok(before.team!==1&&after.t===before.t||after.t==='idle'||after.t==='gather','남의 유닛 이동 명령 거부 (order='+after.t+')');
 const strikes=await H.evaluate(()=>players[1].strikes.length);ok(strikes>=2,'부정 요청이 strike 로 기록됨: '+strikes);
 const nb=await H.evaluate(()=>blds.filter(b=>b.team===1).length);
 await A.evaluate(()=>{const w=units.filter(u=>u.team===me&&u.type==='worker').map(u=>u.id);
  sendCmd({c:'place',type:'turret',tx:70,ty:10,ids:w});          // 탐색 안 된 먼 곳
  sendCmd({c:'place',type:'airfield',tx:12,ty:60,ids:w});       // 요구 건물/자원 부족
  sendCmd({c:'place',type:'gen',tx:1.5,ty:'x',ids:w});sendCmd({c:'place',type:'../evil',tx:1,ty:1,ids:w})});
 await sleep(800);
 ok(await H.evaluate(n=>blds.filter(b=>b.team===1).length===n,nb),'탐색하지 않은 곳/조건 불충족/잘못된 형식의 건설 거부');
 const hres=await H.evaluate(()=>res[1].ore);
 await A.evaluate(()=>{res[me].ore=99999;res[me].plasma=99999;sendCmd({c:'train',bid:blds.find(b=>b.team===me&&b.type==='hq').id,item:'worker'})});
 await sleep(500);
 ok(await H.evaluate(()=>res[1].ore<5000),'클라이언트가 로컬 자원을 조작해도 호스트 자원은 그대로 ('+(await H.evaluate(()=>res[1].ore|0))+')');
 console.log('  … 명령 폭주(flood) 시도');
 await A.evaluate(()=>{for(let i=0;i<600;i++)Net.sendCmd({c:'order',o:'move',ids:[1],x:1,y:1})});
 await A.waitForFunction(()=>UI.view==='home',null,{timeout:12000}).catch(()=>{});
 ok(await A.evaluate(()=>UI.view==='home'),'폭주/부정 요청 반복 시 호스트가 강제 퇴장시킴');
 ok(await H.evaluate(()=>players[1].conn===null||players[1].ai===true||Net.room.slots[1].kind!=='human'),'호스트 상태에서도 슬롯 정리됨');

 console.log('\n[6] 연결 끊김 → AI 인계');
 await B.close();await sleep(800);
 ok(await H.evaluate(()=>players[2].ai===true&&players[2].human===false),'B 이탈 후 해당 플레이어를 AI 가 이어받음');

 console.log('\n[7] 종료 → 로비 복귀');
 await H.evaluate(()=>{for(const b of blds.slice())if(b.team===1||b.team===3){kill(b,null)}});
 await H.waitForFunction(()=>over===true,null,{timeout:8000});
 ok(await H.evaluate(()=>!$('end').hidden&&$('endT').textContent==='승리!'),'호스트: 승리 화면 표시');
 await H.click('#endLobby');await H.waitForFunction(()=>UI.view==='lobby'&&Net.room.phase==='lobby');
 ok(true,'호스트: 로비로 복귀');

 console.log('\n[8] 비밀 방');
 const S=await mk('S'),J=await mk('J');
 await S.click('.cta [data-act=create]');await S.fill('#cNick','비밀장');await S.click('input[name=cVis][value=private] + span');await S.click('#fCreate button[type=submit]');
 await S.waitForFunction(()=>UI.view==='lobby'&&Net.room&&Net.room.code);
 const scode=await S.evaluate(()=>Net.room.code);await sleep(500);
 ok(!(await J.evaluate(()=>localStorage.getItem('mock-retained')||'')).includes(scode),'비밀 방은 목록(브로커)에 게시되지 않음');
 await J.click('.cta [data-act=join]');await J.fill('#jCode',scode==='00000000'?'11111111':'00000000');await J.click('#fJoin button[type=submit]');
 await J.waitForFunction(()=>document.querySelector('#jErr').textContent.length>0);
 ok((await J.textContent('#jErr')).includes('찾을 수 없'),'잘못된 코드 → 오류 안내');
 await J.fill('#jCode',scode);await J.click('#fJoin button[type=submit]');
 await J.waitForFunction(()=>UI.view==='lobby'&&Net.room);ok(true,'올바른 8자리 코드로 입장');
 await J.evaluate(()=>Net.leave());await S.evaluate(()=>UI.goHome());

 console.log('\n[9] 게임 모드 규칙 (솔로 시뮬레이션)');
 const M=await mk('M');
 const res2=await M.evaluate(()=>{const out={};
  const run=(mode,slots)=>{setupMatch(slots,mode,'t');const r=players.map(p=>p&&{grp:p.grp,asym:p.asym,hp:+p.hpMul.toFixed(2),ore:res[p.slot].ore,ai:p.ai,diff:p.diff});running=false;stopTicker();return r};
  const S=(kind,grp,diff)=>({kind,name:'x',grp,diff:diff==null?1:diff,link:null});
  out.ffa=run('ffa',[S('human',0),S('ai',1,0),S('ai',2,1),S('ai',3,2)]);
  out.team=run('team',[S('human',0),S('ai',1),S('human',0),S('ai',1)]);
  out.asym=run('asym',[S('human',0),S('ai',1),S('ai',1),S('ai',1)]);
  out.aivh=run('aivh',[S('human',0),S('human',0),S('ai',1,2),S('closed',1)]);
  return out});
 ok(res2.ffa.every(p=>p.asym===0)&&new Set(res2.ffa.map(p=>p.grp)).size===4,'개인전: 4명 모두 다른 그룹, 보너스 없음');
 ok(res2.ffa.slice(1).map(p=>p.diff).join()==='0,1,2','AI 난이도가 슬롯별로 다르게 적용됨 (쉬움·보통·어려움)');
 ok(res2.team.every(p=>p.asym===0),'팀전: 2 대 2, 보너스 없음');
 ok(res2.asym[0].asym===2&&res2.asym[0].hp>1.3&&res2.asym[0].ore>300&&res2.asym[1].asym===0,'비대칭 팀전: 1 대 3 에서 1인 쪽만 보너스 ('+JSON.stringify(res2.asym[0])+')');
 ok(res2.aivh[0].grp===0&&res2.aivh[2].grp===1&&res2.aivh[2].ai,'AI 대 인간: 인간 팀 vs AI 팀');

 console.log('\n[10] 사이트/SEO 정적 검사');
 const seo=await M.evaluate(()=>({t:document.title,d:document.querySelector('meta[name=description]').content,og:!!document.querySelector('meta[property="og:image"]'),h1:document.querySelectorAll('h1').length,icons:[...document.querySelectorAll('link[rel*=icon]')].length,ld:[...document.querySelectorAll('script[type="application/ld+json"]')].every(s=>{try{JSON.parse(s.textContent.replace(/__SITE_URL__/g,'https://x'));return true}catch(e){return false}}),lang:document.documentElement.lang}));
 ok(seo.t.includes('OpenRTS')&&seo.d.length>60&&seo.og&&seo.icons>=3&&seo.ld&&seo.lang==='ko','제목·설명·OG·파비콘·JSON-LD 존재');
 ok(!/스타크래프트|starcraft|blizzard/i.test(fs.readFileSync(path.join(root,'index.html'),'utf8')),'페이지 텍스트에 상표명 없음');

 console.log('\n페이지 오류:',errs.length?'\n'+errs.slice(0,10).join('\n'):'없음');
 console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
 await browser.close();server.close();process.exit(fail||errs.length?1:0);
})().catch(e=>{console.error('테스트 실행 오류',e);process.exit(2)});
