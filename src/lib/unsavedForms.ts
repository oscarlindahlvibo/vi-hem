// Only identities of dirty forms are retained; never form content or credentials.
const dirtyForms=new Set<symbol>();
export function registerUnsavedForm(){const identity=Symbol('unsaved form');dirtyForms.add(identity);return()=>{dirtyForms.delete(identity);};}
export function hasUnsavedForms(){return dirtyForms.size>0;}
