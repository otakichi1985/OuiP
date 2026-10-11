const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const exec=promisify(require('node:child_process').execFile);
const {Updater,newer,releaseAsset,checkNames}=require('../lib/updater');
test('更新の版・配布元・ハッシュ・ZIP経路を検証',()=>{
  assert.ok(newer('0.10.0','0.9.9'));assert.ok(!newer('0.1.0','0.1.0'));
  assert.throws(()=>newer('0.2.0-beta','0.1.0'));
  assert.throws(()=>checkNames('OuiP/OuiP.exe\nOuiP/.ouip-package.json\nOuiP/../secret'));
  assert.throws(()=>releaseAsset({tag_name:'v0.2.0',assets:[]},'0.1.0'));
});
test('ZIP取得とSHA256検証・展開、実PowerShellで交換/ロールバック、創作データは保持',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'ouip-update-'));
  try{
    const root=path.join(tmp,'install','OuiP'),build=path.join(tmp,'build','OuiP'),cache=path.join(tmp,'cache');
    async function fixture(dir,v){await fs.mkdir(path.join(dir,'resources','app'),{recursive:true});await fs.writeFile(path.join(dir,'OuiP.exe'),'fixture');await fs.writeFile(path.join(dir,'.ouip-package.json'),JSON.stringify({product:'OuiP',version:v,platform:'win32',arch:'x64'}));await fs.writeFile(path.join(dir,'resources','app','package.json'),JSON.stringify({name:'ouip',version:v}));}
    await fixture(root,'0.1.0');await fixture(build,'0.2.0');
    await fs.writeFile(path.join(tmp,'world.json'),'private creative data');
    const zip=path.join(tmp,'update.zip'),tar=path.join(process.env.WINDIR,'System32','tar.exe');
    await exec(tar,['-a','-cf',zip,'-C',path.dirname(build),'OuiP'],{windowsHide:true});
    const bytes=await fs.readFile(zip),digest='sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
    const release={tag_name:'v0.2.0',body:'更新内容',assets:[{name:'ouip-win-x64-v0.2.0.zip',size:bytes.length,digest,browser_download_url:'https://github.com/otakichi1985/OuiP/releases/download/v0.2.0/ouip-win-x64-v0.2.0.zip'}]};
    const updater=new Updater({root,cache,current:'0.1.0',supported:true,fetcher:async(url)=>url.includes('api.github')?new Response(JSON.stringify(release)):new Response(bytes)});
    assert.equal((await updater.check()).kind,'available');
    assert.equal((await updater.download()).version,'0.2.0');
    const ps=path.join(process.env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const config=path.join(tmp,'config.json'),script=path.resolve(__dirname,'../lib/update-swap.ps1');
    async function swap(candidate,rollback){await fs.writeFile(config,JSON.stringify({root,candidate,rollback,pid:2147483647,log:path.join(tmp,'swap.log')}));await exec(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Config',config,'-TestNoLaunch'],{windowsHide:true,timeout:15000});assert.match(await fs.readFile(path.join(tmp,'swap.log'),'utf8'),/completed/);}
    await swap(updater.staged,false);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'.ouip-package.json'))).version,'0.2.0');
    assert.equal((await updater.info()).backup,'0.1.0');
    await swap(root+'.previous',true);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'.ouip-package.json'))).version,'0.1.0');
    assert.equal(await fs.readFile(path.join(tmp,'world.json'),'utf8'),'private creative data');
    release.assets[0].digest='sha256:'+'0'.repeat(64);
    await updater.check();await assert.rejects(updater.download(),/SHA256/);
    assert.ok(!(await fs.readdir(path.dirname(root))).some(n=>n.startsWith('.ouip-stage-')));
    updater.supported=false;assert.equal((await updater.check()).kind,'unsupported');
  }finally{await fs.rm(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});