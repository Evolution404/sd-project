# 输电项目全流程管理系统（首轮开发）

单机本地服务器、集中 SQLite 数据库、本地附件目录；Vue 3/TypeScript 前端与 Node.js 服务端。业务设计依据为本目录四份设计资料，不连接旧系统生产数据。

## Mac 本地测试：一条命令启动

在终端运行：

```bash
cd /Users/zhangyuxi/Desktop/sd_project
make dev
```

自动检查 Node.js 24+、首次安装依赖、构建最新前端并在 `http://127.0.0.1:8787` 启动本地服务。**首次运行**会交互式创建管理员（密码不设最低长度或复杂度要求，但不能为空，输入不回显），第二次以后直接启动。保持终端窗口打开，按 `Ctrl+C` 停止。

此命令始终使用项目内 `.local-test-data/` 测试数据库，不会操作 Windows 正式数据库或默认用户数据目录。启动前本机 8787 端口应空闲。可通过 `make dev PORT=8790` 临时指定不同端口，`make check` 执行构建与集成测试。默认监听 0.0.0.0，可通过本机 Wi-Fi IP 在同一局域网访问；但服务器内置精确 IP 白名单仍然生效，未授权设备建立 TCP 连接后立即触发 RST（不发送 HTTP 状态、页面或错误信息）。仅限本机测试可用 `make dev HOST=127.0.0.1`。

## Windows 10 x64（交付 ZIP）

1. 将发布 ZIP 整包解压到可写目录（例如 D:\SDProject），不要直接在压缩包中运行。
2. 双击 **初始化管理员.cmd**，设置用户名与自选强密码（不设默认密码）。
3. 双击 **启动服务.cmd**，保持服务窗口运行。
4. 服务器本机打开 http://127.0.0.1:8787；局域网终端通过 http://服务器IP:8787 访问，按需在 Windows 防火墙放行 TCP 8787。
5. 数据默认存放于 `%LOCALAPPDATA%\SDProject`（SQLite、附件、备份），独立于解压目录，覆盖升级程序不能覆盖数据库。需要改目录时在启动前设置 `DATA_DIR` 环境变量，并使用本地磁盘路径。
6. 发布包包含 Windows x64 Node 运行时、前端已构建文件和生产依赖，不需要在目标 Windows 安装 npm、Node.js 或编译器。
7. 建议仅在可信局域网运行；跨网/不可信网络必须配置 HTTPS、访问限制。运行窗口不能关闭，否则服务停止。

### PowerShell 5.1 与文件编码

- `scripts/first-run.ps1`：**UTF-8 with BOM**（EF BB BF）；其中有中文提示，Windows PowerShell 5.1 需要 BOM 识别 UTF-8。
- `*.cmd`：纯 ASCII，避免 CMD 随系统代码页出现乱码；中文只放文件名或 PowerShell 内。
- `*.mjs`、`*.json`、`*.sql`、`*.ts`：UTF-8 **无 BOM**；PowerShell 5.1 如需写入这些文件，使用 `[System.IO.File]::WriteAllText($path,$text,(New-Object System.Text.UTF8Encoding($false)))`，不要使用默认 `Out-File` / `Set-Content -Encoding utf8`（5.1 默认会写 BOM）。
- 不将执行策略改为全局 Bypass，入口只针对初始化进程使用 `-ExecutionPolicy Bypass`。

## 开发（macOS / Windows）

Node 24+，执行：

```sh
npm ci
npm run build
SD_ADMIN_USER=admin SD_ADMIN_PASSWORD='自选非空密码' npm run init-admin
npm start
```

启动后访问 http://127.0.0.1:8787；开发调试可用 `npm run dev:api` 和 `npx vite`。
不提供默认密码。不同环境使用独立 `DATA_DIR`，禁止测试时使用生产数据库。

## 首轮数据模型和功能

- 电压、线路、物理杆塔、逻辑杆塔真实 SQLite 台账。逻辑身份和资产分开；同塔多回可以指向一座物理塔；名称/实体关联历史、稳定 ID、按版本更新。
- 字典项及历史版本支持新增、编辑、排序、停用与操作默认值；首次数据库不自动插入示例业务选项。
- 需求批量录入：跨线路勾选、按真实沿线顺序追加区段、共同字段、逐行差异、源记录只创建一次、幂等键及事务提交，所有要求有效的数据转入待核实，核实后才生效。
- 需求列表、详情、核实、退回、修订历史与筛选后的全量 Excel 导出；附件上传及鉴权下载 API。
- 账号、角色、会话与后台权限校验；首位管理员使用专用脚本初始化。
- 尚未实现完整项目储备、入库、立项、费用、结算、真正的 Excel 导入向导及数据库恢复切换。详见 `DEVELOPMENT_STATUS.md`。

## Windows 发布包生成（在联网开发机）

运行 `npm run build`，然后 `node scripts/package-win10.mjs`。脚本下载官方 Windows x64 Node.js 运行时，核验官方 SHA256SUMS，复制运行时和生产依赖，生成 `release/sd-project-win10-x64.zip`，扫描编码和必需文件。正式 Windows 10 实机验收尚需在目标机进行。


## 当前正式界面

界面以《批量新建需求》交互截图为正式设计基准：顶部标题栏、左侧业务导航、灰白画布、深绿色主色、逐步表单与矩形杆塔勾选卡片。

导航：工作台、需求中心（含批量新建）、项目中心、框架与协议、基础台账、系统管理。管理员在“系统管理 → IP访问管理”逐个添加、移除可访问的 IPv4/IPv6 地址；非本机的未授权连接在页面及 API 层均被拒绝。

SQLite 架构已通过增量迁移升级至 v4，现有数据库不应因升级程序丢失。项目预算采用“元输入 → 整数分存储”，工作量采用千分位整数；入库/立项均保留阶段快照，项目可创建多个独立执行批次并记录实际完成量。执行费用与结算仍属于后续开发内容。

批量需求的“共同来源依据”支持添加多条；每条来源独立保存到 SQLite，并通过关联表与本次所有需求关联。无自动业务样例导入，生产使用时请先由管理员配置真实业务字典与线路杆塔资料。

验收截图保存于 release/entry-ui-acceptance.png 和 release/entry-mobile-acceptance.png，均来自 Chrome 对真实运行的前端操作，测试时使用临时隔离数据库。

### IP 访问控制的边界

- 未授权来源在 Node.js 的 TCP connection 事件中立即进行 `resetAndDestroy()`，不进入 HTTP 业务处理，也不提供登录页、健康检查、403 或其它 HTTP 响应；本机回环地址仍允许管理。
- 该操作发生在 TCP 三次握手完成之后：网络扫描仍可能看到监听端口。要使未授权 IP 在 TCP 握手前就被过滤，必须由宿主机 Windows 防火墙/网络防火墙进行 DROP；应用层无法自行屏蔽 SYN。
- IP 白名单修改后对**新连接**即时生效；已建立的长连接不保证自动断开，重连时强制核验。
