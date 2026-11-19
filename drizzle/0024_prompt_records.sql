-- 提示词全文按内容存放（id 为记录 JSON 的 SHA-256），故事文档的调用记录只保留 promptRecordId 引用。
-- 已有内嵌记录由代码钩子 server/prompt-record-migration.ts 在同一事务中移出并核对。
CREATE TABLE prompt_records(
 id text PRIMARY KEY NOT NULL,
 record text NOT NULL
);
