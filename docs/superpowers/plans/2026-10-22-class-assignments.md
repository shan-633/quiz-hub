# 班级任务与计时 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session; preserve the existing local deployment directory and branch.

**Goal:** 教师分组并推送限时任务，学生倒计时、到期交卷和查看状态。
**Architecture:** 独立班级表/成员表、任务快照/收件表；索引保存强制截止时间，由服务端定时及写入口共同处理。
**Tech Stack:** 现有React、Fastify、SQLite、TypeScript，无新增依赖。
**Spec:** ../specs/2026-10-22-class-assignments-design.md

## Global Constraints
- 只能分组当前关联学生；只推送自己的已发布内容。
- 保留原目录；收件及规则快照不可被后续班级/题库修改改变。
- 截止和开始加时长取早者；硬截止用服务器时间，离线不延期。
- 旧作答无计时迁移；数据备份后部署。

## Review Focus
- 重叠组重复收件及并发重复开始：唯一索引及事务保证同一任务只有一份答卷。
- 截止瞬间保存/上传：提交前复查，禁止截止后写入。
- 后台/断网/重启：服务端主动提交且保留已存答案。
- 关系解除/角色变化：所有组、任务和成绩入口复用当前授权。
- 试卷变更：推送内容、分值及规则快照保持不变。

## Task 1: 班级与任务后端
Files: shared/assignments.ts、server/assignments.ts、server/routes/assignments.ts、server/app.ts、server/store.ts、tests/assignments.test.ts。
Interfaces: AssignmentService groups/create/update/push/studentTasks/start；GET/POST/PUT /api/teacher/groups、GET /api/teacher/students、GET/POST /api/teacher/assignments、GET /api/tasks。
- [x] 先写权限、重复组去重、快照与重复开始的API测试，确认失败。
- [x] 建表、服务及路由实现；任务状态关联原答卷，规则快照，不返回解答。
- [x] 定向测试通过。

## Task 2: 服务端计时
Files: server/attemptTiming.ts、server/routes/{attempts,uploads}.ts、shared/{model,schema}.ts、tests/attemptTiming.test.ts。
Interfaces: timingSnapshot、expireAttempt、submitAttempt、startDeadlineWorker；attempt.dueAt/timeLimitMinutes/enforceTimeLimit/assignmentId/submissionReason/late。
- [x] 先写硬/软超时、无人在线、启动恢复、保存和上传拒绝测试，确认失败。
- [x] 索引、时钟、定时交卷与入口复查；普通练习默认计时规则兼容旧数据。
- [x] 定向及相关原回归通过。

## Task 3: 教师/学生界面
Files: client/pages/{TeacherStudentsPage,TasksPage}.tsx、client/components/{PushAssignment,AttemptTimer}.tsx、client/pages/{TeacherLibraryPage,AttemptPage,HistoryPage}.tsx、client/App.tsx、client/assignments.css、tests/assignmentsUi.test.tsx。
Interfaces: 教师学生分组/推送入口；学生/tasks、倒计时及强制退出后的状态。
- [x] 先写分组/推送表单和硬超时锁定/跳转组件测试，确认失败。
- [x] 响应式页面；限时默认设置与推送覆盖；服务端时间校准并在恢复前台时复核。
- [x] 构建及定向测试通过。

## Task 4: 验收与部署
Files: README.md、CHANGELOG.md、docs/class-assignments.md、docs/verification.md及截图。
- [x] 完整回归、构建和独立只读审查，修复发现。
- [x] 临时数据端到端验收：建组→推送→答题→自动交卷→教师收卷→学生状态。
- [x] 备份真实数据，升级局域网运行服务，核对数据与健康，纳入本次源码提交。

## Execution ledger
- 用户明确要求新增并沿用本地部署；在现有工作分支执行。按已授权范围完成具体可检查实现，无额外权限变更或外部发布。
- Ruling: 任务是独立推送层，原题库目录保留；名单和题目均为发送时快照。避免后来改班级导致已布置考试变化；若需重做则重新推送。
- 已完成3项任务。新增13项回归覆盖分组/快照/计时/重启/断网恢复；第一次完整回归173项通过。
- 独立只读审查发现1项Important：大答案校验跨过硬截止。确定性回归先返回200失败，加入最终写入前核验后409通过，截止前答案保留。上传元信息异步读取也移至最终授权检查前。
- 隔离3002端口、全新临时数据真实浏览器走通建组、界面推送、学生保存及刷新、1分钟到时自动退出、任务待批改、原答案只读和教师收卷状态；桌面1440、平板820、手机390截图留档，无横向溢出或浏览器异常。修正验收脚本误将链接/选项label当button/input的选择器，不涉及产品修补。
- 138个非会话文档、91个题目版本、42个附件及全部既有关系/聊天表已备份，路径记录于data/class-assignments-backup.json。完整回归SSE文件出现两次Windows原生工作进程退出；单独重复5轮共10项通过，最终开启致命报告的完整重跑47文件174项通过且无报告。根因未确定，不将失败运行计为通过，不宣称原生问题已修复；详见验收记录。
- 4.1.0已部署局域网。全部原有非会话表及附件指纹与备份完全一致，只有四张新表；健康、生产JS、原师生目录/题目、进度SSE、管理员首次改密门禁及新分组/任务接口验证通过。
