-- 修复旧修订遗漏的故障目标，代码钩子与本索引在同一迁移事务内提交。
CREATE INDEX reader_faults_origin_job ON reader_faults(session_id,owner_id,origin_fault_id)
 WHERE kind='job' AND job_id IS NULL AND origin_fault_id IS NOT NULL;
