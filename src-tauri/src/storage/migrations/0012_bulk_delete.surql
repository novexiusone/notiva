-- The delete events cost most of what deleting a database costs: every event
-- runs its lookups once per deleted record, 0.8 ms for a page and 0.3 ms for
-- a block (#83). `delete_database_rows` deletes the rows of a database in
-- chunks and does the cascade itself with set-based statements. It sets
-- `$cascade_done` for those deletes, and the events then have nothing left to
-- do. Without the variable, which is every other delete, the events run as
-- before. A variable that is not set is NONE, which is not `true`.

DEFINE EVENT OVERWRITE page_deleted ON page WHEN $event = 'DELETE' AND $cascade_done != true THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM block WHERE page = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE in = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE out = $gone);
    DELETE (SELECT VALUE id FROM property WHERE database = $gone);
    DELETE (SELECT VALUE id FROM property WHERE target = $gone);
    DELETE (SELECT VALUE id FROM view WHERE database = $gone);
    DELETE (SELECT VALUE id FROM page WHERE parent = $gone);
};
DEFINE EVENT OVERWRITE block_deleted ON block WHEN $event = 'DELETE' AND $cascade_done != true THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM links_to WHERE block = $gone);
    DELETE (SELECT VALUE id FROM block WHERE parent = $gone);
};
