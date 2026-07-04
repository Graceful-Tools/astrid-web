import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
const T=process.env.VERCEL_API_TOKEN||process.env.VERCEL_TOKEN;
const TEAM='team_gFxp7fWaX7e8tUPt8Vt3YXl0', PROJ='prj_MUWxfWJ9lIZOi2clHPZhlHsYqSiy';
const h={Authorization:`Bearer ${T}`};
// latest prod deployment
const dr=await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJ}&teamId=${TEAM}&limit=1&target=production&state=READY`,{headers:h});
const dep=(await dr.json()).deployments?.[0];
console.log('deployment:', dep?.uid, new Date(dep?.created).toISOString());
// runtime logs (last window)
const lr=await fetch(`https://api.vercel.com/v1/projects/${PROJ}/deployments/${dep.uid}/runtime-logs?teamId=${TEAM}`,{headers:h});
console.log('runtime-logs status:', lr.status);
if(lr.ok){
  const text=await lr.text();
  const lines=text.trim().split('\n').filter(Boolean);
  console.log('log lines:', lines.length);
  let shown=0;
  for(const ln of lines){
    try{ const j=JSON.parse(ln);
      const msg=(j.message||'').slice(0,160);
      const path=j.requestPath||j.proxy?.path||'';
      const status=j.responseStatusCode||j.proxy?.statusCode;
      if((status>=400) || /error|fail|Idempoten/i.test(msg)){
        console.log(`[${j.timestampInMs?new Date(j.timestampInMs).toISOString():'?'}] ${status||''} ${path} :: ${msg}`);
        if(++shown>30) break;
      }
    }catch{}
  }
  if(!shown) console.log('(no 4xx/5xx/error lines in available window)');
} else { console.log(await lr.text().then(t=>t.slice(0,200))); }
