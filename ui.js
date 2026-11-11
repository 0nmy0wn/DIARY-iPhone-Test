'use strict';
const el=id=>document.getElementById(id);
const home=el('home'),editor=el('editor'),menu=el('menu'),confirm=el('confirm'),body=el('body');
const DB_NAME='diary-local-v1', STORE='entries', AI_STORE='aiComments';
const API_BASE='https://diary-ai-api.jyono26.workers.dev';
const TOKEN_KEY='diary-ai-token';
let authToken=localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||'';
if(authToken){localStorage.setItem(TOKEN_KEY,authToken);sessionStorage.removeItem(TOKEN_KEY);}
function clearAuth(){authToken='';localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(TOKEN_KEY);updateAuthStatus();}
let pendingAI=null,aiWorking=false;
const AUTO_KEY='diary-ai-auto-consent-v1';
let autoEnabled=localStorage.getItem(AUTO_KEY)==='yes';
let autoRunning=false;
const autoTried=new Set();

let db, toastTimer, pendingDelete=null, pendingRestore=null, busy=false;
function uid(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
function showToast(message){const t=el('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),4000)}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,2);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(AI_STORE))d.createObjectStore(AI_STORE,{keyPath:'entryId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('別のタブがデータベースを使用中です。'))})}
function readAll(){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function putOne(entry){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).add(entry);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function deleteOne(id){return new Promise((resolve,reject)=>{const tx=db.transaction([STORE,AI_STORE],'readwrite');tx.objectStore(STORE).delete(id);tx.objectStore(AI_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function addBatch(entries){return new Promise((resolve,reject)=>{if(!entries.length){resolve();return}const tx=db.transaction(STORE,'readwrite');for(const e of entries)tx.objectStore(STORE).add(e);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function readComments(){return new Promise((resolve,reject)=>{const tx=db.transaction(AI_STORE,'readonly');const req=tx.objectStore(AI_STORE).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function saveComment(c){return new Promise((resolve,reject)=>{const tx=db.transaction(AI_STORE,'readwrite');const store=tx.objectStore(AI_STORE);const req=store.add(c);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function addBatchWithComments(entries,comments){return new Promise((resolve,reject)=>{if(!entries.length&&!comments.length){resolve();return}const tx=db.transaction([STORE,AI_STORE],'readwrite');for(const e of entries)tx.objectStore(STORE).add(e);for(const c of comments)tx.objectStore(AI_STORE).add(c);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function dayKey(iso){const d=new Date(iso);return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`}
function dayLabel(iso){return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(iso))}
function timeLabel(iso){return new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
function dateLabel(iso){return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
// Display-only fallback for legacy comments without a stored emoji.
// Never modify the saved comment or pretend to recover a lost original emoji.
function legacyCommentEmoji(text){
 const value=typeof text==='string'?text:'';
 if(/笑|www|ウケ|面白|楽しい|最高|爆笑/.test(value))return '😆';
 if(/おめでと|すごい|やった|よかった|素敵|嬉し/.test(value))return '✨';
 if(/疲れ|休ん|無理せず|大丈夫|ゆっくり/.test(value))return '🍵';
 if(/食べ|ご飯|お腹|おいし/.test(value))return '🍙';
 if(/寒い|暖か|天気|晴れ/.test(value))return '☀️';
 if(/頑張|応援|進もう/.test(value))return '🔥';
 return '😊';
}
async function render(){const entries=(await readAll()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));const list=el('entryList');const comments=new Map((await readComments()).map(c=>[c.entryId,c]));list.replaceChildren();if(!entries.length){const section=document.createElement('section');section.className='empty';const p=document.createElement('p');p.textContent='まだ日記はありません。';section.append(p);list.append(section);return}list.className='entry-list';let lastDay='';for(const entry of entries){const day=dayKey(entry.createdAt);if(day!==lastDay){const heading=document.createElement('h2');heading.className='day-divider';heading.textContent=dayLabel(entry.createdAt);list.append(heading);lastDay=day;}const article=document.createElement('article');article.className='entry';const date=document.createElement('p');date.className='entry-date';date.textContent=dateLabel(entry.createdAt);const p=document.createElement('p');p.className='entry-body';p.textContent=entry.body;const actions=document.createElement('div');actions.className='entry-actions';const del=document.createElement('button');del.className='entry-delete';del.textContent='削除';del.setAttribute('aria-label',`${dateLabel(entry.createdAt)}の日記を削除`);del.addEventListener('click',()=>{pendingDelete=entry.id;el('deleteConfirm').classList.remove('hidden')});actions.append(del);article.append(date,p);
 const comment=comments.get(entry.id);
 if(comment){const note=document.createElement('div');note.className='ai-comment-group';const replies=Array.isArray(comment.replies)&&comment.replies.length?comment.replies:[{emoji:(typeof comment.emoji==='string'&&comment.emoji.trim()&&comment.emoji.trim()!=='💬')?comment.emoji:legacyCommentEmoji(comment.text),text:comment.text}];for(const reply of replies){const line=document.createElement('div');line.className='ai-comment';const emoji=document.createElement('span');emoji.className='ai-emoji';emoji.textContent=reply.emoji||'😊';emoji.setAttribute('aria-hidden','true');const words=document.createElement('span');words.textContent=reply.text;line.append(emoji,words);note.append(line)}article.append(note)}
 else if(entry.aiEligible===true&&!autoEnabled){const aiButton=document.createElement('button');aiButton.className='ai-generate';aiButton.textContent='✦ ひとことコメントを生成';aiButton.disabled=aiWorking;aiButton.addEventListener('click',()=>{pendingAI=entry;el('aiConfirm').classList.remove('hidden')});article.append(aiButton)}
  else if(entry.aiEligible===true&&autoEnabled){const status=document.createElement('p');status.className='ai-pending';status.textContent=authToken?'コメントを考えています…':'AIコメントはログイン後に自動生成されます';article.append(status)}
 article.append(actions);list.append(article)}}
function openEditor(){home.classList.add('hidden');editor.classList.remove('hidden');window.scrollTo(0,0);body.focus()}
function leaveEditor(){editor.classList.add('hidden');home.classList.remove('hidden');body.value='';el('editorStatus').textContent='';el('submitEntry').disabled=true;window.scrollTo(0,0)}
function requestClose(){if(busy)return;if(body.value.trim())confirm.classList.remove('hidden');else leaveEditor()}
function openMenu(){menu.classList.remove('hidden');el('menuButton').setAttribute('aria-expanded','true')}
function closeMenu(){if(busy)return;menu.classList.add('hidden');el('menuButton').setAttribute('aria-expanded','false')}
function setBusy(flag){busy=flag;el('submitEntry').disabled=flag||!body.value.trim();el('backupButton').disabled=flag;el('restoreButton').disabled=flag;el('acceptRestore').disabled=flag;el('acceptDelete').disabled=flag}
async function submit(){if(busy||!body.value.trim())return;setBusy(true);el('editorStatus').textContent='保存しています…';try{await putOne({id:uid(),originId:null,createdAt:new Date().toISOString(),body:body.value,schemaVersion:2,aiEligible:true});await render();leaveEditor();showToast('日記を保存しました。');queueAutoComments()}catch(e){el('editorStatus').textContent='保存できませんでした。文章は残っています。もう一度「投稿する」を押してください。';showToast('保存に失敗しました。')}finally{setBusy(false)}}
async function removeEntry(){if(!pendingDelete||busy)return;const id=pendingDelete;setBusy(true);try{await deleteOne(id);pendingDelete=null;el('deleteConfirm').classList.add('hidden');await render();showToast('日記を削除しました。')}catch(e){showToast('削除できませんでした。')}finally{setBusy(false)}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function backup(){if(busy)return;setBusy(true);try{const entries=await readAll();const comments=await readComments();const payload={format:'DIARY_BACKUP',version:2,exportedAt:new Date().toISOString(),entries,aiComments:comments};const text=JSON.stringify(payload,null,2);downloadBlob(new Blob([text],{type:'application/json;charset=utf-8'}),`DIARY_backup_${new Date().toLocaleDateString('sv-SE')}.json`);el('storageStatus').textContent=`${entries.length}件のバックアップを作成しました。ダウンロード先をご確認ください。`;}catch(e){el('storageStatus').textContent='バックアップ作成に失敗しました。';showToast('バックアップ作成に失敗しました。')}finally{setBusy(false)}}
async function chooseRestore(file){if(!file)return;pendingRestore=null;try{if(file.size>20*1024*1024)throw Error('ファイルが大きすぎます（上限20MB）。');const data=JSON.parse(await file.text());const entries=DiaryMerge.validateBackup(data);pendingRestore={entries,comments:DiaryMerge.validateComments(data)};el('restoreSummary').textContent=`バックアップの日記 ${entries.length}件を確認しました。現在の日記を残したまま統合します。よろしいですか？`;el('restoreConfirm').classList.remove('hidden')}catch(e){el('storageStatus').textContent=`復元を開始できません：${e.message}`;showToast('バックアップを読み込めませんでした。')}finally{el('restoreFile').value=''}}
async function restore(){if(!pendingRestore||busy)return;setBusy(true);try{const current=await readAll();const result=DiaryMerge.mergeEntries(current,pendingRestore.entries,uid);const existingComments=await readComments();const commentSet=new Set(existingComments.map(c=>c.entryId));const idMap=new Map();for(const a of result.additions){const original=pendingRestore.entries.find(e=>e.id===a.id||e.id===a.originId&&e.body===a.body);if(original)idMap.set(original.id,a.id)}
 const newComments=[];for(const c of pendingRestore.comments){const target=idMap.get(c.entryId);if(target&&!commentSet.has(target)){newComments.push({...c,entryId:target});commentSet.add(target)}}
 await addBatchWithComments(result.additions,newComments);pendingRestore=null;el('restoreConfirm').classList.add('hidden');await render();el('storageStatus').textContent=`統合完了：追加${result.additions.length}件、重複スキップ${result.skipped}件、同ID異本文を別IDで保存${result.renamed}件。`;showToast('バックアップを統合しました。')}catch(e){el('storageStatus').textContent='統合できませんでした。現在の日記は削除していません。';showToast('復元に失敗しました。')}finally{setBusy(false)}}
function updateAuthStatus(){const e=el('authStatus');if(e)e.textContent=authToken?'AIログイン済み（AIコメント生成のたびに有効期限を30日延長）':'未ログイン';}
el('aiLoginButton').addEventListener('click',async()=>{
 const password=el('aiPassword').value;
 if(!password){showToast('AI用パスワードを入力してください。');return;}
 const button=el('aiLoginButton');button.disabled=true;
 try{
  const response=await fetch(API_BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  const data=await response.json();
  if(!response.ok||!/^([a-f0-9]{64})$/.test(data.token||''))throw Error(data.error||'ログイン失敗');
  authToken=data.token;localStorage.setItem(TOKEN_KEY,authToken);el('aiPassword').value='';updateAuthStatus();showToast('AIログインに成功しました。');queueAutoComments();
 }catch(e){showToast('AIログインに失敗しました。パスワードや通信状態を確認してください。');console.error('AI login:',e.message)}
 finally{button.disabled=false;}
});
el('aiLogoutButton').addEventListener('click',async()=>{
 const oldToken=authToken;clearAuth();el('aiPassword').value='';
 if(oldToken){try{await fetch(API_BASE+'/auth/logout',{method:'POST',headers:{'Authorization':'Bearer '+oldToken}})}catch(e){console.warn('AI logout network:',e.message)}}
 showToast('この端末のAIログイン情報を消去しました。');
});
function updateAutoStatus(){
 const checkbox=el('aiAutoConsent');if(checkbox)checkbox.checked=autoEnabled;
 const status=el('aiAutoStatus');if(status)status.textContent=autoEnabled?'自動生成：オン（アプリ起動時・投稿時に実行）':'自動生成：オフ（従来どおり手動生成）';
}
function queueAutoComments(){if(!autoEnabled||!authToken||autoRunning||!db||!navigator.onLine)return;void runAutoComments()}
function normalizeAIResult(result){
 const replies=Array.isArray(result.comments)?result.comments.slice(0,2).filter(c=>typeof c?.comment==='string'&&c.comment.trim()).map(c=>({emoji:typeof c.emoji==='string'?c.emoji:'😊',text:c.comment.trim()})):[];
 if(!replies.length&&typeof result.comment==='string'&&result.comment.trim())replies.push({emoji:result.emoji||'😊',text:result.comment.trim()});
 if(!replies.length)throw Error(result.error||'AI応答エラー');
 return {text:replies[0].text,emoji:replies[0].emoji,replies};
}
async function runAutoComments(){
 if(autoRunning)return;autoRunning=true;
 try{
  const entries=(await readAll()).filter(e=>e.aiEligible===true&&typeof e.body==='string'&&e.body.trim()&&e.body.length<=2000).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const existing=new Set((await readComments()).map(c=>c.entryId));
  let processed=0;
  for(const entry of entries){
   if(!autoEnabled||!authToken||!navigator.onLine||processed>=3)break;
   if(existing.has(entry.id)||autoTried.has(entry.id))continue;
   autoTried.add(entry.id);processed++;
   try{
    const response=await fetch(API_BASE+'/ai/comment',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},body:JSON.stringify({text:entry.body})});
    if(response.status===401){clearAuth();showToast('AIログインの期限が切れました。再ログインしてください。');break;}
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'AI応答エラー');const ai=normalizeAIResult(result);
    // Do not restore comments for entries deleted during the request.
    const current=await readAll();if(!current.some(e=>e.id===entry.id))continue;
    const latest=await readComments();if(latest.some(c=>c.entryId===entry.id))continue;
    await saveComment({entryId:entry.id,id:uid(),...ai,createdAt:new Date().toISOString(),provider:'gemini',requestId:uid()});
    existing.add(entry.id);await render();
   }catch(error){console.warn('Automatic AI comment:',error.message)}
  }
 }catch(error){console.warn('Automatic AI comments:',error.message)}
 finally{autoRunning=false;}
}
el('aiAutoConsent').addEventListener('change',event=>{
 autoEnabled=event.target.checked;
 if(autoEnabled)localStorage.setItem(AUTO_KEY,'yes');else localStorage.removeItem(AUTO_KEY);
 updateAutoStatus();void render();if(autoEnabled)queueAutoComments();
});
updateAutoStatus();
window.addEventListener('online',queueAutoComments);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueAutoComments()});
updateAuthStatus();
el('aiCancel').addEventListener('click',()=>{pendingAI=null;el('aiConfirm').classList.add('hidden')});
el('aiAccept').addEventListener('click',async()=>{if(!pendingAI||aiWorking)return;const entry=pendingAI;pendingAI=null;el('aiConfirm').classList.add('hidden');aiWorking=true;try{if(!authToken){showToast('メニューからAIログインしてください。');return;}const response=await fetch(API_BASE+'/ai/comment',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},body:JSON.stringify({text:entry.body})});if(response.status===401){clearAuth();throw Error('ログイン期限切れです。再ログインしてください。');}const result=await response.json();if(!response.ok)throw Error(result.error||'AIからコメントを取得できませんでした');const ai=normalizeAIResult(result);await saveComment({entryId:entry.id,id:uid(),...ai,createdAt:new Date().toISOString(),provider:'gemini',requestId:uid()});showToast('Geminiのコメントを保存しました')}catch(e){showToast('AIコメントの取得・保存に失敗しました。再試行できます。');console.error('AI comment error:',e.message)}finally{aiWorking=false;await render()}});
el('newButton').addEventListener('click',openEditor);el('closeEditor').addEventListener('click',requestClose);body.addEventListener('input',()=>{el('submitEntry').disabled=busy||!body.value.trim();el('editorStatus').textContent=''});el('submitEntry').addEventListener('click',submit);el('keepWriting').addEventListener('click',()=>confirm.classList.add('hidden'));el('discard').addEventListener('click',()=>{confirm.classList.add('hidden');leaveEditor()});el('menuButton').addEventListener('click',openMenu);el('closeMenu').addEventListener('click',closeMenu);document.querySelector('[data-close-menu]').addEventListener('click',closeMenu);
el('cancelDelete').addEventListener('click',()=>{pendingDelete=null;el('deleteConfirm').classList.add('hidden')});el('acceptDelete').addEventListener('click',removeEntry);el('backupButton').addEventListener('click',backup);el('restoreButton').addEventListener('click',()=>el('restoreFile').click());el('restoreFile').addEventListener('change',e=>chooseRestore(e.target.files[0]));el('cancelRestore').addEventListener('click',()=>{pendingRestore=null;el('restoreConfirm').classList.add('hidden')});el('acceptRestore').addEventListener('click',restore);
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!el('restoreConfirm').classList.contains('hidden')){pendingRestore=null;el('restoreConfirm').classList.add('hidden')}else if(!el('deleteConfirm').classList.contains('hidden')){pendingDelete=null;el('deleteConfirm').classList.add('hidden')}else if(!confirm.classList.contains('hidden'))return;else if(!menu.classList.contains('hidden'))closeMenu();else if(!editor.classList.contains('hidden'))requestClose()});
window.addEventListener('beforeunload',e=>{if(!editor.classList.contains('hidden')&&body.value.trim()){e.preventDefault();e.returnValue=''}});
(async()=>{try{db=await openDB();await render();queueAutoComments();/* PWA service worker registered separately */}catch(e){el('entryList').textContent='日記の保存領域を開けませんでした。ブラウザの設定を確認してください。';el('newButton').disabled=true;showToast('保存領域を利用できません。')}})();
