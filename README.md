# Via

Via 是一款 macOS 桌面 SSH 本地端口转发管理器。它以会话与表格规则的方式，集中维护从 `127.0.0.1:本地端口` 经 SSH 跳板机到内网服务的连接。

> 当前版本提供 SQLite 本地配置、加密凭据、SSH Local 转发、端口冲突隔离、会话批量启停及运行状态展示。所有转发均限制在本机回环地址。

## V1 范围

- 仅支持 SSH Local Forwarding：`127.0.0.1:local_port → SSH session → target_host:target_port`。
- 支持密码认证、私钥文件认证与加密私钥口令。
- 凭据仅本地保存；有应用主密码时加密保存，无主密码时不持久化。
- JSON 导入/导出只含分组、会话非敏感字段与转发规则，永远不导出密码、私钥口令、私钥内容或主密码。
- 支持端口冲突隔离、单条/批量启停和断线自动重连。

V1 不提供 Remote Forwarding、Dynamic/SOCKS5、终端、SFTP、云端同步或跨平台支持。完整产品约束见 [PRD](prd/via.md)，实施步骤见 [技术方案](docs/superpowers/plans/2026-08-12-via-v1-implementation.md)。

## 技术栈

- 桌面框架：Tauri 2 + Rust
- 前端：Vue 3、TypeScript、Vite
- 后端职责：配置、加密、SSH、端口监听、运行状态和重连都由 Rust 管理
- 本地存储：单个 SQLite 数据库（`via.db`）；JSON 仅用于不含凭据的导入/导出

## 环境要求

- macOS 13 或更高版本
- Node.js 22+
- Rust stable（当前工程使用 Rust 2024 edition）
- Xcode Command Line Tools：`xcode-select --install`
- 用于运行桌面应用和打包的 Tauri CLI：`cargo install tauri-cli --version "^2"`

## 快速开始

```bash
make install
make dev
```

`make dev` 会启动 Vite 开发服务器及 Tauri 桌面窗口。首次执行 Rust 构建可能需要下载和编译依赖。

## 常用命令

```bash
make help       # 查看全部命令
make install    # 按 package-lock.json 安装前端依赖
make dev        # 启动桌面开发环境（需要 Tauri CLI）
make build      # 构建前端并编译 Rust 二进制
make test       # 前端测试、类型检查、Rust 格式/Clippy/单测
make check      # 快速静态检查
make package    # 生成并 ad-hoc 签名 macOS .app 包（需要 Tauri CLI）
make clean      # 删除 dist 与 Rust target 构建产物
make clean-all  # 在 clean 基础上删除 node_modules
```

打包产物位于 `src-tauri/target/release/bundle/macos/`。`make package` 会使用本机 ad-hoc 签名，使本地开发环境可校验和运行该 `.app`。对外分发前仍须使用 Apple Developer ID 重新签名并完成公证；该命令不会上传或发布任何产物。

## 项目结构

```text
src/                         Vue 前端
src/types/via.ts             前后端传输 DTO
src-tauri/src/domain/        会话、规则与校验模型
src-tauri/src/storage/       版本化本地配置与安全导入导出
src-tauri/tests/             Rust 集成测试
prd/via.md                   产品需求文档
docs/superpowers/plans/      实施计划
```

## 安全原则

- 隧道只能监听 `127.0.0.1`，不暴露至局域网。
- 导出配置永不携带凭据。
- 会话、规则、主机信任记录与加密凭据存于本地 SQLite；密码与私钥口令仅以加密 BLOB 形式写入数据库。
- 日志不得记录密码、私钥口令或私钥内容。
- 首次 SSH 连接将要求确认主机密钥指纹；指纹变化时应阻断连接。

### 应用设置

凭据库初始化完成后，可从标题栏打开“设置”。语言支持跟随系统、简体中文和 English；字体大小支持小、中、大；主题支持跟随系统、浅色和深色。设置保存在当前设备的 SQLite 数据库中，不会进入配置 JSON 的导入或导出内容。

外观调整会立即预览，并按顺序写入本地数据库；写入失败时会回退到最近一次成功保存的设置并保留设置窗口，便于重试。选择“跟随系统”主题后，Via 会实时响应系统深浅色变化。

“本地凭据”区域可在凭据库已解锁时修改主密码。该操作只使用新主密码重新加密同一份数据密钥，不会改写已保存的 SSH 密码、私钥口令或恢复码；修改成功后，现有恢复码仍然有效。

### 主密码与恢复码

首次启动时必须设置应用主密码，Via 使用它保护保存在当前设备上的 SSH 密码和私钥口令。初始化完成后会生成 10 枚恢复码，并且只显示一次；请立即将它们保存在密码管理器等安全位置，并在确认保存前不要关闭应用窗口。

忘记主密码时，可使用一枚未使用的恢复码设置新的主密码。恢复成功后，原恢复码全部失效，Via 会生成并仅显示一次全新的 10 枚恢复码。恢复功能只恢复对本机加密凭据副本的访问，无法找回、重置或下载远端服务器上的 SSH 凭据。

### Master password and recovery codes

Via requires a master password for locally encrypted credential copies. The 10 recovery codes are shown once and rotate after recovery; they restore local access only and cannot recover credentials from remote SSH servers.

## 开发验证

提交前运行：

```bash
make test
make build
```
