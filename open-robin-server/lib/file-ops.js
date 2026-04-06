/**
 * Safe file operations with archive support.
 *
 * Used by the deploy modal flow: when a file is moved into settings/,
 * the prior copy is archived before replacement.
 */

const fs = require('fs');
const path = require('path');

/**
 * Move a file into a target directory, archiving any existing file first.
 *
 * If targetDir already contains a file with the same name, the existing
 * file is moved to targetDir/archive/FILENAME-{ISO-date}.md before
 * the source file is moved in.
 *
 * @param {string} source - Absolute path to the source file
 * @param {string} targetDir - Absolute path to the destination directory
 * @param {string} projectRoot - Absolute path to project root (for validation)
 * @returns {{ archived: string|null, moved: string }} Paths of archived and moved files
 * @throws {Error} If paths are outside project root or source doesn't exist
 */
function moveFileWithArchive(source, targetDir, projectRoot) {
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(targetDir);
  const resolvedRoot = path.resolve(projectRoot);

  if (!resolvedSource.startsWith(resolvedRoot)) {
    throw new Error(`Source path outside project root: ${source}`);
  }
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Target path outside project root: ${targetDir}`);
  }
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Source file does not exist: ${source}`);
  }

  const filename = path.basename(resolvedSource);
  const destination = path.join(resolvedTarget, filename);
  let archived = null;

  // Archive existing file if it exists
  if (fs.existsSync(destination)) {
    const archiveDir = path.join(resolvedTarget, 'archive');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `${base}-${date}${ext}`;
    archived = path.join(archiveDir, archiveName);

    fs.renameSync(destination, archived);
    console.log(`[FileOps] Archived: ${destination} → ${archived}`);
  }

  // Ensure target directory exists
  if (!fs.existsSync(resolvedTarget)) {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  // Move source to destination
  fs.renameSync(resolvedSource, destination);
  console.log(`[FileOps] Moved: ${resolvedSource} → ${destination}`);

  return { archived, moved: destination };
}

module.exports = { moveFileWithArchive };
