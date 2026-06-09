package com.bsea.workbench.modules.task.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.bsea.workbench.common.entity.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 后台任务执行表。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("job_task")
public class JobTask extends BaseEntity {
    private String taskType;
    private String taskName;
    private String paramsJson;
    private String status;
    private Integer progress;
    private String resultJson;
    private String errorMessage;
    private Integer retryCount;
    private Integer maxRetries;
    private java.time.LocalDateTime startTime;
    private java.time.LocalDateTime endTime;
    private Long durationMs;

    /** 当前步骤。 */
    private String currentStep;

    /** 总处理数量。 */
    private Integer totalCount;

    /** 成功数量。 */
    private Integer successCount;

    /** 失败数量。 */
    private Integer failedCount;

    /** 预计结束时间。 */
    private java.time.LocalDateTime estimatedEndTime;

    /** 更新摘要 JSON。 */
    private String updatedSummaryJson;

    /** 断点续跑游标 JSON。 */
    private String resumeCursorJson;

    /** Python 单任务执行日志路径。 */
    private String logPath;
}
