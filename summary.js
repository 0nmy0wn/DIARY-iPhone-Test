'use strict';
/* v0.4.0 test: daily summaries, local storage and opt-in Gemini calls. */
(()=>{
 const STORE_NAME='dailySummaries', CONSENT='diary-summary-consent-v1';
 const $=id=>document.getElementById(id);
 let generating=false;
 const jpDay=iso=>{
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
   const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
   const d=new Date(`${p.year}-${p.month}-${p.day}T12:00:00+09:00`);
   if(Number(p.hour)<3)d.setUTCDate(d.getUTCDate()-1);
   return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 };
 const localTime=iso=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
 const todayKey=()=>jpDay(new Date().toISOString());
 function allSummaries(){return new Promise((ok,fail)=>{const t=db.transaction(STORE_NAME,'readonly'),r=t.objectStore(STORE_NAME).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error)})}
 function saveSummary(value){return new Promise((ok,fail)=>{const t=db.transaction(STORE_NAME,'readwrite');t.objectStore(STORE_NAME).put(value);t.oncomplete=ok;t.onerror=()=>fail(t.error);t.onabort=()=>fail(t.error)})}
 function sourceHash(entries){return entries.map(e=>`${e.id}:${e.createdAt}:${e.body}`).join('\u001f')}
 function makeCard(item, dayLabelText){
   const article=document.createElement('article');article.className='summary-card';
   const h=document.createElement('h3');h.textContent='この日の振り返り（AI自動生成）';
   const p=document.createElement('p');p.textContent=item.text;
   article.append(h,p);return article;
 }
 async function renderSummaries(){if(db)await render()}
 async function generatePending(all=false){
   if(generating||!db)return;
   const status=$('summaryStatus');
   if(!navigator.onLine){status.textContent='オフラインのため生成できません。';return}
   if(!authToken){status.textContent='AIログインが必要です。';return}
   if(localStorage.getItem(CONSENT)!=='yes'){status.textContent='先に自動まとめを有効にしてください。';return}
   generating=true;const button=$('summaryGenerate');button.disabled=true;
   try{
     status.textContent='未生成の日付を確認しています…';
     const entries=await readAll(), summaries=await allSummaries(), existing=new Set(summaries.map(x=>x.day));
     const groups=new Map();for(const e of entries){if(typeof e.body!=='string'||!e.body.trim())continue;const day=jpDay(e.createdAt);if(day>=todayKey()||existing.has(day))continue;if(!groups.has(day))groups.set(day,[]);groups.get(day).push(e)}
     const days=[...groups.keys()].sort();if(!all)days.reverse();
     if(!days.length){status.textContent='未生成の「1日の振り返り」はありません。';return}
     let completed=0;
     for(const day of (all?days:days.slice(0,1))){
       if(all&&localStorage.getItem(CONSENT)!=='yes'){status.textContent=`${completed}日分を保存しました。自動まとめがオフになったため停止しました。`;return}
       status.textContent=all?`${days.length}日分のうち${completed+1}日目を生成中…`:`${day} の振り返りを生成中…`;
       const group=groups.get(day).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
       const requestEntries=group.map(e=>({time:localTime(e.createdAt),text:e.body}));
       let response;
       try{response=await fetch(API_BASE+'/ai/daily-summary',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},body:JSON.stringify({day,entries:requestEntries})})}
       catch(e){throw Error('ネットワークエラー')}
       if(response.status===401){status.textContent=`${completed}日分を保存しました。AIへの再ログインが必要です。`;return}
       const data=await response.json();if(!response.ok||typeof data.summary!=='string'||!data.summary.trim())throw Error(data.error||'AI応答エラー');
       if(!(await allSummaries()).some(x=>x.day===day)){
         await saveSummary({day,text:data.summary.trim(),sourceEntryIds:group.map(e=>e.id),sourceSnapshot:sourceHash(group),createdAt:new Date().toISOString(),provider:'gemini',mode:'automatic'});
         completed++;await renderSummaries();
       }
     }
     status.textContent=`${completed}日分の「1日の振り返り」を作成しました。`;
   }catch(e){console.error('daily summary:',e);status.textContent='途中で生成を停止しました。保存済みの振り返りは残っています。未生成分は再実行できます。'}finally{generating=false;button.disabled=false}
 }
 async function init(){if(!db)return;await renderSummaries();const toggle=$('summaryConsent');toggle.checked=localStorage.getItem(CONSENT)==='yes';toggle.addEventListener('change',()=>{localStorage.setItem(CONSENT,toggle.checked?'yes':'no');$('summaryStatus').textContent=toggle.checked?'自動まとめ：オン（過去日をアプリ起動時に生成）':'自動まとめ：オフ';if(toggle.checked)void generatePending()});$('summaryGenerate').addEventListener('click',()=>void generatePending(true));if(toggle.checked)void generatePending()}
 window.DiarySummary={init,allSummaries,saveSummary,renderSummaries,generatePending,makeCard,dayForEntry:jpDay};
})();
