# 知序三版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 交付经过三轮实质迭代的响应式物理练习 WebApp 与独立前后端源码。

**Architecture:** React 前端通过 HTTP JSON API 访问 Fastify 后端。SQLite 持久化题库、题目不可变版本、试卷快照和用户答案；本机 IndexedDB 在同步失败时保存草稿与照片。新项目独立目录和 Git 仓库，不修改既有资料。

**Tech Stack:** TypeScript、React、Vite、Fastify、Node 内置 SQLite、Markdown/KaTeX、Pointer Events、IndexedDB、Vitest。

**Spec:** ./design.md（用户已确认）。执行方式：本会话连续执行；分为三个可运行 Git 标签，不在每个任务间重复询问。

## Global Constraints

- 中文、初中物理；手机 390px / iPad 820px / PC 1440px 响应式。
- 题目包含单选、多选、填空、实验和计算；计算答案可以同时包含文字、笔迹和照片。
- 首版本地运行；公网部署与真机测试不冒充已完成。
- 每题最多 10 张图片，每张最大 10MB；JPEG/PNG/WebP；服务端验证。
- 学生不能获得进行中练习的答案和解析，也不能越权访问资源或后台。
- 保存采用 revision，已提交作答不可修改，题目历史版本不可被更新覆盖。
- 三版均保存提交、更新日志与实际验证证据；最终提供源码压缩包、启动方式、演示账号。

## Review Focus

1. 同时自动保存与提交：提交不能漏掉最后一次修改或附件。
2. 横竖屏和刷新：笔迹、照片和稳定空格 ID 关联不能丢失。
3. 编辑发布中的题目：旧作答与试卷必须继续引用旧版本。
4. 来历不明的 ID / 资源引用：不能读取他人附件、保存他人图片或调用管理功能。
5. 图文混排、长公式、长选项和表格：不得撑破手机视口。

## Task 1 — V1 内容模型与判分

**Files:** shared/model.ts、shared/domain.ts、tests/domain.test.ts。
**Interfaces:** validateQuestion(q): string[]；gradeQuestion(q, answer): Grade；publicQuestion(q)；isAnswered(q, answer)。客户端和服务端共用类型；只有后端载入 solution。

- [ ] 写测试并确认失败：多选不能靠选全部得分；填空稳定 ID 与数值容差；缺失答案不判对；实验题分值汇总；去除标准答案；题目发布校验。
- [ ] 实现内容块树、题型模板与上述函数，跑测试通过。

## Task 2 — V1 持久化 API

**Files:** server/store.ts、server/auth.ts、server/app.ts、server/routes/*.ts、server/seed.ts、tests/api.test.ts。
**Interfaces:** createApp({dataDir, seed?}) 返回可 listen/inject 的 Fastify 实例；/api 路由按设计文档；错误统一 {message}，冲突返回服务器 revision 与答案。

- [ ] 编写失败集成测试：登录/CSRF、学生管理员隔离、题库发布、作答无答案泄漏、同题版本隔离、revision 冲突、重复提交幂等、提交后禁止写入、服务重启数据仍在。
- [ ] 实现真实 SQLite 事务、密码散列、会话、所有权与管理接口，测试转绿。

## Task 3 — V1 学生与后台页面

**Files:** client/App.tsx、client/pages/*.tsx、client/components/QuestionRenderer.tsx、client/components/AnswerInput.tsx、client/styles.css、client/api.ts。
**Interfaces:** QuestionRenderer({question, answer, onChange, disabled})；后台和学生端共用。API 客户端带 CSRF 与 Cookie。

- [ ] 加入渲染行为测试：填空显示输入、切换计算方式保留文字、答案不在进行中页面出现。
- [ ] 实现首页、我的作答、登录、连续题卡、题号导航、提交确认、结果、后台题库/试卷/录题；开始本地预览检查。
- [ ] 构建与测试通过，提交并标记 v1.0.0。

## Task 4 — V2 混合答案与离线恢复

**Files:** client/components/DrawingBoard.tsx、PhotoAnswer.tsx、client/persistence.ts、client/useAnswerSync.ts、server/routes/uploads.ts、tests/sync.test.ts、tests/upload.test.ts。
**Interfaces:** 草稿使用 attemptId＋questionId＋userId 键；同步队列串行保存并返回当前 revision；图片在成功上传后才进入已同步答案。

- [ ] 失败测试覆盖：本地内容覆盖旧服务器草稿、保存过程中又编辑的最后一笔、冲突不静默覆盖、照片所有权/真实格式/数量限制。
- [ ] 实现 IndexedDB、可重试保存、冲突恢复选择；多页手写笔迹/预览、撤销/重做/擦除/仅笔模式；照片上传、顺序、旋转、删除和断网上传队列。
- [ ] 验证刷新、切题、断网与恢复，运行完整套件，提交并标记 v2.0.0。

## Task 5 — V3 录题效率与跨屏优化

**Files:** client/components/editor/*.tsx、shared/domain.ts、client/styles.css、tests/editor.test.ts、tests/security.test.ts。
**Interfaces:** 内容块插入/复制/移动不修改已有 blankId；预览设备宽度 390/820/1440；发布仍通过服务端校验。

- [ ] 失败测试覆盖：子题/表格空格、图文组合、分值错误、空白/无效公式、试卷顺序分值、他人附件引用、撤销后空画布不算已答。
- [ ] 优化模板编辑、图片/公式/表格/子题、拖动与上下移动、答案规则、归档、发布检查；响应式与键盘焦点、错误空状态、附件总览。
- [ ] 检查三个视口与关键完整流程；修复审查问题；构建、测试；提交并标记 v3.0.0。

## Task 6 — 交付与审查

**Files:** README.md、CHANGELOG.md、docs/verification.md、docs/progress.md、scripts/package.ps1。

- [ ] 独立审查权限、保存/提交和完整需求覆盖；问题必须修复并回归。
- [ ] 生成源码 zip（不含 node_modules、运行数据和凭据），包含 lockfile、环境变量示例与一键启动脚本。
- [ ] 打开本地可运行网页版，核对 Git 三版标签与源码压缩包内容，报告已通过与仍需真机验证的项目。
