import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUNSET, uploadActivity, verdict } from './slack-files-upload-probe.mjs';

test('method_deprecated is the finding', () => {
  const [state, detail] = verdict({ ok: false, error: 'method_deprecated' });
  assert.equal(state, 'retired');
  assert.match(detail, /2025-11-12/);
});

test('deprecated_endpoint is the same finding', () => {
  assert.equal(verdict({ ok: false, error: 'deprecated_endpoint' })[0], 'retired');
});

test('missing_scope proves nothing about the method', () => {
  const [state, detail] = verdict({ ok: false, error: 'missing_scope', needed: 'files:write' });
  assert.equal(state, 'unknown');
  assert.match(detail, /files:write/);
});

test('a parsed call means the method still answers', () => {
  assert.equal(verdict({ ok: false, error: 'no_file_data' })[0], 'still-answering');
});

test('a credential error is not a deprecation', () => {
  assert.equal(verdict({ ok: false, error: 'invalid_auth' })[0], 'auth');
});

test('non json body is not an answer', () => {
  assert.equal(verdict('<html>proxy</html>')[0], 'unreadable');
});

test('history ending before the cutover is a silent outage', () => {
  const files = [{ created: SUNSET - 86400 * 30 }, { created: SUNSET - 86400 * 400 }];
  const [state, detail] = uploadActivity(files, SUNSET + 86400 * 10);
  assert.equal(state, 'silent-since-sunset');
  assert.match(detail, /40 day\(s\)/);
});

test('an upload after the cutover clears the history check', () => {
  const files = [{ created: SUNSET - 10 }, { created: SUNSET + 10 }];
  assert.equal(uploadActivity(files, SUNSET + 86400)[0], 'uploading');
});

test('no files is not evidence either way', () => {
  assert.equal(uploadActivity([], SUNSET)[0], 'no-uploads');
});
