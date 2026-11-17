const dklpoDbPool_ = new Map();
function dklpoOpenDb_(name, version, stores) {
  const key = name + ':' + version;
  const existing = dklpoDbPool_.get(key);
  if (existing) return existing.promise;
  const entry = {db:null, promise:null};
  entry.promise = new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      if (dklpoDbPool_.get(key) === entry) dklpoDbPool_.delete(key);
      reject(error || new Error('IndexedDB unavailable'));
    };
    let request;
    try { request = indexedDB.open(name, version); } catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [store, keyPath] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, keyPath ? {keyPath} : undefined);
        }
      }
    };
    request.onblocked = () => fail(new Error('IndexedDB upgrade blocked. Tutup tab portal lama dan cuba lagi.'));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      entry.db = db;
      const forget = () => { if (dklpoDbPool_.get(key) === entry) dklpoDbPool_.delete(key); };
      db.onversionchange = () => { db.close(); forget(); };
      db.onclose = forget;
      resolve(db);
    };
  });
  dklpoDbPool_.set(key, entry);
  entry.promise.catch(() => { if (dklpoDbPool_.get(key) === entry) dklpoDbPool_.delete(key); });
  return entry.promise;
}
function dklpoDbRequest_(db, store, mode, method, value, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const target = tx.objectStore(store);
    const request = method === 'getAll' ? target.getAll()
      : method === 'put' && key !== undefined ? target.put(value, key)
      : target[method](value);
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || request.error || new Error('IndexedDB transaction aborted'));
  });
}

const CACHE_PREFIX = 'kkpas-pic-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE_NAME = CACHE_PREFIX + 'comfort-20261117-ux-2';
const APP_SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(
    APP_SHELL.map(url => cache.add(url))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if(request.headers.has('Authorization')||/^\/(?:api|session|pic-session|client-config)(?:\/|$)/.test(url.pathname)||url.searchParams.has('action'))return;
  if(request.mode!=='navigate'&&!/\.(?:html|css|js|json|png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname))return;
  event.respondWith(fetch(request).then(response => {
    if (response && response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => null));
    }
    return response;
  }).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return await cache.match(new URL('./index.html', self.registration.scope).href)
        || await cache.match(self.registration.scope) || Response.error();
    }
    return Response.error();
  }));
});

const WEB_APP_URL = 'https://dklpo-pic-api.ennedeystudio.workers.dev';  
const DB_NAME = 'kkpas-offline-v1';
const DB_VERSION = 3;
const MAX_SYNC_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60*1000, 5*60*1000, 15*60*1000, 60*60*1000, 6*60*60*1000];

function openDb_() { return dklpoOpenDb_(DB_NAME, DB_VERSION, {drafts:'id',offlineQueue:'id',kv:'key'}); }

async function getAllQueue_(value) { return await dklpoDbRequest_(await openDb_(), 'offlineQueue', 'readonly', 'getAll', value) || []; }
async function putQueue_(value) { return await dklpoDbRequest_(await openDb_(), 'offlineQueue', 'readwrite', 'put', value); }
async function deleteQueue_(value) { return await dklpoDbRequest_(await openDb_(), 'offlineQueue', 'readwrite', 'delete', value); }

function syncError_(message, retryable=true, retryAfterMs=0){
  const err=new Error(String(message||'SYNC_FAILED'));
  err.retryable=!!retryable;
  err.retryAfterMs=Number(retryAfterMs||0);
  return err;
}

