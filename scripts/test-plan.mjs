// 已知测试输入按文件选测，生产变更按责任域取并集；未知影响保留基础检查。
// createRelatedPlan 为开发内循环的相关计划，只用快速开关，与 PR/CI 计划分开。
import {loadMetadata,groups,supported} from './test-metadata.mjs';
const fallbackGroups=['safety','startup','tooling'];
export function fullScope(reason='explicit full qualification'){
 return {code:true,books:true,native:true,full:true,groups:[...groups],reasons:[reason]};
}
export function fallbackScope(reason){
 return {code:true,books:false,native:true,full:false,groups:[...fallbackGroups],reasons:[reason]};
}
const rules=[
 [/^(?:client|public)\//,['reader']],
 [/^desktop\//,['desktop']],
 [/^src-tauri\//,['desktop'],true],
 [/^(?:db|drizzle)\//,['storage','books','startup'],true],
 [/^data\/library\//,['books','discovery']],
 [/^skills\//,['tooling','startup']],
 [/^server\/(?:system-settings|cli-options|cli-setup|config|browser-provider-settings)\.ts$/,['startup','providers','desktop'],true],
 [/^lib\/(?:system-settings|provider-settings)\.ts$/,['startup','providers','desktop'],true],
 [/^server\/(?:cli|start|index|headless-cli)\.ts$/,['startup','production','tooling']],
 [/^server\/(?:desktop|desktop-access|desktop-owner|desktop-remote|desktop-tunnel|phone-access)\.ts$/,['desktop']],
 [/^server\/(?:development|development-access|cli-skill)\.ts$/,['tooling','startup']],
 [/^server\/(?:database|database-migrations|library-schema)\.ts$/,['storage','books','startup'],true],
 [/^server\/(?:library-backup|library-directory|library-maintenance|library-upgrade|import-legacy|diagnostics)\.ts$/,['storage','startup'],true],
 [/^server\/(?:app|http|media)\.ts$/,['storage','production','reader','media']],
 [/^server\/(?:local-books|local-book-[\w-]+|local-source-[\w-]+|story-reading-inputs)\.ts$/,['books','discovery']],
 [/^server\/(?:local-story-discovery|story-discovery-[\w-]+|story-theme-matching|story-token-budget)\.ts$/,['discovery']],
 [/^server\/local-generation\.ts$/,['books','providers','discovery','preparation','review','production','media']],
 [/^server\/(?:generation|provider-runtime)\.ts$/,['providers','discovery','preparation','review','production','media']],
 [/^server\/(?:codex-runner|claude-runner|openai-provider)\.ts$/,['providers']],
 [/^server\/(?:production-queue|reader-commands|reader-production|reader-reselection|reader-revisions|reader-input-migration|story-summary-migration)\.ts$/,['production','storage']],
 [/^server\/reader-intake\.ts$/,['preparation','discovery']],
 [/^server\/(?:reader-image-health|story-export|book-image-reference)\.ts$/,['media','review']],
 [/^server\/reader-copy\.ts$/,['reader','production']],
 [/^lib\/(?:reader-model|reader-api|reader-generation-contract|reader-local-contract|reader-source-types|services|server)\.ts$/,['discovery','preparation','review','production','reader','storage','providers','media'],true],
 [/^lib\/(?:reader-provider|reader-gemini[\w-]*|reader-responses-diagnostics|reader-reasoning|codex-settings)\.ts$/,['providers']],
 [/^lib\/(?:reader-limits|reader-engine|reader-generation)\.ts$/,['providers','preparation','review','production','discovery']],
 [/^lib\/(?:reader-source[\w-]*|reader-verified-passages|reader-books|reader-contents|reader-legacy-catalog|reader-discovery-call|reader-suggestion-request|reader-suggestions|reader-theme-match)\.ts$|^lib\/reader-discovery-v1\.json$/,['books','discovery']],
 [/^lib\/(?:reader-intake|reader-story-brief|reader-requirements|reader-editorial|reader-art-recommendation)\.ts$/,['preparation']],
 [/^lib\/(?:reader-acceptance|reader-frame-recommendation|reader-review[\w-]*|reader-storyboard|reader-structure)\.ts$/,['review']],
 [/^lib\/(?:reader-repository|reader-recovery|reader-production|reader-reselection|reader-revision[\w-]*|reader-versions|production-[\w-]+|generation-progress)\.ts$/,['production','storage']],
 [/^lib\/(?:reader-image[\w-]*|reader-png|reader-pdf|reader-zip[\w-]*|story-export-runtime|story-publication|story-watermark|story-webp-metadata)\.ts$|^lib\/public-story-zip\.mjs$/,['media']],
 [/^lib\/(?:reader-production-client|shelf-generation)\.ts$/,['reader','production','discovery','preparation']],
 [/^lib\/(?:reader-home|reader-navigation|reader-production-client|reader-request|reader-snapshots|reader-styles|reader-prompt-format|reader-prompt-records|reader-random-id|shelf-[\w-]+|content|utils)\.ts$/,['reader']],
 // 已知独立工具按责任域运行。
 [/^scripts\/export-story\.mjs$/,['media','tooling']],
 [/^scripts\/(?:desktop-node|desktop-resources|desktop-smoke)\.mjs$/,['desktop'],true],
 [/^scripts\/eval-story-discovery\.mjs$/,['discovery']],
];
function documentation(file){
 if(/^(?:data|tests|scripts|server|lib|skills|db|drizzle)\//.test(file))return false;
 return /\.md$|^\.docs\/|^(?:LICENSE|NOTICE)$/.test(file);
}
// 只有已声明消费者的提示词、样式、夹具和测试调度输入才允许走文件级选择。
const directInput=/^(?:lib\/reader-(?:legacy-)?prompts\.ts|(?:client|desktop)\/.+\.css|tests\/fixtures\/.+|tests\/manifest\.json|scripts\/(?:ci-scope|node-version|test-(?:graph|metadata|plan|pr|source|tiers))\.mjs)$/;
export function changeScope(files,metadata=loadMetadata()){
 if(!files.length)return fallbackScope('empty comparison');
 const selected=new Set(),directTests=new Set(),reasons=[];let code=false,native=false;
 const selectTest=entry=>{
  if(entry.level==='native'){native=true;entry.groups.forEach(group=>selected.add(group));}
  else directTests.add(entry.file);
 };
 for(const file of files){
  if(typeof file!=='string'||file.includes('\\')||file.startsWith('/')||file.split('/').includes('..')){
   fallbackGroups.forEach(group=>selected.add(group));code=true;native=true;reasons.push('invalid path');continue;
  }
  if(documentation(file))continue;
  code=true;
  const test=metadata.tests.find(entry=>entry.file===file);
  if(test){selectTest(test);reasons.push(file);continue;}
  const consumers=metadata.tests.filter(entry=>entry.covers.includes(file));
  if(directInput.test(file)&&consumers.length){consumers.forEach(selectTest);reasons.push(file);continue;}
  const [,affected,requiresNative]=rules.find(([pattern])=>pattern.test(file))||[null,fallbackGroups,true];
  affected.forEach(group=>selected.add(group));native||=Boolean(requiresNative);
  for(const consumer of consumers){consumer.groups.forEach(group=>selected.add(group));native||=consumer.level==='native';}
  reasons.push(file);
 }
 return {code,books:selected.has('books'),native,full:false,groups:[...selected].sort(),reasons,...(directTests.size?{directTests:[...directTests].sort()}:{})};
}
export function validScope(scope){
 if(!scope||!['code','books','native','full'].every(key=>typeof scope[key]==='boolean')||!Array.isArray(scope.groups)||new Set(scope.groups).size!==scope.groups.length||!scope.groups.every(g=>groups.includes(g)))return false;
 const direct=scope.directTests===undefined?[]:scope.directTests;
 return Array.isArray(direct)&&new Set(direct).size===direct.length&&direct.every(file=>typeof file==='string')&&(!scope.full||(scope.code&&scope.native&&groups.every(g=>scope.groups.includes(g))))&&(scope.code||(!scope.groups.length&&!direct.length&&!scope.native&&!scope.books))&&(!scope.code||scope.groups.length>0||direct.length>0)&&scope.books===scope.groups.includes('books');
}
// 开发内循环：只运行改动的已登记测试及反查到的消费者，全部快速开关；不是资格检查，空集不扩大范围。
export function createRelatedPlan(files,consumers,metadata=loadMetadata(),{platform=process.platform}={}){
 const chosen=new Set([...consumers,...files.filter(file=>metadata.tests.some(entry=>entry.file===file))]);
 const entries=metadata.tests.filter(entry=>chosen.has(entry.file));
 const runnable=entries.filter(entry=>entry.level!=='native'&&entry.level!=='browser-e2e'&&supported(entry,platform));
 const deferredBrowser=entries.filter(entry=>entry.level==='browser-e2e').map(entry=>entry.file);
 const native=entries.some(entry=>entry.level==='native')||files.some(file=>file.startsWith('src-tauri/'));
 const hints=[];
 if(deferredBrowser.length)hints.push('浏览器用例请运行 pnpm test:e2e');
 if(native)hints.push('原生代码请运行 pnpm desktop:test');
 if(!runnable.length)hints.push('没有直接相关的测试：0 个文件被运行，间接受影响的测试未检查，这不代表通过。');
 hints.push(runnable.length?'只包含直接相关测试；交付前运行一次 pnpm test:changed':'请运行 pnpm test:changed 检查完整影响面');
 return {version:1,platform,related:true,files,native,tests:runnable.map(entry=>({file:entry.file,level:entry.level,mode:'fast'})),deferredBrowser,excluded:entries.filter(entry=>entry.level!=='native'&&!supported(entry,platform)).map(entry=>entry.file),hints};
}
export function createPlan(scope,metadata=loadMetadata(),{platform=process.platform,includeBrowser=false}={}){
 if(!validScope(scope)||scope.directTests?.some(file=>!metadata.tests.some(entry=>entry.file===file&&entry.level!=='native')))scope=fallbackScope('missing/invalid scope');
 const direct=new Set(scope.directTests);
 const core=scope.groups.some(group=>['discovery','preparation','review','production'].includes(group));
 const affected=entry=>direct.has(entry.file)||entry.groups.some(group=>scope.groups.includes(group))||core&&entry.gates.includes('extended');
 const selected=metadata.tests.filter(entry=>entry.level!=='native'&&(scope.full||entry.pr==='always'||affected(entry)||scope.groups.length&&entry.pr==='code'));
 const available=selected.filter(entry=>supported(entry,platform));
 // 影响范围与执行门禁分开，只有显式资格检查纳入 Playwright。
 const tests=available.filter(entry=>includeBrowser||entry.level!=='browser-e2e').map(entry=>({file:entry.file,level:entry.level,mode:scope.full||affected(entry)?'full':'fast'}));
 const deferredBrowser=includeBrowser?[]:available.filter(entry=>entry.level==='browser-e2e').map(entry=>entry.file);
 return {version:1,platform,scope,native:scope.native,tests,deferredBrowser,excluded:selected.filter(entry=>!supported(entry,platform)).map(entry=>entry.file)};
}
