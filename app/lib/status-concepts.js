'use strict';
// ステータスの定義（世界観で共通）。正本の決まりは renderer/status-model.js にあり、ここは保存側の窓口。
// 1つの定義は「グラフの種類（card/detail）」と「項目」のセットを持つ。項目は値を持たず、IDで各キャラの値とつながる。
const StatusModel = require('../renderer/status-model');

const ID_RE = StatusModel.SET_ID;
const newId = () => StatusModel.newId('st-');
const normalizeStatusConcept = (input) => StatusModel.normalizeSet(input);
const normalizeStatusConcepts = (input) => StatusModel.normalizeSets(input);
// 項目IDが振られていない定義（IDを持つ前の開発版のデータ）があるか。読み込み時に一度だけ振って保存する。
const needsItemIds = (list) => Array.isArray(list) && list.some((c) => Array.isArray(c?.items) && c.items.some((it) => !it?.id));

module.exports = { normalizeStatusConcept, normalizeStatusConcepts, needsItemIds, newId, ID_RE };
