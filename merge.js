'use strict';
/* Pure validation and merge rules, shared by browser and Node tests. */
(function(root){
function validEntry(e){return e && typeof e==='object' && !Array.isArray(e) && typeof e.id==='string' && e.id.length>0 && e.id.length<=200 && typeof e.body==='string' && e.body.length>0 && e.body.length<=100000 && typeof e.createdAt==='string' && Number.isFinite(Date.parse(e.createdAt));}
function validateBackup(data){
 if(!data || typeof data!=='object' || Array.isArray(data) || data.format!=='DIARY_BACKUP' || data.version!==1 || !Array.isArray(data.entries) || data.entries.length>50000)throw Error('対応していないバックアップ形式です。');
 if(!data.entries.every(validEntry))throw Error('バックアップに不正な日記データがあります。');
 return data.entries.map(e=>({id:e.id,originId:typeof e.originId==='string'?e.originId:e.id,createdAt:e.createdAt,body:e.body,schemaVersion:1}));
}
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
root.DiaryMerge={validateBackup,mergeEntries};
if(typeof module!=='undefined')module.exports=root.DiaryMerge;
})(typeof globalThis!=='undefined'?globalThis:this);
