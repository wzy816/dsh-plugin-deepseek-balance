/**
 * Host half of the DeepSeek balance / price-period status plugin (`dsh-plugin-deepseek-balance`).
 *
 * It owns everything that needs a privileged origin:
 *  - reads the DeepSeek API key through the profile credential service (or the
 *    environment as an ambient fallback) and queries `/user/balance`, so the
 *    browser never sees the key and no CORS preflight is involved;
 *  - loads Chinese public holidays from timor.tech (cached per year);
 *  - evaluates the DeepSeek peak/off-peak rule and the next switch instant;
 *  - serves one same-origin JSON snapshot on `/​_dsh/deepseek-balance`, which the
 *    Client half polls.
 *
 * Peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday,
 * excluding Chinese public holidays. Everything else is off-peak.
 */
import os from 'node:os';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

/** Peak windows in UTC hours, half-open [start, end). */
const PEAK_WINDOWS_UTC = [
  [1, 4],
  [6, 10],
];

const ROUTE_PATH = '/_dsh/deepseek-balance';

const DEFAULTS = {
  apiKeyRef: 'DEEPSEEK_API_KEY',
  apiBase: 'https://api.deepseek.com',
  holidayApiBase: 'https://timor.tech/api/holiday',
  balanceTtlSeconds: 60,
  holidayTtlSeconds: 21600,
  requestTimeoutMs: 15000,
};

const NUMBER_KEYS = new Set(['balanceTtlSeconds', 'holidayTtlSeconds', 'requestTimeoutMs']);

/**
 * Merge the loader row config over the defaults, ignoring malformed values.
 * @param {unknown} raw - config from the patch row.
 * @returns {typeof DEFAULTS} the effective config.
 */
