// "The Dossier" — a profile summary card in the Death Note palette: name, all-time
// contributions, public repositories, years on GitHub, location, and a smooth
// area chart of contributions per month over the last year.
//
//   node scripts/dossier-card.mjs <user> <outDir>                (needs GITHUB_TOKEN)
//   node scripts/dossier-card.mjs <user> <outDir> --data file.json
//
// Writes <outDir>/dossier.svg. Static SVG (no scripts), safe for GitHub's <img>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [user, outDir = 'dist', ...rest] = process.argv.slice(2)
if (!user) throw new Error('usage: dossier-card.mjs <user> <outDir> [--data file.json]')
const dataFlag = rest.indexOf('--data')

async function gql(query, variables) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'dossier-card' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors ?? json)}`)
  return json.data
}

async function fetchData() {
  if (dataFlag >= 0) return JSON.parse(readFileSync(rest[dataFlag + 1], 'utf8'))
  const base = await gql(
    `query($login:String!){user(login:$login){name login location createdAt
      repositories(privacy:PUBLIC,ownerAffiliations:OWNER){totalCount}
      contributionsCollection{contributionYears contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
    { login: user },
  )
  const u = base.user
  // all-time total: one query per contribution year
  let allTime = 0
  for (const year of u.contributionsCollection.contributionYears) {
    const d = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{totalContributions}}}}`,
      { login: user, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    )
    allTime += d.user.contributionsCollection.contributionCalendar.totalContributions
  }
  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays)
  return { name: u.name, login: u.login, location: u.location, createdAt: u.createdAt, repos: u.repositories.totalCount, allTime, days }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const r1 = (n) => Math.round(n * 10) / 10

/** Smooth path through points (Catmull-Rom → cubic Bézier), clamped so it never dips below the baseline. */
function smooth(pts, floor) {
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)]
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`
  }
  return d
}

