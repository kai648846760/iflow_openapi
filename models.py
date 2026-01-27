"""
Pydantic 数据模型定义
用于 OpenAI 兼容接口的请求和响应验证
"""
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, field_validator


# ==================== 请求模型 ====================

class Message(BaseModel):
    """消息模型"""
    role: Literal["user", "assistant", "system"] = Field(..., description="消息角色")
    content: str = Field(..., description="消息内容")


class ChatRequest(BaseModel):
    """聊天请求模型"""
    model: str = Field(..., description="模型名称，必须为 'iflow'")
    messages: List[Message] = Field(..., min_length=1, description="消息列表")
    stream: bool = Field(default=True, description="是否使用流式响应，必须为 true")

    @field_validator('model')
    @classmethod
    def validate_model(cls, v: str) -> str:
        """验证 model 字段必须为 'iflow'"""
        if v != 'iflow':
            raise ValueError('model must be "iflow"')
        return v

    @field_validator('stream')
    @classmethod
    def validate_stream(cls, v: bool) -> bool:
        """验证 stream 必须为 true"""
        if not v:
            raise ValueError('stream must be true')
        return v


# ==================== 响应模型 ====================

class Delta(BaseModel):
    """Delta 模型 - 流式响应增量"""
    content: Optional[str] = Field(None, description="内容增量")


class Choice(BaseModel):
    """Choice 模型 - 选择项"""
    index: int = Field(0, description="选择索引")
    delta: Delta = Field(..., description="增量内容")
    finish_reason: Optional[Literal["stop", "length", "content_filter"]] = Field(
        None, description="结束原因"
    )


class ChatCompletionChunk(BaseModel):
    """流式响应 chunk 模型 - 遵循 OpenAI 规范"""
    id: str = Field(..., description="请求 ID")
    object: Literal["chat.completion.chunk"] = Field(
        "chat.completion.chunk", description="对象类型"
    )
    created: int = Field(..., description="创建时间戳")
    model: str = Field("iflow", description="模型名称")
    choices: List[Choice] = Field(..., min_length=1, description="选择列表")


# ==================== 错误响应模型 ====================

class ErrorDetail(BaseModel):
    """错误详情模型"""
    message: str = Field(..., description="错误消息")
    type: str = Field("invalid_request_error", description="错误类型")
    param: Optional[str] = Field(None, description="错误参数")
    code: Optional[str] = Field(None, description="错误代码")


class ErrorResponse(BaseModel):
    """错误响应模型"""
    error: ErrorDetail = Field(..., description="错误详情")