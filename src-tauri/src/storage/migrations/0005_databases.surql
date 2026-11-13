-- Databases. A database is a page with `kind = 'database'`, and each of its
-- rows is a page below it. This migration carries the model for the modules
-- `databases`, `database-views` and `database-embed`.

-- A page without `kind` is an ordinary page, so pages written before this
-- migration are not rewritten.
DEFINE FIELD kind ON page TYPE option<string> ASSERT $value = NONE OR $value IN ['database'];
-- Set on rows, where it equals `parent`.
DEFINE FIELD database ON page TYPE option<record<page>>;
-- The cells of a row: { <property id>: value }.
DEFINE FIELD props ON page TYPE option<object> FLEXIBLE;
DEFINE INDEX page_database ON page FIELDS database;

-- A typed column of a database.
DEFINE TABLE property SCHEMAFULL;
DEFINE FIELD database ON property TYPE record<page>;
DEFINE FIELD name ON property TYPE string DEFAULT '';
DEFINE FIELD type ON property TYPE string
    ASSERT $value IN ['text', 'number', 'date', 'select', 'relation'];
DEFINE FIELD position ON property TYPE float DEFAULT 0.0;
-- Select only.
DEFINE FIELD options ON property TYPE array<object> DEFAULT [];
DEFINE FIELD options.*.id ON property TYPE string;
DEFINE FIELD options.*.name ON property TYPE string;
DEFINE FIELD options.*.color ON property TYPE string;
-- Relation only: the target database.
DEFINE FIELD target ON property TYPE option<record<page>>;
DEFINE INDEX property_database ON property FIELDS database;
DEFINE INDEX property_target ON property FIELDS target;

-- A stored view of a database. `config` belongs to `database-views`.
DEFINE TABLE view SCHEMAFULL;
DEFINE FIELD database ON view TYPE record<page>;
DEFINE FIELD name ON view TYPE string DEFAULT '';
DEFINE FIELD position ON view TYPE float DEFAULT 0.0;
DEFINE FIELD config ON view TYPE object FLEXIBLE;
DEFINE INDEX view_database ON view FIELDS database;

-- The value of a relation cell: one edge per linked row, from the row that
-- holds the cell to the row it points at.
DEFINE TABLE row_link TYPE RELATION IN page OUT page SCHEMAFULL;
DEFINE FIELD property ON row_link TYPE record<property>;
DEFINE FIELD position ON row_link TYPE float DEFAULT 0.0;
DEFINE INDEX row_link_property ON row_link FIELDS property;
DEFINE INDEX row_link_in ON row_link FIELDS in;
DEFINE INDEX row_link_out ON row_link FIELDS out;

-- Deleting a database takes its properties and views along, and the relation
-- properties of other databases that point at it. Its rows are child pages.
DEFINE EVENT OVERWRITE page_deleted ON page WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM block WHERE page = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE in = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE out = $gone);
    DELETE (SELECT VALUE id FROM property WHERE database = $gone);
    DELETE (SELECT VALUE id FROM property WHERE target = $gone);
    DELETE (SELECT VALUE id FROM view WHERE database = $gone);
    DELETE (SELECT VALUE id FROM page WHERE parent = $gone);
};
DEFINE EVENT property_deleted ON property WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM row_link WHERE property = $gone);
};
