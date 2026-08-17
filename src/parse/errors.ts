/** An author-facing error, always anchored to a source location. */
export class SlideParseError extends Error {
  readonly file: string
  /** 1-based. */
  readonly line: number

  constructor(message: string, file: string, line: number) {
    super(`${file}:${line} ${message}`)
    this.name = 'SlideParseError'
    this.file = file
    this.line = line
  }
}
