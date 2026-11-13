-- Search-as-you-type: besides lower-casing and accent folding, index the
-- prefixes of every word, so that "ferm" finds "fermentation".
DEFINE ANALYZER OVERWRITE notiva_text TOKENIZERS class, blank FILTERS lowercase, ascii, edgengram(2, 15);

-- The indexes hold terms produced by the old analyzer and have to be rebuilt.
REMOVE INDEX page_title_search ON page;
REMOVE INDEX block_text_search ON block;
DEFINE INDEX page_title_search ON page FIELDS title FULLTEXT ANALYZER notiva_text BM25 HIGHLIGHTS;
DEFINE INDEX block_text_search ON block FIELDS text FULLTEXT ANALYZER notiva_text BM25 HIGHLIGHTS;
