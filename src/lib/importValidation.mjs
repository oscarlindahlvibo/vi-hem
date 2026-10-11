const clean=value=>String(value??'').trim();
const numbers=['size','rooms','rent','balcony_size','monthly_rent','purchase_price','minimum_stock','target_stock','reorder_quantity','initial_quantity','deposit','quantity','minimum_duration','maximum_duration','price','duration','priority','sort_order','last_renovation_year','vat_rate','floor'];
export function validateImportRows(rows,required,kind){
 const errors=[],seen=new Set();
 for(const [index,row] of rows.entries()){
  const messages=required.filter(key=>!clean(row[key])).map(key=>`saknar ${key}`);
  for(const key of numbers)if(clean(row[key])&&!Number.isFinite(Number(row[key])))messages.push(`${key} måste vara ett tal (decimalpunkt)`);
  for(const key of ['initial_quantity','quantity','price','rent','monthly_rent'])if(clean(row[key])&&Number(row[key])<0)messages.push(`${key} får inte vara negativt`);
  if(kind==='tenants'&&clean(row.email)&&!/^\S+@\S+\.\S+$/.test(clean(row.email)))messages.push('ogiltig e-post');
  const keys={properties:['name','address'],apartments:['property_name','property_address','apartment_number'],tenants:['email'],inventory_locations:['parent_location','name'],inventory_items:['article_number'],rental_products:['slug'],rental_assets:['product_slug','product_name','internal_identifier']}[kind];
  if(keys&&(kind!=='rental_assets'||clean(row.internal_identifier))){const signature=JSON.stringify(keys.map(key=>clean(row[key]).toLowerCase()));if(seen.has(signature))messages.push('samma post förekommer flera gånger i filen');seen.add(signature);}
  if(messages.length)errors.push({row:index+2,message:messages.join(', ')});
 }
 return errors;
}

export function decodeImportText(buffer) {
  try { return new TextDecoder('utf-8', {fatal:true}).decode(buffer); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}
