-- Optional on old records, which read as unfavourited.
DEFINE FIELD is_favorite ON page TYPE option<bool> DEFAULT false;
