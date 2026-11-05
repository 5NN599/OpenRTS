#!/usr/bin/env node
'use strict';
/* OpenRTS 빌드: dist/ 에 사이트를 만듭니다.
   - vendor/ 에 PeerJS·MQTT 브라우저 번들을 복사 (npm install 필요)
   - index.html / sitemap / robots / manifest 의 __SITE_URL__, __REPO_URL__ 치환
   환경변수: SITE_URL, REPO_URL  (없으면 GITHUB_REPOSITORY 로 GitHub Pages 주소를 추정)
   옵션: --vendor-only (루트의 vendor/ 만 채움)  */
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
const vendorOnly=process.argv.includes('--vendor-only');
const repoEnv=process.env.GITHUB_REPOSITORY||'';           // owner/repo
let site=(process.env.SITE_URL||'https://open-rts.kro.kr').replace(/\/+$/,''),repo=(process.env.REPO_URL||'').replace(/\/+$/,'');
if(!site&&repoEnv){const[o,r]=repoEnv.split('/');site=r.toLowerCase()===(o+'.github.io').toLowerCase()?`https://${o}.github.io`:`https://${o}.github.io/${r}`}
if(!repo&&repoEnv)repo='https://github.com/'+repoEnv;
site=site||'https://example.github.io/openrts';repo=repo||'https://github.com/OWNER/openrts';

function copyLib(srcRel,dest){
 const src=path.join(root,'node_modules',srcRel);
 if(!fs.existsSync(src)){console.error('! 없음: '+srcRel+'  → 먼저 `npm install` 을 실행하세요');process.exitCode=1;return false}
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);console.log('vendor ←',srcRel);return true}
function vendor(base){
 copyLib('peerjs/dist/peerjs.min.js',path.join(base,'vendor/peerjs.min.js'));
 copyLib('mqtt/dist/mqtt.min.js',path.join(base,'vendor/mqtt.min.js'))}
if(vendorOnly){vendor(root);process.exit()}

fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
const rep=s=>s.replace(/__SITE_URL__/g,site).replace(/__REPO_URL__/g,repo);
const textExt=/\.(html|xml|txt|webmanifest|json)$/;
function cp(rel){const s=path.join(root,rel),d=path.join(dist,rel);
 if(fs.statSync(s).isDirectory()){fs.mkdirSync(d,{recursive:true});for(const f of fs.readdirSync(s))cp(path.join(rel,f))}
 else{fs.mkdirSync(path.dirname(d),{recursive:true});if(textExt.test(rel))fs.writeFileSync(d,rep(fs.readFileSync(s,'utf8')));else fs.copyFileSync(s,d)}}
for(const f of ['index.html','robots.txt','sitemap.xml','site.webmanifest','404.html','.nojekyll','CNAME','LICENSE','css','js','icons','favicon.ico'])if(fs.existsSync(path.join(root,f)))cp(f);
vendor(dist);
console.log(`\n빌드 완료 → dist/\n  SITE_URL = ${site}\n  REPO_URL = ${repo}`);
