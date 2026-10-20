// "The Apple's Toll" — a Death Note–themed animated contribution map.
//
// A red apple rolls along the top of the contribution grid. Over every week with
// contributions a blood droplet falls and runs down the column, staining each day
// that was written in code (darker red = more contributions). When the apple
// reaches the end, a pair of shinigami eyes wakes in the dark and blinks; the
// stains fade, and the run begins again. Pure SVG + CSS animation: no scripts, so
// it renders inside GitHub's <img> sandbox.
//
//   node scripts/apple-toll.mjs <user> <outDir>            (needs GITHUB_TOKEN)
//   node scripts/apple-toll.mjs <user> <outDir> --data calendar.json
//
// Writes <outDir>/apple-toll-dark.svg and <outDir>/apple-toll-light.svg.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [user, outDir = 'dist', ...rest] = process.argv.slice(2)
if (!user) throw new Error('usage: apple-toll.mjs <user> <outDir> [--data file.json]')
const dataFlag = rest.indexOf('--data')

// ───────────────────────── data ─────────────────────────
async function fetchCalendar() {
  if (dataFlag >= 0) return JSON.parse(readFileSync(rest[dataFlag + 1], 'utf8'))
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions weeks{contributionDays{date contributionCount contributionLevel weekday}}}}}}`
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'apple-toll' },
    body: JSON.stringify({ query, variables: { login: user } }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors ?? json)}`)
  return json.data.user.contributionsCollection.contributionCalendar
}

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ───────────────────────── geometry & timing ─────────────────────────
const CELL = 11
const GAP = 3
const STEP = CELL + GAP
const LEFT = 30 // room for weekday labels
const RAIL_Y = 30 // the apple's path, above the grid
const TOP = 58 // grid top
const EYES_W = 92 // the shinigami's corner, right of the grid

const T = 16 // seconds per loop
const RUN = 0.6 // fraction of the loop the apple takes to cross
const FALL = 0.5 // seconds for a drop to fall from the apple to the grid
const ROW_DT = 0.07 // seconds for the blood to run one row down
const pct = (s) => `${Math.min(100, Math.max(0, (s / T) * 100)).toFixed(2)}%`
const r = (n) => Math.round(n * 10) / 10

const THEMES = {
  dark: {
    bg: '#0d1117',
    grain: '#1a0b0e',
    empty: '#161b22',
    stain: ['#161b22', '#4a0a12', '#7a0f18', '#b3121b', '#ff2a3a'],
    text: '#8b949e',
    title: '#e8e2d0',
    rail: '#30363d',
    eye: '#ff2a3a',
  },
  light: {
    bg: '#f6f8fa',
    grain: '#f1e4e4',
    empty: '#ebedf0',
    stain: ['#ebedf0', '#f2b8bd', '#e0525f', '#b3121b', '#6e0a12'],
    text: '#57606a',
    title: '#24292f',
    rail: '#d0d7de',
    eye: '#c1121f',
  },
}

