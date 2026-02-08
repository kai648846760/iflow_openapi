// ============================================
// iflow2api - Cloudflare Worker 版本
// 将 iFlow CLI 的 AI 服务暴露为 OpenAI 兼容 API
//
// ============================================

// iFlow 固定配置
const IFLOW_CONFIG = {
  BASE_URL: "https://apis.iflow.cn/v1",
  USER_AGENT: "iFlow-Cli",
  CLIENT_ID: "10009311001",
  CLIENT_SECRET: "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
  TOKEN_URL: "https://iflow.cn/oauth/token",
  USER_INFO_URL: "https://iflow.cn/api/oauth/getUserInfo",
  AUTH_URL: "https://iflow.cn/oauth",
};

// 支持的模型列表 (来源于 iflow-cli SUPPORTED_MODELS)
const SUPPORTED_MODELS = [
  { id: "glm-4.7", name: "GLM-4.7", description: "智谱 GLM-4.7 (推荐)" },
  { id: "iFlow-ROME-30BA3B", name: "iFlow-ROME-30BA3B", description: "iFlow ROME 30B (快速)" },
  { id: "deepseek-v3.2-chat", name: "DeepSeek-V3.2", description: "DeepSeek V3.2 对话模型" },
  { id: "qwen3-coder-plus", name: "Qwen3-Coder-Plus", description: "通义千问 Qwen3 Coder Plus" },
  { id: "kimi-k2-thinking", name: "Kimi-K2-Thinking", description: "Moonshot Kimi K2 思考模型" },
  { id: "minimax-m2.1", name: "MiniMax-M2.1", description: "MiniMax M2.1" },
  { id: "kimi-k2-0905", name: "Kimi-K2-0905", description: "Moonshot Kimi K2 0905" },
];

// KV 键名 
const KV_KEY = {
  API_KEY: "apiKey",
  BASE_URL: "baseUrl",
  MODEL_NAME: "modelName",
  CNA: "cna",
  AUTH_TYPE: "selectedAuthType",
  OAUTH_ACCESS_TOKEN: "oauth_access_token",
  OAUTH_REFRESH_TOKEN: "oauth_refresh_token",
  OAUTH_EXPIRES_AT: "oauth_expires_at",
  WORKER_AUTH_TOKEN: "worker_auth_token",  // Worker 访问鉴权
  MODELS_LIST: "models_list",  // 完整模型列表（包含自动发现的新模型）
  MODELS_UPDATED_AT: "models_updated_at",  // 模型列表最后更新时间
};

export default {
  async fetch(request, env, ctx) {
    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 公开端点不需要鉴权
      if (isPublicEndpoint(path)) {
        return await handlePublicRoute(path, url, request, env);
      }

      // 需要鉴权的端点：先验证 Worker 层鉴权
      const authResult = await verifyAuth(request, env);
      if (authResult !== true) {
        return authResult;
      }

      // 鉴权通过，处理受保护路由
      return await handleProtectedRoute(path, request, env, ctx);

    } catch (error) {
      console.error("Error:", error);
      return jsonResponse({ error: { message: error.message, type: "api_error" } }, 500);
    }
  },

  // 定时任务：每15分钟刷新token，每24小时自动更新模型列表
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    console.log(`Scheduled task triggered: ${cron}`);
    
    // 每天0点（24小时）更新模型列表
    if (cron === "0 0 * * *") {
      console.log("Updating models list...");
      await updateModelsList(env, ctx);
    }
    
    // 每15分钟检查并刷新 token
    if (cron === "*/15 * * * *") {
      console.log("Checking and refreshing OAuth token...");
      await refreshOAuthTokenIfNeeded(env, ctx);
    }
  }
};

// ============================================
// 鉴权中间件
// ============================================

function isPublicEndpoint(path) {
  return ["/", "/health", "/oauth/login", "/oauth/callback"].includes(path);
}

async function handlePublicRoute(path, url, request, env) {
  switch (path) {
    case "/":
      return handleRoot();
    case "/health":
      return await handleHealth(env);
    case "/oauth/login":
      return handleOAuthLogin(url);
    case "/oauth/callback":
      return await handleOAuthCallback(request, env);
    default:
      return jsonResponse({ error: "Not Found" }, 404);
  }
}