async function formPost_(payload){
  const edgeSession=await dklpoBackgroundSession_();
  const params=new URLSearchParams();
  Object.entries(payload||{}).forEach(([k,v])=>params.append(k,typeof v==='object'?JSON.stringify(v):String(v??'')));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);
  let response;
  let text;
  try {
    response = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization':'Bearer '+edgeSession.token },
      body: params,
      signal: controller.signal
    });
    text = await response.text();
  } catch(err) {
    throw syncError_(err && err.message ? err.message : 'NETWORK_ERROR', true);
  } finally {
    clearTimeout(timeoutId);
  }
  let data=null;
  try{data=JSON.parse(text)}catch(_){throw syncError_('NON_JSON_RESPONSE',response.status>=500||response.status===429)}
  if(response.status===401){const e=syncError_('EDGE_AUTH_REQUIRED',true);e.authRequired=true;await broadcast_({type:'DKLPO_EDGE_AUTH_REQUIRED'});throw e;}
  if(data?.ok===false&&/INSPECTOR_AUTH|INSPECTOR_SESSION|TOKEN_EXPIRED|SESSION_EXPIRED/i.test(String(data.error||''))){const e=syncError_(data.error,true);e.authRequired=true;await broadcast_({type:'DKLPO_EDGE_AUTH_REQUIRED'});throw e;}
  if(!response.ok||!data||!data.ok){
    const retryable=(data&&typeof data.retryable==='boolean')?data.retryable:(response.status===429||response.status>=500);
    const retryAfterMs=(data&&data.retryAfterMs)||0;
    throw syncError_((data&&data.error)||('HTTP_'+response.status),retryable,retryAfterMs);
  }
  return data;
}

function isPermanentSyncError_(err){
  if(err&&err.retryable===false)return true;
  const msg=String(err&&err.message?err.message:err||'');
  return /Missing required|Unsupported image|Invalid base64|Empty image|Too many photos|Photo upload incomplete|GPS_(?:OUTSIDE|INVALID|STALE|LOW_INTEGRITY)|Station already inspected|INVALID_SUBMISSION/i.test(msg);
}

function nextRetryAt_(attempts,err){
  const explicit=Number(err&&err.retryAfterMs||0);
  const fallback=RETRY_DELAYS_MS[Math.min(Math.max(0,attempts-1),RETRY_DELAYS_MS.length-1)];
  return new Date(Date.now()+Math.max(explicit,fallback)).toISOString();
}

async function broadcast_(data){
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  clients.forEach(c=>c.postMessage(data));
}


