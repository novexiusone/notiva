//! Turns a database into a Markdown table and the values of a row into the
//! list at the top of its file.

use std::collections::HashMap;

use crate::domain::{CellValue, Property, PropertyType};
use crate::storage::number_as_text;

use super::markdown::{escape, guard_line_start};

/// The header of the title column, as the table in the app calls it.
const TITLE_HEADER: &str = "Name";

/// A row as the table of its database shows it.
pub struct TableRow {
    pub title: String,
    /// The relative link to the row's file, when it is part of the export.
    pub link: Option<String>,
    /// The value of every property, in property order, as plain text.
    pub values: Vec<String>,
}

/// The value of a cell as plain text, or an empty text when the cell is
/// empty or holds something that does not fit its property.
pub fn value(
    property: &Property,
    cell: Option<&CellValue>,
    titles: &HashMap<String, String>,
) -> String {
    let Some(cell) = cell else {
        return String::new();
    };
    match (property.kind, cell) {
        (PropertyType::Text, CellValue::Text(text)) => text.clone(),
        (PropertyType::Number, CellValue::Number(number)) => number_as_text(*number),
        (PropertyType::Date, CellValue::Date(date)) => date.clone(),
        (PropertyType::Select, CellValue::Select(id)) => property
            .options
            .iter()
            .find(|option| &option.id == id)
            .map(|option| option.name.clone())
            .unwrap_or_default(),
        (PropertyType::Relation, CellValue::Relation(ids)) => ids
            .iter()
            .filter_map(|id| titles.get(id))
            .map(|title| name(title).to_owned())
            .collect::<Vec<_>>()
            .join(", "),
        // Every other pair is a value of the wrong type, which readers treat
        // as empty.
        _ => String::new(),
    }
}

/// A name for a title or a property, "Untitled" when there is none.
fn name(text: &str) -> &str {
    let text = text.trim();
    if text.is_empty() { "Untitled" } else { text }
}

/// Plain text for a table cell: escaped, on one line, without the spaces
/// around it that the table would drop anyway.
fn cell(text: &str) -> String {
    escape(text.trim())
        .replace("\r\n", "<br>")
        .replace(['\n', '\r'], "<br>")
}

/// The file of a database: its title and a table with one line per row.
pub fn table(title: &str, properties: &[Property], rows: &[TableRow]) -> String {
    let mut out = format!("# {}\n\n", escape(name(title)));

    let mut header = vec![TITLE_HEADER.to_owned()];
    header.extend(properties.iter().map(|property| cell(name(&property.name))));
    line(&mut out, &header);
    line(&mut out, &vec!["---".to_owned(); header.len()]);

    for row in rows {
        let title = cell(name(&row.title));
        let mut cells = vec![match &row.link {
            Some(link) => format!("[{title}]({link})"),
            None => title,
        }];
        cells.extend(row.values.iter().map(|value| cell(value)));
        // A row always has as many cells as the header.
        cells.resize(header.len(), String::new());
        line(&mut out, &cells);
    }
    out
}

fn line(out: &mut String, cells: &[String]) {
    out.push_str("| ");
    out.push_str(&cells.join(" | "));
    out.push_str(" |\n");
}

/// The marker of the items in a row's property list. The lists in a page's
/// content use `-`; a different marker keeps a list at the top of the content
/// from joining this one.
const PROPERTY_MARKER: char = '*';

/// The list of a row's properties that have a value, as `* Name: value`
/// lines. Empty when no property has a value.
pub fn property_list(properties: &[Property], values: &[String]) -> String {
    let mut out = String::new();
    for (property, value) in properties.iter().zip(values) {
        // A line break continues the item instead of ending it. Lines without
        // text are dropped: they would end the paragraph.
        let lines: Vec<String> = value
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .enumerate()
            .map(|(index, line)| match index {
                // The first line follows the name, so it starts nothing.
                0 => escape(line),
                _ => guard_continuation(&escape(line)),
            })
            .collect();
        if lines.is_empty() {
            continue;
        }
        let label = guard_line_start(&escape(name(&property.name)));
        let value = lines.join("  \n  ");
        out.push_str(&format!("{PROPERTY_MARKER} {label}: {value}\n"));
    }
    out
}

