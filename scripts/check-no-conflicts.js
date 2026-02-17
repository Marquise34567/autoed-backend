const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const EXCLUDE_DIRS = ['node_modules', '.git']
const ALLOWED_EXT = new Set(['.js', '.ts', '.json', '.jsx', '.tsx'])

function walk(dir, cb) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
  for (const it of items) {
    if (EXCLUDE_DIRS.includes(it.name)) continue
    const full = path.join(dir, it.name)
    if (it.isDirectory()) walk(full, cb)
    else cb(full)
  }
}

const markers = ['<<<<<<<', '=======', '>>>>>>>']
let found = []

walk(ROOT, (file) => {
  const ext = path.extname(file)
  if (!ALLOWED_EXT.has(ext)) return
  // ignore files in scripts that are this script etc
  try {
    const txt = fs.readFileSync(file, 'utf8')
    for (const m of markers) if (txt.includes(m)) {
      found.push({ file, marker: m })
      break
    }
  } catch (e) { /* ignore read errors */ }
})

if (found.length) {
  console.error('\nERROR: merge conflict markers detected in source files:')
  for (const f of found) console.error('-', f.file, f.marker)
  console.error('\nPlease resolve conflicts and commit before starting.')
  process.exit(1)
}
console.log('No conflict markers found.')
process.exit(0)
