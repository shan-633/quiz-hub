# Multi-exam Implementation Plan

Goal: 一个账号跨学段/学科/地区学习或教学，内容独立分类，兼容现有数据并部署到公网。
Architecture: shared/curriculum统一类型和校验；用户偏好独立存储；内容/任务/作答分类快照；前端可选上下文只影响列表；所有权限继续由原关系模型校验。
Spec: docs/superpowers/specs/2026-10-24-multi-exam.md

- [x] 分类与偏好：shared/curriculum.ts、server/routes/curriculum.ts；API测试多方向、revision、CSRF、隔离和非法输入。
- [x] 内容分类：LibraryItem/Attempt/Assignment的可选curriculum；库编辑/导入校验；创建任务和作答时冻结；测试旧数据不变与冻结。
- [x] 界面：方向管理、顶栏当前方向、题库/题目/首页/任务/历史筛选，元信息标签；移动端布局与旧UI回归。
- [x] 验证与部署：完整测试/构建，真实浏览器验证；服务器配置与数据备份，保留cat/UNO，部署并重启验收。
- [x] 源码：排除数据与凭据后上传GitHub，验证远程提交及干净工作区。

Review focus: 未选择方向时必须看到全部已授权内容；偏好不能授权未推送卷；旧快照不改写；删除当前方向恢复全部；导入默认不能误把外地文件当北京；共享电脑切换账号不能串偏好；云端不能保留公开默认密码。
