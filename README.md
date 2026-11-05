# OpenRTS

브라우저에서 바로 즐기는 **무료 오픈소스 P2P 실시간 전략(RTS) 게임**. 설치도 가입도 없이, 최대 **4인**이 서버 없이 직접 연결해 대전합니다.

- 🏔 고도 3단계 지형(고지대·절벽·경사로)의 **2.5D** 전장, 높이에 따른 시야 제한
- 🌐 **P2P 온라인 멀티플레이** (WebRTC / PeerJS) — **공개 방**과 **8자리 숫자 코드 비밀 방**
- 🎮 **4가지 모드**: 개인전 · 팀전 · 비대칭 팀전 · 인공지능 대 인간
- 🤖 **슬롯별 AI 난이도** (쉬움 / 보통 / 어려움)
- 🛡 **방장 권위 + 검증**으로 치트/핵 차단, 안개 속 정보는 전송하지 않음(맵핵 불가)
- 🎨 모든 그래픽은 Canvas 로 그리고, 모든 소리는 WebAudio 로 합성 (외부 에셋 없음)
- 프레임워크/번들러 없는 순수 JavaScript, **MIT 라이선스**

## 빠른 시작

```bash
git clone https://github.com/<owner>/openrts.git && cd openrts
npm install        # peerjs, mqtt 를 받아 vendor/ 로 복사하는 데만 쓰입니다
npm start          # http://localhost:8080
```

`npm install` 없이도 동작하지만(CDN 폴백), 온라인 기능은 PeerJS/MQTT 라이브러리가 필요합니다. 혼자 하기(AI 대전)는 라이브러리 없이 동작합니다.

## GitHub Pages 로 배포

1. 이 저장소를 GitHub 에 올립니다 (`main` 브랜치).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions** 를 선택합니다.
3. `main` 에 push 하면 `.github/workflows/pages.yml` 이 `npm run build` 를 실행해 `dist/` 를 배포합니다.
   - 빌드가 `index.html`/`sitemap.xml`/`robots.txt` 의 `__SITE_URL__`, `__REPO_URL__` 을 실제 주소로 바꿉니다 (`GITHUB_REPOSITORY` 로 자동 추정, `SITE_URL`/`REPO_URL` 환경변수로 덮어쓰기 가능).
4. 커스텀 도메인을 쓰면 `SITE_URL=https://example.com npm run build` 로 빌드하세요.
5. 검색 노출: Google Search Console / 네이버 서치어드바이저에 사이트와 `sitemap.xml` 을 등록하세요.

## 온라인 플레이 방법

| 하고 싶은 일 | 방법 |
|---|---|
| 방 만들기 | 메인 → **방 만들기** → 공개/비밀/혼자 선택, 모드 선택 |
| 공개 방 입장 | 메인 → **공개 방 찾기** → 입장 |
| 비밀 방 입장 | 방장이 알려준 **8자리 코드** 입력, 또는 초대 링크 `…/#join=12345678` |
| AI 추가 | 로비에서 슬롯 종류를 **AI** 로, 난이도는 슬롯마다 따로 |

### 모드

- **개인전**: 모두가 적. 마지막 생존자 승리.
- **팀전**: A팀 대 B팀(슬롯마다 팀 지정). 같은 팀은 시야 공유.
- **비대칭 팀전**: 인원이 다른 두 팀(예: 1 대 3). 수가 적은 팀은 시작 자원·건물 체력·인구 한도·수입 보너스를 자동으로 받습니다.
- **인공지능 대 인간**: 사람들이 한 팀, AI 들이 다른 팀.

## 구조

```
index.html        랜딩 + 로비 + 게임 화면 (SEO 메타, JSON-LD, 파비콘 내장)
css/style.css
js/config.js      설정 (PeerJS/TURN/MQTT 브로커 변경은 여기, 또는 window.OPENRTS_CONFIG)
js/core.js        상수·데이터(유닛/건물/연구)·사운드 합성
js/map.js         지형 생성·시야·경로탐색
js/sim.js         ★ 호스트 시뮬레이션: 전투·AI·명령 검증·경기 시작/종료
js/snapshot.js    ★ 안개 필터 이진 스냅샷 (호스트→클라이언트)
js/net.js         WebRTC(PeerJS)·MQTT 공개 방 목록·로비 프로토콜
js/render.js      2.5D 렌더링·입력·HUD
js/ui.js          랜딩/방/로비/종료 화면
tools/build.js    dist/ 빌드 (vendor 복사, URL 치환)
tests/            Playwright 통합 테스트 + 가짜 P2P
```

## 네트워크·보안 모델

- **방장 = 서버.** 방을 만든 사람의 브라우저가 게임 전체를 계산합니다(30Hz). 참가자는 *의도*(이동/건설/생산 명령)만 보냅니다.
- 호스트 검증: 소유권, 자원, 건설 위치(탐색·평지·충돌), 선행 건물, 시야(공격 대상), 좌표/형식, 명령 속도 제한. 부정 요청이 반복되면 자동 강퇴됩니다.
- **맵핵 방지**: 스냅샷에는 해당 플레이어(와 동맹)가 *현재 볼 수 있는* 엔티티만 담깁니다.
- 공개 방 목록은 공개 MQTT 브로커의 retained 메시지로 공유합니다(방 이름·모드·인원·코드만). 비밀 방은 어디에도 게시되지 않으며 8자리 코드를 아는 사람만 접속할 수 있습니다. 코드는 암호가 아니므로 민감한 용도에는 적합하지 않습니다.
- **한계**: 방장 본인이 자기 브라우저를 조작하는 것은 P2P 구조상 막을 수 없습니다. 신뢰할 수 있는 사람의 방에서 하세요. 엄격한 NAT/방화벽에서는 TURN 서버(`js/config.js`)가 필요할 수 있습니다. 공개 PeerJS 시그널링 서버와 공개 MQTT 브로커는 무보증 공용 서비스이므로, 운영 환경에서는 직접 운영하는 서버를 `config.js` 에 지정하세요.

## 개발 / 테스트

```bash
npm test      # 정적 서버 + Playwright (가짜 PeerJS/MQTT 로 2~4탭 멀티플레이 시나리오)
```

테스트는 `tests/mock-p2p.js` 로 PeerJS/MQTT 를 BroadcastChannel 로 대체합니다. 실제 네트워크(NAT, 공용 브로커) 경로는 자동 테스트하지 않으니 배포 후 서로 다른 네트워크의 두 기기로 한 번 확인하세요.

## 라이선스

[MIT](LICENSE). OpenRTS 는 독립 프로젝트이며 어떤 상용 게임의 에셋(스프라이트·사운드)도 사용하지 않습니다.