function render(data) {
  const W = 760
  const H = 230
  // ── monthly totals over the calendar's year ──
  const byMonth = new Map()
  for (const d of data.days) {
    const k = d.date.slice(0, 7)
    byMonth.set(k, (byMonth.get(k) ?? 0) + d.contributionCount)
  }
  const months = [...byMonth.keys()].sort()
  const values = months.map((m) => byMonth.get(m))
  const max = Math.max(4, ...values)
  const niceMax = Math.ceil(max / 4) * 4

  // ── chart geometry ──
  const cx0 = 360
  const cx1 = W - 52
  const cy0 = 52
  const cy1 = H - 46
  const x = (i) => cx0 + (i / Math.max(1, months.length - 1)) * (cx1 - cx0)
  const y = (v) => cy1 - (v / niceMax) * (cy1 - cy0)
  const pts = values.map((v, i) => [x(i), y(v)])
  const line = smooth(pts, cy1)
  const area = `${line}L${r1(cx1)} ${cy1}L${cx0} ${cy1}Z`

  const ticks = [0, 1, 2, 3, 4].map((k) => (niceMax / 4) * k)
  const yAxis = ticks
    .map((t) => `<line x1="${cx1}" x2="${cx1 + 4}" y1="${r1(y(t))}" y2="${r1(y(t))}" class="ax"/><text x="${cx1 + 8}" y="${r1(y(t)) + 3.5}" class="tk">${t}</text>`)
    .join('')
  const grid = ticks.slice(1).map((t) => `<line x1="${cx0}" x2="${cx1}" y1="${r1(y(t))}" y2="${r1(y(t))}" class="grid"/>`).join('')
  const xLabels = months
    .map((m, i) => (i % 2 === 0 ? `<text x="${r1(x(i))}" y="${cy1 + 16}" class="tk" text-anchor="middle">${m.slice(2, 4)}/${m.slice(5, 7)}</text>` : ''))
    .join('')

  const years = Math.max(1, Math.floor((Date.now() - new Date(data.createdAt).getTime()) / (365.25 * 864e5)))
  const yearCount = data.days.reduce((n, d) => n + d.contributionCount, 0)
  const name = data.name ? `${data.login} (${data.name})` : data.login
  const rows = [
    ['M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2Z', `${data.allTime.toLocaleString('en-US')} Contributions on GitHub`],
    ['M2 2.5A2.5 2.5 0 0 1 4.5 0h8.8a.7.7 0 0 1 .7.7v12.6a.7.7 0 0 1-.7.7h-2.5a.7.7 0 0 1 0-1.5h1.7v-2H4.5a1 1 0 0 0-.8 1.7.7.7 0 1 1-1.1 1A2.5 2.5 0 0 1 2 11.5v-9Zm10.5-1h-8a1 1 0 0 0-1 1v6.7a2.5 2.5 0 0 1 1-.2h8V1.5ZM5 12.3v3.5a.3.3 0 0 0 .4.2l1.4-1a.3.3 0 0 1 .3 0l1.4 1a.3.3 0 0 0 .5-.2v-3.5a.3.3 0 0 0-.3-.3H5.3a.3.3 0 0 0-.3.3Z', `${data.repos} Public Repos`],
    ['M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.3v2.9l1.8 1.8a.8.8 0 0 1-1 1L7.2 8.5a.8.8 0 0 1-.2-.5V4.8a.8.8 0 0 1 1.5 0Z', `Joined GitHub ${years} year${years === 1 ? '' : 's'} ago`],
    ...(data.location ? [['m12.6 11.4-3.5 3.6a1.6 1.6 0 0 1-2.2 0L3.4 11.4a6.4 6.4 0 1 1 9.2 0ZM8 1.5a4.9 4.9 0 0 0-3.5 8.4L8 13.5l3.5-3.6A4.9 4.9 0 0 0 8 1.5ZM8 5a1.8 1.8 0 1 1 0 3.5A1.8 1.8 0 0 1 8 5Z', esc(data.location)]] : []),
  ]
  const rowSvg = rows
    .map(
      ([icon, text], i) =>
        `<g transform="translate(26 ${84 + i * 34})"><path d="${icon}" class="ic" transform="translate(0 -12)"/><text x="26" y="0" class="row">${text}</text></g>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}: ${data.allTime} contributions on GitHub, ${data.repos} public repositories, joined ${years} years ago${data.location ? `, ${esc(data.location)}` : ''}. ${yearCount} contributions in the last year.">
<defs>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ff2a3a" stop-opacity=".85"/>
    <stop offset=".6" stop-color="#b3121b" stop-opacity=".55"/>
    <stop offset="1" stop-color="#5c0a10" stop-opacity=".15"/>
  </linearGradient>
  <radialGradient id="glow" cx="20%" cy="0%" r="80%">
    <stop offset="0" stop-color="#5c0a10" stop-opacity=".45"/>
    <stop offset="1" stop-color="#5c0a10" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="reveal"><rect x="${cx0}" y="0" width="0" height="${H}"><animate attributeName="width" from="0" to="${cx1 - cx0 + 2}" dur="1.6s" fill="freeze" calcMode="spline" keySplines=".22 1 .36 1" keyTimes="0;1"/></rect></clipPath>
</defs>
<style>
  .ttl{font:600 21px 'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif;fill:#ef3b47}
  .row{font:400 15px 'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif;fill:#e8e2d0}
  .ic{fill:#c1121f}
  .tk{font:400 10px 'Segoe UI',Ubuntu,Arial,sans-serif;fill:#a9a294}
  .cap{font:400 10.5px 'Segoe UI',Ubuntu,Arial,sans-serif;fill:#ef3b47;letter-spacing:.3px}
  .ax{stroke:#a9a294;stroke-width:1}
  .grid{stroke:#e8e2d0;stroke-opacity:.07}
  .base{stroke:#a9a294;stroke-width:1}
  @media (prefers-reduced-motion:reduce){animate{display:none}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="6" fill="#050505" stroke="#5c0a10"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="6" fill="url(#glow)"/>
<text x="26" y="42" class="ttl">${esc(name.length > 34 ? `${name.slice(0, 33)}…` : name)}</text>
${rowSvg}
<text x="${cx1}" y="38" class="cap" text-anchor="end">contributions in the last year · ${yearCount}</text>
${grid}
<g clip-path="url(#reveal)">
  <path d="${area}" fill="url(#fill)"/>
  <path d="${line}" fill="none" stroke="#ff2a3a" stroke-width="1.6"/>
</g>
<line x1="${cx0}" x2="${cx1}" y1="${cy1}" y2="${cy1}" class="base"/>
<line x1="${cx1}" x2="${cx1}" y1="${cy0 - 4}" y2="${cy1}" class="ax"/>
${yAxis}
${xLabels}
</svg>
`
}

const data = await fetchData()
mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'dossier.svg')
writeFileSync(file, render(data))
console.log(`wrote ${file} (${data.allTime} all-time, ${data.repos} repos)`)
