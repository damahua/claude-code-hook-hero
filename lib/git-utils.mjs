import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Parse a git remote URL (SSH or HTTPS) and return "owner/repo" string.
 * Returns null if the URL is not recognized.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function parseGitRemote(url) {
  if (!url) return null;

  // SSH: git@host:owner/repo.git
  const sshMatch = url.match(/^git@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://host/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

/**
 * Return the last path component of cwd (the project name).
 *
 * @param {string} cwd
 * @returns {string}
 */
export function extractProjectName(cwd) {
  return path.basename(cwd);
}

/**
 * Run a git command in the given cwd and return stdout as a trimmed string.
 * Returns null if the command fails.
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {string|null}
 */
function runGit(command, cwd) {
  try {
    return execSync(command, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Extract git context for the given working directory.
 *
 * @param {string} cwd
 * @returns {{
 *   project_path: string|null,
 *   project_name: string|null,
 *   directory: string|null,
 *   cwd: string,
 *   repo: string|null,
 *   git_remote_url: string|null,
 *   git_branch: string|null
 * }}
 */
export function getGitContext(cwd) {
  // Fall back to directory name when not in a git repo
  const homedir = process.env.HOME || '';
  const fallbackName = !cwd ? null
    : cwd === homedir ? '~'
    : extractProjectName(cwd) || '~';
  const defaults = {
    project_path: cwd || null,
    project_name: fallbackName,
    directory: null,
    cwd,
    repo: null,
    git_remote_url: null,
    git_branch: null,
  };

  try {
    const projectPath = runGit('git rev-parse --show-toplevel', cwd);
    if (!projectPath) return defaults;

    const projectName = extractProjectName(projectPath);

    // Relative path of cwd within the repo root
    const relativeDir = runGit('git rev-parse --show-prefix', cwd);
    // --show-prefix includes a trailing slash; strip it, empty string means repo root
    const directory = relativeDir ? relativeDir.replace(/\/$/, '') : '';

    const gitRemoteUrl = runGit('git remote get-url origin', cwd);
    const repo = gitRemoteUrl ? parseGitRemote(gitRemoteUrl) : null;
    const gitBranch = runGit('git rev-parse --abbrev-ref HEAD', cwd);

    return {
      project_path: projectPath,
      project_name: projectName,
      directory,
      cwd,
      repo,
      git_remote_url: gitRemoteUrl,
      git_branch: gitBranch,
    };
  } catch {
    return defaults;
  }
}

/**
 * Collect git activity stats since a given start time.
 *
 * @param {string} cwd
 * @param {Date|number} startTime  — Date object or epoch milliseconds
 * @returns {{
 *   commits_made: number,
 *   branches_touched: string[],
 *   files_changed: number,
 *   insertions: number,
 *   deletions: number,
 *   prs_created: number
 * }}
 */
export function getGitStats(cwd, startTime) {
  const defaults = {
    commits_made: 0,
    branches_touched: [],
    files_changed: 0,
    insertions: 0,
    deletions: 0,
    prs_created: 0,
  };

  try {
    // Normalise startTime to an ISO string that git understands
    const since = new Date(startTime).toISOString();

    // Count commits since startTime
    const logOutput = runGit(
      `git log --since="${since}" --oneline`,
      cwd,
    );
    const commitLines = logOutput ? logOutput.split('\n').filter(Boolean) : [];
    const commitsMade = commitLines.length;

    // Count PRs via "Merge pull request" pattern in commit messages
    const prsMade = commitLines.filter((line) =>
      /Merge pull request/i.test(line),
    ).length;

    // Collect unique branch names touched (from reflog entries, best-effort)
    const branchesRaw = runGit(
      `git log --since="${since}" --format=%D`,
      cwd,
    );
    const branchesTouched = branchesRaw
      ? [
          ...new Set(
            branchesRaw
              .split('\n')
              .flatMap((line) => line.split(','))
              .map((ref) => ref.trim())
              .filter((ref) => ref && !ref.startsWith('HEAD') && !ref.startsWith('tag:') && !ref.includes('origin/')),
          ),
        ]
      : [];

    // Diff stats against HEAD (files changed, insertions, deletions)
    const diffStat = runGit('git diff --stat HEAD', cwd);
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    if (diffStat) {
      // Summary line looks like: "3 files changed, 42 insertions(+), 7 deletions(-)"
      const summaryMatch = diffStat.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      );
      if (summaryMatch) {
        filesChanged = parseInt(summaryMatch[1], 10) || 0;
        insertions = parseInt(summaryMatch[2], 10) || 0;
        deletions = parseInt(summaryMatch[3], 10) || 0;
      }
    }

    return {
      commits_made: commitsMade,
      branches_touched: branchesTouched,
      files_changed: filesChanged,
      insertions,
      deletions,
      prs_created: prsMade,
    };
  } catch {
    return defaults;
  }
}
