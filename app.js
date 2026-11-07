import {validateBackup,planMerge} from './merge.js';
const $=id=>document.getElementById(id);const DB='diary-local-v1',STORE='entries';let db, saving=false;
function uid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('別のDIARY画面を閉じて再試行してください。'));});}
function allEntries(){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function putEntry(e){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).add(e);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function deleteEntry(id){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function addManyAtomic(entries){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');const s=tx.objectStore(STORE);for(const e of entries)s.add(e);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function ask(title,message,accept='続ける'){return new Promise(resolve=>{const d=$('confirmDialog');$('dialogTitle').textContent=title;$('dialogMessage').textContent=message;$('dialogAccept').textContent=accept;const done=()=>{d.removeEventListener('close',done);resolve(d.returnValue==='accept');};d.addEventListener('close',done);d.showModal();});}
function displayDate(iso){return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));}
async function render(){const entries=await allEntries();entries.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));const container=$('entries');container.replaceChildren();if(!entries.length){const p=document.createElement('p');p.className='empty';p.textContent='まだ日記がありません。\n右下の＋から最初の日記を書いてみましょう。';container.append(p);return;}for(const e of entries){const article=document.createElement('article');article.className='entry';const head=document.createElement('div');head.className='entryhead';const date=document.createElement('time');date.className='date';date.dateTime=e.createdAt;date.textContent=displayDate(e.createdAt);const del=document.createElement('button');del.className='delete';del.textContent='削除';del.setAttribute('aria-label',`${displayDate(e.createdAt)}の日記を削除`);del.onclick=async()=>{if(!await ask('日記を完全に削除しますか？','この操作は取り消せません。過去のバックアップには残る場合があります。','完全に削除'))return;try{await deleteEntry(e.id);await render();$('status').textContent='日記を削除しました。';}catch{$('status').textContent='削除できませんでした。再試行してください。';}};head.append(date,del);const body=document.createElement('p');body.className='entrytext';body.textContent=e.body;article.append(head,body);container.append(article);}}
function showEditor(){ $('editorError').textContent='';$('entryBody').value='';$('editor').hidden=false;$('entryBody').focus();}
async function closeEditor(){if(saving)return;if($('entryBody').value.trim()&&!await ask('入力中の日記を破棄しますか？','保存していない文章は失われます。','破棄して閉じる'))return;$('editor').hidden=true;}
async function save(){if(saving)return;const body=$('entryBody').value;if(!body.trim()){$('editorError').textContent='文章を入力してください。';return;}saving=true;$('saveEntry').disabled=true;$('editorError').textContent='';const id=uid();try{await putEntry({id,originId:id,createdAt:new Date().toISOString(),body,schemaVersion:1});$('editor').hidden=true;$('entryBody').value='';await render();$('status').textContent='日記を保存しました。';}catch(e){$('editorError').textContent='保存できませんでした。文章は残っています。もう一度「投稿する」を押してください。';}finally{saving=false;$('saveEntry').disabled=false;}}
async function backup(){
  const button=$('backupButton'), status=$('settingsStatus');
  button.disabled=true;
  try{
    const entries=await allEntries();
    const payload={format:'DIARY_BACKUP',version:1,exportedAt:new Date().toISOString(),entries};
    const fileName=`DIARY_backup_${new Date().toISOString().slice(0,10)}.json`;
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    // Desktop browsers should download directly; their Web Share permissions can be denied.
    const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||
      (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    if(isIOS && navigator.share && navigator.canShare){
      const file=new File([blob],fileName,{type:'application/json'});
      if(navigator.canShare({files:[file]})){
        try{
          await navigator.share({files:[file],title:'DIARYバックアップ'});
          status.textContent='共有操作へ引き渡しました。ファイルアプリで実際の保存先とファイルを確認してください。';
          return;
        }catch(e){
          if(e.name==='AbortError'){
            status.textContent='共有操作がキャンセルされました。バックアップの保存は確認されていません。';
            return;
          }
          // A denied/unsupported share should not prevent a regular file download.
          if(!['NotAllowedError','SecurityError','NotSupportedError','TypeError'].includes(e.name))throw e;
        }
      }
    }
    const url=URL.createObjectURL(blob);
    try{
      const a=document.createElement('a');a.href=url;a.download=fileName;
      document.body.append(a);a.click();a.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
    status.textContent='バックアップファイルのダウンロードを開始しました。実際にファイルが保存されたか確認してください。';
  }catch(e){status.textContent='バックアップの作成に失敗しました。'+(e.message||'');}
  finally{button.disabled=false;}
}
async function restore(file){if(!file)return;const status=$('settingsStatus');try{if(file.size>30*1024*1024)throw new Error('ファイルが大きすぎます（上限30MB）。');const raw=JSON.parse(await file.text());const incoming=validateBackup(raw);const existing=await allEntries();const plan=planMerge(existing,incoming,uid);if(!await ask('バックアップを統合しますか？',`現在の日記 ${existing.length}件は保持します。\n追加予定 ${plan.additions.length}件、重複スキップ ${plan.skipped}件。\n同じIDで本文が異なる日記は別の日記として保存します。`,'統合する')){status.textContent='復元をキャンセルしました。';return;}if(plan.additions.length)await addManyAtomic(plan.additions);await render();status.textContent=`復元が完了しました。追加 ${plan.additions.length}件／重複スキップ ${plan.skipped}件。`; }catch(e){status.textContent='復元できませんでした。既存の日記を保持しています。'+(e.message||'');}finally{$('restoreFile').value='';}}
async function init(){try{db=await openDB();await render();$('addButton').onclick=showEditor;$('closeEditor').onclick=closeEditor;$('saveEntry').onclick=save;$('menuButton').onclick=()=>{$('settingsStatus').textContent='';$('settings').hidden=false;};$('closeSettings').onclick=()=>{$('settings').hidden=true;};$('backupButton').onclick=backup;$('restoreFile').onchange=e=>restore(e.target.files[0]);if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{$('status').textContent='オフライン準備に失敗しました。ネット接続時に再度開いてください。';});}catch(e){$('status').textContent='日記の保存領域を開けませんでした。Safariの設定や空き容量を確認してください。';$('addButton').disabled=true;}}
init();
