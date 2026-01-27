"""
FastAPI 应用入口
提供 OpenAI 兼容的 HTTP 接口
"""
import uuid
import json
import time
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ChatRequest,
    ChatCompletionChunk,
    Choice,
    Delta,
    ErrorResponse,
    ErrorDetail,
)
from iflow_service import iflow_service, IFlowConnectionError

# 常量定义
EXPECTED_TOKEN = "111222333444555666"
EXPECTED_MODEL = "iflow"


# ==================== FastAPI 应用初始化 ====================

app = FastAPI(
    title="iFlow OpenAI Compatible API",
    description="将 iFlow AI 模型包装为 OpenAI 兼容接口",
    version="1.0.0",
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 应用生命周期事件 ====================

@app.on_event("startup")
async def startup_event():
    """应用启动时 - 启动 iFlow 进程并初始化长期连接"""
    import subprocess
    import time
    import socket

    print("=" * 60)
    print("正在启动 iFlow OpenAI 兼容 API 服务...")
    print("=" * 60)

    # 检查 iFlow CLI 是否已安装
    try:
        result = subprocess.run(["iflow", "--version"], capture_output=True, text=True)
        if result.returncode != 0:
            print("⚠️  iFlow CLI 未安装，请先安装 iFlow CLI")
            print("安装命令: npm install -g iflow-cli")
        else:
            print(f"✅ iFlow CLI 已安装: {result.stdout.strip()}")
    except FileNotFoundError:
        print("⚠️  iFlow CLI 未安装，请先安装 iFlow CLI")
        print("安装命令: npm install -g iflow-cli")

    # 尝试启动 iFlow 进程
    try:
        # 检查端口是否已被占用
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('127.0.0.1', 8090))
        sock.close()

        if result != 0:
            print("🚀 启动 iFlow 进程...")
            # 启动 iFlow 进程，启用 ACP 服务
            process = subprocess.Popen(
                ["iflow", "--experimental-acp", "--port", "8090"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True
            )
            print("✅ iFlow 进程已启动（后台运行）")
            print("⏳ 等待 iFlow 进程就绪...")
            # 等待 5 秒，确保进程就绪
            time.sleep(5)
        else:
            print("⚠️  端口 8090 已被占用，使用已有的 iFlow 进程")
    except Exception as e:
        print(f"⚠️  启动 iFlow 进程失败: {e}")
        print("请手动启动: iflow --experimental-acp --port 8090")

    # 服务启动完成
    print("=" * 60)
    print("✅ 服务启动完成！")
    print("接口地址: http://127.0.0.1:11666/v1")
    print("健康检查: http://127.0.0.1:11666/health")
    print("=" * 60)


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时"""
    print("=" * 60)
    print("正在关闭服务...")
    print("=" * 60)

    # 关闭 iFlow 连接
    await iflow_service.close()

    print("=" * 60)
    print("✅ 服务已关闭")
    print("=" * 60)


# ==================== 辅助函数 ====================

def create_error_response(
    message: str,
    error_type: str = "invalid_request_error",
    status_code: int = status.HTTP_400_BAD_REQUEST,
) -> tuple[ErrorResponse, int]:
    """
    创建错误响应

    Args:
        message: 错误消息
        error_type: 错误类型
        status_code: HTTP 状态码

    Returns:
        (ErrorResponse, status_code)
    """
    error = ErrorResponse(
        error=ErrorDetail(message=message, type=error_type)
    )
    return error, status_code


async def validate_request(request: Request) -> None:
    """
    验证请求

    Args:
        request: FastAPI 请求对象

    Raises:
        HTTPException: 验证失败
    """
    # 验证 Authorization header
    auth_header = request.headers.get("Authorization")

    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=create_error_response(
                "Missing Authorization header",
                error_type="authentication_error"
            )[0].model_dump()
        )

    # 验证 token 格式
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=create_error_response(
                "Invalid Authorization header format",
                error_type="authentication_error"
            )[0].model_dump()
        )

    # 验证 token 值
    token = auth_header.replace("Bearer ", "").strip()  # 去除所有 "Bearer " 并去除前后空格

    if token != EXPECTED_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=create_error_response(
                "Invalid authentication token",
                error_type="authentication_error"
            )[0].model_dump()
        )


async def stream_generator(
    messages: list, request_id: str
) -> AsyncGenerator[str, None]:
    """
    流式响应生成器

    Args:
        messages: 消息列表
        request_id: 请求 ID

    Yields:
        str: SSE 格式的数据块
    """
    created_timestamp = int(time.time())

    try:
        # 检查是否有用户消息
        has_user_message = False
        for msg in messages:
            if msg.role == "user":
                has_user_message = True
                break

        if not has_user_message:
            raise ValueError("No user message found")

        # 调用 iFlow SDK 获取流式响应（传递完整的消息列表）
        async for text_chunk in iflow_service.stream_chat(messages):
            if text_chunk:
                # 创建 OpenAI 格式的 chunk
                chunk = ChatCompletionChunk(
                    id=request_id,
                    created=created_timestamp,
                    model=EXPECTED_MODEL,
                    choices=[
                        Choice(
                            index=0,
                            delta=Delta(content=text_chunk),
                            finish_reason=None
                        )
                    ]
                )

                # 返回 SSE 格式
                yield f"data: {chunk.model_dump_json()}\n\n"

        # 发送结束信号
        final_chunk = ChatCompletionChunk(
            id=request_id,
            created=created_timestamp,
            model=EXPECTED_MODEL,
            choices=[
                Choice(
                    index=0,
                    delta=Delta(content=None),
                    finish_reason="stop"
                )
            ]
        )
        yield f"data: {final_chunk.model_dump_json()}\n\n"
        yield "data: [DONE]\n\n"

    except IFlowConnectionError as e:
        # iFlow 连接错误
        error_chunk = ChatCompletionChunk(
            id=request_id,
            created=created_timestamp,
            model=EXPECTED_MODEL,
            choices=[]
        )
        yield f"data: {error_chunk.model_dump_json()}\n\n"
        yield "data: [DONE]\n\n"

    except Exception as e:
        # 其他错误
        error_chunk = ChatCompletionChunk(
            id=request_id,
            created=created_timestamp,
            model=EXPECTED_MODEL,
            choices=[]
        )
        yield f"data: {error_chunk.model_dump_json()}\n\n"
        yield "data: [DONE]\n\n"


# ==================== API 路由 ====================

@app.get(
    "/v1/models",
    response_model=None,
    responses={
        200: {"description": "模型列表"},
        401: {"description": "认证失败", "model": ErrorResponse},
    },
)
async def list_models(request: Request):
    """
    列出可用模型

    OpenAI 兼容接口 - 返回可用模型列表
    """
    await validate_request(request)

    return {
        "object": "list",
        "data": [
            {
                "id": "iflow",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "iflow"
            }
        ]
    }


@app.get(
    "/v1/models/{model_id}",
    response_model=None,
    responses={
        200: {"description": "模型信息"},
        401: {"description": "认证失败", "model": ErrorResponse},
        404: {"description": "模型不存在", "model": ErrorResponse},
    },
)
async def retrieve_model(request: Request, model_id: str):
    """
    获取模型信息

    OpenAI 兼容接口 - 返回指定模型的详细信息
    """
    await validate_request(request)

    if model_id != "iflow":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=create_error_response(
                f"Model '{model_id}' not found",
                error_type="invalid_request_error"
            )[0].model_dump()
        )

    return {
        "id": "iflow",
        "object": "model",
        "created": int(time.time()),
        "owned_by": "iflow"
    }


@app.post(
    "/v1/chat/completions",
    response_model=None,
    responses={
        200: {"description": "流式响应"},
        400: {"description": "请求错误", "model": ErrorResponse},
        401: {"description": "认证失败", "model": ErrorResponse},
    },
)
async def chat_completions(request: Request, body: ChatRequest):
    """
    OpenAI 兼容的聊天完成接口

    支持：
    - 流式响应（stream=true）
    - OpenAI 格式的请求和响应
    - 标准 SSE 协议

    限制：
    - 仅支持 model="iflow"
    - 仅支持 stream=true
    - 需要有效的 Authorization header
    """
    # 验证请求
    await validate_request(request)

    # 生成请求 ID
    request_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"

    # 返回流式响应
    return StreamingResponse(
        stream_generator(body.messages, request_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        }
    )


# ==================== 健康检查 ====================

@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "ok", "service": "iflow-openai-compatible-api"}


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=11666,
        reload=False,
        log_level="info"
    )