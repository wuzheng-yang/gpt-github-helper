package com.bsea.workbench.modules.task.service;

import com.bsea.workbench.modules.task.entity.JobTask;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.File;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

/**
 * Java 任务派发服务。
 *
 * 新设计：
 * 1. Java 负责任务调度和启动进程。
 * 2. Python 不再常驻轮询 job_task。
 * 3. 每个任务由 Java 启动一次 Python task_runner。
 * 4. Python 中途只写日志文件，结束时回写 job_task 最终状态和结果。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TaskDispatchService {

    private final JobTaskService jobTaskService;

    @Value("${app.python.executable:python}")
    private String pythonExecutable;

    @Value("${app.python.work-dir:../ai_python}")
    private String pythonWorkDir;

    /**
     * 创建任务并立即派发执行。
     */
    public JobTask createAndDispatch(JobTask task) {
        if (!StringUtils.hasText(task.getStatus())) {
            task.setStatus("pending");
        }
        if (task.getProgress() == null) {
            task.setProgress(0);
        }
        if (!StringUtils.hasText(task.getCurrentStep())) {
            task.setCurrentStep("等待 Java 调度");
        }
        JobTask saved = jobTaskService.create(task);
        dispatch(saved.getId());
        return saved;
    }

    /**
     * 派发已有任务。
     */
    public JobTask dispatch(Long taskId) {
        JobTask task = jobTaskService.getRequired(taskId);
        if (!"pending".equals(task.getStatus()) && !"failed".equals(task.getStatus())) {
            throw new IllegalStateException("只有 pending/failed 状态任务可以派发: " + task.getStatus());
        }
        startPythonTask(taskId);
        task.setCurrentStep("Java 已启动 Python task_runner");
        task.setEstimatedEndTime(LocalDateTime.now().plusMinutes(5));
        return jobTaskService.update(taskId, task);
    }

    /**
     * 失败任务重新派发，沿用原任务行和 resumeCursorJson。
     */
    public JobTask resume(Long taskId) {
        JobTask task = jobTaskService.getRequired(taskId);
        if (!"failed".equals(task.getStatus())) {
            throw new IllegalStateException("只有 failed 状态任务可以续跑: " + task.getStatus());
        }
        task.setStatus("pending");
        task.setProgress(0);
        task.setErrorMessage(null);
        task.setCurrentStep("等待 Java 续跑调度");
        jobTaskService.update(taskId, task);
        return dispatch(taskId);
    }

    private void startPythonTask(Long taskId) {
        List<String> command = Arrays.asList(
                pythonExecutable,
                "-m",
                "app.task_runner",
                "--task-id",
                String.valueOf(taskId)
        );
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            if (StringUtils.hasText(pythonWorkDir)) {
                builder.directory(new File(pythonWorkDir));
            }
            builder.redirectErrorStream(true);
            builder.redirectOutput(ProcessBuilder.Redirect.INHERIT);
            Process process = builder.start();
            log.info("Dispatched job_task {} with pid={}, command={}, workDir={}", taskId, process.pid(), command, pythonWorkDir);
        } catch (Exception e) {
            throw new RuntimeException("启动 Python task_runner 失败: " + e.getMessage(), e);
        }
    }
}
