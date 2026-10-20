import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Same minimal TypeScript loader the other tests use.
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    let code = stripTypeScriptTypes(readFileSync(file, 'utf8'));
    const names = [...code.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]);
    code = code.replace(/^import ['"]server-only['"];?/gm, '')
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, bindings, source) => `const {${bindings.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(source)});`)
      .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '');
    code += `\nObject.assign(exports, {${names.join(',')}});`;
    const require = (name) => {
      if (name === 'server-only') return {};
      if (name in overrides) return overrides[name];
      const target = name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(file), name);
      return load(`${target}.ts`);
    };
    new Function('exports', 'require', code)(exports, require);
    return exports;
  }
  return load;
}

const { DEFAULT_DMP_URL, dmPanelMarkup, resolveDmpUrl } = loader()('lib/dm-embed.ts');

test('the company DMP deployment is the default target', () => {
  assert.match(DEFAULT_DMP_URL, /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/);
  assert.equal(resolveDmpUrl(''), DEFAULT_DMP_URL);
  assert.equal(resolveDmpUrl('   '), DEFAULT_DMP_URL);
  assert.equal(resolveDmpUrl(undefined), DEFAULT_DMP_URL);
  assert.equal(resolveDmpUrl(null), DEFAULT_DMP_URL);
});

test('an override must be https, so a data: or javascript: URL cannot be framed', () => {
  assert.equal(resolveDmpUrl('https://example.com/dmp'), 'https://example.com/dmp');
  assert.equal(resolveDmpUrl('http://example.com/dmp'), DEFAULT_DMP_URL);
  assert.equal(resolveDmpUrl('javascript:alert(1)'), DEFAULT_DMP_URL);
  assert.equal(resolveDmpUrl('data:text/html,<script>alert(1)</script>'), DEFAULT_DMP_URL);
  assert.equal(resolveDmpUrl('not a url'), DEFAULT_DMP_URL);
});

test('the panel embeds the DMP app and offers a launcher that always works', () => {
  const html = dmPanelMarkup('https://script.google.com/macros/s/abc/exec');
  assert.ok(html.includes('<iframe src="https://script.google.com/macros/s/abc/exec"'));
  assert.ok(html.includes('title="EMVEESS Daily Management Plan"'));
  // The launcher is a plain link with no opener access: it works even when a frame is refused.
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('data-dm-action="reload"'));
  assert.ok(html.includes('data-dm-action="fullscreen"'));
  assert.ok(html.includes('Conduct DM'));
  // If the frame is refused, the operator is told why instead of staring at a white box.
  assert.ok(html.includes('XFrameOptionsMode.ALLOWALL'));
});

test('the launcher-only variant has no frame to be blank', () => {
  const html = dmPanelMarkup(DEFAULT_DMP_URL, { embedded: false });
  assert.equal(html.includes('<iframe'), false);
  assert.equal(html.includes('data-dm-action="reload"'), false);
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('Conduct DM'));
});

test('an unsafe URL can never reach the markup', () => {
  const html = dmPanelMarkup('javascript:alert(1)');
  assert.equal(html.includes('javascript:'), false);
  assert.ok(html.includes(DEFAULT_DMP_URL));
});

test('query strings are escaped, not injected', () => {
  const html = dmPanelMarkup('https://example.com/dmp?a=1&b="><script>alert(1)</script>');
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('"><script>'), false);
  assert.ok(html.includes('&amp;b='));
});

test('the console mounts the DM panel after the design starts', () => {
  const source = readFileSync('app/components/safetyos/SafetyOsApp.tsx', 'utf8');
  assert.ok(source.includes("import { mountDmPage, resolveDmpUrl } from '@/lib/dm-embed';"));
  assert.ok(source.includes('mountDmPage(container, DMP_URL'));
  // Opt-out for deployments where the Apps Script project still refuses framing.
  assert.ok(source.includes('NEXT_PUBLIC_DMP_EMBED'));
  assert.ok(source.includes('NEXT_PUBLIC_DMP_URL'));
  // Credentials belong to the Apps Script app; this repository must not carry them.
  const dmModule = readFileSync('lib/dm-embed.ts', 'utf8');
  assert.equal(/password|passcode|Gulam/i.test(dmModule), false);
  const constants = source.slice(source.indexOf('const DMP_URL'), source.indexOf('const PAGE_SIZE'));
  assert.equal(/password|passcode/i.test(constants), false);
});