const DKLPO_PIC_ONLY_=true;
/*! © Ennedey 2026. Bounded uploads: preserve order and await in-flight work. */
async function dklpoUploadPool_(items,limit,job){
 const result=new Array(items.length);let cursor=0,failed=null;
 async function worker(){while(!failed){const i=cursor++;if(i>=items.length)return;try{result[i]=await job(items[i],i);}catch(e){if(!failed)failed=e;}}}
 await Promise.all(Array.from({length:Math.min(Math.max(1,Number(limit)||1),2,items.length)},worker));
 if(failed)throw failed;return result;
}
function dklpoUploadTransient_(e){return e?.retryable===true||e?.networkError===true||/RATE_LIMIT|SERVER_BUSY|BACKEND_UNAVAILABLE|GATEWAY_FAILURE|429|timeout|Failed to fetch|NetworkError/i.test(String(e?.message||e?.error||''));}
/*! © Ennedey 2026. Atomic queue ownership and bounded parallel photo uploads. */
async function dklpoSwChange_(id,change){
 const db=await openDb_();let result=null;
 await new Promise((resolve,reject)=>{const tx=db.transaction('offlineQueue','readwrite'),store=tx.objectStore('offlineQueue'),request=store.get(id);
  request.onsuccess=()=>{try{const old=request.result,next=change(old);if(next===false){store.delete(id);result=old;}else if(next){store.put(next);result=next;}}catch(e){reject(e);tx.abort();}};
  tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('QUEUE_WRITE_FAILED'));
 });return result;
}
async function dklpoSwCheckpoint_(record,release=false){
 const saved=await dklpoSwChange_(record.id,row=>row?.owner===record.owner?{...record,owner:release?'':record.owner,leaseUntil:release?0:Date.now()+120000,lastAttemptAt:new Date().toISOString()}:null);
 if(!saved)throw Error('QUEUE_LEASE_LOST');return saved;
}
async function syncOne_(record){
 if(!record||['DEAD_LETTER','EDITING'].includes(record.status)||(DKLPO_PIC_ONLY_&&record.type!=='ADHOC_V13'))return {skipped:true};
 const claimed=await dklpoSwChange_(record.id,row=>{
  if(!row||['DEAD_LETTER','EDITING'].includes(row.status)||Date.parse(row.nextAttemptAt||'')>Date.now())return null;
  if(Number(row.leaseUntil)>Date.now()&&(row.owner||['DIRECT_SENDING','SENDING','SYNCING'].includes(row.status)))return null;
  if(row.status==='SYNCING'&&Date.now()-Date.parse(row.lastAttemptAt||'')<120000)return null;
  return {...row,owner:'SW-'+(self.crypto?.randomUUID?self.crypto.randomUUID():Date.now()+'-'+Math.random()),leaseUntil:Date.now()+120000,status:'SYNCING',attempts:Number(row.attempts||0)+1,lastAttemptAt:new Date().toISOString(),nextAttemptAt:''};
 });
 if(!claimed)return {skipped:true,retry:true};Object.assign(record,claimed);
 let lost=false,writes=Promise.resolve(),done=0;
 const checkpoint=()=>{writes=writes.then(()=>dklpoSwCheckpoint_(record));return writes;};
 const heartbeat=setInterval(()=>{dklpoSwChange_(record.id,row=>row?.owner===record.owner?{...row,leaseUntil:Date.now()+120000,lastAttemptAt:new Date().toISOString()}:null).then(r=>{if(!r)lost=true;}).catch(()=>{});},15000);
 const progress=(phase,total)=>(broadcast_({type:'DKLPO_UPLOAD_PROGRESS',id:record.id,phase,done,total}));
 try{
  const photos=Array.isArray(record.photos)?record.photos:[],map={...(record.uploadedPhotoMap||{})},adhoc=record.type==='ADHOC_V13',p=record.payload||{};
  await progress('uploading',photos.length);
  let uploaded;
  try{uploaded=await dklpoUploadPool_(photos,record.uploadConcurrency===1?1:2,async(ph,i)=>{
   if(lost)throw Error('QUEUE_LEASE_LOST');
   const stable=String(ph?.id??'legacy-'+(i+1)).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70),key=adhoc?record.id+'-ADHOC-'+(i+1):record.id+'-PHOTO-'+stable;
   let receipt=map[key];if(!receipt&&!record.uploadedPhotoMap&&!adhoc)receipt=record.uploadedPhotoUrls?.[i];
   if(!receipt||(adhoc?!receipt.fileId:!receipt.url)){
    const req=adhoc?{action:'uploadAdhocFindingPhoto',reporterName:p.reporterName,station:p.station,month:p.month||['January','February','March','April','May','June','July','August','September','October','November','December'][new Date(record.createdAt||Date.now()).getMonth()],index:i+1,base64:ph.data,comment:ph.comment||'',uploadKey:key}:{action:'uploadPhoto',teamCode:p.teamCode,inspectorAuth:p.inspectorAuth||p.inspectorToken||'',checklistVersion:p.checklistVersion||'',uploadKey:key,month:p.month,station:p.station,inspectorName:p.inspectorName,base64:ph.data,comment:ph.comment||'',index:i+1,filename:ph.filename||`photo_${i+1}.jpg`};
    const r=await formPost_(req);if(adhoc?!r?.fileId:!r?.url)throw syncError_('UPLOAD_RECEIPT_MISSING',true);
    receipt={url:r.url||'',fileId:r.fileId||'',resourceKey:r.resourceKey||''};map[key]=receipt;record.uploadedPhotoMap=map;await checkpoint();
   }
   done++;await progress('uploading',photos.length);
   return adhoc?{fileId:receipt.fileId,comment:ph.comment||''}:{...receipt,comment:ph.comment||'',findingKey:ph.findingKey||'',index:i+1,reviewAnalysis:ph.reviewAnalysis||null,reviewAccepted:ph.reviewAccepted||null,reviewedAt:ph.reviewedAt||''};
  });await writes;}catch(e){if(dklpoUploadTransient_(e)){record.uploadConcurrency=1;await checkpoint().catch(()=>{});}throw e;}
  if(lost)throw Error('QUEUE_LEASE_LOST');await progress('submitting',photos.length);
  record.uploadedPhotoUrls=uploaded;await checkpoint();
  const payload=adhoc?{...p,issueAction:p.issueAction||p.action||'',action:'submitAdhocFinding',photos:JSON.stringify(uploaded)}:{...p,action:'submitInspection',clientSubmissionId:p.clientSubmissionId||record.id,offlineQueuedAt:record.createdAt||'',syncAttempt:record.attempts,checklist:typeof p.checklist==='string'?p.checklist:JSON.stringify(p.checklist||[]),photos:JSON.stringify(uploaded),findings:typeof p.findings==='string'?p.findings:JSON.stringify(p.findings||[])};
  const result=await formPost_(payload);if(adhoc?!result?.findingId:!result?.id)throw syncError_('SUBMISSION_RECEIPT_MISSING',true);
  const removed=await dklpoSwChange_(record.id,row=>row?.owner===record.owner?false:null);if(!removed)throw Error('QUEUE_LEASE_LOST');
  await progress('success',photos.length);await broadcast_({type:adhoc?'KKPAS_ADHOC_SYNC_SUCCESS':'KKPAS_SYNC_SUCCESS',station:p.station,id:result.id||'',clientSubmissionId:record.id,findingId:result.findingId||''});
  try{await self.registration.showNotification(adhoc?'Laporan NCR/CAR/PAR Berjaya':'KKPAS Sync Berjaya',{body:p.station+' • '+(result.id||result.findingId||'')+(adhoc?'':' — Pemeriksaan diterima sistem. Semak status terkini di ennedey.app/view_laporan_pemeriksaan. Kata laluan Viewer: Dklpo1234'),tag:'dklpo-'+record.id,data:{url:adhoc?'./':'https://ennedey.app/view_laporan_pemeriksaan'}});}catch(_){}
  return {ok:true};
 }catch(e){await progress(e.retryable===false?'review':'pending',(record.photos||[]).length);throw e;}
 finally{clearInterval(heartbeat);}
}
async function syncAdhocV13_(record){return syncOne_(record);}

