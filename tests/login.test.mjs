import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The sign-in screen is staff-only. Employees use the public app without an account and
 * identify themselves through the Employee-ID lookup, so re-introducing an "Employee"
 * login tab would promise a flow that is not connected and leaks no value.
 */
test('login offers exactly two roles: safety supervisor and admin', () => {
  const source = readFileSync('app/components/OfficerAccessDialog.tsx', 'utf8');

  assert.ok(source.includes("type Role = 'supervisor' | 'admin'"));
  assert.equal((source.match(/className=\{`account-role-tab /g) ?? []).length, 2);
  assert.ok(source.includes("role === 'supervisor'"));
  assert.ok(source.includes("role === 'admin'"));

  // No employee sign-in surface left behind.
  for (const removed of ["role === 'employee'", 'Send OTP', 'One-Time Password', 'Employee ID']) {
    assert.equal(source.includes(removed), false, removed);
  }
});

test('the role picker lays out two cards, not three', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  assert.ok(css.includes('.account-role-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr));'));
  assert.equal(css.includes('.account-role-grid { display: grid; grid-template-columns: repeat(3'), false);
});

test('the account page describes staff access, not employee access', () => {
  const pages = readFileSync('app/components/MorePages.tsx', 'utf8');
  assert.ok(pages.includes('description="Safety supervisor or admin access"'));
  assert.equal(pages.includes('Employee, supervisor or admin access'), false);
});
