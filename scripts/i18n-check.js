#!/usr/bin/env node
/* i18n-check.js — Bilingual coverage gate.
 *
 * Purpose: enforce that every UI string and every Recipe metadata field
 * has both an English (`en`) and Japanese (`ja`) value. Without this,
 * translations slip out of sync silently and users see empty strings.
 *
 * Run as:
 *     node scripts/i18n-check.js
 *     npm run i18n-check
 *
 * Exits with code 0 if everything is in sync, 1 otherwise.
 *
 * ---------------------------------------------------------------------------
 * Pre-commit / CI (task 3.5)
 * ---------------------------------------------------------------------------
 *
 * GitHub Actions (example `.github/workflows/i18n.yml`):
 *
 *   on: [push, pull_request]
 *   jobs:
 *     i18n:
 *       runs-on: ubuntu-latest
 *       steps:
 *         - uses: actions/checkout@v4
 *         - uses: actions/setup-node@v4
 *           with: { node-version: '20' }
 *         - run: npm run i18n-check
 *
 * Optional pre-commit (Husky v9+):
 *
 *   npx husky init
 *   printf 'npm run i18n-check\\n' >> .husky/pre-commit
 *   chmod +x .husky/pre-commit
 *
 * Implementation notes:
 *   - Intentionally zero-dependency. The repo is build-less by design.
 *   - We parse `common/i18n.js` and recipe files with a *regex*, not a
 *     real JS parser. This is good enough because:
 *       (a) i18n.js is hand-written and follows a very regular shape
 *           (one `'key.name': 'value'` per line),
 *       (b) recipe files (Wave 2 work) are also hand-written and follow
 *           the documented schema where `title.en` / `title.ja` etc.
 *           appear as obvious literal property pairs.
 *     If either file grows weird shapes (computed keys, template
 *     literals, conditionals) this script will need a real parser.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var I18N_FILE = path.join(ROOT, 'common', 'i18n.js');
var RECIPES_DIR = path.join(ROOT, 'recipes');

var issues = [];
function report(line) { issues.push(line); }

// ---------------------------------------------------------------------------
// 1. Parse TRANSLATIONS.en and TRANSLATIONS.ja key sets from common/i18n.js.
// ---------------------------------------------------------------------------

function readI18nKeys() {
  var src;
  try {
    src = fs.readFileSync(I18N_FILE, 'utf8');
  } catch (e) {
    report('[i18n-check] cannot read ' + I18N_FILE + ': ' + e.message);
    return null;
  }

  // Find the start of the TRANSLATIONS object literal.
  var startIdx = src.indexOf('TRANSLATIONS = {');
  if (startIdx < 0) startIdx = src.indexOf('TRANSLATIONS={');
  if (startIdx < 0) {
    report('[i18n-check] TRANSLATIONS object not found in common/i18n.js');
    return null;
  }

  // Split into language sections.
  // The file structure is:
  //   var TRANSLATIONS = {
  //     en: { ... },
  //     ja: { ... },
  //   };
  // We locate the `en: {` and `ja: {` markers and extract everything
  // between each marker and its matching closing `},` at the same indent.
  function extractLangSection(lang) {
    // Use a regex to find e.g. /\ben:\s*\{/ after TRANSLATIONS.
    var marker = new RegExp('\\b' + lang + '\\s*:\\s*\\{');
    var m = marker.exec(src.substring(startIdx));
    if (!m) return null;
    var absStart = startIdx + m.index + m[0].length; // first char after `{`
    // Walk forward, tracking braces, ignoring those inside strings.
    var depth = 1;
    var i = absStart;
    var inStr = false;
    var quote = '';
    while (i < src.length && depth > 0) {
      var ch = src[i];
      var prev = src[i - 1];
      if (inStr) {
        if (ch === quote && prev !== '\\') {
          inStr = false;
        }
      } else {
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = true;
          quote = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
        }
      }
      i++;
    }
    if (depth !== 0) return null;
    return src.substring(absStart, i - 1);
  }

  var enBody = extractLangSection('en');
  var jaBody = extractLangSection('ja');
  if (enBody == null || jaBody == null) {
    report('[i18n-check] could not extract en/ja sections from TRANSLATIONS');
    return null;
  }

  // Within each section, count keys by matching lines like:
  //   'foo.bar': 'value',
  // or "foo.bar": "value",
  // Comments starting with // are stripped.
  function keysFromBody(body) {
    var keys = new Set();
    var lines = body.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Strip line comments. (No /* */ comments expected mid-line.)
      var commentIdx = line.indexOf('//');
      if (commentIdx >= 0) line = line.substring(0, commentIdx);
      var m = /^[\s]*['"]([A-Za-z0-9_.\-]+)['"]\s*:/.exec(line);
      if (m) keys.add(m[1]);
    }
    return keys;
  }

  return {
    en: keysFromBody(enBody),
    ja: keysFromBody(jaBody),
  };
}

// ---------------------------------------------------------------------------
// 2. Symmetric difference of en/ja key sets.
// ---------------------------------------------------------------------------

function diffKeySets(en, ja) {
  var missingInJa = [];
  var missingInEn = [];
  en.forEach(function (k) { if (!ja.has(k)) missingInJa.push(k); });
  ja.forEach(function (k) { if (!en.has(k)) missingInEn.push(k); });
  missingInJa.sort();
  missingInEn.sort();
  return { missingInJa: missingInJa, missingInEn: missingInEn };
}

