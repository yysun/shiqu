-- 制作生命周期使用已有的故障来源、输入指纹和状态字段。每个来源对同一画幅及输入最多登记一次。
CREATE UNIQUE INDEX reader_faults_origin_frame ON reader_faults(session_id,owner_id,origin_fault_id,node_key,input_hash)
 WHERE kind='image-loss' AND origin_fault_id IS NOT NULL AND state!='awaiting-match' AND node_key!='';

-- 旧应用按画幅身份判断故障，不能安全地调度带指纹阻断的书库。
PRAGMA user_version=3;
