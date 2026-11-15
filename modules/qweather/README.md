# qweather — 和风天气实时查询模块

> ⚠️ **安全提示（务必先读）**
> - 模块源码（`index.mjs` / `module.json`）与本文档**不含任何真实凭据**；凭据**只在 Aurabot 面板的模块设置项里填写**，模块不读取任何外部配置文件。
> - `apiKey` 是 `password` 类型：面板不回显，日志自动脱敏；请勿把凭据贴到日志、截图或聊天里。
> - 改设置**无需重载模块**：每次工具调用都会重新读取 `api.settings()`。
> - **面板主配置**（Aurabot 的 `ext.qweather`）里含凭据，请勿提交、打包或分享。
> - 这把 API KEY 曾在会话中**明文出现**，**建议尽快到和风天气控制台轮换（重新生成）**。

## 功能

- 只提供一个**模型工具** `qweather_now`：查询指定城市的**实时天气**（不做预报、空气质量、预警、定时任务、面板页面）。
- 入参 `city`（必填，JSON Schema `string`）为城市名，支持中文；返回值为可 JSON 序列化的对象 `{ ok, message }`，`message` 是给模型看的多行天气文本，失败时为对应的中文提示。
- **不注册任何聊天命令、不监听消息、不设定时任务、不开放 HTTP 路由、不注入规则**，工具只在模型主动调用时执行。
- 工具在 `level === 'chat'` 或系统会话（`chat.kind === 'system'`）下不挂载：此时 `api.tool` 的 builder（生成函数）返回 `[]`，属宿主约定。
- 如需让模型更主动使用该工具，可自行添加 `api.rule`；本模块按「只提供工具」的定位未添加。
- 模块先用城市名查询 GeoAPI 拿到经纬度，再按「纬度/经度」请求天气 v1 接口；输出末尾按官方许可要求附带数据来源。
- 无第三方依赖，仅使用 Node 内置 `fetch` 与 `AbortSignal.timeout`（需 **Node ≥ 22.13**，插件版本 ≥ 1.2.0）。

## 安装（Windows）

1. 把整个 `modules/qweather` 目录复制到
   `%USERPROFILE%\.dsh\plugins-data\aurabot\modules\qweather\`，
   最终该目录下应有 `module.json`、`index.mjs`、`README.md`、`LICENSE` 四个文件。
2. 保存后等待数秒，Aurabot 会自动热重载；也可在面板「写模块的工具 → 新建模块」中创建同名模块并粘贴内容。
3. 在模块设置里确认 API Host / API Key，然后在 Aurabot 面板「模拟测试 → 调用工具」选择 `qweather_now`，参数填 `{"city":"北京"}`；或在对话里直接问「北京现在天气怎么样」。

> `module.json` 中 `minPluginVersion` 为 `1.2.0`。若实际插件版本与此不一致，请按实际版本调整该字段。

## 设置项

| 设置 | 类型 | 说明 |
| --- | --- | --- |
| `apiHost` | text | 和风天气控制台「设置」中查看的**专属 API Host**，不带 `https://`、不带结尾 `/`。填错会返回 403 INVALID HOST。模块会自动去掉协议前缀、首尾空白与结尾斜杠。模块会用 URL 解析校验，拒绝含用户名密码、端口、路径、查询串或非法域名的 Host，校验不通过会提示重新填写。 |
| `apiKey` | password | 控制台创建的 **API KEY**。仅通过 `X-QW-Api-Key` 请求头发送，不使用 `?key=`、不使用 Bearer；面板不回显，日志不记录。 |
| `credentialId` | text | 只读记录项：**凭据 ID 是 JWT header 的 `kid`，在 API KEY 模式下不参与认证，也不会被拼进请求**。若要改用 JWT 认证，还需要 Ed25519 私钥 PEM、项目 ID、开发者 ID 并自行签发 JWT；本模块**未实现 JWT**。 |

## 配置

无需任何配置文件，三项都在 Aurabot 面板的模块设置里填。`DEFAULTS` 为空，面板未填时工具会提示先配置；改完设置无需重载模块。

## 使用的接口（仅 HTTPS，走专属 Host）

- 城市搜索：`GET https://<apiHost>/geo/v2/city/lookup?location=<城市>&lang=zh&number=1`
  （旧版错误码：HTTP 200 + body 里的 `code`，成功为 `"200"`；模块以 `String(body?.code) !== '200'` 判断，同时兼容字符串 `"200"` 与数字 `200`）。
- 实时天气：`GET https://<apiHost>/weather/v1/current/<lat>/<lon>?lang=zh`
  （**纬度在前、经度在后**；GeoAPI 的 `location` 坐标输入是「经度,纬度」，两者顺序不要写反）。
- v1 天气接口使用 v2 错误码：HTTP 状态码即业务状态，错误体为 `application/problem+json`，字段嵌套在 `error` 对象内（`error.status` / `error.title` / `error.detail` 等）。
- v1 的 `temperature`、`feelsLike`、`wind.speed`、`visibility`、`pressure` 等带单位的量是 `{ value, unit }` 对象；`humidity` 是 0~1 比例（输出湿度时已换算为百分数）。
- 和风 API 强制 Gzip，Node 内置 `fetch`（undici）会自动解压，模块直接 `await res.json()`，不手写 zlib、不设置 `Accept-Encoding`。

## 常见错误

| 现象 | 处理 |
| --- | --- |
| 403 / INVALID HOST | 检查 `apiHost` 是否为控制台里的专属 Host，且不带 `https://`。 |
| 403 额度不足 | 检查控制台套餐与剩余额度。 |
| 401 | 检查 `apiKey` 是否正确、是否已轮换。 |
| 429 | 触发限流，稍后再试。 |
| 404 | 接口路径或 Host 不对，检查 `apiHost`。 |
| 500 / 网络超时 | 返回「天气服务暂时不可用，请稍后再试」，稍后重试。 |
| 「没找到这个城市」 | 换用更完整的地名，或带上区县名称。 |
| 「暂无该地区天气数据」 | 接口返回 `metadata.zeroResult === true`，该地区当前无数据。 |

## 许可

MIT，见 [LICENSE](LICENSE)。