// ---------------------------------------------------------------------------
// 3. Recipe bilingual coverage check.
// ---------------------------------------------------------------------------

function checkRecipes() {
  if (!fs.existsSync(RECIPES_DIR)) {
    console.log('[i18n-check] recipes/ not found (skipped)');
    return { recipeCount: 0, skipped: true };
  }
  var entries;
  try {
    entries = fs.readdirSync(RECIPES_DIR);
  } catch (e) {
    report('[i18n-check] cannot read recipes/: ' + e.message);
    return { recipeCount: 0, skipped: false };
  }
  var files = entries.filter(function (name) {
    if (!name.endsWith('.js')) return false;
    if (name.charAt(0) === '_') return false;
    return true;
  });

  for (var i = 0; i < files.length; i++) {
    var fname = files[i];
    var fpath = path.join(RECIPES_DIR, fname);
    var src;
    try {
      src = fs.readFileSync(fpath, 'utf8');
    } catch (e) {
      report('[i18n-check] cannot read ' + fpath + ': ' + e.message);
      continue;
    }
    var recipeId = fname.replace(/\.js$/, '');
    checkRecipeField(src, recipeId, 'title');
    checkRecipeField(src, recipeId, 'description');
    checkHandoffWhy(src, recipeId);
  }
  return { recipeCount: files.length, skipped: false };
}

// For a field like `title` or `description`, look for the most recent
// surrounding occurrence and verify both `.en` and `.ja` are non-empty.
// We look for patterns like:
//     title: { en: 'x', ja: 'y' }
//     title: { en: "x", ja: "" }   <- flagged
//     title: { en: 'x' }            <- ja missing, flagged
function checkRecipeField(src, recipeId, field) {
  // Find blocks: <field>: { ... }
  var re = new RegExp('\\b' + field + '\\s*:\\s*\\{', 'g');
  var m;
  while ((m = re.exec(src)) !== null) {
    var startBrace = m.index + m[0].length - 1; // position of `{`
    var body = extractBalancedBraces(src, startBrace);
    if (body == null) continue;
    var enVal = extractStringProp(body, 'en');
    var jaVal = extractStringProp(body, 'ja');
    if (enVal == null || enVal === '') {
      report('[i18n-check] Recipe ' + recipeId + ': missing ' + field + '.en');
    }
    if (jaVal == null || jaVal === '') {
      report('[i18n-check] Recipe ' + recipeId + ': missing ' + field + '.ja');
    }
  }
}

// humanHandoffPoints: [ { why: { en: '...', ja: '...' }, ... }, ... ]
function checkHandoffWhy(src, recipeId) {
  // Heuristic: every occurrence of `why: { ... }` should have both.
  var re = /\bwhy\s*:\s*\{/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    var startBrace = m.index + m[0].length - 1;
    var body = extractBalancedBraces(src, startBrace);
    if (body == null) continue;
    var enVal = extractStringProp(body, 'en');
    var jaVal = extractStringProp(body, 'ja');
    if (enVal == null || enVal === '') {
      report('[i18n-check] Recipe ' + recipeId + ': missing humanHandoffPoints[].why.en');
    }
    if (jaVal == null || jaVal === '') {
      report('[i18n-check] Recipe ' + recipeId + ': missing humanHandoffPoints[].why.ja');
    }
  }
}

// Given src + position of an opening `{`, return the substring inside the
// matching closing `}` (or null on imbalance). Skips braces inside strings.
function extractBalancedBraces(src, openIdx) {
  if (src.charAt(openIdx) !== '{') return null;
  var depth = 1;
  var i = openIdx + 1;
  var inStr = false;
  var quote = '';
  while (i < src.length && depth > 0) {
    var ch = src[i];
    var prev = src[i - 1];
    if (inStr) {
      if (ch === quote && prev !== '\\') inStr = false;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = true;
        quote = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
    }
    i++;
  }
  if (depth !== 0) return null;
  return src.substring(openIdx + 1, i - 1);
}

// Within a brace body, look for `name: '...'` or `name: "..."` and return
// the string value. Returns null if not found.
function extractStringProp(body, name) {
  var re = new RegExp('\\b' + name + '\\s*:\\s*([\'"`])((?:\\\\.|(?!\\1).)*)\\1');
  var m = re.exec(body);
  if (!m) return null;
  return m[2];
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

var keys = readI18nKeys();
if (!keys) {
  printIssues();
  process.exit(1);
}

var diff = diffKeySets(keys.en, keys.ja);
if (diff.missingInJa.length > 0) {
  report('[i18n-check] Missing in ja: ' + diff.missingInJa.join(', '));
}
if (diff.missingInEn.length > 0) {
  report('[i18n-check] Missing in en: ' + diff.missingInEn.join(', '));
}

var recipeResult = checkRecipes();

if (issues.length === 0) {
  // Use the en key count as canonical (in sync case en == ja).
  console.log('[i18n-check] OK (' + keys.en.size + ' keys, ' + recipeResult.recipeCount + ' recipes)');
  process.exit(0);
} else {
  printIssues();
  console.log('[i18n-check] FAIL — ' + issues.length + ' issue' + (issues.length === 1 ? '' : 's'));
  process.exit(1);
}

function printIssues() {
  for (var i = 0; i < issues.length; i++) {
    console.log(issues[i]);
  }
}
