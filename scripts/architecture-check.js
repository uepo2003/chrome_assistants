#!/usr/bin/env node
/* architecture-check.js
 *
 * Zero-dependency architectural guardrail for the build-less MV3 extension.
 * It catches the drift this project is most prone to:
 *   - message literals mirrored in multiple contexts
 *   - provider defaults drifting between background and UI surfaces
 *   - manifest/content-script order breaking globals
 *   - active run state living only in service-worker globals
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var issues = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function report(msg) {
  issues.push('[architecture-check] ' + msg);
}

function extractObjectBody(src, marker) {
  var start = src.indexOf(marker);
  if (start < 0) return null;
  var brace = src.indexOf('{', start);
  if (brace < 0) return null;
  var depth = 1;
  var i = brace + 1;
  var inStr = false;
  var quote = '';
  while (i < src.length && depth > 0) {
    var ch = src[i];
    var prev = src[i - 1];
    if (inStr) {
      if (ch === quote && prev !== '\\') inStr = false;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true;
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    }
    i += 1;
  }
  if (depth !== 0) return null;
  return src.slice(brace + 1, i - 1);
}

function parseStringMap(body) {
  var map = {};
  if (!body) return map;
  var re = /^\s*([A-Z0-9_]+)\s*:\s*['"]([^'"]+)['"]/gm;
  var m;
  while ((m = re.exec(body)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

function parseConstString(src, name) {
  var re = new RegExp("const\\s+" + name + "\\s*=\\s*['\"]([^'\"]+)['\"]");
  var m = re.exec(src);
  return m ? m[1] : null;
}

function parseDefaultModelByProvider(src, provider) {
  var re = new RegExp(provider + "\\s*:\\s*\\[\\s*['\"]([^'\"]+)['\"]");
  var m = re.exec(src);
  return m ? m[1] : null;
}

function assertSubsequence(actual, expected, label) {
  var pos = -1;
  expected.forEach(function (item) {
    var next = actual.indexOf(item);
    if (next < 0) {
      report(label + ' is missing ' + item);
      return;
    }
    if (next <= pos) {
      report(label + ' loads ' + item + ' out of order');
      return;
    }
    pos = next;
  });
}

function checkManifest() {
  var manifest = JSON.parse(read('manifest.json'));
  if (manifest.manifest_version !== 3) report('manifest_version must stay at 3');
  if (!manifest.background || manifest.background.type !== 'module') {
    report('background service_worker must be an ES module');
  }
  if (!manifest.permissions || !manifest.permissions.includes('storage')) {
    report('manifest permissions must include storage');
  }
  if (!manifest.permissions || !manifest.permissions.includes('sidePanel')) {
    report('manifest permissions must include sidePanel');
  }
  var contentScripts = manifest.content_scripts && manifest.content_scripts[0];
  var js = contentScripts && contentScripts.js;
  if (!Array.isArray(js)) {
    report('manifest content_scripts[0].js must be an ordered array');
    return;
  }
  assertSubsequence(js, [
    'common/error-capture.js',
    'common/i18n.js',
    'common/messages.js',
    'common/recorder-messages.js',
    'content/cursor.js',
    'content/dom-analyzer.js',
    'content/selector-cache.js',
    'content/action-executor.js',
    'content/main.js',
    'content/recorder.js',
  ], 'manifest content script chain');
}

function checkMessages() {
  var sw = read('background/service-worker.js');
  var common = read('common/messages.js');
  var recorder = read('common/recorder-messages.js');
  var swMsg = parseStringMap(extractObjectBody(sw, 'const MSG = {'));
  var commonMsg = parseStringMap(extractObjectBody(common, 'const MSG = Object.freeze({'));
  var recorderMsg = parseStringMap(extractObjectBody(recorder, 'var RECORDER_MSG = Object.freeze({'));
  var recorderValues = new Set();
  Object.keys(recorderMsg).forEach(function (key) {
    recorderValues.add(recorderMsg[key]);
  });

  Object.keys(swMsg).forEach(function (key) {
    var value = swMsg[key];
    if (key.indexOf('RECORDER_') === 0) {
      if (!recorderValues.has(value)) {
        report('recorder message ' + key + ' is missing from common/recorder-messages.js');
      }
      return;
    }
    if (commonMsg[key] !== value) {
      report('message drift: ' + key + ' is ' + value + ' in service-worker but ' +
        (commonMsg[key] || '<missing>') + ' in common/messages.js');
    }
  });
}

function checkProviderDefaults() {
  var providerConfig = read('background/provider-config.js');
  var common = read('common/messages.js');
  var options = read('options/options.js');
  var defaultProvider = parseConstString(providerConfig, 'DEFAULT_PROVIDER');
  var defaultFallback = parseConstString(providerConfig, 'DEFAULT_FALLBACK_PROVIDER');
  var defaultModel = parseDefaultModelByProvider(providerConfig, defaultProvider || 'gemini');

  if (defaultProvider !== 'gemini') report('DEFAULT_PROVIDER should be gemini');
  if (defaultFallback !== 'anthropic') report('DEFAULT_FALLBACK_PROVIDER should be anthropic');
  if (defaultModel !== 'gemini-2.5-flash-lite') {
    report('Gemini default model should be gemini-2.5-flash-lite');
  }

  [
    ['common/messages.js DEFAULTS.PROVIDER', common, /PROVIDER:\s*'gemini'/],
    ['common/messages.js DEFAULTS.MODEL', common, /MODEL:\s*'gemini-2\.5-flash-lite'/],
    ['options/options.js DEFAULTS.PROVIDER', options, /PROVIDER:\s*'gemini'/],
    ['options/options.js DEFAULTS.MODEL', options, /MODEL:\s*'gemini-2\.5-flash-lite'/],
  ].forEach(function (item) {
    if (!item[2].test(item[1])) report(item[0] + ' is out of sync with provider-config.js');
  });
}

function checkServiceWorkerState() {
  var sw = read('background/service-worker.js');
  if (!sw.includes('chrome.storage.session')) {
    report('service-worker active run state must checkpoint to chrome.storage.session');
  }
  if (!sw.includes('ACTIVE_RUNS_SESSION_KEY')) {
    report('service-worker is missing ACTIVE_RUNS_SESSION_KEY');
  }
}

function checkDocs() {
  var docs = read('docs/architecture.md');
  [
    'MV3 service worker',
    'chrome.storage.session',
    'Message contract',
    'Tech stack decision',
    '<all_urls>',
  ].forEach(function (needle) {
    if (!docs.includes(needle)) report('docs/architecture.md must document ' + needle);
  });
}

function main() {
  try { checkManifest(); } catch (e) { report('manifest check failed: ' + e.message); }
  try { checkMessages(); } catch (e) { report('message check failed: ' + e.message); }
  try { checkProviderDefaults(); } catch (e) { report('provider check failed: ' + e.message); }
  try { checkServiceWorkerState(); } catch (e) { report('service-worker state check failed: ' + e.message); }
  try { checkDocs(); } catch (e) { report('docs check failed: ' + e.message); }

  if (issues.length > 0) {
    issues.forEach(function (line) { console.error(line); });
    process.exit(1);
  }
  console.log('[architecture-check] OK');
}

main();
