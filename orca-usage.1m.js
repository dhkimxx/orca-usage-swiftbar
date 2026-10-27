#!/usr/bin/env -S ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca
// Orca에 연결된 AI 제공자 사용량을 메뉴바에 표시한다. Orca를 단일 기준(SSOT)으로 쓰며,
// 새로고침도 Orca 런타임에 요청해 Orca가 직접 제공자에서 받아오게 한다.
//
// <xbar.title>Orca Usage</xbar.title>
// <xbar.version>v1.0.0</xbar.version>
// <xbar.author>dhkimxx</xbar.author>
// <xbar.author.github>dhkimxx</xbar.author.github>
// <xbar.desc>Orca에 연결된 AI 제공자 사용량을 메뉴바에 표시</xbar.desc>
// <xbar.dependencies>Orca, SwiftBar</xbar.dependencies>
// <xbar.abouturl>https://github.com/dhkimxx/orca-usage-swiftbar</xbar.abouturl>
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
//
// 설정은 SwiftBar 플러그인 변수로 바꾼다. 값은 플러그인 폴더의 orca-usage.1m.vars.json에 저장된다.
// <xbar.var>select(ORCA_USAGE_TITLE="claude-both"): 메뉴바에 보일 숫자. [claude-both, claude-session, claude-weekly, max]</xbar.var>
// <xbar.var>number(ORCA_USAGE_AUTO_REFRESH_MINUTES="5"): Orca 값이 이 분보다 오래되면 자동 새로고침 (0이면 끔)</xbar.var>
// <xbar.var>number(ORCA_USAGE_WARN_PERCENT="70"): 주황색 경고 기준 (%)</xbar.var>
// <xbar.var>number(ORCA_USAGE_CRITICAL_PERCENT="90"): 빨간색 경고 기준 (%)</xbar.var>
// <xbar.var>boolean(ORCA_USAGE_SHOW_PACE="true"): 막대에 기간 경과 세로선 표시</xbar.var>

const CONFIG = {
  // 메뉴바 숫자: 'claude-both'(세션·주간) | 'claude-session' | 'claude-weekly' | 'max'(전체 중 최고값)
  title: process.env.ORCA_USAGE_TITLE || 'claude-both',
  // Orca 값이 이보다 오래되면 자동으로 Orca에 새로고침 요청. 0이면 자동 새로고침 끔
  autoRefreshAfterMs: numberEnv('ORCA_USAGE_AUTO_REFRESH_MINUTES', 5) * 60_000,
  // 새로고침 요청 최소 간격 (Orca 최소 폴링 간격과 동일)
  minRefreshIntervalMs: 30_000,
  warnPercent: numberEnv('ORCA_USAGE_WARN_PERCENT', 70),
  criticalPercent: numberEnv('ORCA_USAGE_CRITICAL_PERCENT', 90),
  showPace: process.env.ORCA_USAGE_SHOW_PACE !== 'false',
  // 갱신이 이보다 오래 멈춰 있으면 메뉴바를 회색으로
  staleAfterMs: 30 * 60_000,
}

function numberEnv(name, fallback) {
  const raw = process.env[name]
  const value = Number(raw)
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(value) ? value : fallback
}

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const ORCA_CLIENT = '/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/runtime-client.js'
const STATE_FILE = path.join(os.homedir(), 'Library/Caches/orca-usage-swiftbar/state.json')
const PLUGIN_NAME = 'orca-usage'
const RPC_TIMEOUT_MS = 20_000

const COLOR = { warn: '#FF9500', critical: '#FF3B30', muted: '#8E8E93' }

const PROVIDERS = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencodeGo: 'OpenCode Go',
  minimax: 'MiniMax',
  kimi: 'Kimi',
  grok: 'Grok',
  cursor: 'Cursor',
  zcode: 'ZCode',
  antigravity: 'Antigravity',
}

const WINDOW_LABELS = { session: '세션 5시간', weekly: '주간', fableWeekly: '주간 · Fable', monthly: '월간' }
const WINDOW_ORDER = ['session', 'weekly', 'fableWeekly', 'monthly']

// ---------- Orca 런타임 ----------

