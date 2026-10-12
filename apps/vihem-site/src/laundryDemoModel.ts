import type {LaundryCalendarSlot} from '../../../src/components/laundry/LaundryCalendarView';
export type LaundryDemoState={week:number;day:number;mine:Record<string,LaundryCalendarSlot>;pending:{slot:LaundryCalendarSlot;cancel:boolean}|null;screen:boolean;error:string};
export const initialLaundry=():LaundryDemoState=>({week:0,day:0,mine:{},pending:null,screen:false,error:''});
