# Personal Agent Instructions

## Commit & Branch Conventions

**IMPORTANT: DO NOT CREATE BRANCHES. ALWAYS COMMIT DIRECTLY TO `main`.**

Always use Conventional Commits v1.0.0 for commit messages, branch names, and related versioning

### Requirements
- commit messages must follow the Conventional Comments format: `<type>[optional scope]: <description>`
  - types: feat, fix, docs, style, refactor, perf, test, chore, etc
  - use imperative mood, lowercase description, no period at end
  - include breaking change indicator `!` or `BREAKING CHANGE:` footer when applicable
- use a second `-m` argument for `git commit` for more details
  - the body message should include the ticket number as the last line of the body
  - the ticket reference must be the final line of the second commit message body
- **DO NOT USE BRANCHES. COMMIT STRAIGHT TO `main`.**
- never use ad-hoc or free-form messages
  - always validate against https://www.conventionalcommits.org/en/v1.0.0/

## Release Conventions

Every tag must have a GitHub release, created immediately after the tag is pushed

### Requirements
- create the release right after pushing the tag, before starting other work
- derive the notes from the commits between the previous tag and the new tag (`git log <prev-tag>..<new-tag> --oneline`), rewritten as user-facing changes
- call out breaking changes explicitly in a "Breaking changes" section at the top of the notes — any commit with a `!` suffix or `BREAKING CHANGE:` footer in the range is breaking
- for the first release, state that it is the initial release and list all changes since the initial commit
- release notes must use a structured format with `## Changes` and `## Breaking changes` sections; for configuration changes, explicitly include the new search order and a brief "how to use" instruction