function createClient() {
  const { RuntimeClient } = require(ORCA_CLIENT)
  // 원격 페어링/환경 변수를 무시하고 이 맥의 Orca에만 붙는다.
  return new RuntimeClient(undefined, RPC_TIMEOUT_MS, null, null)
}

async function listAccounts(client, refreshUsage) {
  const res = await client.call('accounts.list', { refreshUsage }, { timeoutMs: RPC_TIMEOUT_MS })
  return res.result
}

// ---------- 상태 파일 (새로고침 간격 제한, 마지막 실패 기록) ----------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  const tmp = `${STATE_FILE}.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(state))
  fs.renameSync(tmp, STATE_FILE)
}

function canRefresh(state, now) {
  return now - (state.lastRefreshAt ?? 0) >= CONFIG.minRefreshIntervalMs
}

async function refreshViaOrca(client, now) {
  try {
    const snapshot = await listAccounts(client, true)
    writeState({ lastRefreshAt: now, lastRefreshError: null })
    return snapshot
  } catch (error) {
    writeState({ lastRefreshAt: now, lastRefreshError: errorMessage(error) })
    throw error
  }
}

// ---------- 포맷 ----------

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

// SwiftBar는 `|`를 파라미터 구분자로 쓰므로 본문에서 치환한다.
function clean(text) {
  return String(text).replace(/\|/g, '│').replace(/\s+/g, ' ').trim()
}

const pad2 = (n) => String(n).padStart(2, '0')

function percent(value) {
  return Math.round(Math.max(0, Math.min(100, value)))
}

function levelColor(p) {
  if (p >= CONFIG.criticalPercent) return COLOR.critical
  if (p >= CONFIG.warnPercent) return COLOR.warn
  return null
}

// ---------- 막대 이미지 ----------
// 메뉴 항목 이미지로 넣을 PNG 막대를 직접 그린다. pHYs에 배율만큼 dpi를 기록해 Retina에서 선명하게 보인다.

const BAR = { width: 120, height: 12, thickness: 6, scale: 2 } // pt 단위, scale은 픽셀 배율

const PALETTES = {
  Dark: {
    track: [255, 255, 255, 0.16],
    pace: [255, 255, 255, 0.9],
    normal: [10, 132, 255],
    warn: [255, 159, 10],
    critical: [255, 69, 58],
  },
  Light: {
    track: [0, 0, 0, 0.1],
    pace: [0, 0, 0, 0.6],
    normal: [0, 122, 255],
    warn: [255, 149, 0],
    critical: [255, 59, 48],
  },
}
const PALETTE = PALETTES[process.env.OS_APPEARANCE] ?? PALETTES.Light

// 선분 a-b를 반지름 r로 두른 캡슐이 픽셀 중심 (px, py)를 덮는 비율 (안티에일리어싱)
function segmentCoverage(px, py, ax, ay, bx, by, r) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - r
  return Math.max(0, Math.min(1, 0.5 - d))
}

