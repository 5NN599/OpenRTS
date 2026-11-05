/* 테스트용 가짜 PeerJS / MQTT (BroadcastChannel + localStorage 기반).
   실제 라이브러리의 일부 동작(NAT, 시그널링, 브로커 장애 등)은 재현하지 않습니다.
   페이지 로드 전에 addInitScript 로 주입하면 Libs.load() 가 외부 라이브러리를 건너뜁니다. */
(function(){
 const CH='mock-peers';
 let seq=0;
 class DC{constructor(peer,remote,cid,reliable){this.peer=peer;this.remote=remote;this.cid=cid;this.open=false;this.h={};this.dataChannel=null}
  on(e,f){(this.h[e]=this.h[e]||[]).push(f);return this}
  emit(e,a){(this.h[e]||[]).slice().forEach(f=>f(a))}
  send(d){if(!this.open)return;this.peer.ch.postMessage({k:'data',to:this.remote,cid:this.cid,d})}
  close(){if(!this.open&&this.closed)return;const was=this.open;this.open=false;this.closed=true;if(was)this.peer.ch.postMessage({k:'close',to:this.remote,cid:this.cid});this.emit('close')}}
 class Peer{
  constructor(id,opts){this.id=id||('anon-'+Math.random().toString(36).slice(2,10));this.h={};this.conns=new Map();this.destroyed=false;
   this.ch=new BroadcastChannel(CH);this.ch.onmessage=e=>this._msg(e.data);
   const claimed=[];this._claimTimer=null;
   if(id){this.ch.postMessage({k:'claim',id:this.id,nonce:this._n=Math.random()});this._claimTimer=setTimeout(()=>{if(this._taken){this.emit('error',{type:'unavailable-id'});this.destroy()}else this.emit('open',this.id)},60)}
   else setTimeout(()=>this.emit('open',this.id),10)}
  on(e,f){(this.h[e]=this.h[e]||[]).push(f);return this}
  emit(e,a){(this.h[e]||[]).slice().forEach(f=>f(a))}
  connect(id,opts){const cid=this.id+'>'+(++seq);const c=new DC(this,id,cid);this.conns.set(cid,c);
   this.ch.postMessage({k:'dial',to:id,from:this.id,cid});
   const t=setTimeout(()=>{if(!c.open&&!c._ans){this.emit('error',{type:'peer-unavailable'})}},400);c._t=t;return c}
  _msg(m){if(this.destroyed)return;
   switch(m.k){
   case'claim':if(m.id===this.id&&this._opened)this.ch.postMessage({k:'taken',id:m.id,nonce:m.nonce});break;
   case'taken':if(m.id===this.id&&m.nonce===this._n)this._taken=true;break;
   case'dial':if(m.to===this.id){const c=new DC(this,m.from,m.cid);c.open=true;this.conns.set(m.cid,c);this.ch.postMessage({k:'ans',to:m.from,cid:m.cid});this.emit('connection',c);c.emit('open')}break;
   case'ans':if(m.to===this.id){const c=this.conns.get(m.cid);if(c){c._ans=true;clearTimeout(c._t);c.open=true;c.emit('open')}}break;
   case'data':if(m.to===this.id){const c=this.conns.get(m.cid);if(c&&c.open)c.emit('data',m.d)}break;
   case'close':if(m.to===this.id){const c=this.conns.get(m.cid);if(c){const w=c.open;c.open=false;c.closed=true;if(w)c.emit('close')}}break}}
  reconnect(){}
  destroy(){if(this.destroyed)return;this.destroyed=true;clearTimeout(this._claimTimer);for(const c of this.conns.values())if(c.open){this.ch.postMessage({k:'close',to:c.remote,cid:c.cid});c.open=false}this.ch.close()}}
 // 이미 열린 피어가 claim 에 응답하도록 보정
 const origEmit=Peer.prototype.emit;Peer.prototype.emit=function(e,a){if(e==='open'){this._opened=true;this._claimTimer=null}return origEmit.call(this,e,a)};
 window.Peer=Peer;

 /* ---- MQTT ---- */
 const RK='mock-retained',MC='mock-mqtt';
 const getR=()=>{try{return JSON.parse(localStorage.getItem(RK)||'{}')}catch(e){return{}}};
 const setR=o=>localStorage.setItem(RK,JSON.stringify(o));
 const match=(pat,t)=>{const a=pat.split('/'),b=t.split('/');for(let i=0;i<a.length;i++){if(a[i]==='#')return true;if(a[i]==='+'){if(b[i]===undefined)return false;continue}if(a[i]!==b[i])return false}return a.length===b.length};
 window.__mockMqttFail=false;
 window.mqtt={connect(url,opts){
  const c={h:{},subs:[],connected:false,ch:new BroadcastChannel(MC),on(e,f){(this.h[e]=this.h[e]||[]).push(f);return this},emit(e,...a){(this.h[e]||[]).slice().forEach(f=>f(...a))},
   publish(topic,payload,o){o=o||{};if(o.retain){const r=getR();if(payload===''||payload==null)delete r[topic];else r[topic]=payload;setR(r)}this.ch.postMessage({topic,payload})},
   subscribe(p){this.subs.push(p);const r=getR();setTimeout(()=>{for(const t in r)if(match(p,t))this.emit('message',t,r[t])},20)},
   end(){this.connected=false;try{this.ch.close()}catch(e){}}};
  c.ch.onmessage=e=>{const{topic,payload}=e.data;if(c.connected&&c.subs.some(p=>match(p,topic)))c.emit('message',topic,payload)};
  setTimeout(()=>{if(window.__mockMqttFail){c.emit('error',new Error('mock fail'));return}c.connected=true;c.emit('connect')},15);return c}};
})();
