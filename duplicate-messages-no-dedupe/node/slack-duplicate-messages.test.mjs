import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, fingerprint } from './slack-duplicate-messages.mjs';

test('one message is never a duplicate', () => {
  const [state, detail] = classify(['1712345678.000100']);
  assert.equal(state, 'unique');
  assert.match(detail, /nothing to explain/);
});

test('sub-second copies are a double delivery', () => {
  const [state, detail] = classify(['1712345678.000100', '1712345678.400200']);
  assert.equal(state, 'double-delivery');
  assert.match(detail, /app_mention/);
});

test('sixty and three hundred second gaps are Slack retries', () => {
  const [state, detail] = classify(['1000.0', '1061.0', '1358.0']);
  assert.equal(state, 'retry-duplicate');
  assert.match(detail, /three seconds/);
});

test('hours apart is a rerun, not a retry', () => {
  assert.equal(classify(['0.0', '7200.0'])[0], 'rerun');
});

test('mixed spacing is not given a confident cause', () => {
  const [state, detail] = classify(['1000.0', '1000.2', '1008.0']);
  assert.equal(state, 'duplicated');
  assert.match(detail, /matches no known cause/);
});

test('identical fallback text with different blocks is not a duplicate', () => {
  const a = { text: 'New alert', blocks: [{ type: 'section', text: 'disk full' }] };
  const b = { text: 'New alert', blocks: [{ type: 'section', text: 'cert expiring' }] };
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test('the same content at different timestamps shares a fingerprint', () => {
  assert.equal(
    fingerprint({ text: 'deploy finished', ts: '1712345678.000100' }),
    fingerprint({ text: 'deploy finished', ts: '1712345738.000200' }),
  );
});
