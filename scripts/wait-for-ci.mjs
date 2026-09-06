import { pathToFileURL } from 'node:url';

// Only the newest run of our workflow for this exact source commit can authorize
// publication. Never accept a green run from an older commit or a manual run.
export function selectRun(runs, commit, branch, event) {
  return runs.filter((run) => run.head_sha === commit
    && run.head_branch === branch && run.event === event
    && run.path === '.github/workflows/ci.yml')
    .sort((a, b) => b.id - a.id)[0];
}

export async function waitForCi({
  commit, branch, event = 'push', token = '',
  timeoutMs = 15 * 60_000, pollMs = 30_000,
  fetchImpl = fetch, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '') || !branch) {
    throw new Error('Deployment blocked: COMMIT_REF and BRANCH must identify the source commit.');
  }
  const endpoint = new URL('https://api.github.com/repos/FruitieX/busmap/actions/workflows/ci.yml/runs');
  endpoint.searchParams.set('head_sha', commit);
  endpoint.searchParams.set('event', event);
  endpoint.searchParams.set('per_page', '100');
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Deployment blocked: GitHub CI lookup returned HTTP ${response.status}.`);
    }
    const data = await response.json();
    if (!Array.isArray(data.workflow_runs)) throw new Error('Deployment blocked: invalid GitHub response.');
    const run = selectRun(data.workflow_runs, commit, branch, event);
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Deployment blocked: CI ${run.conclusion} for ${commit}. ${run.html_url}`);
      }
      log(`CI passed for ${commit}: ${run.html_url}`);
      return run;
    }
    log(`Waiting for CI for ${commit}: ${run?.status ?? 'not started yet'}`);
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Deployment blocked: CI did not pass within ${timeoutMs / 60_000} minutes for ${commit}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForCi({
    commit: process.env.COMMIT_REF,
    branch: process.env.HEAD || process.env.BRANCH,
    event: process.env.CONTEXT === 'deploy-preview' ? 'pull_request' : 'push',
    // Public runs can be read without a token. Optional token increases API limits.
    token: process.env.GITHUB_CI_READ_TOKEN,
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
