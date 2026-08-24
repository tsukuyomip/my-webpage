let seq = 0

/** 譜面内でユニークならよいので、短くて読みやすい ID にする。 */
export function newId(): string {
  seq += 1
  return `n${seq.toString(36)}${Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, '0')}`
}
