/*
  # vihem_contract_signatures -- tillåt admin att radera avtal (rensa testdata)

  Det fanns tidigare INGEN DELETE-policy alls på vihem_contract_signatures
  (V1:s hyresavtalsflöde, InspectionsPage.tsx) -- utan en explicit policy
  nekar RLS varje delete, oavsett roll. Lägger till en admin/superadmin-
  scopad DELETE-policy, samma organisationsgräns som redan gäller för
  UPDATE på samma tabell.

  Ingen ON DELETE CASCADE-graf att oroa sig för här (till skillnad från
  Avtal V2:s vihem_agreements): inget annat bord refererar
  vihem_contract_signatures.id.

  Ingen organisationsgräns i policyn nedan -- matchar den befintliga
  "Staff and tenants can update contracts"-policyn på samma tabell, som
  redan bara kollar rollen (organisation_id på tabellen är dessutom
  nullable, så ett org-villkor hade oavsiktligt spärrat radering av äldre
  rader utan organisation_id satt).
*/

CREATE POLICY "Admin can delete contracts"
  ON public.vihem_contract_signatures
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('admin', 'superadmin')
    )
  );
