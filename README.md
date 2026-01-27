# iFlow OpenAI 兼容 API 接口

## 项目简介

该项目是基于 iFlow 官方 Python SDK 开发的 OpenAI 兼容式 OpenAPI 接口适配层，核心作用是将 iFlow 内置 AI 模型包装为严格遵循 OpenAI 规范接口，让所有支持 OpenAI OpenAPI 标准的工具、客户端、代码库无需任何改造，即可直接调用 iFlow 的 AI 模型能力。

### 核心特性

- **OpenAI 兼容**：严格遵循 OpenAI 规范，支持所有 OpenAI 兼容工具
- **流式响应**：支持流式响应，提供实时的生成体验
- **上下文管理**：正确处理对话历史和角色定义
- **性能优化**：延迟初始化 iFlow 客户端，确保服务快速启动
- **易于集成**：简单易用的 API 接口，无需复杂配置

## 技术栈

- **Python 3.8+**：主要开发语言
- **FastAPI**：高性能的 API 框架
- **iFlow SDK**：与 iFlow CLI 交互的 SDK
- **Pydantic**：数据验证和序列化
- **uv**：Python 包和虚拟环境管理

## 安装说明

### 前提条件

- Python 3.8 或更高版本
- iFlow CLI 0.2.24 或更高版本
- uv（Python 包管理工具）

### 安装步骤

1. **克隆项目**

```bash
git clone https://github.com/kai648846760/iflow_openapi.git
cd iflow_openapi
```

2. **初始化环境**

```bash
# 初始化 uv 项目
uv init

# 创建虚拟环境
uv venv

# 激活虚拟环境（Linux/macOS）
source .venv/bin/activate

# 激活虚拟环境（Windows）
.venv\Scripts\activate
```

3. **安装依赖**

```bash
uv add fastapi uvicorn iflow-cli-sdk pydantic
```

## 使用说明

### 启动服务

```bash
uv run python main.py
```

或使用 uvicorn 直接启动：

```bash
uv run uvicorn main:app --host 127.0.0.1 --port 11666 --log-level info
```

服务将在 `http://127.0.0.1:11666` 上运行。

### API 接口

#### 1. 健康检查

```bash
GET /health
```

响应：

```json
{
  "status": "ok",
  "service": "iflow-openai-compatible-api"
}
```

#### 2. 列出可用模型

```bash
GET /v1/models
```

请求头：
- `Authorization: Bearer 111222333444555666`

响应：

```json
{
  "object": "list",
  "data": [
    {
      "id": "iflow",
      "object": "model",
      "created": 1769502380,
      "owned_by": "iflow"
    }
  ]
}
```

#### 3. 获取模型信息

```bash
GET /v1/models/iflow
```

请求头：
- `Authorization: Bearer 111222333444555666`

响应：

```json
{
  "id": "iflow",
  "object": "model",
  "created": 1769502380,
  "owned_by": "iflow"
}
```

#### 4. 聊天完成（流式响应）

```bash
POST /v1/chat/completions
```

请求头：
- `Authorization: Bearer 111222333444555666`
- `Content-Type: application/json`

请求体：

```json
{
  "model": "iflow",
  "messages": [
    {
      "role": "system",
      "content": "你是一个友好的助手"
    },
    {
      "role": "user",
      "content": "你好，请问你是谁？"
    }
  ],
  "stream": true
}
```

响应：

```
data: {"id":"chatcmpl-12345","object":"chat.completion.chunk","created":1769502380,"model":"iflow","choices":[{"index":0,"delta":{"content":"你好！我是心流 CLI..."},"finish_reason":null}]}

data: {"id":"chatcmpl-12345","object":"chat.completion.chunk","created":1769502380,"model":"iflow","choices":[{"index":0,"delta":{"content":null},"finish_reason":"stop"}]}

data: [DONE]
```

## 使用示例

### 使用 curl 测试

```bash
curl -X POST http://127.0.0.1:11666/v1/chat/completions \
  -H "Authorization: Bearer 111222333444555666" \
  -H "Content-Type: application/json" \
  -d '{"model":"iflow","messages":[{"role":"user","content":"你好，请问你是谁？"}],"stream":true}'
```

### 使用 Python 测试

```python
import requests
import json

url = "http://127.0.0.1:11666/v1/chat/completions"
headers = {
    "Authorization": "Bearer 111222333444555666",
    "Content-Type": "application/json"
}
data = {
    "model": "iflow",
    "messages": [
        {"role": "user", "content": "你好，请问你是谁？"}
    ],
    "stream": True
}

response = requests.post(url, headers=headers, json=data, stream=True)

for line in response.iter_lines():
    if line:
        line = line.decode('utf-8')
        if line.startswith('data: '):
            data = line[6:]
            if data != '[DONE]':
                try:
                    chunk = json.loads(data)
                    content = chunk['choices'][0]['delta'].get('content', '')
                    if content:
                        print(content, end='', flush=True)
                except json.JSONDecodeError:
                    pass
print()
```

## 配置说明

### 安全配置

- **API 密钥**：当前使用固定的 API 密钥 `111222333444555666`，仅用于验证请求格式，无实际的鉴权逻辑
- **模型限制**：仅支持 `model="iflow"`，不做实际的模型路由

### 性能配置

- **延迟初始化**：iFlow 客户端采用延迟初始化策略，确保服务快速启动
- **流式响应**：默认启用流式响应，提供实时的生成体验

## 注意事项

1. **iFlow CLI 必须已安装**：确保 iFlow CLI 0.2.24 或更高版本已安装并可用
2. **网络连接**：确保服务能够访问本地的 iFlow CLI WebSocket 服务
3. **API 密钥**：所有请求必须包含有效的 Authorization 头
4. **模型限制**：仅支持 model="iflow"
5. **流式响应**：仅支持 stream=true 的流式请求

## 故障排除

### 常见问题

1. **服务启动失败**
   - 检查 iFlow CLI 是否已安装
   - 检查端口 8090 是否被占用
   - 检查 Python 依赖是否正确安装

2. **API 请求失败**
   - 检查 Authorization 头是否正确
   - 检查请求体格式是否符合 OpenAI 规范
   - 检查 iFlow CLI 是否正在运行

3. **响应格式错误**
   - 确保请求体中的 stream 参数设置为 true
   - 确保使用正确的模型名称 "iflow"

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 联系方式

- 项目地址：https://github.com/kai648846760/iflow_openapi.git
- 问题反馈：https://github.com/kai648846760/iflow_openapi/issues