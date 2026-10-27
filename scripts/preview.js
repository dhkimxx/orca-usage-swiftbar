// 막대 디자인 미리보기 PNG를 만든다. 다크/라이트 배경에 여러 사용률을 확대해서 그린다.
// 실행: ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca scripts/preview.js docs/bars.png
const fs = require('node:fs')
const path = require('node:path')
const { drawBar, encodePng, PALETTES } = require(path.join(__dirname, '..', 'orca-usage.1m.js'))

const SCALE = 6
const PAD = 18
// [사용률, 기간 경과 비율]
const cases = [
  [0, null],
  [43, 0.69],
  [57, 0.84],
  [75, 0.5],
  [95, 0.9],
]
const modes = [
  ['Dark', [40, 40, 40]],
  ['Light', [236, 236, 236]],
]

const sample = drawBar(0, null, { scale: SCALE, palette: PALETTES.Dark })
const colW = sample.width + PAD * 2
const rowH = sample.height + PAD
const width = colW * modes.length
const height = rowH * cases.length + PAD
const rgba = Buffer.alloc(width * height * 4)

modes.forEach(([name, bg], col) => {
  for (let y = 0; y < height; y++) {
    for (let x = col * colW; x < (col + 1) * colW; x++) {
      const i = (y * width + x) * 4
      rgba.set([...bg, 255], i)
    }
  }
  cases.forEach(([p, pace], row) => {
    const bar = drawBar(p, pace, { scale: SCALE, palette: PALETTES[name] })
    const ox = col * colW + PAD
    const oy = PAD + row * rowH
    for (let y = 0; y < bar.height; y++) {
      for (let x = 0; x < bar.width; x++) {
        const s = (y * bar.width + x) * 4
        const a = bar.rgba[s + 3] / 255
        const d = ((oy + y) * width + ox + x) * 4
        for (let c = 0; c < 3; c++) rgba[d + c] = Math.round(bar.rgba[s + c] * a + rgba[d + c] * (1 - a))
      }
    }
  })
})

const out = process.argv[2] ?? path.join(__dirname, '..', 'docs', 'bars.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, encodePng({ width, height, rgba }, 1))
console.log(`wrote ${out} (${width}x${height})`)
