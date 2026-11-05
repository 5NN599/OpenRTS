'use strict';
/* ===== OpenRTS core: 유틸, 데이터 정의, 플레이어/동맹, 합성 사운드/음악 ===== */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
let seed=(Math.random()*1e9)|0;
function rnd(){seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h|0}
const TS=32,MW=80,MH=80,WW=MW*TS,WH=MH*TS;
const EH=22;      // 고도 1단계당 화면 픽셀
const AIRH=46;    // 공중 유닛 비행 높이
const TC=['#3ea6ff','#ff5545','#52d67a','#ffc83d'];   // 플레이어 슬롯 색
const TCN=['파랑','빨강','초록','노랑'];

/* ---------- 플레이어 / 동맹 ---------- */
let me=0;                                   // 이 화면의 플레이어 슬롯
const players=[null,null,null,null];        // 게임 중 플레이어 정보 (슬롯 인덱스 = 플레이어 번호)
function ally(a,b){const A=players[a],B=players[b];return !!A&&!!B&&A.grp===B.grp}
function isEnemy(a,b){return a!==b&&!ally(a,b)}
const res=[{ore:0,plasma:0},{ore:0,plasma:0},{ore:0,plasma:0},{ore:0,plasma:0}];
const tech=[0,1,2,3].map(()=>({weapons:0,armor:0,stim:0}));

/* ---------- 데이터 ---------- */
const UD={
 worker:{name:'일꾼',hp:40,speed:95,r:9,sight:220,cost:[50,0],time:10,supply:1,dmg:4,range:22,cd:1,by:'hq',sym:'일',armor:0,bio:true},
 soldier:{name:'보병',hp:60,speed:100,r:9,sight:260,cost:[50,0],time:12,supply:1,dmg:7,range:130,cd:.6,by:'barracks',sym:'보',aa:true,bio:true,armor:0},
 medic:{name:'의무병',hp:55,speed:104,r:9,sight:240,cost:[75,25],time:14,supply:1,by:'barracks',req:'lab',sym:'의',bio:true,armor:0,heal:12,hrange:95},
 rocket:{name:'로켓병',hp:75,speed:88,r:10,sight:280,cost:[100,25],time:18,supply:2,dmg:20,range:175,cd:1.5,by:'barracks',req:'barracks',sym:'로',aa:true,armor:1,bio:true},
 walker:{name:'기갑워커',hp:260,speed:70,r:15,sight:290,cost:[150,75],time:28,supply:3,dmg:28,range:150,cd:1.6,splash:42,by:'foundry',req:'foundry',sym:'워',armor:3},
 wasp:{name:'말벌',hp:90,speed:150,r:11,sight:330,cost:[120,60],time:22,supply:2,dmg:9,range:140,cd:.8,by:'airfield',req:'airfield',sym:'말',air:true,aa:true,armor:0}
};
const BD={
 hq:{name:'사령부',hp:1000,w:4,h:4,cost:[400,0],time:60,sight:300,supply:10,hot:'H',hgt:42,armor:2},
 gen:{name:'발전기',hp:350,w:2,h:2,cost:[100,0],time:20,sight:200,supply:8,hot:'G',hgt:22,armor:1},
 barracks:{name:'병영',hp:600,w:3,h:3,cost:[150,0],time:35,sight:230,hot:'B',hgt:30,armor:1},
 foundry:{name:'공장',hp:700,w:3,h:3,cost:[150,50],time:40,sight:230,req:'barracks',hot:'F',hgt:36,armor:1},
 lab:{name:'연구소',hp:500,w:3,h:3,cost:[150,100],time:35,sight:230,req:'barracks',hot:'L',hgt:28,armor:1},
 airfield:{name:'비행장',hp:600,w:3,h:3,cost:[150,100],time:40,sight:230,req:'foundry',hot:'D',hgt:20,armor:1},
 refinery:{name:'정제소',hp:450,w:2,h:2,cost:[75,0],time:25,sight:200,hot:'R',hgt:22,armor:1},
 turret:{name:'포탑',hp:300,w:2,h:2,cost:[100,0],time:25,sight:300,req:'barracks',hot:'T',hgt:16,armor:1,dmg:12,range:190,cd:.8,aa:true}
};
const RD={
 weapons:{name:'무기 강화',max:3,time:40,cost:l=>[100*(l+1),50*(l+1)],sym:'무'},
 armor:{name:'방어 강화',max:3,time:40,cost:l=>[100*(l+1),50*(l+1)],sym:'방'},
 stim:{name:'자극제',max:1,time:30,cost:l=>[100,100],sym:'자'}
};
const UT=Object.keys(UD),BT=Object.keys(BD),RK=Object.keys(RD);   // 네트워크 인덱스용
function qDef(t){
 if(t.charAt(1)===':'){const p=t.split(':'),r=RD[p[1]],lv=+p[2];return{name:r.name,time:r.time,cost:r.cost(lv-1),supply:0,sym:r.sym,res:true}}
 const d=UD[t];return{name:d.name,time:d.time,cost:d.cost,supply:d.supply,sym:d.sym,req:d.req}}
