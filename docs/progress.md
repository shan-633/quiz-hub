# SDD ledger — plan: ../../docs/webapp-design/implementation-plan.md

2026-10-20：用户确认设计并要求连续优化三个版本。

Ruling: 在本会话连续执行，不再为已授权的编码重复请求许可；先记录实现计划，再实施。
Ruling: 父目录 .git 无法识别；新建 physics-webapp 独立仓库和 work/three-versions 分支，不触碰既有资料。
Ruling: 本轮选定本地 React + Fastify + SQLite 运行平台，按用户已确认的交付建议；不将需要本地磁盘的后端误部署到 Workers。

Pre-flight: shared/model.ts 的 Question、Answer、ContentBlock 是渲染/编辑/API 边界；学生版只从后端 publicQuestion 获得，不传 solution。所有答案写入使用 revision。后端与客户端均使用稳定 ID。

Task 1: in progress — 内容模型与判题，先测试再实现。

Task 1: complete — 8 项 domain 测试通过。
Task 2: complete — 6 项真实 SQLite API 集成测试通过。
Task 3: complete — 3 项渲染测试通过；tsc/Vite 构建通过；浏览器验证学生登录和练习展示。
Ruling: Windows 环境中 tsx CLI watch 子进程存在但 API 未监听；同模块由 node --import tsx 启动立即监听，改用 Node 原生 watch，复测 npm run dev 双服务均启动。
V1 scope: 计算文字与公式已完成；多页笔迹、照片和本机离线保存属于 V2，不能将 V1 当作最终交付。
