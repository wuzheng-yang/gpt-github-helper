// usage_status.js
// -----------------------------------------------------------------------------
// ChatGPT 会员与 Codex 用量状态。
//
// 作用：
// 1. 读取 ChatGPT session 里的 accessToken。
// 2. 使用 ChatGPT 后端接口获取账号计划与 Codex 用量。
// 3. 输出给右侧状态卡使用的稳定展示模型。
// -----------------------------------------------------------------------------

(function () {
  window.GptGithubHelper = window.GptGithubHelper || {};

  const CHATGPT_ORIGIN = 'https://chatgpt.com';
  const SESSION_URL = `${CHATGPT_ORIGIN}/api/auth/session`;
  const ACCOUNT_URL = `${CHATGPT_ORIGIN}/backend-api/accounts/check/v4-2023-04-27`;
  const USAGE_URL = `${CHATGPT_ORIGIN}/backend-api/wham/usage`;
  const CACHE_TTL = 5 * 60 * 1000;

  const planNames = {
    chatgptfreeplan: 'Free',
    chatgptfreeworkspaceplan: 'Free Workspace',
    chatgptgoplan: 'Go',
    chatgptplusplan: 'Plus',
    chatgptpro: 'Pro',
    chatgptprolite: 'Pro Lite',
    chatgptteamplan: 'Team',
    chatgptenterpriseplan: 'Enterprise'
  };

  const planMultipliers = {
    chatgptpro: '20x',
    chatgptprolite: '5x'
  };

  let cachedStatus = null;
  let cachedAt = 0;

  function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw createError(`请求失败：${response.status}`, response.status);
    }

    return response.json();
  }

  async function fetchSession() {
    const session = await fetchJson(SESSION_URL);

    if (!session || !session.accessToken) {
      throw createError('未登录 ChatGPT 或无法读取 session');
    }

    return session;
  }

  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return atob(padded);
  }

  function parseJwtPayload(token) {
    const parts = String(token || '').split('.');

    if (parts.length !== 3) {
      return null;
    }

    try {
      return JSON.parse(decodeBase64Url(parts[1]));
    } catch (error) {
      return null;
    }
  }

  function getAccountIdFromToken(token) {
    const payload = parseJwtPayload(token);
    const accountId = payload && payload['https://api.openai.com/auth'] &&
      payload['https://api.openai.com/auth'].chatgpt_account_id;

    return typeof accountId === 'string' && accountId ? accountId : null;
  }

  function normalizePlanName(rawPlan, shortType) {
    if (planNames[rawPlan]) {
      return planNames[rawPlan];
    }

    if (shortType) {
      return shortType.charAt(0).toUpperCase() + shortType.slice(1);
    }

    if (rawPlan) {
      const name = rawPlan.replace(/^chatgpt/i, '').replace(/plan$/i, '');
      return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Unknown';
    }

    return 'Free';
  }

  function normalizeAccount(accountResponse, session) {
    const accounts = accountResponse && accountResponse.accounts || {};
    const ordering = Array.isArray(accountResponse && accountResponse.account_ordering)
      ? accountResponse.account_ordering
      : [];
    const tokenAccountId = getAccountIdFromToken(session.accessToken);
    const accountId = tokenAccountId || ordering[0] || 'default';
    const accountEntry = accounts[accountId] || accounts.default || accounts[ordering[0]] || {};
    const account = accountEntry.account || {};
    const entitlement = accountEntry.entitlement || {};
    const rawPlan = typeof entitlement.subscription_plan === 'string'
      ? entitlement.subscription_plan
      : '';
    const shortType = typeof account.plan_type === 'string'
      ? account.plan_type
      : '';

    return {
      id: accountId,
      email: session.user && session.user.email,
      planName: normalizePlanName(rawPlan, shortType),
      planMultiplier: planMultipliers[rawPlan] || '',
      rawPlan,
      shortType,
      active: Boolean(entitlement.has_active_subscription),
      expiresAt: entitlement.expires_at || null,
      renewsAt: entitlement.renews_at || null
    };
  }

  async function fetchAccount(session) {
    const data = await fetchJson(ACCOUNT_URL, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      }
    });

    return normalizeAccount(data, session);
  }

  async function fetchUsage(session) {
    return fetchJson(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      }
    });
  }

  function normalizePercent(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function normalizeWindow(windowData) {
    if (!windowData || typeof windowData !== 'object') {
      return {
        usedPercent: null,
        remainingPercent: null,
        resetAt: null
      };
    }

    const usedPercent = normalizePercent(windowData.used_percent);
    const remainingPercent = usedPercent === null ? null : Math.max(0, 100 - usedPercent);

    return {
      usedPercent,
      remainingPercent,
      resetAt: Number.isFinite(Number(windowData.reset_at)) ? Number(windowData.reset_at) : null
    };
  }

  function formatPercent(value) {
    return value === null ? '--' : `${value}%`;
  }

  function normalizeUsage(usage) {
    const rateLimit = usage && usage.rate_limit || {};
    const primaryWindow = normalizeWindow(rateLimit.primary_window);
    const secondaryWindow = normalizeWindow(rateLimit.secondary_window);

    return {
      raw: usage,
      primaryWindow,
      secondaryWindow,
      primaryRemainingText: formatPercent(primaryWindow.remainingPercent),
      secondaryRemainingText: formatPercent(secondaryWindow.remainingPercent),
      credits: usage && usage.credits || null
    };
  }

  function getPlanDisplay(account) {
    if (!account) {
      return '未知';
    }

    const planName = account.planName === 'Pro Lite' ? 'Pro' : account.planName;

    return account.planMultiplier
      ? `${planName} ${account.planMultiplier}`
      : planName;
  }

  function getTone(remainingPercent) {
    if (remainingPercent === null) {
      return 'unknown';
    }

    if (remainingPercent <= 20) {
      return 'danger';
    }

    if (remainingPercent <= 50) {
      return 'warning';
    }

    return 'normal';
  }

  function createDisplayStatus(account, usage) {
    const primary = usage && usage.primaryWindow || normalizeWindow(null);
    const secondary = usage && usage.secondaryWindow || normalizeWindow(null);

    return {
      planText: getPlanDisplay(account),
      primaryLabel: '5 小时',
      primaryRemainingText: usage ? usage.primaryRemainingText : '--',
      primaryResetAt: primary.resetAt,
      secondaryLabel: '7 天',
      secondaryRemainingText: usage ? usage.secondaryRemainingText : '--',
      secondaryResetAt: secondary.resetAt,
      tone: getTone(Math.min(
        primary.remainingPercent === null ? 100 : primary.remainingPercent,
        secondary.remainingPercent === null ? 100 : secondary.remainingPercent
      )),
      account,
      usage
    };
  }

  async function fetchStatus(force = false) {
    if (!force && cachedStatus && Date.now() - cachedAt < CACHE_TTL) {
      return cachedStatus;
    }

    const session = await fetchSession();
    const [account, usage] = await Promise.all([
      fetchAccount(session),
      fetchUsage(session).then(normalizeUsage)
    ]);

    cachedStatus = createDisplayStatus(account, usage);
    cachedAt = Date.now();
    return cachedStatus;
  }

  function clearCache() {
    cachedStatus = null;
    cachedAt = 0;
  }

  window.GptGithubHelper.usageStatus = {
    fetchStatus,
    clearCache,
    normalizeAccount,
    normalizeUsage,
    createDisplayStatus
  };
})();
