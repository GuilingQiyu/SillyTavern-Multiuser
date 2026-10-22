# SillyTavern (Multi-User Enhanced Fork)

LLM Frontend for Power Users — with Multi-User Registration, Security Hardening, and Chinese Localization Defaults.

## Personal Modifications (`multiuser` Branch) / 个人修改说明（`multiuser` 分支）

### English Summary

1. **Multi-User Public Registration & Login Hardening**
   - Redesigned glassmorphic login, registration, and password recovery page (`public/login.html`, `public/css/login.css`, `public/scripts/login.js`), enforcing discreet handle login (`enableDiscreetLogin: true`) so the user list is never publicly exposed.
   - Added public self-registration (`POST /api/users/register`), configurable via `enableUserRegistration: true` in `config.yaml`, with handle format validation (`/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/`), case-insensitive duplicate checks, path traversal protection (`isPathUnderParent`), and IP rate limiting (`rateLimiting.accountsRegisterMaxAttempts`).
   - Built-in backend single-use SVG CAPTCHA verification (`GET /api/users/captcha`) required for registration and automatically triggered after login failures, plus an optional Cloudflare Turnstile verification hook (`turnstile.enabled`, `turnstile.siteKey`, `turnstile.secretKey` in `config.yaml`) validated server-side via Cloudflare `siteverify`.
   - Extracted all authentication UI labels, placeholders, and frontend/backend error prompts into `public/locales/zh-cn.json` and `public/locales/zh-tw.json` via `data-i18n` and `t` localization.
2. **Multi-User Isolation, Cache & Plugin Compatibility Fixes**
   - Fixed character `DiskCache` background synchronization (`src/endpoints/characters.js`) so background verification checks all user directories (`getUserDirectoriesList()`) rather than evicting other users' cached character cards.
   - Fixed third-party extension static routing (`src/server-main.js`, `src/users.js`, `src/endpoints/extensions.js`) so user-local extensions take precedence over global extensions of the same name and create directories recursively.
   - Ensured newly created, registered, or reset accounts always seed full default content (`settings.json`, themes, characters, lorebooks, sprites) even when `skipContentCheck: true` is enabled, and cleaned up avatar keys and directory caches on user deletion.
   - Isolated corrupted `.jsonl` chat backup files (`src/endpoints/backups.js`, `public/scripts/chat-backups.js`) while preserving the standard JSON array response for third-party plugin compatibility (passing skipped files via the `X-Backup-Errors` header).
3. **Configurable Community Links & Admin Prompts (`config.yaml`)**
   - Added an optional `communityPrompt` block in `default/config.yaml` (disabled by default):
     ```yaml
     communityPrompt:
       enabled: false
       loginJumpUrl: ""
       popupMessage: ""
       errorContactPrompt: ""
     ```
   - Supports an optional external link button on the login screen (`loginJumpUrl`), a welcome banner toast on the home page (`popupMessage`), and an administrator contact prompt appended to connection, backup, and password recovery error messages (`errorContactPrompt`).
4. **Default Content, Themes, API & Performance Tweaks**
   - Included a Simplified Chinese default character card (`default_索菲娅.png`), matching lorebook (`艾尔多利亚.json`), and expression sprites (`索菲娅/`) alongside the English Seraphina card.
   - Added custom box themes (`盒子-浅色`, `盒子-深色`, `DefaultBoxTheme`) with automatic first-run theme initialization, default `zh-cn` locale, and OpenAI-compatible (`custom`) default API view.
   - Added `loading="lazy"` for chat media attachments, debounced mobile keyboard resize reflows, and exponential backoff auto-restart in `start.sh`.

### 中文修改说明