// p: 사용률(0~100), pace: 기간 경과 비율(0~1) 또는 null
function drawBar(p, pace, { scale = BAR.scale, palette = PALETTE } = {}) {
  const w = BAR.width * scale
  const h = BAR.height * scale
  const r = (BAR.thickness * scale) / 2
  const cy = h / 2
  const pct = percent(p)
  const fill = palette[pct >= CONFIG.criticalPercent ? 'critical' : pct >= CONFIG.warnPercent ? 'warn' : 'normal']
  const fillEnd = Math.max(r, (w * pct) / 100 - r)
  const paceX = pace === null ? null : Math.max(scale, Math.min(w - scale, w * pace))
  const layers = [
    { color: palette.track, cover: (x, y) => segmentCoverage(x, y, r, cy, w - r, cy, r) },
    ...(pct > 0 ? [{ color: fill, cover: (x, y) => segmentCoverage(x, y, r, cy, fillEnd, cy, r) }] : []),
    ...(paceX === null
      ? []
      : [{ color: palette.pace, cover: (x, y) => segmentCoverage(x, y, paceX, 1.5 * scale, paceX, h - 1.5 * scale, 0.6 * scale) }]),
  ]

  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 프리멀티플라이드 알파로 레이어를 차례로 덮어 그린다.
      let a = 0
      let rr = 0
      let gg = 0
      let bb = 0
      for (const { color, cover } of layers) {
        const sa = cover(x + 0.5, y + 0.5) * (color[3] ?? 1)
        if (sa === 0) continue
        rr = color[0] * sa + rr * (1 - sa)
        gg = color[1] * sa + gg * (1 - sa)
        bb = color[2] * sa + bb * (1 - sa)
        a = sa + a * (1 - sa)
      }
      if (a === 0) continue
      const i = (y * w + x) * 4
      rgba[i] = Math.round(rr / a)
      rgba[i + 1] = Math.round(gg / a)
      rgba[i + 2] = Math.round(bb / a)
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  return { width: w, height: h, rgba }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

function encodePng({ width, height, rgba }, scale = BAR.scale) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height) // 각 줄 앞의 필터 바이트는 0(None)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 8bit
  ihdr[9] = 6 // RGBA
  const ppm = Math.round((72 * scale) / 0.0254)
  const phys = Buffer.alloc(9)
  phys.writeUInt32BE(ppm, 0)
  phys.writeUInt32BE(ppm, 4)
  phys[8] = 1 // 단위: 미터
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('pHYs', phys),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// SwiftBar 2.1.1은 macOS 26에서 16pt보다 큰 메뉴 이미지를 16x16 안으로 줄이므로,
// 문서에 없는 width/height를 함께 넘겨 원래 크기로 그리게 한다.
function barParams(p, pace) {
  return `image=${encodePng(drawBar(p, pace)).toString('base64')} width=${BAR.width} height=${BAR.height}`
}

function paceFraction(win, now) {
  if (!win.resetsAt || !win.windowMinutes) return null
  return Math.max(0, Math.min(1, 1 - (win.resetsAt - now) / (win.windowMinutes * 60_000)))
}

function formatAge(ms) {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

function formatRemaining(ms) {
  const min = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(min / 60)
  return hours > 0 ? `${hours}시간 ${min % 60}분 후` : `${min}분 후`
}

function formatReset(ts, now) {
  const d = new Date(ts)
  const today = new Date(now)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
      new Date(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000
  )
  if (ts - now < 86_400_000) {
    const day = dayDiff === 0 ? '오늘' : '내일'
    return `${day} ${hm} 리셋 (${formatRemaining(ts - now)})`
  }
  return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]}) ${hm} 리셋`
}

function windowLabel(key, win) {
  if (WINDOW_LABELS[key]) return WINDOW_LABELS[key]
  if (win.windowMinutes === 300) return '5시간'
  if (win.windowMinutes === 10_080) return '주간'
  if (win.windowMinutes === 43_200) return '월간'
  return key
}

// ---------- 데이터 정리 ----------

function usageWindows(limits) {
  const entries = Object.entries(limits).filter(
    ([, v]) => v && typeof v === 'object' && typeof v.usedPercent === 'number'
  )
  const rank = (key) => {
    const i = WINDOW_ORDER.indexOf(key)
    return i === -1 ? WINDOW_ORDER.length : i
  }
  return entries.sort(([a], [b]) => rank(a) - rank(b)).map(([key, win]) => ({ key, ...win }))
}

function providerEntries(rateLimits) {
  const keys = [
    ...Object.keys(PROVIDERS),
    ...Object.keys(rateLimits).filter(
      (k) => !(k in PROVIDERS) && rateLimits[k] && typeof rateLimits[k] === 'object' && 'provider' in rateLimits[k]
    ),
  ]
  return keys
    .filter((k) => rateLimits[k])
    .map((k) => ({ key: k, name: PROVIDERS[k] ?? k, limits: rateLimits[k], windows: usageWindows(rateLimits[k]) }))
}

function isConnected(p) {
  return p.limits.status === 'ok' || (p.windows.length > 0 && p.limits.status !== 'unavailable')
}

// Orca는 제공자 전체를 한 번에 갱신하므로, 연결된 제공자 중 가장 오래된 시각을 기준으로 본다.
function lastUpdatedAt(providers) {
  const connected = providers.filter(isConnected).map((p) => p.limits.updatedAt).filter(Boolean)
  if (connected.length > 0) return Math.min(...connected)
  const all = providers.map((p) => p.limits.updatedAt).filter(Boolean)
  return all.length > 0 ? Math.max(...all) : 0
}

function titleWindows(providers) {
  const claude = providers.find((p) => p.key === 'claude' && isConnected(p))
  if (claude && CONFIG.title !== 'max') {
    const pick = { 'claude-session': ['session'], 'claude-weekly': ['weekly'] }[CONFIG.title] ?? ['session', 'weekly']
    return pick.map((k) => claude.limits[k] ?? null)
  }
  const all = providers.filter(isConnected).flatMap((p) => p.windows)
  if (all.length === 0) return []
  return [all.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a))]
}

function claudeAccountLabel(snapshot) {
  const claude = snapshot.claude
  const active = claude?.accounts?.find((a) => a.id === claude.activeAccountId)
  if (active) return active.organizationName ? `${active.email} (${active.organizationName})` : active.email
  return claude?.systemDefaultEmail ?? null
}

// ---------- 출력 ----------

function gaugeSymbol(p) {
  if (p < 17) return 'gauge.with.dots.needle.0percent'
  if (p < 42) return 'gauge.with.dots.needle.33percent'
  if (p < 59) return 'gauge.with.dots.needle.50percent'
  if (p < 84) return 'gauge.with.dots.needle.67percent'
  return 'gauge.with.dots.needle.100percent'
}

function selfAction(arg) {
  return `bash="${__filename.replace(/["\\]/g, '\\$&')}" param1=${arg} terminal=false refresh=false`
}

