/**
 * 把 src/mock/roots.ts 导出为 shared/seed-roots.json，供后端 scripts/seed_vocab.py 导入。
 * 用法：npm run export:seed
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOCK_ROOTS } from '../src/mock/roots.ts';

const out = fileURLToPath(new URL('../../shared/seed-roots.json', import.meta.url));

const roots = MOCK_ROOTS.map((r, i) => ({
  rootText: r.rootText,
  meaning: r.meaning,
  sortOrder: i,
  // 单词 id 由数据库生成，不导出 wordId
  words: r.words.map(({ wordId: _wordId, ...w }, j) => ({ ...w, sortOrder: j })),
}));

writeFileSync(out, JSON.stringify(roots, null, 2) + '\n', 'utf8');
console.log(`已导出 ${roots.length} 个词根到 ${out}`);
