// 開発版と共用の世界を新しいフォルダーに作る: node test/seed.js <フォルダー>
const path = require('node:path');
const { ensureFixture } = require('../lib/dev-fixture');
if (!process.argv[2]) { console.error('出力先フォルダーを指定してください'); process.exitCode=1; }
else ensureFixture(path.resolve(process.argv[2])).then(created=>{
  if(!created) throw Error('既存フォルダーは変更しません。新しい出力先を指定してください');
  console.log('検証用データを作成しました');
}).catch(error=>{console.error(error);process.exitCode=1;});
