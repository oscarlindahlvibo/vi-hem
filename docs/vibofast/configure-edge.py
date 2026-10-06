#!/usr/bin/env python3
"""Only add the dedicated website rate-limit secret to the existing functions env."""
from pathlib import Path
import re,secrets,sys
compose=Path(sys.argv[1] if len(sys.argv)>1 else '/home/vibo/atm-personal-supabase/docker-compose.yml')
env=compose.parent/'.env'
text=compose.read_text()
match=re.search(r'^  functions:\n.*?(?=^  [a-zA-Z_][\w-]*:|\Z)',text,re.M|re.S)
if not match: raise SystemExit('Cannot identify the existing functions service')
section=match.group(0)
if 'VIBOFAST_RATE_LIMIT_SECRET:' not in section:
    anchor='      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}'
    if section.count(anchor)!=1: raise SystemExit('Unexpected functions configuration; no edit made')
    section=section.replace(anchor,anchor+'\n      VIBOFAST_RATE_LIMIT_SECRET: ${VIBOFAST_RATE_LIMIT_SECRET}')
    text=text[:match.start()]+section+text[match.end():]
values=env.read_text()
secret=re.search(r'^VIBOFAST_RATE_LIMIT_SECRET=(.*)$',values,re.M)
if secret and len(secret.group(1).strip().strip('\"\''))<32:
    raise SystemExit('Existing website rate-limit secret is too short; no edit made')
if not secret:
    values=values.rstrip()+'\nVIBOFAST_RATE_LIMIT_SECRET='+secrets.token_hex(32)+'\n'
env.write_text(values)
compose.write_text(text)
print('Dedicated website secret configured. Secret value not displayed.')
