import { request } from '@/utils'

// Java 任务中心：创建任务后由 Java 直接启动 Python task_runner
export const jobTaskApi = {
  list: params => request.get('/java/task/jobs', { params }),
  detail: id => request.get(`/java/task/jobs/${id}`),
  create: data => request.post('/java/task/jobs', data),
  createOnly: data => request.post('/java/task/jobs/create-only', data),
  dispatch: id => request.post(`/java/task/jobs/${id}/dispatch`),
  resume: id => request.post(`/java/task/jobs/${id}/resume`),
  cancel: id => request.post(`/java/task/jobs/${id}/cancel`),
  delete: id => request.delete(`/java/task/jobs/${id}`),
  sync1d: data => request.post('/java/task/jobs/sync-1d', data),
  backtest: data => request.post('/java/task/jobs/backtest', data),
}

// 数据脚本注册 data_script
export const dataScriptApi = {
  enabled: () => request.get('/java/data/scripts/enabled'),
  list: params => request.get('/java/data/scripts', { params }),
  detail: id => request.get(`/java/data/scripts/${id}`),
  run: (id, data) => request.post(`/java/data/scripts/${id}/run`, data),
}

// 定时任务配置 job_schedule
export const jobScheduleApi = {
  list: params => request.get('/java/task/schedules', { params }),
  detail: id => request.get(`/java/task/schedules/${id}`),
  create: data => request.post('/java/task/schedules', data),
  update: (id, data) => request.put(`/java/task/schedules/${id}`, data),
  delete: id => request.delete(`/java/task/schedules/${id}`),
  runOnce: id => request.post(`/java/task/schedules/${id}/run-once`),
}

// Java 任务中心管理的本地进程
export const managedProcessApi = {
  list: () => request.get('/java/task/processes'),
  detail: name => request.get(`/java/task/processes/${name}`),
  start: data => request.post('/java/task/processes/start', data),
  startPythonWorker: data => request.post('/java/task/processes/python-worker/start', data),
  stop: name => request.post(`/java/task/processes/${name}/stop`),
}

export const taskApi = jobTaskApi
export default jobTaskApi
