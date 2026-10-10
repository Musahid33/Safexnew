import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const code = stripTypeScriptTypes(readFileSync(new URL('../lib/recognitions-validation.ts', import.meta.url), 'utf8'));
const { validRecognitionInput } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
const valid = { employeeName: 'Test Worker', rewardFor: 'Reported a hazard', consentConfirmed: true, isPublished: true };

test('only complete, consented records can be published', () => {
  const result = validRecognitionInput(valid);
  assert.equal(result?.employee_name, 'Test Worker');
  assert.equal(result?.reward_for, 'Reported a hazard');
  assert.equal(result?.is_published, true);
  assert.equal(validRecognitionInput({ ...valid, consentConfirmed: false }), null);
  assert.equal(validRecognitionInput({ ...valid, rewardFor: '' }), null);
  assert.equal(validRecognitionInput({ ...valid, employeeName: '' }), null);
  assert.equal(validRecognitionInput({ ...valid, consentConfirmed: false, isPublished: false })?.is_published, false);
  assert.equal(validRecognitionInput({ ...valid, sortOrder: -1 }), null);
});

test('image URLs obey the restrictive CSP', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  try {
    assert.equal(validRecognitionInput({ ...valid, imageUrl: '/rewards/award.jpg' })?.image_url, '/rewards/award.jpg');
    assert.equal(validRecognitionInput({ ...valid, imageUrl: '/\\\\external.test/award.jpg' }), null);
    assert.equal(validRecognitionInput({ ...valid, imageUrl: 'https://project.supabase.co/storage/v1/object/public/rewards/award.jpg' })?.image_url,
      'https://project.supabase.co/storage/v1/object/public/rewards/award.jpg');
    for (const imageUrl of ['//external.test/photo', 'javascript:alert(1)', 'https://external.test/photo',
      'https://project.supabase.co/auth/v1/user', '/photo.jpg?tracking=1']) {
      assert.equal(validRecognitionInput({ ...valid, imageUrl }), null, imageUrl);
    }
  } finally { delete process.env.NEXT_PUBLIC_SUPABASE_URL; }
});
