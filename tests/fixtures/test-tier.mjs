// 快速层保留提供方契约和小型完整性冒烟；制作流程与真实原著套件由共享选择器分开运行。
// 完整提供方和重型用例由 SHIQU_TEST_TIER=full 开启。
export const fullTier=process.env.SHIQU_TEST_TIER==='full';
const fastProvider='codex';
// Providers for a production-flow test matrix: all of them in the full tier, one in fast runs.
export function flowProviders(names){return fullTier?names:names.includes(fastProvider)?[fastProvider]:names.slice(0,1);}
// Options for a single production-flow test inside a provider loop that also holds adapter tests.
export function flowProvider(name,names=['codex','gemini']){return flowProviders(names).includes(name)?{}:{skip:'provider matrix: run pnpm test:providers'};}
// Options for exhaustive or long-running cases kept out of fast runs.
export const heavy=fullTier?{}:{skip:'heavy case: run pnpm test:providers'};
// 原著全库校验单独启用，常规完整提供方矩阵不扫描全部 shipped books。
export const books=process.env.SHIQU_TEST_BOOKS==='1'?{}:{skip:'shipped book contents: run pnpm test:books'};
