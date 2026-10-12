import sys,json,uuid,urllib.request,urllib.error,concurrent.futures
c=json.load(sys.stdin);base='http://127.0.0.1:18880'
def request(path,body,token=None,origin=None):
 h={'apikey':c['anon'],'Content-Type':'application/json','Authorization':'Bearer '+(token or c['anon'])}
 if origin:h['Origin']=origin
 try:
  r=urllib.request.urlopen(urllib.request.Request(base+path,json.dumps(body).encode(),h),timeout=30);raw=r.read();return r.status,json.loads(raw) if raw else None
 except urllib.error.HTTPError as e:
  raw=e.read()
  try:return e.code,json.loads(raw)
  except:return e.code,None
def rpc(name,args={},token=None):return request('/rest/v1/rpc/'+name,args,token)
tokens={}
for key in ['oscar','christofer','tenant','outsider']:
 s,d=request('/auth/v1/token?grant_type=password',{'email':c['users'][key]['email'],'password':c['user_password']});assert s==200;tokens[key]=d['access_token']
s,public=rpc('vihem_vibogruppen_public_site');assert s==200 and public['heroTitle'] and 'enquiries' not in public
assert rpc('vihem_vibogruppen_admin_site')[0] in [401,403]
for role in ['christofer','tenant','outsider']:assert rpc('vihem_vibogruppen_admin_site',{},tokens[role])[0]==403
s,admin=rpc('vihem_vibogruppen_admin_site',{},tokens['oscar']);assert s==200,(s,admin)
bad={**admin['content'],'businesses':[{'id':'bad','name':'Bad','url':'javascript:alert(1)','tagline':'','description':'','visible':True}]}
assert rpc('vihem_vibogruppen_save_content',{'p_content':bad,'p_revision':admin['revision']},tokens['oscar'])[0]>=400
assert rpc('vihem_vibogruppen_save_content',{'p_content':{},'p_revision':admin['revision']},tokens['oscar'])[0]>=400
args={'p_content':admin['content'],'p_revision':admin['revision']}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:res=list(pool.map(lambda _:rpc('vihem_vibogruppen_save_content',args,tokens['oscar']),range(2)))
assert sorted(s for s,d in res)==[200,409],res
print('PASS anonymous public content, private enquiries, admin/staff/tenant/foreign roles, content validation and optimistic concurrent save')
endpoint='/functions/v1/vihem-vibogruppen-contact';origin='https://vibogruppen.se';operation=str(uuid.uuid4());email='portal-qa-'+operation+'@example.invalid';payload={'name':'QA Åsa Öberg','email':email,'phone':'','company':'QA','subject':'vibo-charge','message':'QA contact to VI-HEM','website':''};body={'operation_id':operation,'payload':payload}
assert request(endpoint,body,origin='https://attacker.example')[0]==403
assert request(endpoint,{**body,'payload':{}},origin=origin)[0]==400
assert request(endpoint,{**body,'payload':{**payload,'website':'bot'}},origin=origin)[0]==201
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:res=list(pool.map(lambda _:request(endpoint,body,origin=origin),range(2)))
assert [s for s,d in res]==[201,201],res
s,admin=rpc('vihem_vibogruppen_admin_site',{},tokens['oscar']);entry=[e for e in admin['enquiries'] if e['id']==operation];assert len(entry)==1 and entry[0]['payload']['message']==payload['message']
assert request(endpoint,{**body,'payload':{**payload,'message':'different'}},origin=origin)[0]==503
for _ in range(4):assert request(endpoint,{**body,'operation_id':str(uuid.uuid4())},origin=origin)[0]==201
assert request(endpoint,{**body,'operation_id':str(uuid.uuid4())},origin=origin)[0]==429
assert rpc('vihem_vibogruppen_store_enquiry',{'p_id':str(uuid.uuid4()),'p_payload':payload,'p_fingerprint':'a'*64})[0] in [401,403]
e=entry[0];args={'p_id':e['id'],'p_status':'in_progress','p_updated_at':e['updated_at']}
assert rpc('vihem_vibogruppen_update_enquiry',args,tokens['tenant'])[0]==403
assert rpc('vihem_vibogruppen_update_enquiry',args,tokens['oscar'])[0] in [200,204]
assert rpc('vihem_vibogruppen_update_enquiry',args,tokens['oscar'])[0]==409
s,d=rpc('vihem_vibogruppen_admin_site',{},tokens['oscar']);assert next(e for e in d['enquiries'] if e['id']==operation)['status']=='in_progress'
print('PASS real QA Edge contact -> database -> admin inbox; origin/validation/honeypot; concurrent retry one record; rate limit; secure status update and stale rejection. No external mail sent.')