function render(cal, theme) {
  const t = THEMES[theme]
  const weeks = cal.weeks
  const cols = weeks.length
  const gridW = cols * STEP - GAP
  const W = LEFT + gridW + EYES_W
  const H = TOP + 7 * STEP - GAP + 34
  const colX = (c) => LEFT + c * STEP
  const dt = (T * RUN) / Math.max(1, cols - 1) // apple time per column

  const css = []
  const cells = []
  const stains = []
  const drops = []
  const months = []
  let lastMonth = -1

  weeks.forEach((w, c) => {
    const first = w.contributionDays[0]
    const m = Number(first.date.slice(5, 7)) - 1
    if (m !== lastMonth && c < cols - 2) {
      months.push(`<text x="${colX(c)}" y="${TOP - 8}" class="lbl">${MONTHS[m]}</text>`)
      lastMonth = m
    }
    const active = w.contributionDays.filter((d) => d.contributionCount > 0)
    const tApple = c * dt // apple above this column
    if (active.length) {
      // the droplet: falls from the apple to the top of the grid, then vanishes into the column
      const t0 = tApple
      const t1 = tApple + FALL
      const x = colX(c) + CELL / 2
      css.push(
        `@keyframes d${c}{0%,${pct(t0)}{transform:translateY(0);opacity:0}${pct(t0 + 0.05)}{opacity:1}` +
          `${pct(t1)}{transform:translateY(${TOP - RAIL_Y - 6}px);opacity:1}${pct(t1 + 0.12)},100%{transform:translateY(${TOP - RAIL_Y}px);opacity:0}}`,
      )
      drops.push(`<path class="drop" style="animation-name:d${c}" d="M${x} ${RAIL_Y + 6}c-2.6 3.4-3.8 5.3-3.8 6.9a3.8 3.8 0 0 0 7.6 0c0-1.6-1.2-3.5-3.8-6.9z"/>`)
    }
    w.contributionDays.forEach((d) => {
      const y = TOP + d.weekday * STEP
      const x = colX(c)
      cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" class="cell"/>`)
      const lvl = LEVEL[d.contributionLevel] ?? 0
      if (!lvl) return
      // stained when the blood running down the column reaches this day; fades at the loop's end
      const ts = tApple + FALL + d.weekday * ROW_DT
      const id = `s${c}_${d.weekday}`
      css.push(
        `@keyframes ${id}{0%,${pct(ts)}{opacity:0;transform:scale(.2)}${pct(ts + 0.12)}{opacity:1;transform:scale(1.35)}` +
          `${pct(ts + 0.4)}{transform:scale(1)}90%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}`,
      )
      stains.push(
        `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.stain[lvl]}" class="stain" style="animation-name:${id}">` +
          `<title>${d.date}: ${d.contributionCount} contribution${d.contributionCount === 1 ? '' : 's'}</title></rect>`,
      )
    })
  })

  const x0 = colX(0) + CELL / 2
  const x1 = colX(cols - 1) + CELL / 2
  const runEnd = T * RUN
  const eyesX = LEFT + gridW + EYES_W / 2 + 4
  const eyesY = TOP + 3 * STEP + 2
  const total = cal.totalContributions

  css.push(
    // the apple rolls across, slips into the dark at the end, and returns
    `@keyframes roll{0%{transform:translateX(0);opacity:1}${pct(runEnd)}{transform:translateX(${r(x1 - x0)}px);opacity:1}` +
      `${pct(runEnd + 0.6)}{transform:translateX(${r(x1 - x0 + 34)}px);opacity:0}97%{transform:translateX(-18px);opacity:0}100%{transform:translateX(0);opacity:1}}`,
    `@keyframes spin{to{transform:rotate(${Math.round(((x1 - x0) / (Math.PI * 9)) * 360)}deg)}}`,
    // the eyes open as the apple arrives, blink twice, then close with the stains
    `@keyframes eyes{0%,${pct(runEnd + 0.2)}{opacity:0;transform:scaleY(.05)}${pct(runEnd + 0.8)}{opacity:1;transform:scaleY(1)}` +
      `${pct(runEnd + 2.2)}{transform:scaleY(1)}${pct(runEnd + 2.32)}{transform:scaleY(.08)}${pct(runEnd + 2.48)}{transform:scaleY(1)}` +
      `${pct(runEnd + 3.4)}{transform:scaleY(1)}${pct(runEnd + 3.52)}{transform:scaleY(.08)}${pct(runEnd + 3.68)}{transform:scaleY(1)}` +
      `90%{opacity:1;transform:scaleY(1)}97%,100%{opacity:0;transform:scaleY(.05)}}`,
    `@keyframes haze{0%,${pct(runEnd)}{opacity:0}${pct(runEnd + 1)}{opacity:.55}90%{opacity:.45}97%,100%{opacity:0}}`,
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${user}'s contribution map: ${total} contributions in the last year, each day stained blood red as an apple rolls past">
<title>${total} contributions in the last year</title>
<defs>
  <radialGradient id="ap" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ff6b6b"/><stop offset=".5" stop-color="#c1121f"/><stop offset="1" stop-color="#4a0508"/></radialGradient>
  <radialGradient id="hz" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${t.eye}" stop-opacity=".45"/><stop offset="1" stop-color="${t.eye}" stop-opacity="0"/></radialGradient>
  <filter id="gl" x="-80%" y="-200%" width="260%" height="500%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<style>
  .lbl{font:10px -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;fill:${t.text}}
  .ttl{font:600 12px -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;fill:${t.title}}
  .cell{fill:${t.empty}}
  .stain,.drop,.apple,.spin,.eyes,.haze{animation-duration:${T}s;animation-iteration-count:infinite;animation-timing-function:linear}
  .stain{transform-box:fill-box;transform-origin:center;animation-timing-function:ease-out}
  .drop{fill:#d0121f;animation-timing-function:cubic-bezier(.5,0,.9,.6)}
  .apple{animation-name:roll}
  .spin{transform-box:fill-box;transform-origin:center;animation-name:spin}
  .eyes{transform-box:fill-box;transform-origin:center;animation-name:eyes}
  .haze{animation-name:haze}
  ${css.join('\n  ')}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}.stain{opacity:1}.apple,.eyes{opacity:1}}
</style>
<rect width="${W}" height="${H}" rx="8" fill="${t.bg}"/>
<line x1="${x0 - 8}" y1="${RAIL_Y + 10}" x2="${x1 + 8}" y2="${RAIL_Y + 10}" stroke="${t.rail}" stroke-dasharray="2 4"/>
${months.join('')}
<text x="2" y="${TOP + 1 * STEP + 9}" class="lbl">Mon</text><text x="2" y="${TOP + 3 * STEP + 9}" class="lbl">Wed</text><text x="2" y="${TOP + 5 * STEP + 9}" class="lbl">Fri</text>
<g>${cells.join('')}</g>
<g>${stains.join('')}</g>
<g>${drops.join('')}</g>
<g class="apple"><g transform="translate(${x0} ${RAIL_Y})"><g class="spin">
  <path d="M0-5.5C-1.6-7.2-6.8-7-8.4-2.6-10 2 -7 8.2-3.4 8.9-1.8 9.2-.8 8.4 0 8.4S1.8 9.2 3.4 8.9C7 8.2 10 2 8.4-2.6 6.8-7 1.6-7.2 0-5.5Z" fill="url(#ap)"/>
  <ellipse cx="-4.2" cy="-1.6" rx="1.6" ry="2.8" fill="#fff" opacity=".35" transform="rotate(20 -4.2 -1.6)"/>
  <path d="M0-5.3C0-7.6.6-9.2 2-10.4" stroke="#3b2414" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  <path d="M1.4-9.4c2.4-2.4 5.6-2 6.6-1-2 2.2-4.6 2.6-6.6 1Z" fill="#3e6b2e"/>
</g></g></g>
<ellipse class="haze" cx="${eyesX}" cy="${eyesY}" rx="44" ry="26" fill="url(#hz)"/>
<g class="eyes" filter="url(#gl)">
  <path d="M${eyesX - 30} ${eyesY}q11-7 22 0q-11 5-22 0Z" fill="${t.eye}"/>
  <path d="M${eyesX + 8} ${eyesY}q11-7 22 0q-11 5-22 0Z" fill="${t.eye}"/>
</g>
<text x="${LEFT}" y="${H - 12}" class="ttl">${total} contributions in the last year</text>
<text x="${LEFT + gridW}" y="${H - 12}" class="lbl" text-anchor="end">every day written in code, stained in the note</text>
</svg>
`
}

const cal = await fetchCalendar()
mkdirSync(outDir, { recursive: true })
for (const theme of Object.keys(THEMES)) {
  const file = join(outDir, `apple-toll-${theme}.svg`)
  writeFileSync(file, render(cal, theme))
  console.log(`wrote ${file}`)
}