async function handleProtectedRoute(path, request, env, ctx) {
  switch (path) {
    case "/v1/models":
    case "/models":
      return await handleModels(env);
    
    case "/v1/models/refresh":
    case "/models/refresh":
      return await handleModelsRefresh(request, env, ctx);
    
    case "/v1/chat/completions":
    case "/chat/completions":
      return await handleChatCompletions(request, env, ctx);
    
    default:
      return jsonResponse({ error: "Not Found" }, 404);
  }
}

async function verifyAuth(request, env) {
  /**
   * 验证请求头中的 Authorization: Bearer <token>
   * Worker 层的额外保护
   */
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader) {
    return jsonResponse({
      error: {
        message: "Missing Authorization header. Expected: Bearer <token>",
        type: "authentication_error",
        code: "missing_auth"
      }
    }, 401);
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return jsonResponse({
      error: {
        message: "Invalid Authorization format. Expected: Bearer <token>",
        type: "authentication_error",
        code: "invalid_auth_format"
      }
    }, 401);
  }

  const providedToken = match[1];
  
  // 同时尝试读取大写和小写的 key（兼容两种设置方式）
  const expectedToken = await env.IFLOW_KV.get(KV_KEY.WORKER_AUTH_TOKEN)
    || await env.IFLOW_KV.get("worker_auth_token");
  
  if (!expectedToken) {
    console.error("WORKER_AUTH_TOKEN not set in KV");
    return jsonResponse({
      error: {
        message: "Service not fully configured. Please set WORKER_AUTH_TOKEN in KV.",
        type: "configuration_error",
        code: "not_configured"
      }
    }, 503);
  }
  
  if (providedToken !== expectedToken) {
    return jsonResponse({
      error: {
        message: "Invalid Bearer token",
        type: "authentication_error",
        code: "invalid_token"
      }
    }, 401);
  }
  
  return true;
}

// ============================================
// 路由处理器 
// ============================================

function handleRoot() {
  return jsonResponse({
    service: "iflow2api",
    version: "1.0.0",
    description: "iFlow CLI AI 服务 → OpenAI 兼容 API (Cloudflare Worker)",
    auth_required: true,
    endpoints: {
      models: "/v1/models",
      chat_completions: "/v1/chat/completions",
      health: "/health",
      oauth_login: "/oauth/login",
    },
  });
}

async function handleHealth(env) {
  const config = await loadIFlowConfig(env);
  const hasWorkerAuth = !!(await env.IFLOW_KV.get(KV_KEY.WORKER_AUTH_TOKEN))
    || !!(await env.IFLOW_KV.get("worker_auth_token"));
  
  return jsonResponse({
    status: config ? "healthy" : "degraded",
    iflow_logged_in: !!config?.api_key,
    worker_auth_configured: hasWorkerAuth,
  });
}

async function handleModels(env) {
  const currentTime = Math.floor(Date.now() / 1000);
  
  // 优先从 KV 读取完整模型列表
  let modelsList = SUPPORTED_MODELS;
  if (env) {
    try {
      const storedModels = await env.IFLOW_KV.get(KV_KEY.MODELS_LIST);
      if (storedModels) {
        modelsList = JSON.parse(storedModels);
      }
    } catch (error) {
      console.error("Error loading models from KV:", error);
    }
  }
  
  const models = modelsList.map(model => ({
    id: model.id,
    object: "model",
    created: currentTime,
    owned_by: "iflow",
    permission: [],
    root: model.id,
    parent: null,
  }));

  return jsonResponse({
    object: "list",
    data: models,
  });
}

async function handleModelsRefresh(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // 触发模型列表更新
    await updateModelsList(env, ctx);
    
    // 返回更新后的模型列表
    return await handleModels(env);
    
  } catch (error) {
    return jsonResponse({ error: { message: `Failed to refresh models: ${error.message}` } }, 500);
  }
}