function readConfig(raw) {
  const config = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return config;
  for (const key of Object.keys(DEFAULTS)) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (NUMBER_KEYS.has(key)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) config[key] = numeric;
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '') config[key] = value.trim();
  }
  return config;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` for an instant, in UTC. */
function utcDayKey(ms) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Host allowlist: loopback names plus this machine's own addresses. */
function localHostnames() {
  const names = new Set(['127.0.0.1', 'localhost', '::1']);
  try {
    if (os.hostname()) names.add(os.hostname().toLowerCase());
  } catch {
    // hostname is optional
  }
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        const address = String(entry.address || '').toLowerCase();
        if (address) names.add(address);
      }
    }
  } catch {
    // interface enumeration is optional
  }
  return names;
}

/** Hostname part of a Host header value, lowercased. */
function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  let value = String(hostHeader).trim().toLowerCase();
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value : value.slice(1, close);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) {
    value = value.slice(0, colon);
  }
  return value;
}

/** Whether a request Host header names this machine. */
function isAllowedHost(hostHeader) {
  const host = hostnameOf(hostHeader);
  // A request without a Host header is not a browser cross-site request.
  if (!host) return true;
  return localHostnames().has(host);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** `fetch` with a hard timeout and a descriptive failure. */
async function fetchWithTimeout(url, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether an instant falls inside a DeepSeek peak window.
 * @param {number} ms - epoch milliseconds.
 * @param {Map<string, string>} holidays - `YYYY-MM-DD` -> holiday name.
 */
function isPeakAt(ms, holidays) {
  const date = new Date(ms);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (holidays.has(utcDayKey(ms))) return false;
  const hour = date.getUTCHours();
  return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end);
}

/**
 * First instant after `ms` whose peak/off-peak state differs from `ms`.
 * Only window edges and midnight can change the state, so scanning those
 * boundaries for a few days is exact and cheap.
 * @param {number} ms - epoch milliseconds.
 * @param {Map<string, string>} holidays - `YYYY-MM-DD` -> holiday name.
 * @returns {number | null} epoch milliseconds of the switch, if within range.
 */
function nextSwitchAt(ms, holidays) {
  const current = isPeakAt(ms, holidays);
  const start = new Date(ms);
  const dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let offset = 0; offset <= 12; offset += 1) {
    for (const hour of [0, 1, 4, 6, 10]) {
      const boundary = dayStart + offset * DAY_MS + hour * HOUR_MS;
      if (boundary <= ms) continue;
      if (isPeakAt(boundary, holidays) !== current) return boundary;
    }
  }
  return null;
}

/**
 * Evaluate the pricing period for one instant.
 * @param {number} ms - epoch milliseconds.
 * @param {Map<string, string>} holidays - `YYYY-MM-DD` -> holiday name.
 */
function describePeriod(ms, holidays) {
  const date = new Date(ms);
  const weekday = date.getUTCDay();
  const dayKey = utcDayKey(ms);
  const holidayName = holidays.get(dayKey) || null;
  const weekend = weekday === 0 || weekday === 6;
  const peak = isPeakAt(ms, holidays);
  const boundary = nextSwitchAt(ms, holidays);
  let reason = 'off-peak-window';
  if (holidayName !== null) reason = 'holiday';
  else if (weekend) reason = 'weekend';
  else if (peak) reason = 'peak-window';
  return {
    state: peak ? 'peak' : 'off-peak',
    nextSwitchAt: boundary,
    nextState: boundary === null ? null : isPeakAt(boundary, holidays) ? 'peak' : 'off-peak',
    utcDate: dayKey,
    utcWeekday: weekday,
    isWeekend: weekend,
    holiday: holidayName,
    reason,
    peakWindowsUtc: PEAK_WINDOWS_UTC,
  };
}

/**
 * Resolve the API key: the profile credential store first, then the process
 * environment for the same reference name.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} ref - credential reference (environment variable name).
 */
async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials');
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(ref);
      if (resolved && typeof resolved.value === 'string' && resolved.value.trim() !== '') {
        return resolved.value.trim();
      }
    } catch {
      // fall through to the ambient environment
    }
  }
  const ambient = process.env[ref];
  return ambient && ambient.trim() !== '' ? ambient.trim() : null;
}

/** Pure helpers, exported for verification. Not part of the plugin contract. */
export const internals = { readConfig, isPeakAt, nextSwitchAt, describePeriod, utcDayKey };

/**
 * Mount the snapshot route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} rawConfig - loader row config.
 */
export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig);
  const state = {
    /** @type {{ fetchedAt: number, value: object } | null} */
    balance: null,
    /** @type {Map<number, { fetchedAt: number, status: string, days: Map<string, string>, error: string | null }>} */
    holidayYears: new Map(),
  };

  /** Load (and cache) one year of Chinese public holidays. */
  async function holidayYear(year, force) {
    const cached = state.holidayYears.get(year);
    const ttl = config.holidayTtlSeconds * 1000;
    if (!force && cached) {
      const age = Date.now() - cached.fetchedAt;
      if (age < ttl && (cached.status === 'ready' || age < 60000)) return cached;
    }
    const base = config.holidayApiBase.replace(/\/+$/, '');
    const record = { fetchedAt: Date.now(), status: 'unavailable', days: new Map(), error: null };
    try {
      const response = await fetchWithTimeout(`${base}/year/${year}`, config.requestTimeoutMs, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`holiday API returned HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || payload.code !== 0 || !payload.holiday) {
        throw new Error('holiday API returned no data');
      }
      for (const [monthDay, entry] of Object.entries(payload.holiday)) {
        if (!entry || entry.holiday !== true) continue;
        const day = typeof entry.date === 'string' ? entry.date : `${year}-${monthDay}`;
        const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : null;
        record.days.set(day, name);
      }
      record.status = record.days.size > 0 ? 'ready' : 'unavailable';
      if (record.days.size === 0) record.error = 'no published holiday data for this year';
    } catch (error) {
      record.error = error && error.name === 'AbortError' ? 'request timeout' : String((error && error.message) || error);
    }
    state.holidayYears.set(year, record);
    return record;
  }

  /** Load the years the current period and the next switch can touch. */
  async function holidaySet(nowMs, force) {
    const now = new Date(nowMs);
    const year = now.getUTCFullYear();
    const years = [year];
    // The next switch can only leave this year near its end.
    if (now.getUTCMonth() === 11 && now.getUTCDate() >= 15) years.push(year + 1);
    const records = await Promise.all(years.map((value) => holidayYear(value, force)));
    const days = new Map();
    for (const record of records) for (const [day, name] of record.days) days.set(day, name);
    const ready = records.filter((record) => record.status === 'ready').length;
    return {
      days,
      status: ready === records.length ? 'ready' : ready === 0 ? 'unavailable' : 'partial',
      years: records.map((record, index) => ({
        year: years[index],
        status: record.status,
        days: record.days.size,
        error: record.error,
      })),
    };
  }

  /** Read the wallet balances through the official REST endpoint. */
  async function readBalance(force) {
    const ttl = config.balanceTtlSeconds * 1000;
    if (!force && state.balance && Date.now() - state.balance.fetchedAt < ttl) return state.balance.value;

    const credentialRef = config.apiKeyRef;
    const apiKey = await resolveApiKey(ctx, credentialRef);
    if (!apiKey) {
      const value = {
        status: 'unconfigured',
        credentialRef,
        apiBase: config.apiBase,
        fetchedAt: null,
        isAvailable: null,
        wallets: [],
        error: null,
      };
      state.balance = { fetchedAt: Date.now(), value };
      return value;
    }

    const base = config.apiBase.replace(/\/+$/, '');
    try {
      const response = await fetchWithTimeout(`${base}/user/balance`, config.requestTimeoutMs, {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`balance API returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('balance API returned invalid JSON');
      }
      const infos = Array.isArray(payload && payload.balance_infos) ? payload.balance_infos : [];
      const value = {
        status: 'ready',
        credentialRef,
        apiBase: config.apiBase,
        fetchedAt: Date.now(),
        isAvailable: payload && payload.is_available === true,
        wallets: infos.map((info) => ({
          currency: typeof info.currency === 'string' ? info.currency : 'CNY',
          total: String(info.total_balance ?? ''),
          granted: String(info.granted_balance ?? ''),
          toppedUp: String(info.topped_up_balance ?? ''),
        })),
        error: null,
      };
      state.balance = { fetchedAt: Date.now(), value };
      return value;
    } catch (error) {
      const previous = state.balance && state.balance.value;
      const value = {
        status: 'failed',
        credentialRef,
        apiBase: config.apiBase,
        fetchedAt: Date.now(),
        isAvailable: null,
        wallets: previous && Array.isArray(previous.wallets) ? previous.wallets : [],
        error: error && error.name === 'AbortError' ? 'request timeout' : String((error && error.message) || error),
      };
      state.balance = { fetchedAt: Date.now(), value };
      return value;
    }
  }

  /** One complete snapshot for the Client half. */
  async function snapshot(force) {
    const now = Date.now();
    const [holiday, balance] = await Promise.all([holidaySet(now, force), readBalance(force)]);
    const pricing = describePeriod(Date.now(), holiday.days);
    return {
      ok: true,
      now: Date.now(),
      balance,
      pricing,
      holidayData: { status: holiday.status, years: holiday.years, source: config.holidayApiBase },
      config: { credentialRef: config.apiKeyRef, apiBase: config.apiBase },
    };
  }

  async function handle(req, res) {
    try {
      if (!isAllowedHost(req.headers && req.headers.host)) {
        return sendJson(res, 403, { ok: false, error: 'forbidden host' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }
      let force = false;
      try {
        const url = new URL(req.url || ROUTE_PATH, 'http://localhost');
        force = url.searchParams.get('refresh') === '1';
      } catch {
        force = false;
      }
      return sendJson(res, 200, await snapshot(force));
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: ROUTE_PATH,
          handler: (req, res) => {
            handle(req, res);
          },
        }),
      'dsh-plugin-deepseek-balance: snapshot route',
    );
  });
}
