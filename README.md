# iFlow OpenAI API【停止维护】

将 iFlow CLI 的 AI 服务转换为 OpenAI 兼容 API，部署在 Cloudflare Workers 上。

> ⚠️ **声明：该项目仅用于学习使用，不得用于任何商业用途。**

> ⚠️ **声明：该项目仅用于学习使用，不得用于任何商业用途。**

> ⚠️ **声明：该项目仅用于学习使用，不得用于任何商业用途。**

## 功能特性

- OpenAI API 兼容接口（`/v1/chat/completions`、`/v1/models`）
- 支持流式响应（stream）
- OAuth 登录自动获取 Token
- Token 自动刷新（每15分钟检查）
- Worker 层鉴权保护
- 多模型支持（GLM-4.7、DeepSeek-V3.2、Qwen3 等）
- 自动发现新模型（每24小时更新）

## 支持的模型

- `glm-4.7` - 智谱 GLM-4.7 (推荐)
- `iFlow-ROME-30BA3B` - iFlow ROME 30B (快速)
- `deepseek-v3.2-chat` - DeepSeek V3.2 对话模型
- `qwen3-coder-plus` - 通义千问 Qwen3 Coder Plus
- `kimi-k2-thinking` - Moonshot Kimi K2 思考模型
- `minimax-m2.1` - MiniMax M2.1
- `kimi-k2-0905` - Moonshot Kimi K2 0905

## 快速开始

### 1. 准备 Cloudflare 账号

确保你已拥有 Cloudflare 账号，并启用了 Workers 功能。

### 2. 创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **KV**
3. 点击 **Create a Namespace**
4. 命名为 `IFLOW_KV`（或其他名称）
5. 记下命名空间 ID（32位字符串）

### 3. 克隆项目

```bash
git clone https://github.com/kai648846760/iflow_openapi.git
cd iflow_openapi
```

### 4. 配置 wrangler.toml

打开 `wrangler.toml`，修改 KV 命名空间 ID：

```toml
[[kv_namespaces]]
binding = "IFLOW_KV"
id = "你的KV命名空间ID"  # 替换为实际的ID
```

### 5. 设置 Worker 访问 Token

```bash
# 登录 Wrangler
npx wrangler login

# 设置 Token
npx wrangler kv:key put --binding=IFLOW_KV WORKER_AUTH_TOKEN "你的访问密码"
```

### 6. 部署

```bash
npx wrangler deploy
```

部署成功后，你会得到一个 Worker URL，例如：`https://iflow-openai.your-username.workers.dev`

## 使用方法

### OAuth 登录

访问以下 URL 完成授权：

```
https://你的WorkerURL/oauth/login
```

授权成功后，你的 iFlow API Key 和 Token 会自动保存到 KV 中。

### API 调用

所有 API 请求都需要在 Header 中添加：

```
Authorization: Bearer <你的Worker访问Token>
```

#### 获取模型列表

```bash
curl https://你的WorkerURL/v1/models \
  -H "Authorization: Bearer <你的Worker访问Token>"
```

#### 刷新模型列表

```bash
curl -X POST https://你的WorkerURL/v1/models/refresh \
  -H "Authorization: Bearer <你的Worker访问Token>"
```

#### 聊天对话

```bash
curl https://你的WorkerURL/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的Worker访问Token>" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

#### 流式响应

```bash
curl https://你的WorkerURL/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的Worker访问Token>" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      {"role": "user", "content": "写一首诗"}
    ],
    "stream": true
  }'
```

### 使用 OpenAI SDK

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://你的WorkerURL/v1',
  apiKey: '你的Worker访问Token',
});

const response = await openai.chat.completions.create({
  model: 'glm-4.7',
  messages: [{ role: 'user', content: '你好' }],
});

console.log(response.choices[0].message.content);
```

Python 示例：

```python
from openai import OpenAI

client = OpenAI(
    base_url='https://你的WorkerURL/v1',
    api_key='你的Worker访问Token'
)

response = client.chat.completions.create(
    model='glm-4.7',
    messages=[{'role': 'user', 'content': '你好'}]
)

print(response.choices[0].message.content)
```

## API 端点

| 端点 | 方法 | 说明 | 鉴权 |
|------|------|------|------|
| `/` | GET | 服务信息 | ❌ |
| `/health` | GET | 健康检查 | ❌ |
| `/oauth/login` | GET | OAuth 登录入口 | ❌ |
| `/oauth/callback` | GET | OAuth 回调 | ❌ |
| `/v1/models` | GET | 获取模型列表 | ✅ |
| `/v1/models/refresh` | POST | 刷新模型列表 | ✅ |
| `/v1/chat/completions` | POST | 聊天对话 | ✅ |

## 错误处理

| 状态码 | 原因 | 解决方案 |
|--------|------|----------|
| 401 | Worker Token 错误 | 检查 `Authorization` Header 和 KV 中的 `WORKER_AUTH_TOKEN` |
| 401 | iFlow 未登录 | 访问 `/oauth/login` 重新授权 |
| 503 | Worker 未配置 | 在 KV 中设置 `WORKER_AUTH_TOKEN` |

## 定时任务

- 每15分钟：检查并刷新 OAuth Token
- 每天0点：自动更新模型列表

## 开发

```bash
# 本地测试
npx wrangler dev
```

## 许可证

MIT

---

> ⚠️ **重要提醒：该项目仅用于学习使用，不得用于任何商业用途。**
