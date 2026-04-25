# Feature List

## 优先级排序

### 高优先级

- [x] **智能 Agent 执行模式 (auto)**
  - 后端实现: LLM 判断任务复杂度，自动选择单次调用或 plan-and-execute
  - 前端需更新 Agent 配置界面，添加 "auto" 选项

- [x] **任务列表 UI**
  - PlanExecuteTaskPanel 已实现完成状态、折叠展开

### 中优先级

- [ ] Agent 配置界面添加执行模式选择（auto/react/single-call/plan-and-execute）
- [ ] 任务状态持久化
- [ ] 计划拖拽排序
- [ ] 批量操作（删除、标记完成）

### 低优先级

- [ ] 任务分类/标签
- [ ] 截止时间提醒
- [ ] 任务导出