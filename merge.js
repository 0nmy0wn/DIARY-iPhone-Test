'use strict';
/* Pure validation and merge rules, shared by browser and Node tests. */
(function(root){
function validEntry(e){return e && typeof e==='object' && !Array.isArray(e) && typeof e.id==='string' && e.id.length>0 && e.id.length<=200 && typeof e.body==='string' && e.body.length>0 && e.body.length<=100000 && typeof e.createdAt==='string' && Number.isFinite(Date.parse(e.createdAt));}
function validateBackup(data){
 if(!data || typeof data!=='object' || Array.isArray(data) || data.format!=='DIARY_BACKUP' || ![1,2].includes(data.version) || !Array.isArray(data.entries) || data.entries.length>50000)throw Error('対応していないバックアップ形式です。');
 if(!data.entries.every(validEntry))throw Error('バックアップに不正な日記データがあります。');
 return data.entries.map(e=>({id:e.id,originId:typeof e.originId==='string'?e.originId:e.id,createdAt:e.createdAt,body:e.body,schemaVersion:e.aiEligible===true&&data.version===2?2:1,aiEligible:e.aiEligible===true&&data.version===2}));
}
function validateComments(data){if(data.version===1)return [];if(!Array.isArray(data.aiComments)||data.aiComments.length>50000)throw Error('AIコメント形式が不正です。');const ids=new Set(data.entries.map(e=>e.id));if(!data.aiComments.every(c=>c&&typeof c.entryId==='string'&&ids.has(c.entryId)&&typeof c.text==='string'&&c.text.length>0&&c.text.length<=10000))throw Error('AIコメントの関連付けが不正です。');return data.aiComments.map(c=>({entryId:c.entryId,id:String(c.id||''),text:c.text,createdAt:String(c.createdAt||''),provider:String(c.provider||'unknown'),requestId:String(c.requestId||'')}))}
function mergeEntries(current,incoming,newId){
 const used=new Map(current.map(e=>[e.id,e]));const additions=[];let skipped=0,renamed=0;
 for(const entry of incoming){
  const found=used.get(entry.id);
  if(found && found.body===entry.body){skipped++;continue;}
  if(found){let id;do{id=newId()}while(used.has(id));const copy={...entry,id,originId:entry.originId||entry.id};used.set(id,copy);additions.push(copy);renamed++;}
  else{const copy={...entry};used.set(copy.id,copy);additions.push(copy);}
 }
 return {additions,skipped,renamed};
}
root.DiaryMerge={validateBackup,validateComments,mergeEntries};
if(typeof module!=='undefined')module.exports=root.DiaryMerge;
})(typeof globalThis!=='undefined'?globalThis:this);
