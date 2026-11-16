-- The lock of a page: 'content' or 'all'. Old records have none and read as unlocked.
DEFINE FIELD lock ON page TYPE option<string> ASSERT $value = NONE OR $value IN ['content', 'all'];
DEFINE INDEX page_lock ON page FIELDS lock;
