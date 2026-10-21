import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The design console ships its own Documents & Library and Communications screens with
// sample rows and publish buttons. Those buttons only redraw the local preview — they never
// write to Supabase — so a document "published" there never reached the worker app. Both
// pages must now be replaced by a handoff card pointing at /admin/publish.

const app = readFileSync('app/components/safetyos/SafetyOsApp.tsx', 'utf8');
const handoff = readFileSync('app/components/safetyos/PublishingHandoff.tsx', 'utf8');
const css = readFileSync('app/safetyos-host.css', 'utf8');

test('the console hosts a handoff on the demo documents and communications pages', () => {
  assert.match(app, /#documentsPage/, 'the demo document library page must be intercepted');
  assert.match(app, /#communicationsPage/, 'the demo communications page must be intercepted');
  assert.match(app, /<PublishingHandoff section="documents"/);
  assert.match(app, /<PublishingHandoff section="communications"/);
});

test('the handoff links to the real publishing panel, not a console preview', () => {
  assert.match(handoff, /href="\/admin\/publish"/);
  assert.doesNotMatch(handoff, /fetch\(/, 'the handoff must not pretend to publish anything');
});

test('every design node on those pages is hidden behind the handoff', () => {
  assert.match(css, /#documentsPage > :not\(\.publishing-host\)/);
  assert.match(css, /#communicationsPage > :not\(\.publishing-host\)/);
  assert.match(css, /display:\s*none !important;/);
});

test('the console never claims its own screens publish to the app', () => {
  // The design's local-only actions must not be presented as real publishing anywhere else.
  const sources = [app, handoff].join('\n');
  assert.doesNotMatch(sources, /commPublish/);
  assert.doesNotMatch(sources, /commBroadcast/);
});
