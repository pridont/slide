// Points git at .githooks/, so the commit-msg hook runs for anyone who has
// installed the dependencies. Run from the `prepare` script.
//
// Git hooks live in .git/hooks, which is not cloned and cannot be committed;
// core.hooksPath moves them to a directory that can be. Doing it here rather
// than inline in package.json keeps it working on Windows, where `||` in a
// script is a shell that may not exist.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Installed as a dependency, or unpacked from a tarball: no repository to
// configure, and no business touching the one it might be sitting inside.
if (!existsSync(join(root, '.git'))) {
  process.exit(0)
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'ignore',
  })
} catch {
  // No git on PATH, or a repository it refuses to touch. The hook is a
  // convenience — CI enforces the same rules — so a failure here is not worth
  // failing an install over.
}