/// A further line of a value must not start a list inside the item or turn
/// the line above it into a heading.
fn guard_continuation(line: &str) -> String {
    let underline = line.chars().all(|c| c == '-') || line.chars().all(|c| c == '=');
    if underline {
        format!("\\{line}")
    } else {
        guard_line_start(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::SelectOption;

    fn property(name: &str, kind: PropertyType) -> Property {
        Property {
            id: name.to_lowercase(),
            database_id: "db".into(),
            name: name.into(),
            kind,
            position: 0.0,
            options: vec![SelectOption {
                id: "open".into(),
                name: "Open".into(),
                color: "green".into(),
            }],
            target_id: None,
        }
    }

    fn row(title: &str, link: Option<&str>, values: &[&str]) -> TableRow {
        TableRow {
            title: title.into(),
            link: link.map(str::to_owned),
            values: values.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    #[test]
    fn every_type_is_written_as_text() {
        use PropertyType::*;

        let titles = HashMap::from([
            ("row".to_owned(), "Row".to_owned()),
            ("blank".to_owned(), " ".to_owned()),
        ]);
        let cases = [
            (Text, CellValue::Text("hello".into()), "hello"),
            (Number, CellValue::Number(412.0), "412"),
            (Number, CellValue::Number(-0.25), "-0.25"),
            (Number, CellValue::Number(1e21), "1e+21"),
            (Date, CellValue::Date("2026-11-13".into()), "2026-11-13"),
            (Select, CellValue::Select("open".into()), "Open"),
            // A deleted option.
            (Select, CellValue::Select("gone".into()), ""),
            (
                Relation,
                CellValue::Relation(vec!["row".into(), "none".into(), "blank".into()]),
                "Row, Untitled",
            ),
            // Values of the wrong type.
            (Number, CellValue::Text("5".into()), ""),
            (Text, CellValue::Number(5.0), ""),
            (Date, CellValue::Select("open".into()), ""),
            (Text, CellValue::Empty, ""),
        ];

        for (kind, cell, expected) in cases {
            assert_eq!(
                value(&property("P", kind), Some(&cell), &titles),
                expected,
                "{kind:?} {cell:?}"
            );
        }
        assert_eq!(value(&property("P", Text), None, &titles), "");
    }

    #[test]
    fn a_database_becomes_a_table_with_the_title_first() {
        let properties = [
            property("Pages", PropertyType::Number),
            property("Status", PropertyType::Select),
        ];
        let rows = [
            row("Dune", Some("Books/Dune.md"), &["412", "Read"]),
            row("Emma", Some("Books/Emma.md"), &["", ""]),
        ];

        assert_eq!(
            table("Books", &properties, &rows),
            "# Books\n\n\
             | Name | Pages | Status |\n\
             | --- | --- | --- |\n\
             | [Dune](Books/Dune.md) | 412 | Read |\n\
             | [Emma](Books/Emma.md) |  |  |\n"
        );
    }

    #[test]
    fn a_database_without_properties_or_rows_is_still_a_table() {
        assert_eq!(table("", &[], &[]), "# Untitled\n\n| Name |\n| --- |\n");
        assert_eq!(
            table("Books", &[], &[row("", Some("Books/Untitled.md"), &[])]),
            "# Books\n\n| Name |\n| --- |\n| [Untitled](Books/Untitled.md) |\n"
        );
    }

    #[test]
    fn text_that_would_break_the_table_is_escaped() {
        let properties = [
            property("A | B", PropertyType::Text),
            property("", PropertyType::Text),
            property("  ", PropertyType::Text),
        ];
        let rows = [
            row(
                "[x] | y\\",
                Some("Books/-x-%20-%20y-.md"),
                &["one | two", "line\nbreak\r\nand\rmore", "  spaced  "],
            ),
            row("a\nb", None, &["back\\slash\\", "*bold* `code` <b>", "\\|"]),
        ];

        assert_eq!(
            table("Pipes | and [brackets]", &properties, &rows),
            "# Pipes \\| and \\[brackets\\]\n\n\
             | Name | A \\| B | Untitled | Untitled |\n\
             | --- | --- | --- | --- |\n\
             | [\\[x\\] \\| y\\\\](Books/-x-%20-%20y-.md) | one \\| two | line<br>break<br>and<br>more | spaced |\n\
             | a<br>b | back\\\\slash\\\\ | \\*bold\\* \\`code\\` \\<b\\> | \\\\\\| |\n"
        );
    }

    #[test]
    fn missing_values_leave_a_row_as_wide_as_the_header() {
        let properties = [
            property("A", PropertyType::Text),
            property("B", PropertyType::Text),
        ];

        assert_eq!(
            table("T", &properties, &[row("R", None, &["a"])]),
            "# T\n\n| Name | A | B |\n| --- | --- | --- |\n| R | a |  |\n"
        );
    }

    #[test]
    fn a_row_lists_only_the_properties_that_have_a_value() {
        let properties = [
            property("Pages", PropertyType::Number),
            property("Notes", PropertyType::Text),
            property("Status", PropertyType::Select),
        ];

        assert_eq!(
            property_list(&properties, &["412".into(), "".into(), "Read".into()]),
            "* Pages: 412\n* Status: Read\n"
        );
        assert_eq!(
            property_list(&properties, &["".into(), "  ".into(), "".into()]),
            ""
        );
    }

    #[test]
    fn the_property_list_stays_one_item_per_property() {
        let properties = [
            property("1. First", PropertyType::Text),
            property("- dash", PropertyType::Text),
            property("", PropertyType::Text),
            property("[x]", PropertyType::Text),
        ];
        let values = [
            "two\nlines".to_owned(),
            " | pipe ".to_owned(),
            "*a*".to_owned(),
            "\\".to_owned(),
        ];

        assert_eq!(
            property_list(&properties, &values),
            "* 1\\. First: two  \n  lines\n\
             * \\- dash: \\| pipe\n\
             * Untitled: \\*a\\*\n\
             * \\[x\\]: \\\\\n"
        );
    }

    #[test]
    fn further_lines_of_a_value_stay_text_of_the_same_item() {
        let properties = [property("Notes", PropertyType::Text)];
        let values = ["1. first\r\n- second\n\n   2. third\n---\n===\nlast".to_owned()];

        assert_eq!(
            property_list(&properties, &values),
            "* Notes: 1. first  \n  \\- second  \n  2\\. third  \n  \\---  \n  \\===  \n  last\n"
        );
    }
}