async function handleChatCompletions(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // 解析请求体
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // 加载 iFlow 配置 
  const config = await loadIFlowConfig(env);
  if (!config?.api_key) {
    return jsonResponse({ 
      error: "iFlow 未登录，请先访问 /oauth/login 完成授权，或手动设置 apiKey" 
    }, 401);
  }

  // 检查并刷新 OAuth Token 
  if (config.auth_type === "oauth-iflow" && config.oauth_refresh_token) {
    try {
      await ensureTokenValid(config, env, ctx);
    } catch (error) {
      // 刷新失败，返回 401 要求重新登录（与原 Python 行为一致）
      return jsonResponse({
        error: {
          message: `${error.message}，请重新访问 /oauth/login 登录`,
          type: "authentication_error",
          code: "token_refresh_failed"
        }
      }, 401);
    }
  }

  const isStream = body.stream === true;

  // 转发请求到 iFlow API 
  try {
    const targetUrl = `${config.base_url}/chat/completions`;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.api_key}`,
      "User-Agent": IFLOW_CONFIG.USER_AGENT,
    };

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ msg: response.statusText }));
      return jsonResponse(
        { error: { message: errorData.msg || errorData.error || "iFlow API Error", code: response.status } },
        response.status
      );
    }

    // 流式响应
    if (isStream) {
      return new Response(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 非流式响应，确保 usage 字段存在 (OpenAI 兼容)
    const result = await response.json();
    if (!result.usage) {
      result.usage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
    }

    return jsonResponse(result);

  } catch (error) {
    return jsonResponse({ error: { message: `Proxy error: ${error.message}` } }, 502);
  }
}

// ============================================
// OAuth 登录与回调
// ============================================

function handleOAuthLogin(url) {
  const state = generateRandomString(16);
  const redirectUri = `${url.origin}/oauth/callback`;
  
  const authUrl = `${IFLOW_CONFIG.AUTH_URL}?` + new URLSearchParams({
    client_id: IFLOW_CONFIG.CLIENT_ID,
    loginMethod: "phone",
    type: "phone",
    redirect: redirectUri,
    state: state,
  });

  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>iFlow OAuth 登录</title>
      <meta charset="utf-8">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; line-height: 1.6; }
        .btn { display: inline-block; padding: 12px 24px; background: #007acc; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
        .btn:hover { background: #005fa3; }
        .info { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        code { background: #e8e8e8; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
      </style>
    </head>
    <body>
      <h1>🔐 iFlow OAuth 登录</h1>
      <div class="info">
        <p>点击下方按钮完成 iFlow 账号授权</p>
        <p>授权后将自动保存 Token 到 Worker KV</p>
      </div>
      <a href="${authUrl}" class="btn">开始 OAuth 登录</a>
      <p style="margin-top: 30px; color: #666; font-size: 14px;">
        回调地址: <code>${redirectUri}</code>
      </p>
    </body>
    </html>
  `, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return jsonResponse({ error: `OAuth error: ${error}` }, 400);
  }

  if (!code) {
    return jsonResponse({ error: "Missing authorization code" }, 400);
  }

  try {
    // 1. 用 code 换 token
    const tokenData = await exchangeCodeForToken(code, `${url.origin}/oauth/callback`);
    
    // 2. 获取用户信息（包含 apiKey）
    const userInfo = await getUserInfo(tokenData.access_token);
    
    if (!userInfo.apiKey) {
      throw new Error("User info missing apiKey");
    }

    // 3. 保存到 KV（与原 Python save_iflow_config 对应）
    await saveIFlowConfig(env, {
      api_key: userInfo.apiKey,
      base_url: IFLOW_CONFIG.BASE_URL,
      model_name: userInfo.modelName || null,
      cna: userInfo.cna || null,
      auth_type: "oauth-iflow",
      oauth_access_token: tokenData.access_token,
      oauth_refresh_token: tokenData.refresh_token,
      oauth_expires_at: tokenData.expires_at,
    });

    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>登录成功 - iFlow2API</title>
        <meta charset="utf-8">
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 50px auto; text-align: center; padding: 20px; }
          .success { color: #28a745; font-size: 64px; margin-bottom: 20px; }
          h1 { color: #333; }
          .info { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
          .key { font-family: monospace; background: #fff; padding: 8px; border-radius: 4px; display: inline-block; margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="success">✅</div>
        <h1>登录成功！</h1>
        <div class="info">
          <p><strong>API Key:</strong> <span class="key">${userInfo.apiKey.substring(0, 12)}...</span></p>
          <p><strong>用户:</strong> ${userInfo.nickName || userInfo.phone || "Unknown"}</p>
          <p><strong>过期时间:</strong> ${tokenData.expires_at ? new Date(tokenData.expires_at).toLocaleString() : "Unknown"}</p>
        </div>
        <p>配置已保存到 Cloudflare KV，可以开始使用 API</p>
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          测试: <code>curl -H "Authorization: Bearer &lt;YOUR_WORKER_TOKEN&gt;" ${url.origin}/v1/models</code>
        </p>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html;charset=utf-8" } });

  } catch (error) {
    console.error("OAuth callback error:", error);
    return jsonResponse({ error: `OAuth callback failed: ${error.message}` }, 500);
  }
}

// ============================================

async function exchangeCodeForToken(code, redirectUri) {
  /**
   * 使用授权码获取 OAuth token
   */
  const credentials = btoa(`${IFLOW_CONFIG.CLIENT_ID}:${IFLOW_CONFIG.CLIENT_SECRET}`);
  
  const response = await fetch(IFLOW_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Authorization": `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
      client_id: IFLOW_CONFIG.CLIENT_ID,
      client_secret: IFLOW_CONFIG.CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = await response.json();
  
  if (!data.access_token) {
    throw new Error("OAuth 响应缺少 access_token");
  }

  // 计算过期时间
  let expiresAt = null;
  if (data.expires_in) {
    expiresAt = Date.now() + (data.expires_in * 1000);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
  };
}

async function getUserInfo(accessToken) {
  /**
   * 获取用户信息（包含 API Key）
   */
  const url = `${IFLOW_CONFIG.USER_INFO_URL}?accessToken=${encodeURIComponent(accessToken)}`;
  
  const response = await fetch(url, {
    headers: { "Accept": "application/json" },
  });

  if (response.status === 401) {
    throw new Error("access_token 无效或已过期");
  }

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  const result = await response.json();
  
  if (!result.success || !result.data) {
    throw new Error("获取用户信息失败");
  }

  return result.data;
}

async function refreshToken(refreshTokenValue) {
  /**
   * 刷新 OAuth token
   */
  const credentials = btoa(`${IFLOW_CONFIG.CLIENT_ID}:${IFLOW_CONFIG.CLIENT_SECRET}`);
  
  const response = await fetch(IFLOW_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Authorization": `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: IFLOW_CONFIG.CLIENT_ID,
      client_secret: IFLOW_CONFIG.CLIENT_SECRET,
      refresh_token: refreshTokenValue,
    }),
  });

  // 处理 400 错误中的 invalid_grant（与原 Python 一致）
  if (response.status === 400) {
    let errorData;
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = {};
    }
    
    if (errorData.error && errorData.error.includes("invalid_grant")) {
      throw new Error("refresh_token 无效或已过期");
    }
    
    throw new Error(`Token refresh failed: ${JSON.stringify(errorData)}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("OAuth 响应缺少 access_token");
  }

  // 计算过期时间
  let expiresAt = null;
  if (data.expires_in) {
    expiresAt = Date.now() + (data.expires_in * 1000);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshTokenValue, // 如果没返回新的，沿用旧的
    expires_at: expiresAt,
  };
}

// ============================================
// Token 刷新管理 
// ============================================

async function ensureTokenValid(config, env, ctx) {
  /**
   * 确保 OAuth Token 有效，如果即将过期则自动刷新
   * 如果刷新失败，抛出错误（与原 Python 行为一致）
   */
  if (!config.oauth_refresh_token) return;
  if (!config.oauth_expires_at) return;

  // 提前 5 分钟刷新 (300 秒 = 300000 毫秒)
  const bufferMs = 5 * 60 * 1000;
  const now = Date.now();

  // Token 还有超过 5 分钟才过期，无需刷新
  if (now < (config.oauth_expires_at - bufferMs)) {
    return;
  }

  console.log(`Token expiring at ${new Date(config.oauth_expires_at).toISOString()}, refreshing...`);
  
  // 调用刷新接口
  const newToken = await refreshToken(config.oauth_refresh_token);
  
  // 获取新用户信息（可能包含新的 apiKey）
  let apiKey = config.api_key;
  try {
    const userInfo = await getUserInfo(newToken.access_token);
    if (userInfo.apiKey) {
      apiKey = userInfo.apiKey;
      console.log("Got new apiKey from user info");
    }
  } catch (e) {
    console.warn("Could not fetch user info during refresh, keeping old apiKey:", e.message);
  }

  // 构建新配置对象
  const newConfig = {
    ...config,
    api_key: apiKey,
    oauth_access_token: newToken.access_token,
    oauth_refresh_token: newToken.refresh_token,
    oauth_expires_at: newToken.expires_at,
  };

  // 使用 waitUntil 异步保存到 KV，不阻塞当前请求
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(saveIFlowConfig(env, newConfig));
  } else {
    await saveIFlowConfig(env, newConfig);
  }

  // 更新内存中的 config 对象（供当前请求使用）
  Object.assign(config, newConfig);
  
  console.log(`Token refreshed successfully, new expiry: ${new Date(newConfig.oauth_expires_at).toISOString()}`);
}

// ============================================

async function loadIFlowConfig(env) {
  /**
   * 从 KV 加载 iFlow 配置（对应原 load_iflow_config）
   */
  try {
    const apiKey = await env.IFLOW_KV.get(KV_KEY.API_KEY);
    if (!apiKey) return null;

    const [
      baseUrl,
      modelName,
      cna,
      authType,
      oauthAccessToken,
      oauthRefreshToken,
      oauthExpiresAt,
    ] = await Promise.all([
      env.IFLOW_KV.get(KV_KEY.BASE_URL),
      env.IFLOW_KV.get(KV_KEY.MODEL_NAME),
      env.IFLOW_KV.get(KV_KEY.CNA),
      env.IFLOW_KV.get(KV_KEY.AUTH_TYPE),
      env.IFLOW_KV.get(KV_KEY.OAUTH_ACCESS_TOKEN),
      env.IFLOW_KV.get(KV_KEY.OAUTH_REFRESH_TOKEN),
      env.IFLOW_KV.get(KV_KEY.OAUTH_EXPIRES_AT),
    ]);

    return {
      api_key: apiKey,
      base_url: baseUrl || IFLOW_CONFIG.BASE_URL,
      model_name: modelName,
      cna: cna,
      auth_type: authType,
      oauth_access_token: oauthAccessToken,
      oauth_refresh_token: oauthRefreshToken,
      oauth_expires_at: oauthExpiresAt ? parseInt(oauthExpiresAt) : null,
    };
  } catch (error) {
    console.error("Error loading config:", error);
    return null;
  }
}

async function saveIFlowConfig(env, config) {
  /**
   * 保存 iFlow 配置到 KV（对应原 save_iflow_config）
   */
  const promises = [
    env.IFLOW_KV.put(KV_KEY.API_KEY, config.api_key),
    env.IFLOW_KV.put(KV_KEY.BASE_URL, config.base_url || IFLOW_CONFIG.BASE_URL),
  ];

  if (config.model_name) promises.push(env.IFLOW_KV.put(KV_KEY.MODEL_NAME, config.model_name));
  if (config.cna) promises.push(env.IFLOW_KV.put(KV_KEY.CNA, config.cna));
  if (config.auth_type) promises.push(env.IFLOW_KV.put(KV_KEY.AUTH_TYPE, config.auth_type));
  if (config.oauth_access_token) promises.push(env.IFLOW_KV.put(KV_KEY.OAUTH_ACCESS_TOKEN, config.oauth_access_token));
  if (config.oauth_refresh_token) promises.push(env.IFLOW_KV.put(KV_KEY.OAUTH_REFRESH_TOKEN, config.oauth_refresh_token));
  if (config.oauth_expires_at) promises.push(env.IFLOW_KV.put(KV_KEY.OAUTH_EXPIRES_AT, config.oauth_expires_at.toString()));

  await Promise.all(promises);
}

// ============================================
// 工具函数
// ============================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(x => chars[x % chars.length])
    .join("");
}

// ============================================
// OAuth Token 定时刷新
// ============================================

async function refreshOAuthTokenIfNeeded(env, ctx) {
  /**
   * 定时任务：检查并刷新即将过期的 OAuth token
   * 如果 token 还有超过 5 分钟才过期，则不刷新
   */
  try {
    const config = await loadIFlowConfig(env);
    
    // 如果不是 OAuth 认证或没有 refresh token，跳过
    if (!config || config.auth_type !== "oauth-iflow" || !config.oauth_refresh_token) {
      return;
    }

    // 如果没有过期时间，跳过
    if (!config.oauth_expires_at) {
      return;
    }

    // 提前 5 分钟刷新 (300 秒 = 300000 毫秒)
    const bufferMs = 5 * 60 * 1000;
    const now = Date.now();

    // Token 还有超过 5 分钟才过期，无需刷新
    if (now < (config.oauth_expires_at - bufferMs)) {
      console.log(`Token still valid, expires at ${new Date(config.oauth_expires_at).toISOString()}`);
      return;
    }

    console.log(`Token expiring at ${new Date(config.oauth_expires_at).toISOString()}, refreshing...`);
    
    // 调用刷新接口
    const newToken = await refreshToken(config.oauth_refresh_token);
    
    // 获取新用户信息（可能包含新的 apiKey）
    let apiKey = config.api_key;
    try {
      const userInfo = await getUserInfo(newToken.access_token);
      if (userInfo.apiKey) {
        apiKey = userInfo.apiKey;
        console.log("Got new apiKey from user info");
      }
    } catch (e) {
      console.warn("Could not fetch user info during refresh, keeping old apiKey:", e.message);
    }

    // 构建新配置对象
    const newConfig = {
      ...config,
      api_key: apiKey,
      oauth_access_token: newToken.access_token,
      oauth_refresh_token: newToken.refresh_token,
      oauth_expires_at: newToken.expires_at,
    };

    // 保存到 KV
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(saveIFlowConfig(env, newConfig));
    } else {
      await saveIFlowConfig(env, newConfig);
    }

    console.log(`Token refreshed successfully, new expiry: ${new Date(newConfig.oauth_expires_at).toISOString()}`);
    
  } catch (error) {
    console.error("Error refreshing OAuth token in scheduled task:", error);
    // 定时任务中不抛出错误，避免中断任务
  }
}

// ============================================
// 模型列表自动更新
// ============================================

async function updateModelsList(env, ctx) {
  /**
   * 从 iFlow API 获取最新模型列表，并与 SUPPORTED_MODELS 合并
   * 保存到 KV 中供后续使用
   */
  try {
    // 1. 加载 iFlow 配置
    const config = await loadIFlowConfig(env);
    if (!config?.api_key) {
      console.log("iFlow not logged in, skipping models update");
      return;
    }

    // 2. 请求 iFlow /v1/models 接口
    const response = await fetch(`${config.base_url}/models`, {
      headers: {
        "Authorization": `Bearer ${config.api_key}`,
        "User-Agent": IFLOW_CONFIG.USER_AGENT,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch models: ${response.status}`);
      return;
    }

    const result = await response.json();
    if (!result.data || !Array.isArray(result.data)) {
      console.error("Invalid models response format");
      return;
    }

    // 3. 提取 iFlow 返回的模型 ID
    const iflowModelIds = new Set(result.data.map(m => m.id));

    // 4. 检查是否有新模型（不在 SUPPORTED_MODELS 中）
    const newModels = [];
    for (const modelId of iflowModelIds) {
      const exists = SUPPORTED_MODELS.some(m => m.id === modelId);
      if (!exists) {
        newModels.push({
          id: modelId,
          name: modelId,
          description: "自动发现的新模型",
        });
      }
    }

    // 5. 合并模型列表（SUPPORTED_MODELS 在前，新模型在后）
    const mergedModels = [...SUPPORTED_MODELS, ...newModels];

    // 6. 保存到 KV
    const modelsJson = JSON.stringify(mergedModels);
    const timestamp = Date.now();

    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(env.IFLOW_KV.put(KV_KEY.MODELS_LIST, modelsJson));
      ctx.waitUntil(env.IFLOW_KV.put(KV_KEY.MODELS_UPDATED_AT, timestamp.toString()));
    } else {
      await env.IFLOW_KV.put(KV_KEY.MODELS_LIST, modelsJson);
      await env.IFLOW_KV.put(KV_KEY.MODELS_UPDATED_AT, timestamp.toString());
    }

    console.log(`Models list updated: ${mergedModels.length} total models (${newModels.length} new)`);
    
  } catch (error) {
    console.error("Error updating models list:", error);
  }
}