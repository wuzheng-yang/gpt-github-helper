package com.bsea.workbench.modules.task.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.bsea.workbench.common.dto.PageQueryRequest;
import com.bsea.workbench.common.dto.PageResult;
import com.bsea.workbench.modules.task.entity.DataScript;
import com.bsea.workbench.modules.task.entity.JobTask;
import com.bsea.workbench.modules.task.repository.DataScriptRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 数据脚本服务。
 *
 * 新模式：
 * 1. Java 管理 data_script。
 * 2. 执行脚本时 Java 创建 job_task。
 * 3. Java 立即启动 Python task_runner 执行单个 task_id。
 */
@Service
@RequiredArgsConstructor
public class DataScriptService {
    private final DataScriptRepository scriptRepository;
    private final TaskDispatchService dispatchService;

    public List<DataScript> listEnabled() {
        return scriptRepository.selectList(new LambdaQueryWrapper<DataScript>()
                .eq(DataScript::getEnabled, 1)
                .orderByAsc(DataScript::getSortOrder)
                .orderByAsc(DataScript::getId));
    }

    public PageResult<DataScript> page(PageQueryRequest request) {
        IPage<DataScript> page = scriptRepository.selectPage(request.toPage(), new LambdaQueryWrapper<DataScript>()
                .orderByAsc(DataScript::getSortOrder)
                .orderByAsc(DataScript::getId));
        return PageResult.of(page.getRecords(), page.getTotal(), (int) page.getCurrent(), (int) page.getSize());
    }

    public DataScript getById(Long id) {
        return scriptRepository.selectById(id);
    }

    public DataScript create(DataScript entity) {
        fillDefaults(entity);
        scriptRepository.insert(entity);
        return entity;
    }

    public DataScript update(Long id, DataScript entity) {
        entity.setId(id);
        fillDefaults(entity);
        scriptRepository.updateById(entity);
        return scriptRepository.selectById(id);
    }

    public void delete(Long id) {
        scriptRepository.deleteById(id);
    }

    public JobTask runScript(Long id, String paramsJson) {
        DataScript script = scriptRepository.selectById(id);
        if (script == null) {
            throw new IllegalArgumentException("数据脚本不存在");
        }
        if (script.getEnabled() == null || script.getEnabled() != 1) {
            throw new IllegalArgumentException("数据脚本未启用");
        }
        String finalParams = StringUtils.hasText(paramsJson) ? paramsJson : script.getDefaultParamsJson();
        JobTask task = new JobTask();
        task.setTaskType(script.getTaskType());
        task.setTaskName(script.getScriptName());
        task.setParamsJson(StringUtils.hasText(finalParams) ? finalParams : "{}");
        task.setStatus("pending");
        task.setProgress(0);
        task.setRetryCount(0);
        task.setMaxRetries(0);
        task.setCurrentStep("等待 Java 调度");
        return dispatchService.createAndDispatch(task);
    }

    private void fillDefaults(DataScript entity) {
        if (entity.getEnabled() == null) entity.setEnabled(1);
        if (entity.getNeedSymbols() == null) entity.setNeedSymbols(0);
        if (entity.getNeedDateRange() == null) entity.setNeedDateRange(0);
        if (entity.getSortOrder() == null) entity.setSortOrder(0);
        if (!StringUtils.hasText(entity.getDefaultParamsJson())) entity.setDefaultParamsJson("{}");
    }
}
