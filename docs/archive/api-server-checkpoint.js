// Git checkpoint system for rollback/accept flow
//
// Before a turn with write tools: snapshot the git state
// After the turn: user sees rollback/accept overlay
// Rollback: git reset --hard to checkpoint
// Accept: drop the checkpoint, continue

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

/**
 * Create a git checkpoint before a turn executes.
 * Returns a checkpoint object that can be used to rollback.
 *
 * Strategy:
 * 1. Stash any uncommitted changes (including untracked)
 * 2. Record the current HEAD
 * 3. Pop the stash (so changes are live for the agent to work with)
 * 4. Tag the stash ref so we can restore to this exact state
 *
 * Simpler approach: just record HEAD + create a temp commit of current state.
 *
 * Simplest approach: use git stash create (creates a stash commit without
 * actually stashing - working tree stays dirty). This gives us a ref to
 * restore to without disrupting the working tree.
 *
 * @param {string} cwd - Project working directory (must be a git repo)
 * @returns {{ id: string, ref: string, head: string, cwd: string } | null}
 */
export function createCheckpoint(cwd) {
  const id = crypto.randomUUID().slice(0, 8);

  try {
    // Record current HEAD
    const head = git('rev-parse HEAD', cwd).trim();

    // Create a stash-like commit of the current working tree + index
    // without actually modifying the working tree or index.
    // git stash create returns empty string if there's nothing to stash.
    const stashRef = git('stash create', cwd).trim();

    // Also stage and snapshot untracked files
    // We do this by creating a temporary commit
    git('add -A', cwd);
    const treeHasChanges = git('status --porcelain', cwd).trim().length > 0 ||
                           stashRef.length > 0;

    let snapshotRef;
    if (treeHasChanges) {
      // Create a snapshot commit (doesn't move HEAD)
      const tree = git('write-tree', cwd).trim();
      snapshotRef = git(
        `commit-tree ${tree} -p ${head} -m "checkpoint-${id}"`,
        cwd,
      ).trim();
      // Reset index back to HEAD (undo the git add -A) but keep working tree
      git('reset HEAD', cwd);
    } else {
      snapshotRef = head;
    }

    // Tag it so it doesn't get gc'd
    const tag = `checkpoint/${id}`;
    git(`tag ${tag} ${snapshotRef}`, cwd);

    return { id, tag, ref: snapshotRef, head, cwd };
  } catch (err) {
    console.error('Failed to create checkpoint:', err.message);
    return null;
  }
}

/**
 * Rollback to a checkpoint. Discards all changes made since the checkpoint.
 *
 * @param {{ id: string, tag: string, ref: string, head: string, cwd: string }} checkpoint
 * @returns {boolean} success
 */
export function rollback(checkpoint) {
  if (!checkpoint) return false;

  try {
    const { tag, ref, head, cwd } = checkpoint;

    // Reset to the checkpoint's HEAD
    git(`reset --hard ${head}`, cwd);

    // If the checkpoint captured uncommitted changes, restore them
    if (ref !== head) {
      // Checkout the snapshot tree on top of HEAD
      git(`checkout ${ref} -- .`, cwd);
      // Unstage everything (restore to working-tree-only state)
      git('reset HEAD', cwd);
    }

    // Clean up the tag
    git(`tag -d ${tag}`, cwd);

    return true;
  } catch (err) {
    console.error('Failed to rollback:', err.message);
    return false;
  }
}

/**
 * Accept the current state and clean up the checkpoint.
 *
 * @param {{ id: string, tag: string, cwd: string }} checkpoint
 * @returns {boolean} success
 */
export function acceptCheckpoint(checkpoint) {
  if (!checkpoint) return true;

  try {
    // Just delete the tag - changes stay as they are
    git(`tag -d ${checkpoint.tag}`, checkpoint.cwd);
    return true;
  } catch (err) {
    console.error('Failed to clean up checkpoint:', err.message);
    return false;
  }
}

/**
 * Get a diff of all changes since the checkpoint.
 * Useful for showing the user what changed before they accept/reject.
 *
 * @param {{ ref: string, head: string, cwd: string }} checkpoint
 * @returns {string} diff output
 */
export function getCheckpointDiff(checkpoint) {
  if (!checkpoint) return '';

  try {
    // Diff between checkpoint snapshot and current working tree
    const staged = git('diff --cached', checkpoint.cwd);
    const unstaged = git('diff', checkpoint.cwd);
    const untracked = git('ls-files --others --exclude-standard', checkpoint.cwd);

    let diff = '';
    if (staged) diff += staged;
    if (unstaged) diff += (diff ? '\n' : '') + unstaged;
    if (untracked.trim()) {
      diff += (diff ? '\n' : '') + '=== Untracked files ===\n' + untracked;
    }
    return diff || '(no changes)';
  } catch (err) {
    return `Error getting diff: ${err.message}`;
  }
}

// --- Helper ---

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
