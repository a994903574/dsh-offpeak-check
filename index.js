// ============================================================================
// dsh-offpeak-check
// DeepSeek 官网峰期价格时段核对：启动后抓一次官网价格页，与本地记录比对。
//   * 一致   -> 静默
//   * 不一致 -> 写 pending + 通知，等你确认，绝不自动改
//   * 抓不到 -> 只记 STALE，本地记录保持原样
// 自包含：不 spawn 子进程、不依赖外部脚本、不 import 宿主包。
// ============================================================================
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const name = 'dsh-offpeak-check';

export const DEFAULTS = {
  timezone: 'Asia/Shanghai',
  utcOffsetMinutes: 480,
  sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
  sourcePattern: 'Peak hours are (.+?) UTC',
  peak: [
    { days: 'mon-fri', from: '09:00', to: '12:00' },
    { days: 'mon-fri', from: '14:00', to: '18:00' },
  ],
  notes: '官网按 UTC 公布：01:00-04:00、06:00-10:00（周一至周五，中国法定节假日除外）。本地换算为 UTC+8。',
  checkedAt: '',
  recheckAfterDays: 30,
};

const STARTUP_DELAY_MS = 15000;
const CHECK_INTERVAL_MS = 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 25000;

function here() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function homeDir() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
}

function files() {
  const h = homeDir();
  return {
    cfg: path.join(h, 'offpeak-hours.json'),
    pending: path.join(h, 'offpeak-pending.json'),
    status: path.join(h, 'offpeak-status.json'),
    log: path.join(h, 'offpeak-check.log'),
  };
}

function log(line) {
  const stamp = new Date().toLocaleString('sv-SE', { hour12: false });
  try { appendFileSync(files().log, stamp + '  [offpeak] ' + line + '\n', 'utf8'); } catch {}
  console.log('[offpeak] ' + line);
}

export function loadConfig() {
  const f = files();
  try { mkdirSync(path.dirname(f.cfg), { recursive: true }); } catch {}
  if (!existsSync(f.cfg)) {
    writeFileSync(f.cfg, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
    log('已生成默认配置 ' + f.cfg);
    return { ...DEFAULTS };
  }
  try {
    const c = JSON.parse(readFileSync(f.cfg, 'utf8'));
    return { ...DEFAULTS, ...c };
  } catch (e) {
    log('配置读取失败（保持默认）: ' + e.message);
    return { ...DEFAULTS };
  }
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isOffPeak(cfg, now = new Date()) {
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const r of cfg.peak || []) {
    if (r.days && r.days !== 'mon-fri') continue;
    if (cur >= toMinutes(r.from) && cur < toMinutes(r.to)) return false;
  }
  return true;
}

// "01:00-04:00 and 06:00-10:00" -> [{from,to},...]  (UTC)
export function parseUtcRanges(text) {
  const out = [];
  const re = /(\d{1,2}:\d{2})\s*[-–~]\s*(\d{1,2}:\d{2})/g;
  let m;
  while ((m = re.exec(String(text)))) out.push({ from: m[1].padStart(5, '0'), to: m[2].padStart(5, '0') });
  return out;
}

export function toLocalRanges(ranges, offsetMinutes = 480) {
  const shift = (hhmm) => {
    const total = (toMinutes(hhmm) + offsetMinutes + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
  return ranges.map((r) => ({ days: 'mon-fri', from: shift(r.from), to: shift(r.to) }));
}

const fmt = (list) => (list || []).map((r) => r.from + '-' + r.to).join(',');

function sameRanges(a, b) {
  return fmt([...a].sort((x, y) => x.from.localeCompare(y.from))) === fmt([...b].sort((x, y) => x.from.localeCompare(y.from)));
}

function notify(title, body) {
  if (process.platform !== 'win32') { log('通知（非 Windows 仅记日志）: ' + title + ' / ' + body); return; }
  const esc = (s) => String(s).replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    '$t = $x.GetElementsByTagName("text")',
    "$t.Item(0).AppendChild($x.CreateTextNode('" + esc(title) + "')) | Out-Null",
    "$t.Item(1).AppendChild($x.CreateTextNode('" + esc(body) + "')) | Out-Null",
    '$n = [Windows.UI.Notifications.ToastNotification]::new($x)',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DeepSeek Harness').Show($n)",
  ].join('; ');
  try {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => {});
    }).catch(() => {});
  } catch (e) {
    log('通知失败: ' + e.message);
  }
}

function writeStatus(patch) {
  const f = files();
  let cur = {};
  try { cur = JSON.parse(readFileSync(f.status, 'utf8')); } catch {}
  try { writeFileSync(f.status, JSON.stringify({ ...cur, ...patch, at: new Date().toISOString() }, null, 2) + '\n', 'utf8'); } catch {}
}

