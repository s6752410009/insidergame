const assert = require('node:assert/strict');
const { verify } = require('../ci/verify-release.cjs');
const sha = 'a'.repeat(40);
const check = { id: 1, head_sha: sha, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', check_suite: { id: 42 }, html_url: 'https://github.com/check' };
const workflow = { head_sha: sha, check_suite_id: 42, path: '.github/workflows/release-checks.yml' };
function api(checks = [check], workflows = [workflow]) {
    return async url => ({ ok: true, json: async () => url.includes('/check-runs?') ? { check_runs: checks } : { workflow_runs: workflows } });
}
(async () => {
    assert.equal(await verify(sha, api()), check.html_url);
    for (const value of [undefined, '', 'main', 'abc123', 'z'.repeat(40)]) await assert.rejects(verify(value, api()), /SOURCE_COMMIT/);
    for (const checks of [[], [{ ...check, head_sha: 'b'.repeat(40) }], [{ ...check, app: { slug: 'other-app' } }],
        [{ ...check, status: 'in_progress' }], [{ ...check, conclusion: 'failure' }], [{ ...check, conclusion: 'cancelled' }],
        [check, { ...check, id: 2, conclusion: 'failure' }], [check, { ...check, id: 2, status: 'queued' }]]) {
        await assert.rejects(verify(sha, api(checks)), /Deploy blocked/);
    }
    for (const workflows of [[], [{ ...workflow, path: '.github/workflows/other.yml' }], [{ ...workflow, check_suite_id: 43 }]]) {
        await assert.rejects(verify(sha, api([check], workflows)), /did not originate/);
    }
    await assert.rejects(verify(sha, async () => ({ ok: false, status: 403 })), /HTTP 403/);
    await assert.rejects(verify(sha, async () => { throw new Error('offline'); }), /offline/);
    const { summarize } = require('./deploy-readiness');
    assert.equal(summarize([]).safeToDeploy, true);
    const room = { roomId: 'r1', gameMode: 'slave', gameStatus: 'waiting', playerCount: 4, onlineCount: 4 };
    assert.equal(summarize([room]).onlineInRooms, 4);
    assert.equal(summarize([{ ...room, gameStatus: 'playing' }]).safeToDeploy, false);
    assert.equal(summarize([{ ...room, gameStatus: 'playing', onlineCount: 0 }]).safeToDeploy, false);
    for (const rooms of [null, [{}], [{ ...room, gameStatus: 'unknown' }], [{ ...room, onlineCount: undefined }]]) assert.throws(() => summarize(rooms));
    console.log('Release gate: exact SHA, workflow provenance, failed/pending/cancelled/rerun and API failure checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
