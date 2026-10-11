import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as S from '../../assets/planner-store.js';
import { sameItem, prepareCommands } from '../../assets/planner-admin.js';

const source = readFileSync(new URL('../../assets/planner-ui.js', import.meta.url), 'utf8');
function harness(state) {
  const context = vm.createContext({ state, S, sameItem, getNow: () => ({ iso: '2026-10-11' }), commits: 0 });
  vm.runInContext('const commit = next => { state = next; commits++; };\n' + ['applyAdminBatch', 'undoAdminAdds'].map(name => {
    const fn = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`))?.[0];
    assert.ok(fn); return fn;
  }).join('\n'), context);
  return context;
}
const state = () => ({ events: [], todos: [{ id: 'old', title: '报告', due: null, star: false, done: true, doneOn: '2026-10-10', created: 1 }], habits: [], habitDone: {}, settings: {} });
const add = { action: 'add', kind: 'todos', item: { title: '复习', due: null, star: false } };

test('a late conflict saves no part of the batch; update preserves completion metadata', () => {
  const ctx = harness(state());
  const commands = prepareCommands([add, { action: 'update', kind: 'todos', id: 'old', item: { title: '交报告' } }], ctx.state);
  ctx.state.todos[0].title = '别的设备改过';
  assert.throws(() => ctx.applyAdminBatch(commands), /刚有变化/);
  assert.equal(ctx.state.todos.length, 1); assert.equal(ctx.commits, 0);
  const update = prepareCommands([{ action: 'update', kind: 'todos', id: 'old', item: { title: '交报告' } }], ctx.state);
  ctx.applyAdminBatch(update);
  assert.equal(ctx.state.todos[0].done, true); assert.equal(ctx.state.todos[0].created, 1);
});

test('batch deduplicates additions; undo preserves additions that the user changed', () => {
  const ctx = harness(state());
  const result = ctx.applyAdminBatch(prepareCommands([add, add, { ...add, item: { ...add.item, title: '运动' } }], ctx.state));
  assert.equal(result.count, 2); assert.equal(ctx.commits, 1);
  const changed = result.added[0];
  ctx.state = S.upsert(ctx.state, 'todos', { id: changed.id, title: '已改复习' });
  ctx.undoAdminAdds(result.added);
  assert.equal(ctx.state.todos.length, 2); assert.equal(ctx.state.todos[0].title, '报告');
  assert.equal(ctx.state.todos[1].title, '已改复习');
});
