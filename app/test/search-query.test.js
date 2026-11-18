'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SearchQuery = require('../renderer/search-query');

test('空白はAND、ORはどれかに一致、-は除外', () => {
  const fields = ['灯', 'あかり', '灯台の娘', '所属', '灯台'];
  assert.equal(SearchQuery.matches(fields, ''), true, '空欄はすべて一致');
  assert.equal(SearchQuery.matches(fields, '灯 灯台'), true, '空白区切りはAND');
  assert.equal(SearchQuery.matches(fields, '灯 存在しない'), false, '片方しか無ければ一致しない');
  assert.equal(SearchQuery.matches(fields, '灯 OR 潮'), true, 'ORはどれか');
  assert.equal(SearchQuery.matches(fields, '灯 OR 存在しない'), true);
  assert.equal(SearchQuery.matches(fields, '灯 -潮'), true, '-は除外');
  assert.equal(SearchQuery.matches(fields, '灯 -灯台'), false);
  assert.equal(SearchQuery.matches(fields, '灯 AND 灯台'), true, 'ANDも区切りとして読む');
});

test('検索窓は空白で区切った言葉をすべて含むだけ（演算子を読まない）', () => {
  assert.equal(SearchQuery.allWords(['灯', 'あかり', '灯台'], '灯 灯台'), true);
  assert.equal(SearchQuery.allWords(['灯', 'あかり'], '灯 灯台'), false);
  assert.equal(SearchQuery.allWords(['灯'], '灯 OR 潮'), false, 'ORは言葉として扱う');
  assert.equal(SearchQuery.allWords(['灯 OR 潮'], '灯 OR 潮'), true);
});

test('引用符は空白を含むひと続きの言葉として読む', () => {
  assert.equal(SearchQuery.matches(['灯台 守の娘'], '"灯台 守"'), true);
  assert.equal(SearchQuery.matches(['灯台の娘'], '"灯台 守"'), false);
  assert.equal(SearchQuery.matches(['灯台 守の娘'], '-"灯台 守"'), false);
});

test('英字は大文字小文字を区別しない', () => {
  assert.equal(SearchQuery.matches(['Lighthouse Keeper'], 'lighthouse'), true);
  assert.equal(SearchQuery.matches(['Lighthouse Keeper'], 'LIGHTHOUSE keeper'), true);
});