const OPEN_ORCA = 'bash=/usr/bin/open param1=-a param2=Orca terminal=false'

// SwiftBar는 동작이 없는 항목을 비활성(회색)으로 그리므로, 정보 줄에는 클릭 시 다시 읽기를 붙인다.
const ACTIVE = 'refresh=true'

function renderUsage(snapshot, now, notices) {
  const rateLimits = snapshot.rateLimits ?? {}
  const providers = providerEntries(rateLimits)
  const updatedAt = lastUpdatedAt(providers)
  const stale = !updatedAt || now - updatedAt > CONFIG.staleAfterMs
  const lines = []

  const shown = titleWindows(providers)
  const values = shown.filter(Boolean).map((w) => w.usedPercent)
  const peak = values.length > 0 ? Math.max(...values) : 0
  const text = shown.length > 0 ? `${shown.map((w) => (w ? percent(w.usedPercent) : '–')).join('·')}%` : '–'
  const color = stale ? COLOR.muted : levelColor(peak)
  lines.push(`${text} | sfimage=${gaugeSymbol(peak)}${color ? ` color=${color}` : ''}`)
  lines.push('---')

  const connected = providers.filter(isConnected)
  let paceShown = false
  for (const p of connected) {
    const account = p.key === 'claude' ? claudeAccountLabel(snapshot) : null
    lines.push(`${clean(account ? `${p.name} · ${account}` : p.name)} | size=13 ${ACTIVE}`)
    for (const w of p.windows) {
      const pct = percent(w.usedPercent)
      const reset = w.resetsAt ? ` · ${formatReset(w.resetsAt, now)}` : ''
      const c = levelColor(pct)
      const pace = CONFIG.showPace ? paceFraction(w, now) : null
      paceShown ||= pace !== null
      lines.push(
        `${String(pct).padStart(3)}%  ${clean(windowLabel(w.key, w) + reset)} | ${barParams(pct, pace)} font=Menlo size=12 ${ACTIVE}${c ? ` color=${c}` : ''}`
      )
    }
    const extra = p.limits.extraUsage
    if (extra?.enabled && typeof extra.spentPercent === 'number') {
      const pct = percent(extra.spentPercent)
      lines.push(`${String(pct).padStart(3)}%  추가 사용량 | ${barParams(pct, null)} font=Menlo size=12 ${ACTIVE}`)
    }
    if (p.limits.status !== 'ok' && p.limits.error) {
      lines.push(`⚠ ${clean(p.limits.error)} | size=11 ${ACTIVE} color=${COLOR.warn}`)
    }
    lines.push('---')
  }
  if (connected.length === 0) {
    lines.push(`연결된 제공자의 사용량이 없습니다 | color=${COLOR.muted}`)
    lines.push('---')
  }

  const disconnected = providers.filter((p) => !isConnected(p))
  if (disconnected.length > 0) {
    lines.push(`미연결 제공자 ${disconnected.length}개 | size=12 color=${COLOR.muted}`)
    for (const p of disconnected) {
      lines.push(`--${clean(p.name)}: ${clean(p.limits.error ?? p.limits.status)} | size=12`)
    }
    lines.push('---')
  }

  const age = updatedAt ? `갱신 ${formatAge(now - updatedAt)} · Orca 기준` : '아직 갱신 기록 없음'
  if (paceShown) lines.push(`세로선 = 기간 경과 지점 · 막대가 선보다 짧으면 여유 | size=11 color=${COLOR.muted}`)
  lines.push(`${age} | size=12 color=${stale ? COLOR.warn : COLOR.muted}`)
  for (const notice of notices) lines.push(`⚠ ${clean(notice)} | size=11 ${ACTIVE} color=${COLOR.warn}`)
  lines.push(`↻ 지금 새로고침 | ${selfAction('--refresh')}`)
  lines.push(`Orca 열기 | ${OPEN_ORCA}`)
  return lines
}

