package com.bsea.workbench.modules.task.controller;

import com.bsea.workbench.common.ApiResponse;
import com.bsea.workbench.common.dto.PageResult;
import com.bsea.workbench.modules.task.dto.JobTaskQueryRequest;
import com.bsea.workbench.modules.task.entity.JobTask;
import com.bsea.workbench.modules.task.service.JobTaskService;
import com.bsea.workbench.modules.task.service.TaskDispatchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 任务中心 Controller。
 *
 * 新模式：
 * 1. Java 创建 job_task。
 * 2. Java 立即派发 Python 单任务进程：python -m app.task_runner --task-id xxx。
 * 3. Python 中途写日志，执行结束后回写 job_task 最终状态、结果和日志路径。
 */
@Slf4j
@RestController
@RequestMapping("/task/jobs")
@RequiredArgsConstructor
public class JobTaskController {

    private final JobTaskService service;
    private final TaskDispatchService dispatchService;

    /** 分页查询任务列表，支持 status / taskType / keyword 筛选。 */
    @GetMapping
    public ApiResponse<PageResult<JobTask>> page(JobTaskQueryRequest request) {
        return ApiResponse.ok(service.page(request));
    }

    /** 查询单个任务详情。 */
    @GetMapping("/{id}")
    public ApiResponse<JobTask> detail(@PathVariable Long id) {
        return ApiResponse.ok(service.getRequired(id));
    }

    /** 创建通用任务，并立即由 Java 派发 Python 单任务进程。 */
    @PostMapping
    public ApiResponse<JobTask> create(@RequestBody JobTask entity) {
        return ApiResponse.ok(dispatchService.createAndDispatch(entity));
    }

    /** 仅创建任务，不立即执行。用于延迟执行、定时调度或人工排队。 */
    @PostMapping("/create-only")
    public ApiResponse<JobTask> createOnly(@RequestBody JobTask entity) {
        if (entity.getStatus() == null) {
            entity.setStatus("pending");
        }
        if (entity.getProgress() == null) {
            entity.setProgress(0);
        }
        if (entity.getCurrentStep() == null) {
            entity.setCurrentStep("等待 Java 调度");
        }
        return ApiResponse.ok(service.create(entity));
    }

    /** 派发已存在的 pending/failed 任务。 */
    @PostMapping("/{id}/dispatch")
    public ApiResponse<JobTask> dispatch(@PathVariable Long id) {
        return ApiResponse.ok(dispatchService.dispatch(id));
    }

    /** 失败任务原任务续跑，沿用 resumeCursorJson。 */
    @PostMapping("/{id}/resume")
    public ApiResponse<JobTask> resume(@PathVariable Long id) {
        return ApiResponse.ok(dispatchService.resume(id));
    }

    /** 取消任务。当前仅 pending 状态可取消。 */
    @PostMapping("/{id}/cancel")
    public ApiResponse<Void> cancel(@PathVariable Long id) {
        JobTask task = service.getRequired(id);
        if (!"pending".equals(task.getStatus())) {
            return ApiResponse.fail("只有 pending 状态的任务可以取消");
        }
        task.setStatus("canceled");
        task.setCurrentStep("已取消");
        service.update(id, task);
        return ApiResponse.ok(null);
    }

    /** 创建日K同步任务，并立即由 Java 派发 Python task_runner。 */
    @PostMapping("/sync-1d")
    public ApiResponse<JobTask> createSync1d(@RequestBody Map<String, Object> params) {
        JobTask task = new JobTask();
        task.setTaskType("sync_1d");
        task.setTaskName("日K同步: " + params.getOrDefault("symbols", ""));
        task.setParamsJson(toJson(params));
        task.setStatus("pending");
        task.setProgress(0);
        task.setCurrentStep("等待 Java 调度");
        return ApiResponse.ok(dispatchService.createAndDispatch(task));
    }

    /** 创建回测任务，并立即由 Java 派发 Python task_runner。 */
    @PostMapping("/backtest")
    public ApiResponse<JobTask> createBacktest(@RequestBody Map<String, Object> params) {
        JobTask task = new JobTask();
        task.setTaskType("backtest");
        task.setTaskName("回测: " + params.getOrDefault("symbol", ""));
        task.setParamsJson(toJson(params));
        task.setStatus("pending");
        task.setProgress(0);
        task.setCurrentStep("等待 Java 调度");
        return ApiResponse.ok(dispatchService.createAndDispatch(task));
    }

    /** 删除任务。 */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }
}
