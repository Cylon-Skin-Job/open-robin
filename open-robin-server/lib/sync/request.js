/**
 * GitLab API request helpers — thin wrapper around https.
 *
 * Uses macOS Keychain for auth. Project ID from sync config.
 * No external dependencies.
 */

const https = require('https');
const { execFileSync } = require('child_process');

const PROJECT_ID = '80453361';
const API_BASE = `/api/v4/projects/${PROJECT_ID}`;

let cachedToken = null;

/**
 * Get GitLab token from macOS Keychain.
 * Caches for the lifetime of the process.
 */
function getToken() {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = execFileSync('/usr/bin/security', [
      'find-generic-password', '-a', 'open-robin', '-s', 'GITLAB_TOKEN', '-w'
    ], { encoding: 'utf8' }).trim();
    return cachedToken;
  } catch (err) {
    throw new Error(`Cannot read GITLAB_TOKEN from Keychain: ${err.message}`);
  }
}

/**
 * Make an HTTPS request to the GitLab API.
 *
 * @param {string} method
 * @param {string} endpoint - e.g. "/issues?state=opened"
 * @param {Object} [body]
 * @returns {Promise<Object>}
 */
function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const fullPath = `${API_BASE}${endpoint}`;

    const options = {
      hostname: 'gitlab.com',
      path: fullPath,
      method,
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitLab ${method} ${endpoint}: ${res.statusCode} ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`GitLab ${method} ${endpoint}: timeout`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function gitlabGet(endpoint) { return request('GET', endpoint); }
function gitlabPost(endpoint, body) { return request('POST', endpoint, body); }
function gitlabPut(endpoint, body) { return request('PUT', endpoint, body); }

module.exports = { gitlabGet, gitlabPost, gitlabPut, getToken };
