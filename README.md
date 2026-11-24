# 私人四川麻将 · 血战到底

仅供你和三位朋友使用的在线四川麻将。房主创建私人房间并把邀请链接发给朋友,四人确认后开局。没有账号系统、公开房间、匹配、语音或任何真钱功能。

- 前端:React + TypeScript + Vite(牌桌完全用 HTML/CSS 绘制)
- 后端:Cloudflare Workers + SQLite-backed Durable Object(每桌一个 Durable Object,是牌局的唯一权威;WebSocket 通信)
- 同一个 Worker 同时提供静态页面、HTTP API 和 WebSocket

牌规、计分、炸胡处罚见 [docs/RULES.md](docs/RULES.md);依赖许可证见 [docs/LICENSES.md](docs/LICENSES.md)。

## 目录结构

```
shared/   牌规引擎、规则快照、胡牌/番数判定、视图与协议(前后端共用)
worker/   Worker 入口(路由、限流)与 Room Durable Object
web/      React 前端
tests/    Vitest 单元测试与 Worker/Durable Object 集成测试
e2e/      Playwright:四个独立浏览器客户端联机测试、手机窄屏布局检查
docs/     规则说明、许可证
wrangler.jsonc  Cloudflare 配置(Durable Object 绑定、SQLite 迁移、静态资源)
```

## 一、安装 Node.js 和 npm

1. 打开 <https://nodejs.org>,下载并安装 **LTS** 版本(要求 Node.js ≥ 20.19.0;开发时使用 Node 24)。npm 会随 Node.js 一起安装。
2. 打开终端(Windows 用 PowerShell),确认安装成功:

   ```
   node -v
   npm -v
   ```

## 二、安装依赖并在本地运行

```
npm install
npm run dev
```

`npm run dev` 会启动 Vite,并在本地用 Cloudflare 的 workerd 运行 Worker 和 Durable Object(与线上行为一致,数据保存在本地 `.wrangler/` 目录)。终端会显示地址,通常是 <http://localhost:5173>。

自己试玩的方法:用同一台电脑打开 4 个**互相独立**的浏览器窗口(例如 Chrome 普通窗口、无痕窗口、Edge 窗口、Firefox 窗口,或不同的浏览器配置文件)——重连凭证保存在浏览器本地存储里,同一个浏览器的普通标签页会共用同一个身份。房主创建房间后复制邀请链接,另外三个窗口打开链接加入。

## 三、测试与类型检查

```
npm run typecheck     # TypeScript 类型检查
npm test              # Vitest:牌规引擎 + Worker/Durable Object 集成测试
npx playwright install chromium   # 只需运行一次,下载测试用浏览器
npm run test:e2e      # Playwright:4 个独立浏览器客户端打完一局 + 手机窄屏检查
```

e2e 会自动启动本地开发服务器,并只在测试中设置两个环境变量:`CLAIM_WINDOW_MS`(把 3 秒响应窗口缩短为 0.4 秒)和 `TEST_NO_RATE_LIMIT`(关闭频率限制,因为所有测试客户端来自同一个 IP)。线上不要设置它们,使用默认的 3 秒与正常限流。

## 四、注册 Cloudflare 并授权 Wrangler

1. 打开 <https://dash.cloudflare.com/sign-up> 注册并验证邮箱。无需绑定银行卡,也无需购买域名。
2. 在项目目录运行:

   ```
   npx wrangler login
   ```

   浏览器会弹出授权页面,点击允许后回到终端。可用 `npx wrangler whoami` 确认已登录。
3. 首次部署时 Cloudflare 会要求你设置一个 `workers.dev` 子域名(例如 `你的名字.workers.dev`),按提示输入即可。

> 不要把 Cloudflare token、`.dev.vars` 或 `.env` 提交到 GitHub。`.gitignore` 已忽略这些文件;本项目也不需要任何密钥。

## 五、先做一次 dry-run,再正式部署

dry-run 只打包并检查配置,**不会发布**,也不会创建线上资源:

```
npm run deploy:dry-run
```

看到 `env.ROOM (Room)  Durable Object`、`env.ASSETS  Assets` 和 `--dry-run: exiting now.` 即表示配置没问题。

确认无误后正式部署:

```
npm run deploy
```

完成后终端会打印形如 `https://my-mahjong.<你的子域名>.workers.dev` 的地址,把它发给朋友即可。第一次部署会按 `wrangler.jsonc` 中的 `migrations`(`new_sqlite_classes: ["Room"]`)创建 SQLite 版 Durable Object。

说明:`npm run deploy` 实际执行 `npm run build && wrangler deploy --config dist/my_mahjong/wrangler.json`,即用 Vite 构建生成的配置部署(静态页面在 `dist/client`,Worker 在 `dist/my_mahjong`)。

> 以下 Cloudflare 控制台的菜单名称可能随官方改版而变化,以实际界面为准。

## 六、连接 GitHub,提交后自动构建部署

1. 把仓库推送到 GitHub。
2. Cloudflare 控制台 → **Workers & Pages** → **Create application** → **Import a repository**(或进入已部署的 Worker → **Settings** → **Builds** → **Connect**),授权 Cloudflare 访问该仓库。
3. 选择生产分支(例如 `main`),并填写:
   - **Build command**:`npm run build`
   - **Deploy command**:`npx wrangler deploy --config dist/my_mahjong/wrangler.json`
   - Worker 名称必须与 `wrangler.jsonc` 中的 `name`(`my-mahjong`)一致。
4. 之后每次推送到该分支,Cloudflare 会自动构建并部署。构建日志在 Worker 的 **Deployments / Builds** 页面查看。

## 七、查看用量

Cloudflare 控制台 → **Workers & Pages** → 选择 `my-mahjong`:

- **Metrics** 查看请求数、CPU 时间、错误。
- Durable Objects 用量(请求、持续时间、SQLite 存储读写)在控制台 **Workers & Pages → Durable Objects** 页面查看。

## 八、免费计划的主要限制

免费额度**不是无限的,也不保证永久不变**,请以官方页面为准:

- Workers: <https://developers.cloudflare.com/workers/platform/limits/>
- Durable Objects: <https://developers.cloudflare.com/durable-objects/platform/pricing/>

要点:Workers 免费版有每日请求次数上限;Durable Objects 只能在免费计划中使用 SQLite 存储后端(本项目已使用),并有每日请求、持续时间和存储读写额度。超出额度后相关请求会被拒绝,到次日重置。WebSocket 长连接会占用 Durable Object 的运行时间,四个人打一局的用量通常很小,但请自己在控制台关注。

## 玩法与注意事项

- 房间码和邀请链接不可预测;重连凭证保存在本机浏览器(`localStorage`)。**清除浏览器数据或换浏览器会丢失身份,无法回到原座位。**
- **"胡"按钮没有二次确认**(按需求始终可点)。在摸打阶段误触会被判炸胡,罚 8 分并退出本局。
- 碰/杠/胡按钮始终显示,不提示是否可用;不合法的碰/杠会被服务器忽略。
- 牌局结束后若 10 分钟没有人进入下一局,牌桌会自动解散并清除数据;四人全部离线超过约 1 分钟(大厅阶段 5 分钟)也会解散。

## 已知限制

- 创建/加入房间的频率限制是**单个 Worker 实例内存**中的,只能挡住简单的刷请求,不是全局严格限流。
- 没有账号系统:凭证丢失无法找回座位。
- 没有观战者与历史牌局回放;房间数据在解散时删除。
- 他人打牌后的 3 秒响应窗口固定为满时长,没有"过"按钮。
- 未在真实 Cloudflare 环境做过多地区/弱网压力测试。
