import { useEffect, useState } from 'react';
import { inspectionFile } from '../../lib/inspections/archive';
export function InspectionImage({ reference, label }: { reference: string; label: string }) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, objectUrl = ''; setUrl(''); setFailed(false);
    inspectionFile(reference).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [reference]);
  return url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`Öppna ${label}`}><img src={url} alt={label} className="h-24 w-24 rounded-lg object-cover" /></a> : <span role="status" className="flex h-24 w-24 items-center justify-center rounded-lg bg-vihem-canvas p-2 text-center text-xs text-vihem-muted">{failed ? 'Kunde inte öppna bilden' : 'Hämtar bild…'}</span>;
}