function renderOffline(error) {
  const offline = error?.code === 'runtime_unavailable'
  return [
    `– | sfimage=gauge.with.dots.needle.0percent color=${COLOR.muted}`,
    '---',
    offline ? 'Orca가 실행 중이 아닙니다' : `Orca 연결 실패: ${clean(errorMessage(error))}`,
    `Orca 실행 | ${OPEN_ORCA} refresh=true`,
    `↻ 다시 시도 | refresh=true`,
  ]
}

function print(lines) {
  return new Promise((resolve) => process.stdout.write(`${lines.join('\n')}\n`, resolve))
}

// ---------- 진입점 ----------

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

// Orca 없이 화면을 확인하기 위한 가짜 데이터. capturedAt 기준으로 저장된 시각을 지금으로 옮긴다.
function loadFixture(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const shift = Date.now() - (data.capturedAt ?? Date.now())
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'updatedAt' || key === 'resetsAt') && typeof child === 'number') value[key] = child + shift
      else walk(child)
    }
  }
  walk(data.snapshot)
  return data.snapshot
}

async function render() {
  const now = Date.now()
  const fixture = argValue('--fixture')
  if (fixture) return print(renderUsage(loadFixture(fixture), now, []))

  let client
  let snapshot
  try {
    client = createClient()
    snapshot = await listAccounts(client, false)
  } catch (error) {
    return print(renderOffline(error))
  }

  const state = readState()
  const notices = []
  const updatedAt = lastUpdatedAt(providerEntries(snapshot.rateLimits ?? {}))
  const shouldAutoRefresh =
    CONFIG.autoRefreshAfterMs > 0 && now - updatedAt > CONFIG.autoRefreshAfterMs && canRefresh(state, now)

  if (shouldAutoRefresh) {
    try {
      snapshot = await refreshViaOrca(client, now)
    } catch (error) {
      notices.push(`새로고침 실패: ${errorMessage(error)}`)
    }
  } else if (state.lastRefreshError) {
    notices.push(`새로고침 실패: ${state.lastRefreshError}`)
  }
  return print(renderUsage(snapshot, now, notices))
}

// 메뉴의 "지금 새로고침": Orca에 갱신을 요청한 뒤 SwiftBar에 다시 그리라고 알린다.
async function manualRefresh() {
  const now = Date.now()
  if (canRefresh(readState(), now)) {
    try {
      await refreshViaOrca(createClient(), now)
    } catch {
      // 실패 내용은 상태 파일에 남겨 다음 렌더에서 표시한다.
    }
  }
  spawnSync('/usr/bin/open', ['-g', `swiftbar://refreshplugin?name=${PLUGIN_NAME}`])
}

if (require.main === module) {
  const main = process.argv.includes('--refresh') ? manualRefresh : render
  main()
    .catch((error) => print([`Orca Usage 오류 | color=${COLOR.critical}`, '---', clean(errorMessage(error))]))
    .finally(() => process.exit(0))
}

module.exports = { drawBar, encodePng, PALETTES }
