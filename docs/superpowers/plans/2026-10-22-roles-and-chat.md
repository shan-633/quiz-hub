# 账号隔离与站内聊天 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Continue within the user's authorized implementation and local deployment scope.

**Goal:** 管理员管理账号和多对多师生关系，教学内容按教师隔离，关联师生可实时私聊。
**Architecture:** 单进程Fastify/SQLite；identity与permissions模块统一授权；独立chat表、服务和SSE；教学快照保持不变。
**Tech Stack:** Node24、TypeScript、Fastify、SQLite、React、现有SSE，无新增依赖。
**Spec:** ../specs/2026-10-22-roles-and-chat-design.md

## Global Constraints
- 学生可关联多位教师；教师只能访问自己的题库题目及自己的学生在其试卷上的答卷。
- 管理员不自动获得聊天正文或教学编辑权限。遗留管理员不自动恢复。
- 重置密码、停用、角色变更撤销会话；最后一个启用管理员受保护。
- 保留作答、版本、附件与局域网配置；上线前备份，先隔离验收。

## Review Focus
- 关系撤销时，已打开的进度和消息连接不能继续泄漏内容。
- 跨教师题目id/版本/图片/PDF/导入摘要不能绕过授权。
- 多位教师的同一学生答卷不能混入其他教师收卷箱。
- 首次强制改密在服务端执行，旧管理员不可误激活。
- 发送重试幂等、游标分页和已读位置保持正确。

## Task 1: 身份与迁移
Files: shared/model.ts、server/identity.ts、server/permissions.ts、server/auth.ts、server/routes/admin.ts、scripts/bootstrap-admin.ts、tests/identity.test.ts。
Interfaces: migrateIdentity(store)、publicUser(user)、requireAdmin(req)、linked(store,teacherId,studentId)、canReadLibrary(store,user,item)、canReview(store,user,attempt)。
- [x] 先测试多教师关系、账号创建/重置/角色/最后管理员、旧管理员停用与迁移幂等，运行观察失败。
- [x] 实现独立关系表/审计/迁移、集中授权及管理员API，安全初始化命令与强制改密。
- [x] 定向测试通过；迁移增加归属元数据并停用遗留管理员，原密码及题目版本保留。

## Task 2: 教学隔离
Files: server/routes/{library,questions,attempts,teacher,uploads,print,bankImport,progressStream}.ts、server/import/bankImport.ts、server/progressStore.ts、tests/teachingIsolation.test.ts及旧fixture。
Interfaces: 复用Task1权限；listProgress(teacherId?)、访问变更订阅；禁止跨教师选题及导入摘要共享。
- [x] 先测试两教师题库/收卷/图片/导出/开始练习直接越权失败与自身访问成功。
- [x] 所有教学入口授权，摘要通过SQL过滤，SSE按连接过滤，关系变更全量校准。
- [x] 调整旧测试明确所属教师和登录前提，保持原业务断言；回归。

## Task 3: 独立聊天后端
Files: shared/chat.ts、server/chat.ts、server/routes/chat.ts、server/eventStream.ts、tests/chat.test.ts。
Interfaces: ChatService.contacts/conversations/messages/send/read；GET/POST /api/chat/*；GET /api/chat/events。
- [x] 先测试非关系拒绝、双方消息/幂等/分页/已读/关系移除只读及第三方拒绝。
- [x] 消息事务持久化后通知，只向参与者推送；会话及角色复查、心跳、断开清理。
- [x] 实际HTTP测试SSE、未读及撤销权限；临时数据库重建应用验证消息和已读游标持久化。

## Task 4: 管理员、联系人和聊天界面
Files: client/pages/{AdminPage,ChatPage,PasswordPage}.tsx、client/chatContext.tsx、client/App.tsx、client/context.tsx、client/pages/{LoginPage,HomePage}.tsx、client/community.css、tests/communityUi.test.tsx。
Interfaces: 按角色入口/强制改密路由；管理账号/多对多关系；会话列表、联系人、历史分页、发送重试、未读及题目引用。
- [x] 组件先测试账号表单、首次改密门禁、聊天发送与只读状态。
- [x] 实现响应式两栏/手机单栏；后台不标读，输入法不误发，安全渲染纯文本。
- [x] 定向组件测试与构建通过。

## Task 5: 验收与部署
Files: README.md、CHANGELOG.md、docs/roles-and-chat.md、docs/verification.md、package.json、截图。
- [x] 完整回归/构建；独立只读审查，修复重要问题。
- [x] 隔离数据库浏览器管理员创建/分配、多教师隔离与师生聊天验收，手机/平板/桌面截图。
- [x] 一致性备份当前数据库，部署迁移并初始化管理员，将临时凭据仅交付本机文件。
- [x] 验证局域网服务、原答案及版本内容不变，更新文档并纳入本次源码提交。

## Execution ledger
- 用户已授权实现及部署，并确认多教师关系；在当前非main工作分支原地执行，以保持本机运行数据位置与部署路径一致。
- 身份、教学隔离、聊天及前端逐步完成；无新增运行依赖。完整测试44文件161项通过，最后界面小改后16项定向回归及生产构建通过。
- 独立审查三项重要问题通过失败回归复现并修复：超过50条消息补齐、失败已读重试、关系调整后首页刷新。状态筛选同步补全。
- 审查裁定：解除关系保留只读聊天为需求；内存中已加载内容不等于新请求越权；SSE会话ID通知后仍经HTTP重新授权；幂等发送复用原消息标识。没有未处理的重要问题。
- 隔离浏览器实测账户创建、关系调整、1→9→1目录切换、第二教师只见自有题目、双向聊天和未读；三种视口截图留档。额外关闭并重建临时应用验证消息/已读持久化。
- 已备份并部署4.0.0。137个原非会话文档在允许的归属/遗留管理员停用元数据迁移外保持一致，91个版本与42份附件内容不变；仅新增新管理员。健康、生产JS、原师生权限及管理员强制改密门禁通过。详见docs/verification.md。
