import {Avatar} from '../ui';
import {WorkOrderCardView,type WorkOrderCardProps} from './WorkOrderCardView';
export type {WorkOrderCardProps} from './WorkOrderCardView';
export function WorkOrderCard(props:WorkOrderCardProps){return <WorkOrderCardView {...props} renderAvatar={(name,userId)=><Avatar name={name} userId={userId} size="sm" className={name==='–'?'bg-slate-100 text-slate-400':''}/>}/>;}
