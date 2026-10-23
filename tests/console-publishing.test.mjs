import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

/**
 * The design console ships its own Documents & Library and Communications screens. Their
 * buttons only redraw the local preview — they never wrote to Supabase — so anything
 * "published" there never reached the worker app.
 *
 * Both pages now host the real publishing workspace in place: the location picker, one card
 * per publishable type (documents, circulars, notices, events and rewards), the form and the
 * published list, all on the same screen. No link to another page and no second sign-in.
 */

const app = readFileSync('app/components/safetyos/SafetyOsApp.tsx', 'utf8');
const workspace = readFileSync('app/components/safetyos/PublisherWorkspace.tsx', 'utf8');
const css = readFileSync('app/safetyos-host.css', 'utf8');

test('the console hosts the publishing workspace on both demo pages', () => {
  assert.match(app, /#documentsPage/);
  assert.match(app, /#communicationsPage/);
  assert.match(app, /<PublisherWorkspace section="documents" selectedSiteId=\{selectedSiteId\} \/>/);
  assert.match(app, /<PublisherWorkspace section="communications" selectedSiteId=\{selectedSiteId\} \/>/);
  assert.equal(existsSync('app/components/safetyos/PublishingHandoff.tsx'), false, 'the handoff card is gone');
});

test('nothing in the workspace navigates away', () => {
  assert.doesNotMatch(workspace, /href=/, 'no link out of the console');
  assert.doesNotMatch(workspace, /window\.open/);
  assert.doesNotMatch(workspace, /target="_blank"/);
  assert.doesNotMatch(workspace, /\/admin\/publish/, 'publishing must not send the operator to another page');
  assert.doesNotMatch(workspace, /router\.push/, 'no route change');
});

test('the location is chosen on the same screen, from the live site list', () => {
  assert.match(workspace, /<label className="pub-site">/);
  assert.match(workspace, /<select value=\{slug\}/);
  assert.match(workspace, /fetch\('\/api\/admin\/content', \{ cache: 'no-store' \}\)/);
  assert.match(workspace, /selectedSiteId/, 'defaults to the site the console is already on');
});

test('every publishable type is a card on the same page', () => {
  for (const kind of ["kind: 'document'", "kind: 'circular'", "kind: 'notice'", "kind: 'event'", "kind: 'reward'"]) {
    assert.ok(workspace.includes(kind), `missing card ${kind}`);
  }
  assert.match(workspace, /className="pub-cards"/);
  assert.match(workspace, /className="pub-card"/);
});

test('the form opens in place and writes through the real admin APIs', () => {
  for (const call of ['/api/admin/content', '/api/admin/content/upload', '/api/admin/recognitions', '/api/admin/recognitions/photo']) {
    assert.ok(workspace.includes(call), `missing ${call}`);
  }
  assert.match(workspace, /\{open === 'document' && <form className="pub-form"/);
  assert.match(workspace, /\{open === 'reward' && <form className="pub-form"/);
  assert.match(workspace, /setOpen\(kind\)/, 'a card opens its form without a route change');
  assert.doesNotMatch(workspace, /window\.location/, 'no redirect');
});

test('a document cannot be published without its file, and is kept on edit', () => {
  assert.match(workspace, /Attach the file before publishing\. A draft can be saved without one\./);
  assert.match(workspace, /keepFile/, 'editing keeps the stored file unless a new one is chosen');
  assert.match(workspace, /accept="application\/pdf,image\/png,image\/jpeg,image\/webp"/);
});

test('a reward needs consent before it can be published', () => {
  assert.match(workspace, /Tick the consent box before publishing the name and photo\./);
  assert.match(workspace, /consentConfirmed/);
  assert.match(workspace, /accept="image\/jpeg,image\/png,image\/webp"/);
});

test('published entries are managed from the same screen', () => {
  assert.match(workspace, /Manage what is published/);
  assert.match(workspace, /Unpublish/);
  assert.match(workspace, /removeRow\('announcement'/);
  assert.match(workspace, /removeRow\('reward'/);
});

test('the design screens stay hidden behind the workspace', () => {
  assert.match(css, /#documentsPage > :not\(\.publishing-host\)/);
  assert.match(css, /#communicationsPage > :not\(\.publishing-host\)/);
  assert.match(css, /\.sos \.pub-cards \{/);
  assert.match(css, /\.sos \.pub-form \{/);
  assert.equal(css.includes('.publishing-handoff'), false, 'the old handoff styles are gone');
});
