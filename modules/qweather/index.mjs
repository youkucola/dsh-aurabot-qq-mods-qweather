const DEFAULTS = {
  apiHost: '',
  apiKey: '',
  credentialId: '',
};

function normalizeHost(value) {
  const raw = String(value ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
  if (!raw || !/^[a-z0-9.-]+$/i.test(raw) || raw.includes('..') || /^[.-]|[.-]$/.test(raw)) return '';
  try {
    const u = new URL('https://' + raw);
    if (u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) return '';
    return u.hostname;
  } catch {
    return '';
  }
}

function bare(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function measured(field) {
  const value = field?.value;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return `${value}${field.unit ? String(field.unit) : ''}`;
}

function coord(value) {
  const n = bare(value);
  return n === null ? null : Math.round(n * 100) / 100;
}

function errorMessage(status, title) {
  if (status === 401) return '认证失败，请检查模块设置里的 API Key';
  if (status === 403) {
    return /invalid\s*host/i.test(title)
      ? '专属 API Host 不正确（INVALID HOST），请在和风控制台「设置」核对并填写 API Host'
      : '请求被拒绝，请检查控制台套餐额度/接口权限与模块设置里的 API Key';
  }
  if (status === 404) return '接口不存在，请检查模块设置里的 API Host';
  if (status === 429) return '请求过于频繁被限流，请稍后再试';
  if (status === 500) return '天气服务暂时不可用，请稍后再试';
  return `天气服务返回异常（HTTP ${status}），请检查模块设置项`;
}

async function qFetch(url, key, api) {
  const res = await fetch(url, {
    headers: { 'X-QW-Api-Key': key },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let problem = null;
    try {
      problem = await res.json();
    } catch {
      problem = null;
    }
    const title = typeof problem?.error?.title === 'string' ? problem.error.title : '';
    api.log?.warn?.(`和风天气返回 HTTP ${res.status}${title ? `（${title.slice(0, 60)}）` : ''}`);
    return { error: errorMessage(res.status, title) };
  }
  return { data: await res.json() };
}

async function lookupCity(host, key, city, api) {
  const url = `https://${host}/geo/v2/city/lookup?location=${encodeURIComponent(city)}&lang=zh&number=1`;
  const result = await qFetch(url, key, api);
  if (result.error) return result;
  const body = result.data;
  if (String(body?.code) !== '200' || !Array.isArray(body.location) || body.location.length === 0) {
    return { error: `没找到这个城市「${city}」，请换个名称或带上区县再试` };
  }
  return { data: body.location[0] };
}

async function currentWeather(host, key, loc, api) {
  const lat = coord(loc?.lat);
  const lon = coord(loc?.lon);
  if (lat === null || lon === null) return { error: '城市坐标缺失，无法查询天气' };
  const url = `https://${host}/weather/v1/current/${lat}/${lon}?lang=zh`;
  const result = await qFetch(url, key, api);
  if (result.error) return result;
  if (result.data?.metadata?.zeroResult === true) return { error: '暂无该地区天气数据' };
  return { data: result.data };
}

function formatWeather(loc, data) {
  const place = [...new Set([loc?.adm1, loc?.adm2, loc?.name].filter(Boolean))].join(' · ') || '该地区';
  const lines = [`${place} 实时天气`];
  const condition = typeof data?.condition?.text === 'string' ? data.condition.text : '';
  const temperature = measured(data?.temperature);
  const feelsLike = measured(data?.feelsLike);
  const headline = [condition, temperature && `气温 ${temperature}`, feelsLike && `体感 ${feelsLike}`]
    .filter(Boolean)
    .join('，');
  if (headline) lines.push(headline);

  const humidity = bare(data?.humidity);
  if (humidity !== null) lines.push(`湿度 ${Math.round(humidity * 100)}%`);

  const compass = typeof data?.wind?.direction?.compass === 'string' ? data.wind.direction.compass : '';
  const windSpeed = measured(data?.wind?.speed);
  const scale = bare(data?.wind?.scale);
  const wind = [compass, windSpeed, scale !== null && `${scale} 级`].filter(Boolean).join(' ');
  if (wind) lines.push(`风 ${wind}`);

  const rain = measured(data?.precipitation?.amount);
  if (rain) lines.push(`降水量 ${rain}`);
  const visibility = measured(data?.visibility);
  if (visibility) lines.push(`能见度 ${visibility}`);
  const pressure = measured(data?.pressure);
  if (pressure) lines.push(`气压 ${pressure}`);
  const uv = bare(data?.uvIndex);
  if (uv !== null) lines.push(`紫外线指数 ${uv}`);

  const attributions = Array.isArray(data?.metadata?.attributions)
    ? data.metadata.attributions.filter((s) => typeof s === 'string' && s.trim())
    : [];
  lines.push(`数据来源：${attributions.length ? attributions.join('、') : '和风天气'}`);
  return lines.join('\n');
}

export default {
  id: 'qweather',
  name: '和风天气查询',
  version: '1.0.0',
  api: 1,
  description: '提供和风天气实时天气模型工具 qweather_now，不注册任何聊天命令。',
  defaults: DEFAULTS,
  settings: [
    {
      key: 'apiHost',
      label: 'API Host',
      type: 'text',
      hint: '在和风天气控制台「设置」里查看专属 API Host，不要带 https:// 和结尾的 /',
      placeholder: 'xxx.qweatherapi.com',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      hint: '控制台创建的 API KEY，仅通过 X-QW-Api-Key 请求头发送，面板不回显、日志不记录',
      placeholder: '填写 API KEY',
    },
    {
      key: 'credentialId',
      label: '凭据 ID',
      type: 'text',
      hint: '只读记录：这是 JWT header 的 kid，API KEY 模式下不参与认证；本模块未实现 JWT',
    },
  ],
  setup(api) {
    api.tool((where = {}) => {
      const { chat, level } = where;
      if (chat?.kind === 'system' || level === 'chat') return [];
      return api.defineTool({
        name: 'qweather_now',
        description: '查询指定城市当前的实时天气，返回天气状况、气温、体感、湿度、风力、降水等信息。当有人询问某个城市现在的天气时使用。',
        properties: { city: { type: 'string', description: '城市名，支持中文，例如「北京」「上海」「朝阳区」' } },
        required: ['city'],
        execute: async (args) => {
          const city = String(args?.city ?? '').trim();
          if (!city) return { ok: false, message: '请提供城市名，例如「北京」。' };
          const s = api.settings() || {};
          const host = normalizeHost(s.apiHost ?? DEFAULTS.apiHost);
          const key = String(s.apiKey ?? DEFAULTS.apiKey).trim();
          if (!host || !key) return { ok: false, message: '请先在模块设置里填写 API Host 和 API Key' };
          try {
            const geo = await lookupCity(host, key, city, api);
            if (geo.error) return { ok: false, message: geo.error };
            const weather = await currentWeather(host, key, geo.data, api);
            if (weather.error) return { ok: false, message: weather.error };
            return { ok: true, message: formatWeather(geo.data, weather.data) };
          } catch (err) {
            api.log?.warn?.(`天气查询网络异常：${err?.name ?? 'Error'}`);
            return { ok: false, message: '天气服务暂时不可用，请稍后再试' };
          }
        },
      });
    });
    return {};
  },
};
