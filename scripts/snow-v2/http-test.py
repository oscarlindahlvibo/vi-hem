"""Optional real PostgREST/API-gate tests. Fixed disposable localhost destination only."""
import base64,hashlib,hmac,json,time,urllib.request,urllib.error,subprocess
assert subprocess.check_output(['docker','inspect','-f','{{index .Config.Labels "vihem.task"}}','vihem-snow-v2-rest'],text=True).strip()=='snow-v2'
SECRET=b'snow-local-test-secret-at-least-32-characters'
def token(user):
 def enc(v):return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=')
 unsigned=enc({'alg':'HS256','typ':'JWT'})+b'.'+enc({'role':'authenticated','sub':user,'exp':int(time.time())+300})
 return (unsigned+b'.'+base64.urlsafe_b64encode(hmac.new(SECRET,unsigned,hashlib.sha256).digest()).rstrip(b'=')).decode()
def request(user,path,data=None):
 headers={'Authorization':'Bearer '+token(user),'Content-Type':'application/json'}
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:55450/'+path,data=json.dumps(data).encode() if data is not None else None,headers=headers),timeout=10) as r:return r.status,r.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
user='10000000-0000-0000-0000-000000000007';org='20000000-0000-0000-0000-000000000001'
status,body=request(user,'rpc/vihem_snow_board',{'p_from':time.strftime('%Y-%m-%d'),'p_days':7});assert status==200,(status,body)
assert json.loads(body)['admin']==False
status,body=request(user,'vihem_finance_customers?select=id');assert status in (401,403),(status,body)
status,body=request(user,'rpc/vihem_snow_command',{'p_id':'99000000-0000-0000-0000-000000000001','p_action':'resource','p_data':{'name':'Forbidden'}});assert status==403,(status,body)
status,body=request(user,'vihem_push_tokens',{'user_id':user,'organisation_id':org,'platform':'ios','token':'disposable-qa-token','active':True});assert status in (200,201),(status,body)
status,body=request(user,'vihem_push_tokens',{'user_id':'10000000-0000-0000-0000-000000000001','organisation_id':org,'platform':'ios','token':'disposable-wrong-owner','active':True});assert status==403,(status,body)
print('PASS: real HTTP JWT + pre-request gate, snow-only board, forbidden finance/admin, own native push token allowed, foreign token denied')
