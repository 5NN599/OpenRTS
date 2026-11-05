'use strict';
/* =====================================================================
   OpenRTS 설정
   - index.html 보다 먼저 `window.OPENRTS_CONFIG = {...}` 를 정의하면 값을 덮어쓸 수 있습니다.
     (예: 자체 PeerJS 서버, TURN 서버, 자체 MQTT 브로커)
   ===================================================================== */
const CONFIG=(function(){
 const base={
  version:'1.0.0',
  protocol:1,                       // 이 값이 다르면 서로 접속할 수 없습니다
  maxPlayers:4,
  peer:{
   prefix:'openrts-p1-',            // 방 코드(8자리 숫자) 앞에 붙는 PeerJS ID 접두사
   options:{                        // new Peer(id, options) 에 그대로 전달됩니다
    debug:0,
    config:{iceServers:[
     {urls:'stun:stun.l.google.com:19302'},
     {urls:'stun:stun1.l.google.com:19302'},
     {urls:'stun:global.stun.twilio.com:3478'}
     /* NAT 이 엄격한 환경을 위해 TURN 서버를 추가할 수 있습니다:
     ,{urls:'turn:turn.example.com:3478',username:'user',credential:'pass'} */
    ]}
    /* 자체 PeerJS 서버:  host:'peer.example.com', port:443, secure:true, path:'/' */
   }
  },
  mqtt:{                            // 공개 방 목록 (retained 메시지 사용)
   brokers:[
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081'
   ],
   topic:'openrts/p1/rooms',
   ttl:75000,                       // 이 시간 이상 갱신이 없는 방은 목록에서 숨깁니다(ms)
   beat:20000                       // 호스트가 방 정보를 갱신하는 주기(ms)
  },
  libs:{                            // vendor/ 에 파일이 없을 때 쓰는 CDN (버전 고정)
   peer:'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
   mqtt:'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js'
  }
 };
 function merge(a,b){for(const k in b){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))merge(a[k],b[k]);else a[k]=b[k]}return a}
 return merge(base,(typeof window!=='undefined'&&window.OPENRTS_CONFIG)||{});
})();
