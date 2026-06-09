package com.bsea.workbench.modules.task.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.bsea.workbench.common.dto.PageQueryRequest;
import com.bsea.workbench.common.dto.PageResult;
import com.bsea.workbench.modules.task.entity.JobSchedule;
import com.bsea.workbench.modules.task.entity.JobTask;
import com.bsea.workbench.modules.task.repository.JobScheduleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;

/**
 * 任务调度配置服务。
 *
 * 新模式：
 * 1. Java 管理 job_schedule。
 * 2. 执行一次时 Java 创建 job_task。
 * 3. Java 立即启动 Python task_runner 执行单个 task_id。
 */
@Service
@RequiredArgsConstructor
public class JobScheduleService {
    private final JobScheduleRepository scheduleRepository;
    private final TaskDispatchService dispatchService;

    public PageResult<JobSchedule> page(PageQueryRequest request) {
        IPage<JobSchedule> page = scheduleRepository.selectPage(request.toPage(), new LambdaQueryWrapper<JobSchedule>()
                .orderByDesc(JobSchedule::getEnabled)
                .orderByDesc(JobSchedule::getId));
        return PageResult.of(page.getRecords(), page.getTotal(), (int) page.getCurrent(), (int) page.getSize());
    }

    public JobSchedule getById(Long id) {
        return scheduleRepository.selectById(id);
    }

    public JobSchedule create(JobSchedule entity) {
        fillDefaults(entity);
        scheduleRepository.insert(entity);
        return entity;
    }

    public JobSchedule update(Long id, JobSchedule entity) {
        entity.setId(id);
        fillDefaults(entity);
        scheduleRepository.updateById(entity);
        return scheduleRepository.selectById(id);
    }

    public void delete(Long id) {
        scheduleRepository.deleteById(id);
    }

    public JobTask runOnce(Long id) {
        JobSchedule schedule = scheduleRepository.selectById(id);
        if (schedule == null) {
            throw new IllegalArgumentException("调度配置不存在");
        }
        JobTask task = new JobTask();
        task.setTaskType(schedule.getTaskType());
        task.setTaskName(schedule.getScheduleName());
        task.setParamsJson(StringUtils.hasText(schedule.getParamsJson()) ? schedule.getParamsJson() : "{}");
        task.setStatus("pending");
        task.setProgress(0);
        task.setRetryCount(0);
        task.setMaxRetries(0);
        task.setCurrentStep("等待 Java 调度");
        JobTask dispatched = dispatchService.createAndDispatch(task);

        schedule.setLastRunTime(LocalDateTime.now());
        schedule.setLastStatus("dispatched");
        scheduleRepository.updateById(schedule);
        return dispatched;
    }

    private void fillDefaults(JobSchedule entity) {
        if (entity.getEnabled() == null) entity.setEnabled(1);
        if (!StringUtils.hasText(entity.getParamsJson())) entity.setParamsJson("{}");
    }
}
