-- Trash and version history. Only adds tables; no existing record changes.

-- One entry per trashed page. A page is moved to the trash together with its
-- subpages (and, for a database, its rows). The records leave the live tables,
-- so every read path ignores them; they are kept in `trash_item` until the
-- page is restored or deleted for good. The entry id is the page id.
DEFINE TABLE trash SCHEMAFULL;
DEFINE FIELD title ON trash TYPE string DEFAULT '';
DEFINE FIELD kind ON trash TYPE string DEFAULT 'page';
DEFINE FIELD icon ON trash TYPE option<string>;
-- Where the page was: restored there when that place still exists.
DEFINE FIELD parent ON trash TYPE option<string>;
DEFINE FIELD database ON trash TYPE option<string>;
DEFINE FIELD page_count ON trash TYPE int DEFAULT 1;
-- How many groups of pages the items are split into.
DEFINE FIELD groups ON trash TYPE int DEFAULT 0;
-- False while the page is being moved to the trash. An entry that stays
-- incomplete (a crash) is rolled back at startup.
DEFINE FIELD complete ON trash TYPE bool DEFAULT false;
-- True while the entry is being deleted for good: it is no longer restorable
-- and a crash is finished at the next start.
DEFINE FIELD purging ON trash TYPE bool DEFAULT false;
-- True while a restore runs; a crash is rolled forward at the next start.
DEFINE FIELD restoring ON trash TYPE bool DEFAULT false;
DEFINE FIELD deleted_at ON trash TYPE datetime DEFAULT time::now();
DEFINE INDEX trash_deleted_at ON trash FIELDS deleted_at;

-- A record of a trashed page, exactly as it was stored.
DEFINE TABLE trash_item SCHEMAFULL;
DEFINE FIELD entry ON trash_item TYPE record<trash>;
-- The table the record came from.
DEFINE FIELD tb ON trash_item TYPE string;
DEFINE FIELD grp ON trash_item TYPE int DEFAULT 0;
DEFINE FIELD data ON trash_item TYPE object FLEXIBLE;
DEFINE INDEX trash_item_entry ON trash_item FIELDS entry, tb, grp;

-- The settings of the trash: one record, `trash_config:main`. Without it the
-- default retention applies.
DEFINE TABLE trash_config SCHEMAFULL;
-- Days a page stays in the trash; none keeps it until it is deleted by hand.
DEFINE FIELD retention_days ON trash_config TYPE option<int>;

-- Snapshots of the blocks of a page.
DEFINE TABLE page_version SCHEMAFULL;
DEFINE FIELD page ON page_version TYPE record<page>;
DEFINE FIELD title ON page_version TYPE string DEFAULT '';
-- The block tree as JSON.
DEFINE FIELD blocks ON page_version TYPE string;
DEFINE FIELD block_count ON page_version TYPE int DEFAULT 0;
DEFINE FIELD preview ON page_version TYPE string DEFAULT '';
DEFINE FIELD created_at ON page_version TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX page_version_page ON page_version FIELDS page, created_at;

-- A separate event, so that the cascade of `page_deleted` is not touched.
DEFINE EVENT page_version_cleanup ON page WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM page_version WHERE page = $gone);
};
