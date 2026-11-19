-- 制作节拍的故事查询由索引回答，不再逐篇解析故事 JSON，也不沿 document 的溢出页读取其后的列。
-- 表达式须与 lib/reader-repository.ts 的 familyRoot、familyNumber 及 scheduleLandscapeRedraws 的条件逐字一致（去掉别名），
-- 否则规划器无法匹配；tests/production-tick-scope.test.mjs 检查节拍查询计划以防漂移。
-- 版本判断：内层按用户、修订根、版本号查找更新版本；外层只需这些列的查询可扫描该覆盖索引，直接读取索引中已算好的表达式值。
CREATE INDEX stories_family ON stories(
 user_id,
 COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.rootId'),id),
 COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.number'),1),
 id,state,generation_control,generation_mode
);
--> statement-breakpoint
-- 回收过期运行锁。
CREATE INDEX stories_lock_scan ON stories(state,lock_until,generation_mode);
--> statement-breakpoint
-- 横图重绘检查只读取确有待重绘修订的故事。
CREATE INDEX stories_landscape_scan ON stories(
 state,generation_control,
 (CASE WHEN json_valid(document) THEN json_type(document,'$.revision.landscapeRedraw')='array' END)
);
