# 展示/分配与学生自评 Implementation Plan

> Execute inline using executing-plans; use TDD and one independent final review.

**Goal:** 两类教学内容、推送后可见与受限学生自评。
**Architecture:** deliveryMode内容属性、gradingMode答卷快照；独立selfReview状态/端点，复用教师表单，沿用任务及计时服务。
**Spec:** ../specs/2026-10-22-library-modes-design.md

## Constraints and review focus
- 默认assigned；旧答卷保持教师流程；不覆盖旧答案/分数。
- 展示答案在交卷后公布，分配答案在教师发布后公布。
- 自评不得改自动部分或其他学生/教师任务。
- 题干图片/PDF不得通过已推送源库泄露未推送新题。
- 所有角色、师生关系、开放/截止/计时校验保留。

## Tasks
1. [x] shared/model/schema及内容权限：写未推送/已推送/展示/旧快照测试；实现assigned可见查询、默认及展示标准答案校验。
2. [x] server/assignments、attempts、print/uploads：直接开始只能落到收件任务，PDF/图片使用开放任务快照；旧回归fixture加入真实推送，保持业务断言。
3. [x] shared/selfReview、server/routes/selfReview、attemptTiming：先测自评权限/分数/混合/完成冲突；实现展示交卷立即公布与仅非选择自评。
4. [x] client共享GradeControls、SelfReviewPage、教师/学生列表及历史：先测类型设置、待自评、自动分只读及提交；实现响应式页面。
5. [x] 完整测试、构建及独立审查；浏览器展示/分配双流程；备份、部署、文档及源码提交。

## Ledger
- 用户授权按两类调整。既有内容缺省归assigned，已有答卷按创建时流程保留。展示发布必须标准答案完整，才能兑现交卷后对照自评。
- 首轮完整52文件190项通过。独立审查发现任务打印入口丢失、零分人工小问自评阻塞，先增加回归复现，再修复；小数人工分值、类别切换后重练权限、聊天引用同步补充边界回归。审查复核无遗留Important。
- 使用隔离数据库及3002端口完成真实Chromium展示、自评、分配、打印与教师收卷双流程，截图覆盖桌面、平板、手机；实际iPad硬件未验收。测试脚本两处按钮选择器问题修正后完整通过，没有因此修改产品行为。
- 最终52文件195项全部通过，TypeScript及生产构建通过。4.3.0已部署局域网，健康/账号/资源检查通过；138条文档、91个版本及42份附件内容指纹完全一致，备份记录在data/library-modes-backup.json。临时验收服务已停止。
