#!/usr/bin/env node
// Public repo: no production/GitHub credential is copied into the image or build logs.
const REPOSITORY = 's6752410009/insidergame';
const WORKFLOW = '.github/workflows/release-checks.yml';
async function verify(sha, request = fetch) {
    if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('SOURCE_COMMIT must contain the full tested Git commit SHA');
    const response = await request(`https://api.github.com/repos/${REPOSITORY}/commits/${sha}/check-runs?check_name=Release%20checks%20passed&per_page=100`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Cannot verify GitHub CI: HTTP ' + response.status);
    const body = await response.json();
    // Check the latest run only; a failed/cancelled rerun must never reuse an earlier green result.
    const runs = (body.check_runs || []).filter(run => run.head_sha === sha && run.app?.slug === 'github-actions')
        .sort((a, b) => b.id - a.id);
    const check = runs[0];
    if (!check || check.status !== 'completed' || check.conclusion !== 'success') {
        throw new Error('Deploy blocked: Release checks passed is missing, pending or failed for ' + sha);
    }
    // Verify provenance: a different workflow with the same check name does not qualify.
    const suiteResponse = await request(`https://api.github.com/repos/${REPOSITORY}/actions/runs?head_sha=${sha}&per_page=100`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000)
    });
    if (!suiteResponse.ok) throw new Error('Cannot verify CI workflow: HTTP ' + suiteResponse.status);
    const suite = await suiteResponse.json();
    const workflowRun = (suite.workflow_runs || []).find(run => run.check_suite_id === check.check_suite?.id && run.path === WORKFLOW && run.head_sha === sha);
    if (!workflowRun) throw new Error('Deploy blocked: check did not originate from the release workflow');
    return check.html_url;
}
if (require.main === module) verify(process.env.SOURCE_COMMIT).then(url => console.log('CI verified for ' + process.env.SOURCE_COMMIT + ': ' + url))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify };
