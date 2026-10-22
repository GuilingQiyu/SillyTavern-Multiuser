> [!IMPORTANT]  
> 此處資訊可能已經過時或不完整，僅供您參考。請使用英文版本以取得最新資訊。

<a name="readme-top"></a>

![][cover]

<div align="center">

[English](readme.md)  | [German](readme-de_de.md) | [中文](readme-zh_cn.md) | 繁體中文 | [日本語](readme-ja_jp.md) | [Русский](readme-ru_ru.md) | [한국어](readme-ko_kr.md)

[![GitHub 星標](https://img.shields.io/github/stars/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/stargazers)
[![GitHub 分支](https://img.shields.io/github/forks/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/forks)
[![GitHub 問題](https://img.shields.io/github/issues/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/issues)
[![GitHub 拉取請求](https://img.shields.io/github/issues-pr/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/pulls)

</div>

---

## 個人修改說明（`multiuser` 分支）

1. **多使用者公開註冊與登入安全加固**
   - 重構毛玻璃風格登入、註冊與密碼找回頁面（`public/login.html`、`public/css/login.css`、`public/scripts/login.js`），預設啟用隱蔽控制代碼登入（`enableDiscreetLogin: true`），不公開暴露使用者列表。
   - 新增公開使用者註冊介面（`POST /api/users/register`），可透過 `config.yaml` 中的 `enableUserRegistration: true` 開關控制；支援使用者名稱格式校驗（`/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/`）、忽略大小寫防重名、路徑穿越防護（`isPathUnderParent`）及 IP 速率限制（`rateLimiting.accountsRegisterMaxAttempts`）。
   - 內建一次性工作階段 SVG 圖形驗證碼（`GET /api/users/captcha`），用於新使用者註冊校驗並在登入失敗後自動觸發防爆破保護。
2. **多使用者隔離、快取與外掛相容性修復**
   - 修復角色卡磁碟快取 `DiskCache` 背景同步邏輯（`src/endpoints/characters.js`），傳入全量使用者目錄列表（`getUserDirectoriesList()`），避免單一使用者修改角色時誤清空其他線上使用者的快取。
   - 修復第三方擴充功能靜態路由優先順序（`src/server-main.js`、`src/users.js`、`src/endpoints/extensions.js`），使單一使用者私有安裝的同名外掛正確覆蓋全域外掛，並支援遞迴建立擴充目錄。
   - 完善新使用者初始化與帳戶重置流程（`src/endpoints/content-manager.js`、`src/endpoints/settings.js`、`src/endpoints/users-admin.js`、`src/endpoints/users-private.js`）：即使開啟 `skipContentCheck: true`，新註冊或重置的使用者仍會自動分發完整預設內容（設定、主題、角色卡、世界書、表情差分），刪除使用者時同步清理頭像鍵值與目錄快取。
   - 增強聊天備份讀取容錯（`src/endpoints/backups.js`、`public/scripts/chat-backups.js`）：單一檔案損壞時自動跳過並提示，同時保持預設回傳標準陣列結構（透過 `X-Backup-Errors` 回應標頭傳遞異常列表），確保第三方備份外掛完全相容。
3. **可設定社群連結、首頁公告與報錯聯繫提示（`config.yaml`）**
   - 在 `default/config.yaml` 中新增可選設定項 `communityPrompt`（預設關閉）：
     ```yaml
     communityPrompt:
       enabled: false
       loginJumpUrl: ""
       popupMessage: ""
       errorContactPrompt: ""
     ```
   - 開啟後可分別設定：登入頁右上角外鏈跳轉按鈕（`loginJumpUrl`）、進入酒館首頁時的頂部懸浮公告彈窗（`popupMessage`）、以及連線中斷/備份異常/密碼找回時的管理員聯繫提示（`errorContactPrompt`）。
4. **預設中文角色卡、主題、API 與效能最佳化**
   - 在保留英文原版 `Seraphina` 的同時，預設提供中文版角色卡（`default_索菲娅.png`）、配套中文世界書（`艾尔多利亚.json`）及全套表情差分（`索菲娅/`）。
   - 內建三套盒子主題（`盒子-浅色`、`盒子-深色`、`DefaultBoxTheme`）並支援首次啟動自動渲染生效；預設介面語言設為簡體中文（`zh-cn`），預設 API 頁面設為 OpenAI 相容介面（`custom`）。
   - 為聊天圖片附件啟用 `loading="lazy"` 懶載入、為行動裝置軟鍵盤彈出/收起添加 `resize` 防抖以消除長對話卡頓，並在 `start.sh` 中支援指數退避自動重啟。

---

SillyTavern 提供一個統一的前端介面，整合多種大型語言模型的 API（包括：KoboldAI/CPP、Horde、NovelAI、Ooba、Tabby、OpenAI、OpenRouter、Claude、Mistral 等）。同時具備對行動裝置友善的佈局、視覺小說模式（Visual Novel Mode）、Automatic1111 與 ComfyUI 的影像生成 API 整合、TTS（語音合成）、世界資訊（Lorebook）、可自訂 UI、自動翻譯功能，以及強大的提示詞（prompt）設定選項和無限的第三方擴充潛力。

我們擁有一個 [官方文件網站](https://docs.sillytavern.app/) 可以幫助解答絕大多數的使用問題，並幫助您順利入門。

## SillyTavern 是什麼？

SillyTavern（簡稱 ST）是一款本地安裝的使用者介面，讓您能與大型語言模型（LLM）、影像生成引擎以及語音合成模型互動的前端。

SillyTavern 起源於 2023 年 2 月，作為 TavernAI 1.2.8 的分支版本發展至今。目前已有超過 300 位貢獻者，並擁有超過三年的獨立開發歷史。如今，它已成為 AI 愛好者中備受推崇的軟體之一。

## 我們的願景

1. 我們致力於賦予使用者對 LLM 提示詞的最大控制權與實用性，並認為學習過程中的挑戰是樂趣的一部分。
2. 我們不提供任何線上或託管服務，也不會程式化追蹤任何使用者數據。
3. SillyTavern 是由一群熱衷於 LLM 的開發者社群所打造的專案，並將永遠保持免費與開源。

## 我需要高效能電腦才能運行 SillyTavern 嗎？

SillyTavern 的硬體需求相當低。任何能夠運行 NodeJS 20 或更高版本的設備都可以執行。若您打算在本地機器上進行 LLM 推理，我們建議使用擁有至少 6GB VRAM 的 3000 系列 NVIDIA 顯示卡，但實際需求可能因模型和您使用的後端而異。

## 有任何問題或建議？

### 歡迎加入我們的 Discord 伺服器

| [![][discord-shield-badge]][discord-link] | [加入我們的 Discord 伺服器](https://discord.gg/sillytavern) 以獲得技術支援、分享您喜愛的角色與提示詞。 |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |

或直接聯繫開發者：

* Discord: cohee, rossascends, wolfsblvt
* Reddit: [/u/RossAscends](https://www.reddit.com/user/RossAscends/), [/u/sillylossy](https://www.reddit.com/user/sillylossy/), [u/Wolfsblvt](https://www.reddit.com/user/Wolfsblvt/)
* [提交 GitHub 問題](https://github.com/SillyTavern/SillyTavern/issues)

### 我喜歡這個專案，我該如何貢獻呢？

1. **提交拉取要求（Pull Request）**：想了解如何貢獻，請參閱 [CONTRIBUTING.md](../CONTRIBUTING.md)。 
2. **提供功能建議與問題報告**：使用本專案所提供的模板提交建議或問題報告。
3. **仔細閱讀此 README 文件及相關文檔**：請避免提出重複問題或建議。

## 螢幕截圖

<img width="500" alt="image" src="https://github.com/user-attachments/assets/9b5f32f0-c3b3-4102-b3f5-0e9213c0f50f">
<img width="500" alt="image" src="https://github.com/user-attachments/assets/913fdbaa-7d33-42f1-ae2c-89dca41c53d1">

## 安裝指南

有關詳細的安裝說明，請訪問我們的文檔：

* **[Windows 安裝指南](https://docs.sillytavern.app/installation/windows/)**
* **[MacOS/Linux 安裝指南](https://docs.sillytavern.app/installation/linuxmacos/)**
* **[Android (Termux) 安裝指南](https://docs.sillytavern.app/installation/android-(termux)/)**
* **[Docker 安裝指南](https://docs.sillytavern.app/installation/docker/)**

## 授權與致謝

**本程式（SillyTavern）的發布是基於其可能對使用者有所幫助的期許，但不提供任何形式的保證；包括但不限於對可銷售性（marketability）或特定用途適用性的隱含保證。如需更多詳情，請參閱 GNU Affero 通用公共許可證。**

* [TavernAI](https://github.com/TavernAI/TavernAI) 1.2.8 由 Humi 提供：MIT 許可
* 經授權使用部分來自 CncAnon 的 TavernAITurbo 模組
* 視覺小說模式（Visual Novel Mode）的靈感，來源於 PepperTaco 的貢獻（<https://github.com/peppertaco/Tavern/>）
* Noto Sans 字體由 Google 提供（OFL 許可）
* Lexer/Parser 由 Chevrotain 提供 (Apache-2.0 許可) <https://github.com/chevrotain/chevrotain>
* 主題圖示由 Font Awesome <https://fontawesome.com> 提供（圖示：CC BY 4.0，字體：SIL OFL 1.1，程式碼：MIT 許可）
* 預設資源來源於 @OtisAlejandro（包含角色 Seraphina 與知識書）與 @kallmeflocc（SillyTavern 官方 Discord 伺服器成員突破 10K 的慶祝背景）
* Docker 安裝指南由 [@mrguymiah](https://github.com/mrguymiah) 和 [@Bronya-Rand](https://github.com/Bronya-Rand) 編寫
* kokoro-js 函式庫由 [@hexgrad](https://github.com/hexgrad) 提供 (Apache-2.0 許可)

## 主要貢獻者

[![Contributors](https://contrib.rocks/image?repo=SillyTavern/SillyTavern)](https://github.com/SillyTavern/SillyTavern/graphs/contributors)

<!-- LINK GROUP -->
[cover]: https://github.com/user-attachments/assets/01a6ae9a-16aa-45f2-8bff-32b5dc587e44
[discord-link]: https://discord.gg/sillytavern
[discord-shield-badge]: https://img.shields.io/discord/1100685673633153084?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=for-the-badge
