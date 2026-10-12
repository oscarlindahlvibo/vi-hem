import {Modal} from '../ui';
import {InspectionImage} from './InspectionImage';
import {InspectionRoomsView} from './InspectionRoomsView';
import type {ComponentProps} from 'react';
export type {InspectionRoom} from './InspectionRoomsView';
export function InspectionRooms(props:Omit<ComponentProps<typeof InspectionRoomsView>,'renderPhoto'|'renderRemoveDialog'>){return <InspectionRoomsView {...props} renderPhoto={(reference,label)=><InspectionImage reference={reference} label={label}/>} renderRemoveDialog={(open,onClose,children)=><Modal open={open} onClose={onClose} title="Ta bort rum?" size="sm">{children}</Modal>}/>;}
