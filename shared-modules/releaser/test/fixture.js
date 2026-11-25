// A real git repository, built in a temp directory, for the tests to read.
//
// The release logic reads git — so the tests give it git, rather than mocking `execSync`
// and testing our own mock. Every one of the cases below has broken this pipeline at least
// once in real life, and none of them could be caught without an actual history to walk.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function newRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'releaser-'));
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  /** Temp directories this repo owns, so `cleanup` takes the remote with it. */
  const owned = [dir];

  git('init -q -b main');
  git('config user.email test@example.test');
  git('config user.name Test');
  git('config commit.gpgsign false');

  const write = (file, body = 'x') => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  };

  const commit = (message, file = 'file.txt') => {
    write(file, String(Math.random()));
    git('add -A');
    git(`commit -q -m ${JSON.stringify(message)}`);
  };

  /**
   * A merged PR, exactly as GitHub records one: a merge commit whose SUBJECT is
   * "Merge pull request #N from …" and whose BODY's first line is the PR title.
   * That pairing is what the notes generator reads.
   */
  const mergePR = (number, title, file = 'file.txt') => {
    const branch = `pr-${number}`;
    git(`checkout -q -b ${branch}`);
    commit(`wip on ${branch}`, file);
    git('checkout -q main');
    git(
      `merge --no-ff -q ${branch} -m ${JSON.stringify(`Merge pull request #${number} from kimtos-labs/${branch}`)} -m ${JSON.stringify(title)}`,
    );
  };

  /**
   * A squash-merge, exactly as GitHub records one: a SINGLE plain commit whose subject is the
   * PR title with a trailing "(#N)". No merge commit. This is how this repo merges (#653).
   */
  const squashMergePR = (number, title, file = 'file.txt') => commit(`${title} (#${number})`, file);

  /** A plain commit with NO PR number — a direct push, not a PR. Must be ignored. */
  const directPush = (message, file = 'file.txt') => commit(message, file);

  /** A merge commit with NO body — so no PR title to read. Must not crash or emit junk. */
  const mergeEmptyBody = (number) => {
    const branch = `empty-${number}`;
    git(`checkout -q -b ${branch}`);
    commit(`wip on ${branch}`);
    git('checkout -q main');
    git(`merge --no-ff -q ${branch} -m ${JSON.stringify(`Merge pull request #${number} from x/${branch}`)}`);
  };

  /**
   * A bare repo wired up as `origin`.
   *
   * Needed to test the release SPLIT (#1208), whose central claim is that nothing pushes the
   * branch any more — only the tag. That claim is about what lands on a remote, so a test
   * without one can only assert the absence of a local tag, which is a different and much
   * weaker statement.
   */
  const addRemote = () => {
    const remote = mkdtempSync(join(tmpdir(), 'releaser-remote-'));
    owned.push(remote);
    execSync('git init -q --bare -b main', { cwd: remote, stdio: 'pipe' });
    git(`remote add origin ${JSON.stringify(remote)}`);
    return {
      dir: remote,
      /** Every ref the remote holds, as `refs/… -> sha`. Empty before the first push. */
      refs: () => {
        try {
          return Object.fromEntries(
            execSync('git show-ref', { cwd: remote, encoding: 'utf8', stdio: 'pipe' })
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((line) => {
                const [sha, name] = line.split(' ');
                return [name, sha];
              }),
          );
        } catch {
          return {}; // `git show-ref` exits 1 on a repo with no refs at all
        }
      },
    };
  };

  return {
    dir,
    git,
    commit,
    mergePR,
    squashMergePR,
    directPush,
    mergeEmptyBody,
    addRemote,
    tag: (name) => git(`tag -a ${name} -m ${name}`),
    head: () => git('rev-parse HEAD').trim(),
    cleanup: () => owned.forEach((d) => rmSync(d, { recursive: true, force: true })),
  };
}