function canHit(s,t){if(!s.d.dmg)return false;return t.d.air?!!s.d.aa:true}

/* ---------- 게임 방식 ---------- */
const MODES={
 ffa:{name:'개인전',desc:'모두가 서로의 적입니다. 마지막까지 살아남으세요.'},
 team:{name:'팀전',desc:'A팀 대 B팀. 슬롯마다 팀을 정할 수 있습니다.'},
 asym:{name:'비대칭 팀전',desc:'인원이 다른 두 팀의 대결. 수가 적은 팀은 자원·체력·인구 보너스를 받습니다.'},
 aivh:{name:'인공지능 대 인간',desc:'사람 플레이어들이 한 팀이 되어 인공지능 팀과 싸웁니다.'}
};
const DIFFN=['쉬움','보통','어려움'];

/* ---------- 사운드 (전부 웹오디오로 합성 — 원작 사운드 미사용) ---------- */
let AC=null,master=null,muted=false,musicOn=true,nbuf=null,mStep=0,mTimer=null;
function audio(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();master=AC.createGain();master.gain.value=.5;master.connect(AC.destination);
 nbuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=nbuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}catch(e){AC=null}}
 if(AC&&AC.state==='suspended')AC.resume();return AC}
function tone(f,d,type,v,f2,when){if(muted||!AC)return;const t=AC.currentTime+(when||0);const o=AC.createOscillator(),g=AC.createGain();o.type=type||'square';o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+d);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(master);o.start(t);o.stop(t+d+.03)}
function noise(d,v,fq,when){if(muted||!AC)return;const t=AC.currentTime+(when||0);const s=AC.createBufferSource();s.buffer=nbuf;const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(fq,t);f.frequency.exponentialRampToValueAtTime(Math.max(60,fq*.2),t+d);const g=AC.createGain();g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);s.connect(f);f.connect(g);g.connect(master);s.start(t,rnd()*.5);s.stop(t+d+.03)}
const lastS={};
function sfx(n,x,y){if(muted||!AC)return;const now=performance.now();if(now-(lastS[n]||0)<45)return;lastS[n]=now;let v=1;
 if(x!==undefined){v=clamp(1-Math.hypot(x-(cam.x+W/2),y-(cam.y+H/2))/1500,0,1);if(v<.06)return}
 switch(n){
 case'rifle':noise(.07,.14*v,3500);tone(900,.06,'square',.04*v,300);break;
 case'rocket':noise(.28,.16*v,1200);tone(320,.25,'sawtooth',.05*v,80);break;
 case'cannon':tone(150,.32,'sawtooth',.13*v,40);noise(.3,.16*v,700);break;
 case'turret':tone(650,.1,'triangle',.08*v,200);noise(.08,.1*v,3000);break;
 case'laser':tone(1400,.12,'sawtooth',.05*v,500);break;
 case'boom':noise(.6,.28*v,500);tone(90,.45,'sine',.2*v,30);break;
 case'boomS':noise(.22,.13*v,1000);tone(170,.15,'sine',.1*v,60);break;
 case'click':tone(1200,.04,'square',.04);break;
 case'ack':tone(520,.05,'triangle',.07);tone(780,.06,'triangle',.07,0,.05);break;
 case'done':tone(523,.12,'triangle',.1);tone(659,.12,'triangle',.1,0,.12);tone(784,.22,'triangle',.12,0,.24);break;
 case'ready':tone(440,.08,'sine',.09);tone(660,.1,'sine',.09,0,.08);break;
 case'alert':tone(880,.12,'square',.07);tone(880,.12,'square',.07,0,.18);break;
 case'err':tone(180,.16,'square',.08);break;
 case'mine':tone(1000,.03,'sine',.025);break;
 case'heal':tone(900,.12,'sine',.03*v,1300);break;
 case'stim':tone(300,.25,'sawtooth',.07,900);break;
 case'research':[440,554,659,880].forEach((f,i)=>tone(f,.15,'triangle',.09,0,i*.08));break;
 case'chat':tone(700,.05,'sine',.05);tone(900,.06,'sine',.05,0,.06);break;
 case'win':[523,659,784,1046].forEach((f,i)=>tone(f,.25,'triangle',.12,0,i*.15));break;
 case'lose':[400,330,260,180].forEach((f,i)=>tone(f,.3,'sawtooth',.1,0,i*.2));break}}
/* 잔잔한 생성형 배경음악 */
function musicTick(){if(muted||!musicOn||!AC)return;const roots=[110,87.3,98,82.4],bar=(mStep>>3)%4,r=roots[bar];
 if(mStep%8===0){tone(r,3.6,'sine',.05);tone(r*1.5,3.6,'sine',.03);tone(r*2,3.6,'sine',.02)}
 if(mStep%2===0){const sc=[1,1.2,1.5,1.8,2,2.4],n=r*2*sc[(mStep*3+bar*2)%6];tone(n,.9,'triangle',.016)}
 mStep++}
function startMusic(){if(!mTimer)mTimer=setInterval(musicTick,430)}
