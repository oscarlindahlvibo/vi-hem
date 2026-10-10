import assert from'node:assert/strict';import{legacySource,legacyPdfBytes}from'./inspection-legacy-source.mjs';
const origin='http://127.0.0.1:18880',org='qa-org',prefix=origin+'/storage/v1/object/public/vihem-inspection-photos/';
assert.equal(legacySource(prefix+org+'/i/photo.jpg',origin,org).kind,'storage-photo');
for(const source of [prefix+'other-org/i.jpg',prefix+org+'/%2e%2e/x.jpg',prefix+org+'/%252e%252e/x.jpg',prefix+org+'/%00x.jpg',prefix+org+'/p.jpg#fragment',prefix+org+'/p.jpg?token=secret',prefix.replace('127.0.0.1','evil.invalid')+org+'/p.jpg','file:///etc/passwd','http://user:password@127.0.0.1:18880/storage/v1/object/public/vihem-inspection-photos/qa-org/x'])assert.equal(legacySource(source,origin,org).kind,'unsupported');
const raw=Buffer.from('%PDF-1.4\nSyntetisk QA\n%%EOF'),ref='data:application/pdf;base64,'+raw.toString('base64');
assert.deepEqual(legacyPdfBytes(ref).bytes,raw);assert.equal(legacyPdfBytes(ref).sha256.length,64);
assert.throws(()=>legacyPdfBytes(ref,4));assert.throws(()=>legacyPdfBytes('data:application/pdf;base64,!!!='));assert.throws(()=>legacyPdfBytes('data:application/pdf;base64,'+Buffer.from('not PDF').toString('base64')));
console.log('PASS legacy source: own-origin/organisation allowlist, traversal and credential/query rejection, bounded PDF bytes/hash. No writes or external requests.');
