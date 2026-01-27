"""
iFlow SDK 封装层 - 完全按照官方文档方式实现
"""
import logging
from typing import AsyncGenerator

from iflow_sdk import (
    IFlowClient,
    AssistantMessage,
    TaskFinishMessage,
)
from iflow_sdk import ConnectionError as IFlowConnectionError

# 配置日志
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)


class IFlowService:
    """iFlow SDK 封装服务类 - 完全按照官方文档方式实现"""

    def __init__(self):
        """初始化 iFlow 服务"""
        self._client = None  # 长期客户端实例

    async def initialize(self) -> None:
        """初始化长期连接 - 完全按照官方文档方式"""
        if self._client is None:
            logger.info("初始化 iFlow 客户端...")
            # 按照官方文档方式：创建客户端
            self._client = IFlowClient()
            # 按照官方文档方式：进入上下文
            await self._client.__aenter__()
            logger.info("✅ iFlow 客户端已就绪")

    async def close(self) -> None:
        """关闭连接"""
        if self._client is not None:
            logger.info("关闭 iFlow 客户端...")
            await self._client.__aexit__(None, None, None)
            self._client = None
            logger.info("✅ iFlow 客户端已关闭")

    async def stream_chat(
        self, messages: list
    ) -> AsyncGenerator[str, None]:
        """
        流式聊天接口 - 按照官方文档方式处理消息

        Args:
            messages: 消息列表，包含完整的上下文

        Yields:
            str: 文本片段

        Raises:
            Exception: 其他错误
        """
        # 延迟初始化 iFlow 客户端
        if self._client is None:
            await self.initialize()

        try:
            # 构建完整的上下文消息
            context_message = ""
            for msg in messages:
                if msg.role == "system":
                    context_message += f"{msg.content}\n\n"
                elif msg.role == "assistant":
                    context_message += f"{msg.content}\n\n"
                elif msg.role == "user":
                    context_message += f"{msg.content}\n\n"

            # 按照官方文档方式：发送消息
            await self._client.send_message(context_message)

            # 按照官方文档方式：接收消息
            async for msg in self._client.receive_messages():
                if isinstance(msg, AssistantMessage):
                    # 按照官方文档方式：处理 AssistantMessage
                    if msg.chunk and msg.chunk.text:
                        yield msg.chunk.text

                elif isinstance(msg, TaskFinishMessage):
                    # 按照官方文档方式：处理 TaskFinishMessage
                    break

        except Exception as e:
            logger.error(f"iFlow 调用失败: {e}", exc_info=True)
            raise Exception(f"iFlow 调用失败: {e}")


# 全局服务实例
iflow_service = IFlowService()