async function processQueue_(){
  const rows=(await getAllQueue_()).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  let synced=0,failed=0,dead=0,skipped=0,needsRetry=false;
  for(const row of rows){
    if(row?.type!=='ADHOC_V13'){skipped++;continue;}
    if(!row||['DEAD_LETTER','EDITING'].includes(row.status)){dead++;continue;}
    if(row.nextAttemptAt&&new Date(row.nextAttemptAt).getTime()>Date.now()){skipped++;needsRetry=true;continue;}
    if(row.status==='DIRECT_SENDING'&&Number(row.leaseUntil||0)>Date.now()){
      skipped++;needsRetry=true;continue;
    }
    const previousAttempts=Number(row.attempts||0);
    try{
      const result=await syncOne_(row);
      if(result&&result.ok)synced++;else {skipped++;if(result?.retry)needsRetry=true;}
    }catch(e){
      if(e.message==='QUEUE_LEASE_LOST'){skipped++;needsRetry=true;continue;}
      if(e.authRequired){row.attempts=previousAttempts;row.status='AUTH_REQUIRED';row.nextAttemptAt='';row.lastError=String(e.message);await dklpoSwCheckpoint_(row,true);skipped++;needsRetry=true;continue;}
      failed++;
      row.lastError=String(e&&e.message?e.message:e);
      row.lastErrorAt=new Date().toISOString();
      const permanent=isPermanentSyncError_(e);
      if(permanent||Number(row.attempts||0)>=MAX_SYNC_ATTEMPTS){
        row.status='DEAD_LETTER';
        row.nextAttemptAt='';
        row.deadLetterAt=new Date().toISOString();
        await dklpoSwCheckpoint_(row,true);
        await broadcast_({type:'KKPAS_SYNC_DEAD_LETTER',station:row.payload&&row.payload.station,stationKey:row.stationKey||'',error:row.lastError,attempts:row.attempts});
        try{await self.registration.showNotification('KKPAS Sync Perlu Tindakan',{body:`${row.payload&&row.payload.station||'Pemeriksaan'} gagal dihantar selepas ${row.attempts} percubaan. Buka KKPAS untuk semakan.`,icon:'https://arleta.site/interactivelink/3333/DKLPO_Master_192.png',tag:'kkpas-dead-'+row.id,data:{url:'./'}})}catch(_){ }
        dead++;
      }else{
        row.status='QUEUED';
        row.nextAttemptAt=nextRetryAt_(Number(row.attempts||0),e);
        await dklpoSwCheckpoint_(row,true);
        await broadcast_({type:'KKPAS_SYNC_ERROR',station:row.payload&&row.payload.station,error:row.lastError,attempts:row.attempts,nextAttemptAt:row.nextAttemptAt});
        needsRetry=true;
      }
       
    }
  }
  const summary={synced,failed,dead,skipped};
   
   
  if(needsRetry){const err=new Error('KKPAS_QUEUE_RETRY_PENDING');err.summary=summary;throw err;}
  return summary;
}

