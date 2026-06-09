-- job_task 任务进度增强字段
-- 说明：
-- 1. 用于展示当前步骤、预计结束时间、处理数量、更新摘要、断点游标和日志路径。
-- 2. 如果字段已存在，请忽略对应 ALTER 报错，或按数据库工具手动检查后执行。

ALTER TABLE job_task ADD COLUMN current_step VARCHAR(128) DEFAULT NULL COMMENT '当前执行步骤';
ALTER TABLE job_task ADD COLUMN total_count INT DEFAULT NULL COMMENT '总处理数量';
ALTER TABLE job_task ADD COLUMN success_count INT DEFAULT NULL COMMENT '成功处理数量';
ALTER TABLE job_task ADD COLUMN failed_count INT DEFAULT NULL COMMENT '失败处理数量';
ALTER TABLE job_task ADD COLUMN estimated_end_time DATETIME DEFAULT NULL COMMENT '预计结束时间';
ALTER TABLE job_task ADD COLUMN updated_summary_json JSON DEFAULT NULL COMMENT '更新摘要JSON';
ALTER TABLE job_task ADD COLUMN resume_cursor_json JSON DEFAULT NULL COMMENT '断点续跑游标JSON';
ALTER TABLE job_task ADD COLUMN log_path VARCHAR(512) DEFAULT NULL COMMENT 'Python单任务执行日志路径';

CREATE INDEX idx_job_task_status_type ON job_task(status, task_type);
CREATE INDEX idx_job_task_estimated_end_time ON job_task(estimated_end_time);
