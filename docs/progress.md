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

Task 4: complete — 23 项完整套件通过，tsc 与构建通过；两页实际鼠标笔迹刷新恢复、两张测试图片上传、390px 视口检查。Apple Pencil 和系统拍照未做真机验证。
Ruling: 手写草稿以可编辑笔迹立即落本机并同步；提交时为每页生成服务端预览快照，避免每一笔都上传新图片。
Ruling: 数学库间接依赖存在旧版低危通告，使用 npm overrides 对齐直接安装的修复版 KaTeX，npm install 复核 0 vulnerabilities。

Task 5: complete — V3 模板/表格/子题/稳定 ID 编辑、设备宽度预览、发布校验和响应式优化；34 项测试与生产构建通过。
Task 6: complete — 独立审查的 3 个重要问题均先重现失败后修复，reviewer 复查确认修复范围无阻断；三个源码标签与压缩包、启动脚本、更新日志、实际截图和验收边界已整理。
Browser evidence: Windows 一键启动成功；后台新建题库与实验题并发布，学生提交得到 4/4；停止 API 时文字保留本机，恢复后重试同步成功，刷新内容完整；手机/平板/PC 视口通过，无页面横向溢出。
Delivery scope: 三版是已完成的本地可运行实现；Apple Pencil、iPad Safari 和系统相机仍需真机复核，未部署公网。运行数据不打包。
