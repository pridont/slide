// Commit messages are the changelog. release-please reads the same history to
// work out the next version and to write CHANGELOG.md, so a message that does
// not parse is a release note that silently goes missing.
//
// Enforced twice: locally by .githooks/commit-msg, and in CI over every commit
// on a pull request plus the pull request title (which becomes the commit
// message on a squash merge).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The list release-please knows about, and nothing else — an invented type
    // is not a typo the tooling can recover from, it is a commit left out of
    // the changelog.
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'revert', 'docs', 'style', 'refactor', 'test', 'build', 'ci', 'chore'],
    ],
    // Release notes are read in a list, so a subject that runs past a line is
    // a subject nobody finishes. The body is where the detail belongs.
    'header-max-length': [2, 'always', 72],
    // Scopes are freeform, but a "Feat(CLI)" and a "feat(cli)" are two entries
    // in a changelog that should have been one.
    'scope-case': [2, 'always', 'kebab-case'],
    // Off. A subject opening on an acronym — "CLI flag ...", "CSS custom
    // properties ..." — reads as upper-case to this rule, and half the
    // subjects in this repository start on one.
    'subject-case': [0],
  },
}