1. **多用户公开注册与登录安全加固**
   - 重构毛玻璃风格登录、注册与密码找回页面（`public/login.html`、`public/css/login.css`、`public/scripts/login.js`），默认启用隐蔽句柄登录（`enableDiscreetLogin: true`），不公开暴露用户列表。
   - 新增公开用户注册接口（`POST /api/users/register`），可通过 `config.yaml` 中的 `enableUserRegistration: true` 开关控制；支持用户名格式校验（`/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/`）、忽略大小写防重名、路径穿越防护（`isPathUnderParent`）及 IP 速率限制（`rateLimiting.accountsRegisterMaxAttempts`）。
   - 验证码生成与一次性核验均在后端完成（`src/endpoints/users-public.js`）：默认使用零外部依赖的后端 Session SVG 图形验证码（`GET /api/users/captcha`），同时支持在 `config.yaml` 中开启 Cloudflare Turnstile 人机验证（`turnstile.enabled`、`siteKey`、`secretKey`，由后端请求 Cloudflare `siteverify` 接口完成校验）。
   - 认证页（登录、注册、找回密码）全部文案与前后端报错提示均已抽离至多语言字典（`public/locales/zh-cn.json` 与 `public/locales/zh-tw.json`），支持 `data-i18n` 与 `t` 动态多语言切换。
2. **多用户隔离、缓存与插件兼容性修复**
   - 修复角色卡磁盘缓存 `DiskCache` 后台同步逻辑（`src/endpoints/characters.js`），传入全量用户目录列表（`getUserDirectoriesList()`），避免单用户修改角色时误清空其他在线用户的缓存。
   - 修复第三方扩展静态路由优先级（`src/server-main.js`、`src/users.js`、`src/endpoints/extensions.js`），使单用户私有安装的同名插件正确覆盖全局插件，并支持递归创建扩展目录。
   - 完善新用户初始化与账户重置流程（`src/endpoints/content-manager.js`、`src/endpoints/settings.js`、`src/endpoints/users-admin.js`、`src/endpoints/users-private.js`）：即使开启 `skipContentCheck: true`，新注册或重置的用户仍会自动分发完整默认内容（设置、主题、角色卡、世界书、表情差分），删除用户时同步清理头像键值与目录缓存。
   - 增强聊天备份读取容错（`src/endpoints/backups.js`、`public/scripts/chat-backups.js`）：单文件损坏时自动跳过并提示，同时保持默认返回标准数组结构（通过 `X-Backup-Errors` 响应头传递异常列表），确保第三方备份插件完全兼容。
3. **可配置社群链接、主页公告与报错联系提示（`config.yaml`）**
   - 在 `default/config.yaml` 中新增可选配置项 `communityPrompt`（默认关闭）：
     ```yaml
     communityPrompt:
       enabled: false
       loginJumpUrl: ""
       popupMessage: ""
       errorContactPrompt: ""
     ```
   - 开启后可分别配置：登录页右上角外链跳转按钮（`loginJumpUrl`）、进入酒馆主页时的顶部悬浮公告弹窗（`popupMessage`）、以及连接断开/备份异常/密码找回时的管理员联系提示（`errorContactPrompt`）。
4. **默认中文角色卡、主题、API 与性能优化**
   - 在保留英文原版 `Seraphina` 的同时，默认提供中文版角色卡（`default_索菲娅.png`）、配套中文世界书（`艾尔多利亚.json`）及全套表情差分（`索菲娅/`）。
   - 内置三套盒子主题（`盒子-浅色`、`盒子-深色`、`DefaultBoxTheme`）并支持首次启动自动渲染生效；默认界面语言设为简体中文（`zh-cn`），默认 API 页面设为 OpenAI 兼容接口（`custom`）。
   - 为聊天图片附件启用 `loading="lazy"` 懒加载、为移动端软键盘弹出/收起添加 `resize` 防抖以消除长对话卡顿，并在 `start.sh` 中支持指数退避自动重启。

## Resources

- Full English README: [.github/readme.md](.github/readme.md)
- 完整中文说明文档: [.github/readme-zh_cn.md](.github/readme-zh_cn.md)
- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

## License

AGPL-3.0
