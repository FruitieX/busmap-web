import { test, expect } from '@playwright/test';
import { selectRun, waitForCi } from '../scripts/wait-for-ci.mjs';

const commit = 'a'.repeat(40);
const run = {
  id: 1, head_sha: commit, head_branch: 'master', event: 'push',
  path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/run/1',
};
const response = (runs: typeof run[]) => new Response(JSON.stringify({ workflow_runs: runs }));

test('deployment selects only the latest exact-commit workflow run', () => {
  expect(selectRun([{ ...run, head_sha: 'b'.repeat(40) }], commit, 'master', 'push')).toBeUndefined();
  expect(selectRun([{ ...run, event: 'workflow_dispatch' }], commit, 'master', 'push')).toBeUndefined();
  expect(selectRun([{ ...run, head_branch: 'other' }], commit, 'master', 'push')).toBeUndefined();
  expect(selectRun([{ ...run, path: '.github/workflows/other.yml' }], commit, 'master', 'push')).toBeUndefined();
  expect(selectRun([run, { ...run, id: 2, conclusion: 'failure' }], commit, 'master', 'push')?.conclusion).toBe('failure');
});

test('deployment waits for queued/running CI before accepting success', async () => {
  const states = [[], [{ ...run, status: 'in_progress' }], [run]];
  let clock = 0;
  const result = await waitForCi({
    commit, branch: 'master', fetchImpl: async () => response(states.shift()!),
    now: () => clock, sleep: async (ms: number) => { clock += ms; }, log: () => {},
  });
  expect(result.id).toBe(1);
  expect(clock).toBe(60_000);
});

for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral']) {
  test(`deployment refuses ${conclusion} CI`, async () => {
    await expect(waitForCi({
      commit, branch: 'master', fetchImpl: async () => response([{ ...run, conclusion }]), log: () => {},
    })).rejects.toThrow('Deployment blocked');
  });
}

test('deployment fails closed on missing CI, invalid commit and API failure', async () => {
  let clock = 0;
  await expect(waitForCi({
    commit, branch: 'master', timeoutMs: 100, pollMs: 50,
    fetchImpl: async () => response([]), now: () => clock,
    sleep: async (ms: number) => { clock += ms; }, log: () => {},
  })).rejects.toThrow('did not pass');
  await expect(waitForCi({ commit: '', branch: 'master' })).rejects.toThrow('COMMIT_REF');
  await expect(waitForCi({
    commit, branch: 'master', fetchImpl: async () => new Response('', { status: 403 }), log: () => {},
  })).rejects.toThrow('HTTP 403');
});
