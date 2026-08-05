# Keep Slipway separate from Shipyard

Shipyard remains the full TypeScript policy engine, while Slipway is a separate skills-first product built from Markdown coordination and plain files. Keeping distinct names and package boundaries preserves an honest comparison and prevents the experiment from becoming a disguised port of Shipyard's domain model; a later integration branch may place both packages under one monorepo workspace without creating a shared runtime.
