import crypto from 'node:crypto'; import dotenv from 'dotenv'; dotenv.config({ path: '/Users/jonparis/Documents/mycode/astrid-dev/astrid-web/.env.local' });
const KID=process.env.APPLE_ASC_KEY_ID,ISS=process.env.APPLE_ASC_ISSUER_ID,pem=process.env.APPLE_ASC_PRIVATE_KEY;
const b=x=>Buffer.from(x).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const mkjwt=()=>{const n=Math.floor(Date.now()/1000);const si=b(JSON.stringify({alg:'ES256',kid:KID,typ:'JWT'}))+'.'+b(JSON.stringify({iss:ISS,iat:n,exp:n+1200,aud:'appstoreconnect-v1'}));return si+'.'+b(crypto.sign('sha256',Buffer.from(si),{key:pem,dsaEncoding:'ieee-p1363'}));};
const g=async p=>(await (await fetch('https://api.appstoreconnect.apple.com'+p,{headers:{Authorization:`Bearer ${mkjwt()}`}})).json());
const sleep=ms=>new Promise(x=>setTimeout(x,ms));
for(let i=0;i<32;i++){
  const runs=await g('/v1/ciWorkflows/88430811-6F76-4F4A-AF2D-D9E8C0DCBA9D/buildRuns?limit=1&sort=-number&fields[ciBuildRuns]=number,executionProgress,completionStatus,sourceCommit');
  const r=runs.data?.[0]; const a=r.attributes;
  if(a.executionProgress==='COMPLETE' && (a.sourceCommit?.commitSha||'').startsWith('3b9d5e0')){
    console.log('#'+a.number+' (3b9d5e0: outbox kinds + apple auto-sync + avatar rect) => '+a.completionStatus);
    const acts=await g('/v1/ciBuildRuns/'+r.id+'/actions');for(const ac of (acts.data||[]))console.log('  ['+ac.attributes.actionType+'] '+ac.attributes.completionStatus);
    process.exit(0);
  }
  await sleep(120000);
}
console.log('timeout');
