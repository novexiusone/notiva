-- Search finds rows by the text of their properties. `props_text` is derived
-- from a row's cells by the repository, which writes it together with the
-- cells, and has its own full-text index with the analyzer of the title and
-- block indexes. Ordinary pages do not have it.
DEFINE FIELD props_text ON page TYPE option<string>;
DEFINE INDEX page_props_search ON page FIELDS props_text FULLTEXT ANALYZER notiva_text BM25 HIGHLIGHTS;

-- The rows that exist are filled by the next migration. SurrealDB 4.0.1
-- refuses to define an index in a transaction that writes records of its
-- table, and to write records in the transaction that defined the index.
