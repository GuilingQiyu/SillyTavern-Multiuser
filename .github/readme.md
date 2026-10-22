<a name="readme-top"></a>

![][cover]

<div align="center">

English | [German](readme-de_de.md) | [中文](readme-zh_cn.md) | [繁體中文](readme-zh_tw.md) | [日本語](readme-ja_jp.md) | [Русский](readme-ru_ru.md) | [한국어](readme-ko_kr.md)

[![GitHub Stars](https://img.shields.io/github/stars/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/forks)
[![GitHub Issues](https://img.shields.io/github/issues/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/SillyTavern/SillyTavern.svg)](https://github.com/SillyTavern/SillyTavern/pulls)

</div>

---

## Personal Modifications (`multiuser` Branch)

1. **Multi-User Public Registration & Login Hardening**
   - Redesigned glassmorphic login, registration, and password recovery UI (`public/login.html`, `public/css/login.css`, `public/scripts/login.js`), defaulting to discreet handle login (`enableDiscreetLogin: true`) so the user list is never publicly exposed.
   - Added public self-registration (`POST /api/users/register`), configurable via `enableUserRegistration: true` in `config.yaml`, with handle format validation (`/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/`), case-insensitive duplicate checks, path traversal protection (`isPathUnderParent`), and IP rate limiting (`rateLimiting.accountsRegisterMaxAttempts`).
   - Built-in single-use SVG CAPTCHA verification (`GET /api/users/captcha`) required for registration and automatically triggered after login failures.
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

---

SillyTavern provides a single unified interface for many LLM APIs (KoboldAI/CPP, Horde, NovelAI, Ooba, Tabby, OpenAI, OpenRouter, Claude, Mistral and more), a mobile-friendly layout, Visual Novel Mode, Automatic1111 & ComfyUI API image generation integration, TTS, WorldInfo (lorebooks), customizable UI, auto-translate, more prompt options than you'd ever want or need, and endless growth potential via third-party extensions.

We have a [Documentation website](https://docs.sillytavern.app/) to answer most of your questions and help you get started.

## What is SillyTavern?

SillyTavern (or ST for short) is a locally installed user interface that allows you to interact with text generation LLMs, image generation engines, and TTS voice models.

Beginning in February 2023 as a fork of TavernAI 1.2.8, SillyTavern now has over 300 contributors and 3 years of independent development under its belt, and continues to serve as a leading software for savvy AI hobbyists.

## Our Vision

1. We aim to empower users with as much utility and control over their LLM prompts as possible. The steep learning curve is part of the fun!
2. We do not provide any online or hosted services, nor programmatically track any user data.
3. SillyTavern is a passion project brought to you by a dedicated community of LLM enthusiasts, and will always be free and open source.

## Do I need a powerful PC to run SillyTavern?

The hardware requirements are minimal: it will run on anything that can run NodeJS 20 or higher. If you intend to do LLM inference on your local machine, we recommend a 3000-series NVIDIA graphics card with at least 6GB of VRAM, but actual requirements may vary depending on the model and backend you choose to use.

## Questions or suggestions?

### Discord server

| [![][discord-shield-badge]][discord-link] | [Join our Discord community!](https://discord.gg/sillytavern) Get support, share favorite characters and prompts. |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |

Or get in touch with the developers directly:

* Discord: cohee, rossascends, wolfsblvt
* Reddit: [/u/RossAscends](https://www.reddit.com/user/RossAscends/), [/u/sillylossy](https://www.reddit.com/user/sillylossy/), [u/Wolfsblvt](https://www.reddit.com/user/Wolfsblvt/)
* [Post a GitHub issue](https://github.com/SillyTavern/SillyTavern/issues)

### I like your project! How do I contribute?

1. Send pull requests. Learn how to contribute: [CONTRIBUTING.md](../CONTRIBUTING.md)
2. Send feature suggestions and issue reports using the provided templates.
3. Read this entire readme file and check the documentation website first, to avoid sending duplicate issues.

## Screenshots

<img width="500" alt="image" src="https://github.com/user-attachments/assets/9b5f32f0-c3b3-4102-b3f5-0e9213c0f50f">
<img width="500" alt="image" src="https://github.com/user-attachments/assets/913fdbaa-7d33-42f1-ae2c-89dca41c53d1">

## Installation

For detailed installation instructions, please visit our documentation:

* **[Windows Installation Guide](https://docs.sillytavern.app/installation/windows/)**
* **[MacOS/Linux Installation Guide](https://docs.sillytavern.app/installation/linuxmacos/)**
* **[Android (Termux) Installation Guide](https://docs.sillytavern.app/installation/android-(termux)/)**
* **[Docker Installation Guide](https://docs.sillytavern.app/installation/docker/)**

## License and credits

**This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.**

* [TavernAI](https://github.com/TavernAI/TavernAI-v1) 1.2.8 by Humi: MIT License
* Portions of CncAnon's TavernAITurbo mod used with permission
* Visual Novel Mode inspired by the work of PepperTaco (<https://github.com/peppertaco/Tavern/>)
* Noto Sans font by Google (OFL license)
* Lexer/Parser by Chevrotain (Apache-2.0 license) <https://github.com/chevrotain/chevrotain>
* Icon theme by Font Awesome <https://fontawesome.com> (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
* Default content by @OtisAlejandro (Seraphina character and lorebook) and @kallmeflocc (10K Discord Users Celebratory Background)
* Docker guide by [@mrguymiah](https://github.com/mrguymiah) and [@Bronya-Rand](https://github.com/Bronya-Rand)
* kokoro-js library by [@hexgrad](https://github.com/hexgrad) (Apache-2.0 License)

## Top Contributors

[![Contributors](https://contrib.rocks/image?repo=SillyTavern/SillyTavern)](https://github.com/SillyTavern/SillyTavern/graphs/contributors)

<!-- LINK GROUP -->
[cover]: https://github.com/user-attachments/assets/01a6ae9a-16aa-45f2-8bff-32b5dc587e44
[discord-link]: https://discord.gg/sillytavern
[discord-shield-badge]: https://img.shields.io/discord/1100685673633153084?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=for-the-badge
