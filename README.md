# 知序 · 物理练习

中文响应式答题 WebApp，前后端独立。React + TypeScript + Vite 前端；Fastify HTTP API；SQLite 本地持久化。Node.js 24 或更高版本。

## 本地运行

```powershell
npm ci
npm run dev
```

打开 http://localhost:5173 。前端 5173，API 3001；开发代理转发 /api。生产式本地运行：`npm run build` 后 `npm start`，打开 http://localhost:3001 。

本地演示账号：student / Student123!；admin / Admin123!。第二学生账号 student2 / Student123! 用于隔离验证。演示题为自编示例，涵盖五种题型，不是当前资料目录的自动导入结果。

## 源码目录

- client/：学生端、管理员端、共用题目渲染器。
- server/：认证、管理、练习 API 与 SQLite 存储。
- shared/：结构化题目、答案类型、输入校验与判分。
- tests/：真实数据库 API 集成测试、内容模型与组件测试。
- public/diagrams/：可复用物理示意图。
- docs/：设计、版本与验证记录。

`npm test` 运行测试；`npm run build` 执行 TypeScript 检查和前端构建。数据在 data/zhixu.sqlite 和 data/uploads，重启保留，不包含在源码包中。

三个迭代版本见 CHANGELOG.md 和 Git 标签；各版能力以更新日志为准。
