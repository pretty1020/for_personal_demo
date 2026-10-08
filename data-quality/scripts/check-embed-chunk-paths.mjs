import fs from 'node:fs'

const s = fs.readFileSync('public/capacity/embed.js', 'utf8')

// Find __vite__mapDeps array contents if present
const mapIdx = s.indexOf('__vite__mapDeps')
console.log('has mapDeps', mapIdx >= 0)
if (mapIdx >= 0) {
  console.log(s.slice(mapIdx, mapIdx + 800))
}

const slashChunks = [...s.matchAll(/\/chunks\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0])
console.log('any /chunks/ paths:', [...new Set(slashChunks)].slice(0, 15))

const capacityChunks = [...s.matchAll(/\/capacity\/chunks\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0])
console.log('any /capacity/chunks/ paths:', [...new Set(capacityChunks)].slice(0, 15))
