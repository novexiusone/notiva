-- Pages form a tree. `position` orders siblings.
DEFINE TABLE page SCHEMAFULL;
DEFINE FIELD title ON page TYPE string DEFAULT '';
DEFINE FIELD parent ON page TYPE option<record<page>>;
DEFINE FIELD position ON page TYPE float DEFAULT 0.0;
DEFINE FIELD created_at ON page TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD updated_at ON page TYPE datetime DEFAULT time::now();
DEFINE INDEX page_parent ON page FIELDS parent;

-- Blocks form a tree inside a page. The record id is the editor's block id.
DEFINE TABLE block SCHEMAFULL;
DEFINE FIELD page ON block TYPE record<page>;
DEFINE FIELD parent ON block TYPE option<record<block>>;
DEFINE FIELD position ON block TYPE float DEFAULT 0.0;
DEFINE FIELD type ON block TYPE string;
DEFINE FIELD props ON block TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD content ON block TYPE array<object> FLEXIBLE DEFAULT [];
DEFINE FIELD text ON block TYPE string DEFAULT '';
DEFINE INDEX block_page ON block FIELDS page;

-- A link from one page to another, made by a block. Backlinks are the
-- incoming edges of a page.
DEFINE TABLE links_to TYPE RELATION IN page OUT page SCHEMAFULL;
DEFINE FIELD block ON links_to TYPE record<block>;
DEFINE INDEX links_to_block ON links_to FIELDS block;

-- Full-text search over page titles and block text.
DEFINE ANALYZER notiva_text TOKENIZERS class, blank FILTERS lowercase, ascii;
DEFINE INDEX page_title_search ON page FIELDS title FULLTEXT ANALYZER notiva_text BM25 HIGHLIGHTS;
DEFINE INDEX block_text_search ON block FIELDS text FULLTEXT ANALYZER notiva_text BM25 HIGHLIGHTS;

-- Deleting cascades, so no caller can leave orphans behind.
DEFINE EVENT page_deleted ON page WHEN $event = 'DELETE' THEN {
    DELETE block WHERE page = $before.id;
    DELETE links_to WHERE in = $before.id OR out = $before.id;
    DELETE page WHERE parent = $before.id;
};
DEFINE EVENT block_deleted ON block WHEN $event = 'DELETE' THEN {
    DELETE links_to WHERE block = $before.id;
    DELETE block WHERE parent = $before.id;
};
