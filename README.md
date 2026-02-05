# iFlow OpenAI API

将 iFlow CLI 的 AI 服务转换为 OpenAI 兼容 API，部署在 Cloudflare Workers 上。

## 功能特性

- ✅ OpenAI API 兼容接口（`/v1/chat/completions`、`/v1/models`）
- ✅ 支持流式响应（stream）
- ✅ OAuth 登录自动获取 Token
- ✅ Token 自动刷新
- ✅ Worker 层鉴权保护
- ✅ 多模型支持（GLM-4.7、DeepSeek-V3.2、Qwen3 等）

## 支持的模型

- `glm-4.7` - 智谱 GLM-4.7 (推荐)
- `iFlow-ROME-30BA3B` - iFlow ROME 30B (快速)
- `deepseek-v3.2-chat` - DeepSeek V3.2 对话模型
- `qwen3-coder-plus` - 通义千问 Qwen3 Coder Plus
- `kimi-k2-thinking` - Moonshot Kimi K2 思考模型
- `minimax-m2.1` - MiniMax M2.1
- `kimi-k2-0905` - Moonshot Kimi K2 0905

## 部署步骤

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

### 5. 设置 Worker 访问 Token（鉴权密钥）

部署后，你需要设置一个 Worker 访问 Token，用于保护你的 API。

**方式一：通过 Cloudflare Dashboard 设置**

1. 进入 Cloudflare Dashboard → Workers & Pages → 你的 Worker
2. 点击 **KV** → 选择你的 KV 命名空间
3. 添加一个 Key-Value：
   - Key: `WORKER_AUTH_TOKEN`
   - Value: `你的访问密码`（建议使用随机字符串）

**方式二：通过 Wrangler CLI 设置**

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录
npx wrangler login

# 设置 Token
npx wrangler kv:key put --binding=IFLOW_KV WORKER_AUTH_TOKEN "你的访问密码"
```

### 6. 部署到 Cloudflare

**方式一：通过 Cloudflare Pages 自动部署**

1. 将代码推送到 GitHub
2. 在 Cloudflare 创建一个新的 Pages 项目
3. 连接你的 GitHub 仓库
4. 构建设置：
   - 构建命令：留空或 `npx wrangler deploy`
   - 输出目录：留空
5. 部署完成！

**方式二：本地手动部署**

```bash
# 登录 Wrangler
npx wrangler login

# 部署
npx wrangler deploy
```

部署成功后，你会得到一个 Worker URL，例如：`https://iflow-openai.your-username.workers.dev`

## 使用方法

### 步骤 1：iFlow OAuth 登录

访问以下 URL 完成授权：

```
https://你的WorkerURL/oauth/login
```

授权成功后，你的 iFlow API Key 和 Token 会自动保存到 KV 中。

### 步骤 2：调用 API

所有 API 请求都需要在 Header 中添加：

```
Authorization: Bearer <你的Worker访问Token>
```

#### 获取模型列表

```bash
curl https://你的WorkerURL/v1/models \
  -H "Authorization: Bearer <你的Worker访问Token>"
```

#### 手动刷新模型列表

当 iFlow 发布新模型时，你可以手动触发刷新：

```bash
curl -X POST https://你的WorkerURL/v1/models/refresh \
  -H "Authorization: Bearer <你的Worker访问Token>"
```

这个接口会：
1. 调用 iFlow API 获取最新模型列表
2. 自动检测并添加新模型
3. 返回更新后的完整模型列表

#### 聊天对话（非流式）

```bash
curl https://你的WorkerURL/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的Worker访问Token>" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ]
  }'
```

#### 聊天对话（流式）

```bash
curl https://你的WorkerURL/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的Worker访问Token>" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      {"role": "user", "content": "写一首关于春天的诗"}
    ],
    "stream": true
  }'
```

### 步骤 3：在应用中使用

因为 API 完全兼容 OpenAI，你可以直接使用 OpenAI SDK：

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

| 端点 | 方法 | 说明 | 是否需要鉴权 |
|------|------|------|-------------|
| `/` | GET | 服务信息 | ❌ |
| `/health` | GET | 健康检查 | ❌ |
| `/oauth/login` | GET | OAuth 登录入口 | ❌ |
| `/oauth/callback` | GET | OAuth 回调 | ❌ |
| `/v1/models` | GET | 获取模型列表 | ✅ |
| `/v1/models/refresh` | POST | 手动刷新模型列表 | ✅ |
| `/v1/chat/completions` | POST | 聊天对话 | ✅ |

## 错误处理

### 401 Unauthorized
- **原因**：Worker 访问 Token 错误或未设置
- **解决**：检查 `Authorization` Header 和 KV 中的 `WORKER_AUTH_TOKEN`

### 401 iFlow 未登录
- **原因**：iFlow OAuth 未授权或 Token 过期
- **解决**：访问 `/oauth/login` 重新授权

### 503 Service Not Configured
- **原因**：`WORKER_AUTH_TOKEN` 未在 KV 中设置
- **解决**：按照上方步骤 5 设置访问 Token

## 注意事项

1. **安全**：不要将你的 Worker 访问 Token 暴露给他人
2. **配额**：iFlow API 有调用配额限制，请注意控制使用频率
3. **Token 刷新**：OAuth Token 会自动刷新，无需手动操作
4. **费用**：Cloudflare Workers 有免费额度，超出后会产生费用

## 开发

本地测试：

```bash
# 安装依赖
npm install

# 本地运行（需要 wrangler）
npx wrangler dev
```

## 许可证

MIT

## 相关链接

- [iFlow CLI](https://iflow.cn/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)