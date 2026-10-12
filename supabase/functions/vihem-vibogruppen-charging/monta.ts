export type Point={label:string;status:'available'|'busy'|'unavailable'|'unknown';maxKw:number|null};
export type Snapshot={status:'ok'|'unavailable';checkedAt:string|null;points:Point[]};
const base='https://public-api.monta.com/api/v1';
export function publicPoint(input:unknown,id:string,index:number):Point {
 const p=input as Record<string,unknown>;
 if(!p||String(p.id)!==id||p.visibility!=='public')throw Error('Unexpected charge point');
 const state=typeof p.state==='string'?p.state:'';
 return {label:`Laddpunkt ${index+1}`,status:state==='available'?'available':state.startsWith('busy')?'busy':['error','disconnected','passive'].includes(state)?'unavailable':'unknown',maxKw:typeof p.maxKw==='number'&&Number.isFinite(p.maxKw)&&p.maxKw>0?p.maxKw:null};
}
export function makeReader(config:{clientId:string;clientSecret:string;ids:string[]},fetcher:typeof fetch=fetch,now=()=>Date.now()) {
 let token='',refresh='',expires=0;let cache:Snapshot={status:'unavailable',checkedAt:null,points:[]};let next=0;let pending:Promise<Snapshot>|null=null;
 async function api(path:string,body?:unknown,authenticated=false):Promise<Record<string,unknown>> {
  const r=await fetcher(base+path,{method:body?'POST':'GET',headers:{'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{}),...(authenticated?{'Authorization':`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!r.ok){if(r.status===401)expires=0;throw Error('Monta request failed');}
  return await r.json();
 }
 async function authenticate(){
  if(token&&now()<expires-60000)return;
  let data:Record<string,unknown>;
  try {if(!refresh)throw Error('No refresh token');data=await api('/auth/refresh',{refreshToken:refresh});}
  catch {data=await api('/auth/token',{clientId:config.clientId,clientSecret:config.clientSecret});}
  const end=Date.parse(String(data.accessTokenExpirationDate));
  if(typeof data.accessToken!=='string'||!data.accessToken||!Number.isFinite(end)||end<=now())throw Error('Invalid token');
  token=data.accessToken;refresh=typeof data.refreshToken==='string'?data.refreshToken:'';expires=end;
 }
 async function load():Promise<Snapshot>{
  try {
   if(!config.clientId||!config.clientSecret||!config.ids.length||config.ids.length>10||new Set(config.ids).size!==config.ids.length||config.ids.some(id=>!/^\d{1,16}$/.test(id)))throw Error('Missing configuration');
   await authenticate();
   const points=await Promise.all(config.ids.map(async(id,i)=>publicPoint(await api('/charge-points/'+id,undefined,true),id,i)));
   cache={status:'ok',checkedAt:new Date(now()).toISOString(),points};next=now()+60000;
  }catch {cache={status:'unavailable',checkedAt:null,points:[]};next=now()+30000;}
  return cache;
 }
 return ()=>{
  if(now()<next)return Promise.resolve(cache);
  if(pending)return pending;
  pending=load().finally(()=>{pending=null;});return pending;
 };
}
