#!/usr/bin/env python3
"""Read public site and send an invalid form request. Never create an enquiry."""
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import json,re
values={}
for line in Path('/home/vibo/barorder/.env').read_text().splitlines():
    m=re.match(r'^\s*(?:export\s+)?(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|VITE_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*)\s*$',line)
    if m: values[m[1]]=m[2].strip().strip('\"\'')
url=values.get('VITE_SUPABASE_URL','').rstrip('/')
key=values.get('VITE_SUPABASE_ANON_KEY') or values.get('VITE_SUPABASE_PUBLISHABLE_KEY')
if url!='https://supabase.asedatruckmeet.se' or not key: raise SystemExit('Expected shared Supabase URL/public key not found')
headers={'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key,'Origin':'https://vibofast.se'}
with urlopen(Request(url+'/rest/v1/rpc/vihem_vibofast_public_site',data=b'{}',headers=headers),timeout=30) as response:
    data=json.load(response)
    if not isinstance(data,dict) or not isinstance(data.get('listings'),list): raise SystemExit('Unexpected public site response')
req=Request(url+'/functions/v1/vihem-vibofast-enquiry',data=b'{"kind":"invalid","payload":{}}',headers=headers)
try:
    urlopen(req,timeout=30)
    raise SystemExit('Invalid form request was not rejected')
except HTTPError as error:
    body=json.load(error)
    if error.code!=400 or body.get('message')!='Invalid request': raise SystemExit('Unexpected enquiry function response')
    if error.headers.get('Access-Control-Allow-Origin')!='https://vibofast.se': raise SystemExit('Incorrect form CORS')
print('Public site RPC and deployed enquiry route respond correctly. No enquiry submitted.')
