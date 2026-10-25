# 公网部署 · 5.1

访问 [考试学习空间](https://74.82.199.118/)。根路径的原cat游戏保留在 [/game/cat/](http://74.82.199.118/game/cat/)，UNO继续在 [/uno/](http://74.82.199.118/uno/)。游戏同时支持HTTPS；HTTP游戏入口仍保留，避免切换协议使原浏览器本地存档和登录令牌失去原来的origin。游戏文件未搬动或重写，Nginx将新路径映射到原目录。

新应用使用独立的`quiz-hub`系统用户和systemd服务：

- 源码和静态构建：`/srv/quiz-hub/current`，指向`releases/5.1.0-20261025`。5.0旧release保留供回滚。
- Node运行时：`/srv/quiz-hub/runtime`，本次为经过官方校验和验证的Node24.22.1。
- 业务数据：`/var/lib/quiz-hub/data`，目录只允许服务用户访问。
- 环境文件：`/etc/quiz-hub.env`，production、DEMO_MODE=false、SECURE_COOKIE=true，监听127.0.0.1:3201。
- Nginx：`/etc/nginx/conf.d/uno.conf`，对应仓库`deploy/nginx-quiz-hub.conf`。UNO的既有房间、身份和socket.io路由继续代理3101，考试接口与根页面代理3201。
- 原Nginx配置和初始数据备份：`/srv/quiz-hub/backups/`，仅root可访问。

本次从本地一致性SQLite备份复制题库、历史、师生关系、聊天及附件，不向GitHub上传这些业务数据。云端清除了旧会话，只替换三个公开演示账号的密码并要求首次修改；其他用户及本地密码不改写。云端初始凭据保存在部署操作者本机的忽略文件`data/quiz-hub-cloud-credentials.txt`，不能加入Git或发到公开聊天。

IP HTTPS使用Let's Encrypt受信任证书。证书采用约6天有效期，由`quiz-cert-renew.timer`每日两次检查续期，成功后reload Nginx；HTTP的ACME路径始终可达。依据官方[Certbot IP证书说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)配置，实际模拟续期已通过。

服务器约1GiB内存。打印验证曾触发系统OOM，已额外增加2GiB交换空间；应用服务MemoryHigh=512M、MemoryMax=768M，并保留浏览器沙箱。使用与服务相同的内存上限，实际中文题目模板打印通过（1页、146488字节）。这是功能验收，不代表已完成公网并发压测；交换空间不能替代更大物理内存。

维护命令：

```sh
systemctl status quiz-hub
journalctl -u quiz-hub -n 50 --no-pager
systemctl restart quiz-hub
nginx -t && systemctl reload nginx
systemctl list-timers quiz-cert-renew.timer
```

更新前先创建包含WAL的SQLite一致性备份、备份上传附件和Nginx配置；先在独立release安装依赖并验证，再切换current并重启服务。构建后的静态资源路径在服务启动时注册，替换dist后必须重启服务。回滚需恢复上一个release与对应环境/配置；不要用旧备份覆盖运行期间新增的作答数据。

源码维护使用仅授权`shan-633/quiz-hub`的永久读写Deploy key，按仓库所有者要求保留。私钥只在操作者本机`.ssh/quiz-hub`，不进入Git或服务器；GitHub主机密钥依据官方HTTPS元信息核对。仓库remote的push使用SSH443，避免失效的HTTPS凭据；不修改其他项目的Git凭据。
