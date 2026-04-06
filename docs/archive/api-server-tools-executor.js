// Tool execution engine
// Runs tool calls from Claude and returns results

import { execSync, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';

/**
 * Execute a tool call and return the result.
 *
 * @param {string} name - Tool name
 * @param {object} input - Tool input parameters
 * @param {string} cwd - Working directory for the project
 * @returns {Promise<{ output: string, is_error: boolean }>}
 */
export async function executeTool(name, input, cwd) {
  try {
    switch (name) {
      case 'bash':
        return await executeBash(input, cwd);
      case 'read_file':
        return executeReadFile(input, cwd);
      case 'write_file':
        return executeWriteFile(input, cwd);
      case 'edit_file':
        return executeEditFile(input, cwd);
      case 'glob':
        return await executeGlob(input, cwd);
      case 'grep':
        return executeGrep(input, cwd);
      case 'list_directory':
        return executeListDirectory(input, cwd);
      default:
        return { output: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (err) {
    return { output: err.message, is_error: true };
  }
}

// --- Individual tool implementations ---

async function executeBash(input, cwd) {
  const timeout = Math.min(input.timeout || 120000, 600000);
  return new Promise((resolve) => {
    exec(input.command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) {
        resolve({ output: err.message, is_error: true });
        return;
      }
      const output = [stdout, stderr].filter(Boolean).join('\n');
      resolve({ output: output || '(no output)', is_error: !!err });
    });
  });
}

function executeReadFile(input, cwd) {
  const filePath = resolvePath(input.path, cwd);
  if (!fs.existsSync(filePath)) {
    return { output: `File not found: ${filePath}`, is_error: true };
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return { output: `Path is a directory, not a file: ${filePath}`, is_error: true };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const offset = Math.max(0, (input.offset || 1) - 1);
  const limit = input.limit || lines.length;
  const slice = lines.slice(offset, offset + limit);

  // Format with line numbers like cat -n
  const numbered = slice.map((line, i) => {
    const lineNum = offset + i + 1;
    return `${String(lineNum).padStart(6)}  ${line}`;
  }).join('\n');

  return { output: numbered, is_error: false };
}

function executeWriteFile(input, cwd) {
  const filePath = resolvePath(input.path, cwd);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, input.content, 'utf8');
  return { output: `File written: ${filePath}`, is_error: false };
}

function executeEditFile(input, cwd) {
  const filePath = resolvePath(input.path, cwd);
  if (!fs.existsSync(filePath)) {
    return { output: `File not found: ${filePath}`, is_error: true };
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const occurrences = content.split(input.old_string).length - 1;

  if (occurrences === 0) {
    return { output: `old_string not found in ${filePath}`, is_error: true };
  }
  if (occurrences > 1 && !input.replace_all) {
    return {
      output: `old_string found ${occurrences} times in ${filePath}. Use replace_all: true to replace all, or provide more context to make it unique.`,
      is_error: true,
    };
  }

  if (input.replace_all) {
    content = content.replaceAll(input.old_string, input.new_string);
  } else {
    content = content.replace(input.old_string, input.new_string);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return {
    output: `Edited ${filePath} (${input.replace_all ? occurrences + ' replacements' : '1 replacement'})`,
    is_error: false,
  };
}

async function executeGlob(input, cwd) {
  const searchPath = input.path ? resolvePath(input.path, cwd) : cwd;
  const matches = await glob(input.pattern, { cwd: searchPath, absolute: true });

  if (matches.length === 0) {
    return { output: 'No files found', is_error: false };
  }

  // Sort by mtime descending
  const withStats = matches.map((f) => {
    try {
      return { path: f, mtime: fs.statSync(f).mtimeMs };
    } catch {
      return { path: f, mtime: 0 };
    }
  });
  withStats.sort((a, b) => b.mtime - a.mtime);

  return { output: withStats.map((f) => f.path).join('\n'), is_error: false };
}

function executeGrep(input, cwd) {
  const searchPath = input.path ? resolvePath(input.path, cwd) : cwd;
  const args = ['--color=never', '-n', '-r'];
  if (input.include) {
    args.push(`--include=${input.include}`);
  }
  args.push(input.pattern, searchPath);

  try {
    const output = execSync(`grep ${args.map(a => `'${a}'`).join(' ')}`, {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { output: output || 'No matches found', is_error: false };
  } catch (err) {
    // grep returns exit code 1 for no matches
    if (err.status === 1) {
      return { output: 'No matches found', is_error: false };
    }
    return { output: err.message, is_error: true };
  }
}

function executeListDirectory(input, cwd) {
  const dirPath = resolvePath(input.path, cwd);
  if (!fs.existsSync(dirPath)) {
    return { output: `Directory not found: ${dirPath}`, is_error: true };
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const formatted = entries.map((e) => {
    const suffix = e.isDirectory() ? '/' : '';
    return `${e.name}${suffix}`;
  }).join('\n');
  return { output: formatted || '(empty directory)', is_error: false };
}

// --- Helpers ---

function resolvePath(p, cwd) {
  if (path.isAbsolute(p)) return p;
  return path.resolve(cwd, p);
}
