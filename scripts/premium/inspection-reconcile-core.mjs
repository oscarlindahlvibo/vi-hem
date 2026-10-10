import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function reconcileInspectionStage(job,adapter,{apply=false}={}) {
 const result={id:job.id,state:job.state,action:'keep',reason:'Not confirmed permanent'};
 if(job.state!=='verified'||!job.drive_file_id||!job.stage_path)return result;
 let stage;try{stage=await adapter.stage(job.stage_path);}catch{return{...result,reason:'Staging could not be checked'};}
 if(!stage)return{...result,action:'none',reason:'Staging absent'};
 if(stage.length!==job.byte_size||sha(stage)!==job.sha256)return{...result,reason:'Staging integrity mismatch'};
 let permanent;try{permanent=await adapter.permanent(job.id);}catch{return{...result,reason:'Permanent file not reverified'};}
 if(permanent.length!==job.byte_size||sha(permanent)!==job.sha256)return{...result,reason:'Permanent integrity mismatch'};
 const current=await adapter.current(job.id);
 if(!current||current.state!=='verified'||current.drive_file_id!==job.drive_file_id||current.sha256!==job.sha256||current.stage_path!==job.stage_path)return{...result,reason:'Job changed during reconciliation'};
 if(apply){await adapter.remove(job.stage_path);return{...result,action:'removed-staging',reason:'Permanent bytes reverified'};}
 return{...result,action:'cleanup-candidate',reason:'Permanent bytes reverified; dry run'};
}
