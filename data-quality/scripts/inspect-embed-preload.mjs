import fs from 'node:fs'

const s = fs.readFileSync('public/capacity/embed.js', 'utf8')
const idx = s.indexOf(',y=function')
console.log(s.slice(idx, idx + 800))
