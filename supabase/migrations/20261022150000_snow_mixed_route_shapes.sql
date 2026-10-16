BEGIN;
-- Allow a flat collection of lines and areas without rewriting saved routes.
CREATE OR REPLACE FUNCTION public.vihem_snow_geometry_valid(g jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE points jsonb; p jsonb; line jsonb; n int; total int:=0;BEGIN
 IF g->>'type'='GeometryCollection' THEN
  IF jsonb_typeof(g->'geometries') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'geometries') NOT BETWEEN 1 AND 100 THEN RETURN false;END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(g->'geometries') LOOP
   IF coalesce(line->>'type','') NOT IN ('LineString','Polygon') OR NOT public.vihem_snow_geometry_valid(line) THEN RETURN false;END IF;
   total:=total+CASE WHEN line->>'type'='Polygon' THEN jsonb_array_length(line->'coordinates'->0) ELSE jsonb_array_length(line->'coordinates') END;
  END LOOP;
  RETURN total<=2000;
 ELSIF g->>'type'='MultiLineString' THEN
  IF jsonb_typeof(g->'coordinates') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'coordinates') NOT BETWEEN 1 AND 100 THEN RETURN false;END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(g->'coordinates') LOOP
   IF NOT public.vihem_snow_geometry_valid(jsonb_build_object('type','LineString','coordinates',line)) THEN RETURN false;END IF;
   total:=total+jsonb_array_length(line);
  END LOOP;
  RETURN total<=2000;
 ELSIF g->>'type'='LineString' THEN points:=g->'coordinates';n:=2;
 ELSIF g->>'type'='Polygon' AND jsonb_array_length(g->'coordinates')=1 THEN points:=g->'coordinates'->0;n:=4;
 ELSE RETURN false;END IF;
 IF points IS NULL OR jsonb_typeof(points) IS DISTINCT FROM 'array' OR jsonb_array_length(points)<n OR jsonb_array_length(points)>2000 THEN RETURN false;END IF;
 IF n=4 AND points->0<>points->(jsonb_array_length(points)-1) THEN RETURN false;END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(points) LOOP
  IF jsonb_typeof(p)<>'array' OR jsonb_array_length(p)<>2 OR jsonb_typeof(p->0)<>'number' OR jsonb_typeof(p->1)<>'number' OR (p->>0)::numeric NOT BETWEEN -180 AND 180 OR (p->>1)::numeric NOT BETWEEN -85 AND 85 THEN RETURN false;END IF;
 END LOOP;RETURN true;
 EXCEPTION WHEN others THEN RETURN false;END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
