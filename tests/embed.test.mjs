import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundle, output} from '../scripts/embed.mjs';

test('the pagecrit.dev demo build matches the extension source (npm run embed)', () => {
  assert.equal(readFileSync(output, 'utf8'), bundle());
});
