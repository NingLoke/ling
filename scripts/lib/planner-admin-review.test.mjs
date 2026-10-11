import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../assets/planner-admin-ui.js', import.meta.url), 'utf8');
const closeHandler = source.match(/review.addEventListener\("close", \(\) => \{[^]*?\n  \}\);/)?.[0];
assert.ok(closeHandler);
test('a reviewed batch waits for the dialog close and history navigation; the next resolver stays intact', () => {
  let close, popstate;
  const ctx = vm.createContext({ approved: [], history: { state: { adminReview: true } }, review: { addEventListener: (_event, fn) => close = fn }, window: { addEventListener: (_event, fn) => popstate = fn } });
  vm.runInContext('var reviewApproved = true; var reviewResolve = value => approved.push(value);\n' + closeHandler, ctx);
  close();
  assert.equal(ctx.approved.length, 0); assert.equal(ctx.reviewResolve, null);
  let nextResolved = false;
  ctx.reviewResolve = () => nextResolved = true;
  popstate();
  assert.equal(ctx.approved[0], true); assert.equal(nextResolved, false);
  ctx.history.state = {};
  ctx.reviewApproved = false;
  close();
  assert.equal(nextResolved, true);
});
