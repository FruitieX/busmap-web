# CI and deployment checks

The `Checks` GitHub Actions job runs on every PR (including Renovate and forks)
and every branch push. It installs the lockfile with `npm ci`, lints and
typechecks the application and tests, builds the production bundle, validates
the MapLibre worker asset, then runs the suite below. No production secrets are
needed: CI builds with a dummy API key and tests intercept transit requests.

## Coverage

- Unit regressions: exact trip/date/direction matching, fresh stationary vehicles,
  canceled/stale vehicles, avoiding double delay, braking distance, and rejection
  of out-of-order vehicle messages.
- Deployment gate: exact-commit/workflow matching, queued runs, newer failed runs,
  canceled/skipped CI, missing runs, lookup failures and timeouts all fail closed.
- Desktop and mobile Chromium: production startup and worker loading; tap,
  keyboard and drag sheet controls; real MQTT decoding and numeric stop IDs;
  vehicle → stop → vehicle navigation; relative departure labels and unavailable
  vehicles; search and saved-route/theme persistence; cached timetable failures;
  service-worker activation and offline app-shell reload.

Tests exercise the compiled app through its UI. HTTP and MQTT WebSocket fixtures
provide fixed data and the browser clock provides a fixed service date. Map styles
use a minimal local fixture, while the real MapLibre renderer and emitted worker
still run. This catches integration regressions without depending on HSL, CARTO,
credentials, or vehicles happening to be on the road. It does not validate live
provider availability, real map tiles, or upstream schema changes.

## Running locally

```sh
npm ci
npx playwright install --with-deps chromium
npm run ci:build
npm test
```

The build needs `VITE_DIGITRANSIT_API_KEY` in `.env`, or a dummy value for an
isolated test build. Never deploy a build made with a dummy key. Tests use the
same `dist` output that will be deployed, and Playwright starts/stops the preview
server itself on port 4173. `npm run test:unit` and `npm run test:e2e` select subsets.
On NixOS, set `SMOKE_CHROMIUM_PATH` to a working system Chromium executable.

Failures retain screenshots and traces in `test-results/` and an HTML report in
`playwright-report/`. GitHub uploads them for 14 days. Open a report with
`npx playwright show-report`. Retries are disabled, so flaky failures cannot turn
into a green deployment by retrying. Tests marked `.only` fail in CI.

## Deployment gate

Netlify's repository-controlled build command is `npm run ci:deploy`:

1. Lint/typecheck/build and validate assets.
2. Run unit regressions locally (no browser installation needed).
3. Wait for the newest successful GitHub `CI` workflow run for the exact
   `COMMIT_REF` and source branch. Production/branch builds require a push run;
   deploy previews require a pull-request run.
4. Only a successful lookup permits Netlify to publish `dist`.

This gate applies to Git-connected production, branch and preview deploys. A
failed check (including browser installation) fails closed and preserves the
previous production deploy. GitHub runs the browser tests because Netlify does
not support installing their system dependencies. The gate waits up to 15 minutes,
polling every 30 seconds, so either build can start first. Old commits, manual
runs, failed/canceled/skipped runs and lookup errors never authorize deployment.
No deployment token or changes to Netlify's Git integration are required. Manual CLI/API uploads can
bypass a build command and should not be used as the normal deployment path.

Netlify needs its real `VITE_DIGITRANSIT_API_KEY` and its built-in `COMMIT_REF`,
`BRANCH`/`HEAD`, and `CONTEXT` environment variables. It uses the same Node version
as GitHub Actions. This repository is public, so the CI lookup needs no token.
If unauthenticated GitHub API limits are hit, builds fail safely; an optional
`GITHUB_CI_READ_TOKEN` in Netlify (read-only Actions access) raises those limits.
Retry the Netlify deploy after fixing a failed or canceled CI run. CI must not
wait for Netlify, otherwise the two systems would deadlock.

Renovate's platform automerge is disabled so Renovate itself waits for successful
checks before merging. `ignoreTests` is explicitly false. For protection against
manual merges as well, configure a GitHub branch rule/ruleset for `master` requiring
the **Checks** status and an up-to-date branch. Repository files cannot enable
GitHub branch protection; that setting requires repository-admin access.

Sources: [Playwright CI](https://playwright.dev/docs/ci),
[Netlify build failures](https://answers.netlify.com/t/support-guide-testing-your-netlify-builds/1456),
[Netlify browser-dependency restrictions](https://answers.netlify.com/t/installing-playwright-dependencies-issue/120303),
[Renovate automerge](https://docs.renovatebot.com/key-concepts/automerge/).
