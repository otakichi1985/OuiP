const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const REPO = 'otakichi1985/OuiP';
const MAX = 600 * 1024 * 1024;
function version(v) {
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  if (!m) throw Error('バージョン表記が不正です');
  return m.slice(1).map(Number);
}
function newer(a,b) { const x=version(a),y=version(b); for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i]; return false; }
function releaseAsset(release,current) {
  if(release.draft || release.prerelease) throw Error('正式版ではありません');
  const v=version(release.tag_name).join('.');
  if(!newer(v,current)) return null;
  const name=`ouip-win-x64-v${v}.zip`,asset=release.assets?.find(a=>a.name===name);
  if(!asset || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest||'') || !Number.isSafeInteger(asset.size) || asset.size<1 || asset.size>MAX) throw Error('検証可能な更新用ZIPがありません');
  if(!asset.browser_download_url?.startsWith(`https://github.com/${REPO}/releases/download/${release.tag_name}/`)) throw Error('配布元が不正です');
  return {version:v,notes:String(release.body||''),asset};
}
function checkNames(text) {
  const names=text.split(/\r?\n/).filter(Boolean);
  if(!names.length || names.some(n=>!n.startsWith('OuiP/') || n.includes('\\') || n.split('/').some(p=>p==='..'||p==='.') || /[:\x00-\x1f]/.test(n))) throw Error('更新ZIPの構成が不正です');
  if(!names.includes('OuiP/OuiP.exe') || !names.includes('OuiP/.ouip-package.json')) throw Error('更新ZIPにアプリがありません');
}
class Updater {
  constructor({root,cache,current,supported,fetcher=fetch}) { Object.assign(this,{root,cache,current,supported,fetcher}); this.pending=null;this.staged=null;this.busy=false; }
  async info() {
    let backup=null;
    try { const m=JSON.parse(await fs.readFile(path.join(this.root+'.previous','.ouip-package.json'),'utf8')); if(m.product==='OuiP') backup=m.version; } catch {}
    return {current:this.current,supported:this.supported,backup};
  }
  async check() {
    if(this.busy) throw Error('更新の処理中です');
    if(this.staged) await fs.rm(path.dirname(this.staged),{recursive:true,force:true,maxRetries:10,retryDelay:200});
    this.pending=null;this.staged=null;
    if(!this.supported) return {...await this.info(),kind:'unsupported'};
    const r=await this.fetcher(`https://api.github.com/repos/${REPO}/releases/latest`,{headers:{'Accept':'application/vnd.github+json','User-Agent':'OuiP','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});
    if(r.status===404) return {...await this.info(),kind:'unpublished'};
    if(!r.ok) throw Error(`更新の確認に失敗しました（HTTP ${r.status}）`);
    this.pending=releaseAsset(await r.json(),this.current);
    return {...await this.info(),kind:this.pending?'available':'current',...(this.pending?{version:this.pending.version,notes:this.pending.notes}:{})};
  }
  async download() {
    if(this.busy) throw Error('更新の処理中です');
    if(!this.pending) throw Error('先に更新を確認してください');
    if(this.staged) return {version:this.pending.version};
    this.busy=true;
    let stage;
    try {
      await fs.mkdir(this.cache,{recursive:true});
      stage=await fs.mkdtemp(path.join(path.dirname(this.root),'.ouip-stage-'));
      const zip=path.join(stage,'update.zip'), r=await this.fetcher(this.pending.asset.browser_download_url,{signal:AbortSignal.timeout(180000)});
      if(!r.ok || !r.body) throw Error('更新のダウンロードに失敗しました');
      const h=crypto.createHash('sha256'),file=await fs.open(zip,'wx');let size=0;
      try {for await(const chunk of r.body){size+=chunk.length;if(size>MAX||size>this.pending.asset.size) throw Error('更新ファイルが大きすぎます');h.update(chunk);let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw Error('更新ファイルを書き込めません');offset+=bytesWritten;}}}finally{await file.close();}
      if(size!==this.pending.asset.size || h.digest('hex')!==this.pending.asset.digest.slice(7).toLowerCase()) throw Error('更新ファイルのSHA256が一致しません');
      const tar=path.join(process.env.WINDIR||'C:\\Windows','System32','tar.exe');
      const listing=await exec(tar,['-tf',zip],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});checkNames(listing.stdout);
      // links are never allowed in a runtime archive.
      const detailed=await exec(tar,['-tvf',zip],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
      if(detailed.stdout.split(/\r?\n/).some(l=>l && !['-','d'].includes(l[0]))) throw Error('更新ZIPにリンクが含まれています');
      await exec(tar,['-xf',zip,'-C',stage],{windowsHide:true,timeout:60000});
      const candidate=path.join(stage,'OuiP');
      const m=JSON.parse(await fs.readFile(path.join(candidate,'.ouip-package.json'),'utf8'));
      if(m.product!=='OuiP'||m.version!==this.pending.version||m.platform!=='win32'||m.arch!=='x64') throw Error('更新対象が一致しません');
      const pkg=JSON.parse(await fs.readFile(path.join(candidate,'resources','app','package.json'),'utf8'));
      if(pkg.name!=='ouip'||pkg.version!==m.version) throw Error('更新のバージョンが一致しません');
      this.staged=candidate; return {version:m.version};
    } catch(e){if(stage) await fs.rm(stage,{recursive:true,force:true,maxRetries:10,retryDelay:200});throw e;}
    finally{this.busy=false;}
  }
  async launchSwap(rollback=false) {
    if(this.busy) throw Error('更新の処理中です');
    if(!this.supported) throw Error('配布版だけで更新できます');
    const candidate=rollback?this.root+'.previous':this.staged;
    if(!candidate) throw Error('更新をダウンロードしてください');
    const m=JSON.parse(await fs.readFile(path.join(candidate,'.ouip-package.json'),'utf8'));
    if(m.product!=='OuiP') throw Error('入れ替えるアプリが不正です');
    await fs.mkdir(this.cache,{recursive:true});
    const config=path.join(this.cache,'swap.json');
    await fs.writeFile(config,JSON.stringify({root:this.root,candidate,pid:process.pid,rollback,log:path.join(this.cache,'update.log')}));
    const script=path.join(this.cache,'swap.ps1');
    await fs.copyFile(path.join(__dirname,'update-swap.ps1'),script);
    const child=spawn(path.join(process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Config',config],{detached:true,windowsHide:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  }
}
module.exports={Updater,version,newer,releaseAsset,checkNames};