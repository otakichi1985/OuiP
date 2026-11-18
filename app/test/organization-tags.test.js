'use strict';
const test = require('node:test');
const assert = require('node:assert');
const OrganizationTags = require('../renderer/organization-tags');

test('所属組織を足すと「所属」タグに入り、外した組織名だけを消す', () => {
  const before = { 年齢: ['16歳'], 所属: ['港', '手で入れた値'] };
  assert.deepEqual(OrganizationTags.merge(before, ['灯台']), { 年齢: ['16歳'], 所属: ['港', '手で入れた値', '灯台'] });
  assert.deepEqual(OrganizationTags.merge(before, [], ['港']), { 年齢: ['16歳'], 所属: ['手で入れた値'] });
  assert.deepEqual(OrganizationTags.merge({ 所属: ['港'] }, [], ['港']), {});
});

test('同じ組織名を二重に入れず、関係のない分類を変えない', () => {
  const tags = { 所属: ['灯台'], 身分: ['学生'] };
  assert.deepEqual(OrganizationTags.merge(tags, ['灯台']), tags);
});
