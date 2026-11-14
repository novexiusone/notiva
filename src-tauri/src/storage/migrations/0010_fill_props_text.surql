-- Fills `props_text` for the rows that existed before schema version 6.
-- The rules are those of `props_text` in `storage/rows.rs`, which writes the
-- field from then on; a test keeps the two the same. The functions are only
-- needed here and are removed again at the end.

-- The line of one property of a row, or NONE when it adds nothing: a text
-- value that is not blank, or the name of the select option the cell holds,
-- as `Name: value`, or only the value when the property has no name. Values
-- that do not fit the type, such as an option that is gone, add nothing.
-- Line breaks become spaces.
DEFINE FUNCTION fn::props_text_line($property: object, $value: any) -> option<string> {
    LET $text = IF !type::is_string($value) {
        NONE
    } ELSE IF $property.type = 'text' {
        $value
    } ELSE IF $property.type = 'select' {
        $property.options[WHERE id = $value][0].name
    } ELSE {
        NONE
    };
    IF $text = NONE OR string::trim($text) = '' {
        RETURN NONE;
    };
    LET $line = IF string::trim($property.name) = '' { $text } ELSE { $property.name + ': ' + $text };
    RETURN string::replace(string::replace($line, "\r", " "), "\n", " ");
};

-- The text of a row: one line per property, in the order of `$properties`
-- (`{ key, name, type, options }`, `key` being the property id in `props`).
DEFINE FUNCTION fn::props_text($props: option<object>, $properties: array) -> string {
    LET $cells = $props ?? {};
    RETURN array::join(
        array::filter(
            array::map($properties, |$property| fn::props_text_line($property, $cells[$property.key])),
            |$line| $line != NONE
        ),
        "\n"
    );
};

-- One database at a time; the rows are found through the `page_database`
-- index. Ordinary pages are not touched.
FOR $database IN (SELECT VALUE id FROM page WHERE kind = 'database') {
    LET $properties = (SELECT record::id(id) AS key, name, type, options, position FROM property
        WHERE database = $database ORDER BY position);
    UPDATE (SELECT VALUE id FROM page WHERE database = $database)
        SET props_text = fn::props_text(props, $properties) RETURN NONE;
};

REMOVE FUNCTION fn::props_text;
REMOVE FUNCTION fn::props_text_line;
