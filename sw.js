const CACHE='bb-daily-v3.1.0';
const ASSETS=["./","./index.html","./styles.css","./app.js","./questions.js","./knowledge.js","./manifest.webmanifest","./icon-192.png","./icon-512.png","./figures/T2-027.png","./figures/T2-030.png","./figures/T2-032.png","./figures/T2-035.png","./figures/T2-042.png","./figures/T2-050.png","./figures/T2-059.png","./figures/T2-061.png","./figures/T2-067.png","./figures/T2-070.png","./figures/T2-087.png","./figures/T2-102.png","./figures/T2-105.png","./figures/T2-134.png","./figures/T3-023.png","./figures/T3-026.png","./figures/T3-027.png","./figures/T3-030.png","./figures/T3-034.png","./figures/T3-066.png","./figures/T3-075.png","./figures/T3-078.png","./figures/T3-111.png","./figures/T3-140.png","./figures/T3-143.png","./figures/T4-026.png","./figures/T4-034.png","./figures/T4-044.png","./figures/T4-047.png","./figures/T4-066.png","./figures/T4-071.png","./figures/T4-075.png","./figures/T4-088.png","./figures/T4-111.png","./figures/T4-113.png","./figures/T4-119.png","./figures/T4-137.png","./figures/T4-140.png","./figures/T5-046.png","./figures/T5-055.png","./figures/T5-087.png","./figures/T5-088.png","./figures/T5-098.png","./figures/T5-113.png","./figures/T5-116.png","./figures/T5-117.png","./figures/T5-120.png","./figures/T5-121.png","./figures/T5-122.png","./figures/T5-123.png","./figures/T5-130.png"];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;
  }).catch(()=>caches.match('./index.html'))));
});
