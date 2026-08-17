/**
 * Did-you-mean for authoring errors — unknown frontmatter keys, unknown theme
 * tokens. Null when nothing is close enough to be worth guessing at.
 */
export function closest(input: string, candidates: readonly string[]): string | null {
  let best: string | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  // Longer names tolerate more typos; the floor keeps short keys from
  // matching everything.
  const threshold = Math.max(2, Math.floor(input.length / 3))
  return bestDistance <= threshold ? best : null
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row.push(Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost))
    }
    prev = row
  }
  return prev[b.length]!
}
