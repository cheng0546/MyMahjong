# 依赖许可证

版本为 `package.json` 中锁定的精确版本(`.npmrc` 设置 `save-exact=true`)。许可证取自各包安装后的 `package.json` 的 `license` 字段,并核对了仓库链接。本项目为私人使用,未分发;下表为 2026-11 核对结果,升级依赖后请重新核对(可用 `npm ls --all` 与上述方法)。

## 运行时依赖(会打包进前端)

| 包 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| react | 19.3.1 | MIT | https://github.com/react/react |
| react-dom | 19.3.1 | MIT | https://github.com/react/react |

## 开发/构建/测试依赖(不随页面发布)

| 包 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| vite | 8.3.8 | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | 6.3.0 | MIT | https://github.com/vitejs/vite-plugin-react |
| @cloudflare/vite-plugin | 1.70.1 | MIT | https://github.com/cloudflare/workers-sdk |
| @cloudflare/vitest-plugin | 1.9.2 | MIT | https://github.com/cloudflare/workers-sdk |
| @cloudflare/workers-types | 5.20261124.1 | MIT OR Apache-2.0 | https://github.com/cloudflare/workerd |
| wrangler | 4.168.0 | MIT OR Apache-2.0 | https://github.com/cloudflare/workers-sdk |
| vitest | 5.1.1 | MIT | https://github.com/vitest-dev/vitest |
| @playwright/test | 1.65.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| typescript | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @types/react | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## 传递依赖概况(已安装的 node_modules)

MIT 99、Apache-2.0 11、MIT OR Apache-2.0 5、BSD-2/3-Clause 各 2、ISC 2、MPL-2.0 2、CC0-1.0 1、Apache-2.0 AND LGPL-3.0-or-later 1。没有许可证缺失或 UNKNOWN 的包。

## 需要注意的项

- **`@img/sharp-win32-x64`(Apache-2.0 AND LGPL-3.0-or-later)**:`wrangler` 间接依赖的图片处理库 `sharp` 的预编译二进制(内含 libvips,LGPL)。仅在开发机本地的 Wrangler 工具链中使用,**不会进入部署到 Cloudflare 的 Worker 或前端包**。若不分发这些二进制,通常没有额外义务。
- **`lightningcss`(MPL-2.0)**:Vite 构建工具链的间接依赖,仅构建时使用。MPL-2.0 为文件级弱 copyleft,只要不修改并再分发其源文件,没有额外义务。
- `@playwright/test` 首次运行 `npx playwright install chromium` 会另外下载 Chromium 浏览器,其许可证由 Chromium 项目各自规定,本项目不分发。
- 本项目不使用付费字体/图标/图片/音效:牌面完全由 CSS 绘制。
- 本项目自身尚未指定开源许可证(`private: true`),如需公开请先选择。

本文不是法律意见。
