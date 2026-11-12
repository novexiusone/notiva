-- The delete cascade has to find its records through the indexes. Two things
-- stand in the way in SurrealDB 4.0 and are worked around here:
--   * a DELETE with a WHERE clause scans its whole table, so the records are
--     found with a SELECT and deleted by id;
--   * an index is only used when the value compared with is a plain
--     variable, so `$before.id` is bound to one first.

DEFINE INDEX block_parent ON block FIELDS parent;
DEFINE INDEX links_to_in ON links_to FIELDS in;
DEFINE INDEX links_to_out ON links_to FIELDS out;

DEFINE EVENT OVERWRITE page_deleted ON page WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM block WHERE page = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE in = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE out = $gone);
    DELETE (SELECT VALUE id FROM page WHERE parent = $gone);
};
DEFINE EVENT OVERWRITE block_deleted ON block WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM links_to WHERE block = $gone);
    DELETE (SELECT VALUE id FROM block WHERE parent = $gone);
};
