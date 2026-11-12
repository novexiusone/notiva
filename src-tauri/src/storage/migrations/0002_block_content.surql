-- Blocks without text, such as images, have no content, and a table keeps its
-- content as an object rather than a list.
DEFINE FIELD OVERWRITE content ON block TYPE option<array<object> | object> FLEXIBLE;
