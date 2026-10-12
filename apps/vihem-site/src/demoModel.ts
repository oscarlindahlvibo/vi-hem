export type OrderStatus='Ny'|'Tilldelad'|'Slutförd';
export type Order={id:number;title:string;description:string;apartment:string;assignee:string;status:OrderStatus;tenantVisible:boolean};
export type Room={name:string;condition:string|null;note:string};
export function initialDemo(){return {orders:[{id:1,title:'Läckande kökskran',description:'Kranen droppar även när den är stängd.',apartment:'1001',assignee:'Erik Demo',status:'Tilldelad' as OrderStatus,tenantVisible:true},{id:2,title:'Kontrollera ventilation',description:'Kontroll av ventilation inför planerat underhåll.',apartment:'1002',assignee:'',status:'Ny' as OrderStatus,tenantVisible:false}],rooms:['Hall','Kök','Badrum'].map(name=>({name,condition:null,note:''} as Room)),inspectionSaved:false,inspectionFinished:false};}
export function createDemoOrder(orders:Order[],draft:{title:string;description:string;apartment:string;assignee:string},tenant=false):Order{
 if(!draft.title.trim())throw Error('Ange en titel.');
 return {id:Math.max(0,...orders.map(o=>o.id))+1,title:draft.title.trim().slice(0,100),description:draft.description.slice(0,1000),apartment:tenant?'1001':draft.apartment,assignee:tenant?'':draft.assignee,status:!tenant&&draft.assignee?'Tilldelad':'Ny',tenantVisible:tenant};
}