export async function check() {
  const cfg = loadConfig();
  let html;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(cfg.sourceUrl, { signal: ctrl.signal, headers: { 'user-agent': 'dsh-offpeak-check' } });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } catch (e) {
    log('抓取失败: ' + e.message + '（本地记录保持不变）');
    writeStatus({ result: 'stale', error: String(e.message || e) });
    return { ok: false, reason: 'fetch-failed', error: String(e.message || e) };
  }

  let m;
  try { m = html.match(new RegExp(cfg.sourcePattern)); } catch (e) {
    log('正则无效: ' + e.message);
    return { ok: false, reason: 'bad-pattern' };
  }
  if (!m) {
    log('页面上没找到时段描述（可能改版），本地记录保持不变');
    writeStatus({ result: 'stale', error: 'pattern-not-found' });
    return { ok: false, reason: 'pattern-not-found' };
  }

  const remote = toLocalRanges(parseUtcRanges(m[1]), cfg.utcOffsetMinutes);
  if (!remote.length) {
    log('解析出的时段为空: ' + JSON.stringify(m[1]));
    writeStatus({ result: 'stale', error: 'parse-empty' });
    return { ok: false, reason: 'parse-empty' };
  }

  if (sameRanges(remote, cfg.peak)) {
    log('一致：' + fmt(remote));
    writeStatus({ result: 'match', peak: remote });
    return { ok: true, changed: false, peak: remote };
  }

  const pending = { peak: remote, notes: '官网原文：' + m[1] + ' UTC', detectedAt: new Date().toISOString() };
  writeFileSync(files().pending, JSON.stringify(pending, null, 2) + '\n', 'utf8');
  writeStatus({ result: 'changed', local: cfg.peak, remote });
  log('发现变化：本地 ' + fmt(cfg.peak) + ' → 官网 ' + fmt(remote) + '（已写 pending，未自动应用）');
  notify('DeepSeek 峰期时段有变化', '本地 ' + fmt(cfg.peak) + ' → 官网 ' + fmt(remote));
  return { ok: true, changed: true, local: cfg.peak, remote };
}

export function applyPending() {
  const cfg = loadConfig();
  const f = files();
  if (!existsSync(f.pending)) return { ok: false, reason: 'no-pending' };
  const p = JSON.parse(readFileSync(f.pending, 'utf8'));
  const next = { ...cfg, peak: p.peak, notes: p.notes, checkedAt: new Date().toISOString().slice(0, 10) };
  writeFileSync(f.cfg, JSON.stringify(next, null, 2) + '\n', 'utf8');
  try { unlinkSync(f.pending); } catch {}
  log('已应用 pending：' + fmt(p.peak));
  return { ok: true, peak: p.peak };
}

// ---- 界面：标题栏「价格」按钮 + 今日峰期面板 ----
const CLIENT_ROUTE = '/dsh-offpeak-check/client.js';
const LOADER = 'var s=document.createElement("script");s.src="' + CLIENT_ROUTE + '";s.onerror=function(){};document.body.appendChild(s);';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function readStatus() {
  try { return JSON.parse(readFileSync(files().status, 'utf8')); } catch { return null; }
}

function registerUi(ctx) {
  try {
    ctx.on('webserver/index-inject', (table) => {
      const row = { kind: 'script', placement: 'body', text: LOADER };
      if (typeof table.push === 'function') table.push(row);
    });
  } catch (e) { log('注入订阅失败: ' + ((e && e.message) || e)); }

  try {
    ctx.inject(['webServer'], (c) => {
      const route = (path, handler) => c.effect(() => c.webServer.register({ kind: 'exact', path, handler }));
      route(CLIENT_ROUTE, (req, res) => {
        try {
          const js = readFileSync(path.join(here(), 'client.js'), 'utf8');
          res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
          res.end(js);
        } catch (e) { res.writeHead(404); res.end('missing client.js'); }
      });
      route('/dsh-offpeak-check/data', (req, res) => {
        const cfg = loadConfig();
        const body = JSON.stringify({
          peak: cfg.peak, utcOffsetMinutes: cfg.utcOffsetMinutes,
          status: readStatus(), now: new Date().toISOString(),
        });
        res.writeHead(200, JSON_HEADERS);
        res.end(body);
      });
      route('/dsh-offpeak-check/check', async (req, res) => {
        try {
          const r = await check();
          res.writeHead(200, JSON_HEADERS);
          res.end(JSON.stringify(r));
        } catch (e) {
          res.writeHead(500, JSON_HEADERS);
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
        }
      });
      log('界面路由已注册: ' + CLIENT_ROUTE);
    });
  } catch (e) { log('路由注册失败: ' + ((e && e.message) || e)); }
}

export function apply(ctx) {
  const run = () => { check().catch((e) => log('检查异常: ' + (e && e.message ? e.message : e))); };
  const t1 = setTimeout(run, STARTUP_DELAY_MS);
  const t2 = setInterval(run, CHECK_INTERVAL_MS);
  if (t1.unref) t1.unref();
  if (t2.unref) t2.unref();
  registerUi(ctx);
  log('已装载（' + STARTUP_DELAY_MS / 1000 + ' 秒后首次核对，之后每 ' + CHECK_INTERVAL_MS / 3600000 + ' 小时）');
}

// ---- 命令行入口（可选）：node index.js [--check|--apply|--now] ----
const argv1 = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === argv1) {
  const a = process.argv.slice(2);
  if (a.includes('--apply')) console.log(JSON.stringify(applyPending()));
  else if (a.includes('--now')) console.log(JSON.stringify({ offPeak: isOffPeak(loadConfig()) }));
  else console.log(JSON.stringify(await check()));
  process.exit(0);
}