let queueSyncPromise_=null;
function runQueueOnce_(){
  if(queueSyncPromise_)return queueSyncPromise_;
  queueSyncPromise_=processQueue_().finally(()=>{queueSyncPromise_=null});
  return queueSyncPromise_;
}
self.addEventListener('sync',event=>{if(event.tag==='kkpas-offline-sync')event.waitUntil(runQueueOnce_())});
self.addEventListener('message',event=>{
  const d=event.data||{};
  if(d.type==='SYNC_KKPAS_QUEUE') event.waitUntil(runQueueOnce_().catch(()=>null));
  if(d.type==='SHOW_NOTIFICATION'&&d.title) event.waitUntil(self.registration.showNotification(d.title,d.options||{}));
});

async function getReminder_(){
  return formPost_({action:'getNotificationCentre'});
}

async function showMonthEndReminder_(){
  const data=await getReminder_();
  const r=data&&data.reminder;
  if(!r||!r.active||!Array.isArray(r.pendingTeams)||!r.pendingTeams.length)return;
  const pendingLines=r.pendingTeams.map(p=>`${p.teamCode||p.teamName||'-'}: ${(p.stations||[]).join(', ')||p.station||'-'}`);
  await self.registration.showNotification('KKPAS Monthly Inspection',{body:pendingLines.join(' | '),icon:'https://arleta.site/interactivelink/3333/DKLPO_Master_192.png',badge:'https://arleta.site/interactivelink/3333/DKLPO_Master_192.png',tag:'kkpas-month-end-'+String(r.dateKey||''),renotify:false,data:{url:'./'}});
}

self.addEventListener('periodicsync',event=>{if(event.tag==='kkpas-month-end-reminder')event.waitUntil(showMonthEndReminder_().catch(()=>null))});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=event.notification.data?.url==='https://ennedey.app/view_laporan_pemeriksaan'?'https://ennedey.app/view_laporan_pemeriksaan':'./';event.waitUntil(target==='./'?self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus'in c)return c.focus()}return self.clients.openWindow('./')}):self.clients.openWindow(target));});

async function dklpoBackgroundSession_(){
  const session = (await dklpoDbRequest_(await openDb_(), 'kv', 'readonly', 'get', 'dklpo_edge_background_v1'))?.session || null;
  if(!session?.token||Number(session.expiresAt)<=Date.now()+5000){
    const error=syncError_('EDGE_AUTH_REQUIRED: Buka portal untuk memperbaharui sesi.',true);error.authRequired=true;
    await broadcast_({type:'DKLPO_EDGE_AUTH_REQUIRED'});throw error;
  }return session;
}
self.addEventListener('message',event=>{
  if(event.data?.type!=='DKLPO_EDGE_BACKGROUND_SESSION')return;
   
  const session=event.data.session;if(!session?.token||!Number.isFinite(Number(session.expiresAt)))return;
  event.waitUntil((async()=>{await dklpoDbRequest_(await openDb_(), 'kv', 'readwrite', 'put', {key:'dklpo_edge_background_v1',session});await runQueueOnce_().catch(()=>null);})());
});

self.addEventListener('message',event=>{
 if(event.data?.type!=='DKLPO_SAFE_UPDATE')return;
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const blocked=()=>Promise.all(clients.map(c=>c.postMessage({type:'DKLPO_UPDATE_BLOCKED'})));
  try{
   if((await getAllQueue_()).length)return blocked();
   const results=await Promise.all(clients.map(client=>new Promise(resolve=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(false);},2500);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.safe===true);};
    client.postMessage({type:'DKLPO_UPDATE_PROBE'},[channel.port2]);
   })));
   if(!results.length||results.some(v=>!v)||(await getAllQueue_()).length)return blocked();
   await self.skipWaiting();
  }catch{await blocked();}
 })());
});
