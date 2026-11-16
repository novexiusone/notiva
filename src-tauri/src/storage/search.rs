//! Full-text search over page titles, block text and the text of the
//! properties of rows.

use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::SearchHit;
use crate::domain::search::{MATCH_END, MATCH_START, excerpt, property_excerpt};

/// How many pages a search returns at most.
const MAX_HITS: usize = 20;
/// How many matching blocks are looked at to find the pages they belong to.
const MAX_BLOCKS: usize = 200;
/// Shorter words are not indexed, see the analyzer in the schema.
const MIN_WORD: usize = 2;

#[derive(SurrealValue)]
struct TitleHit {
    page_id: String,
    title: String,
}

#[derive(SurrealValue)]
struct BlockHit {
    page_id: String,
    title: String,
    excerpt: String,
}

impl Storage {
    /// Pages whose title or content, or rows whose properties, contain every
    /// word of `query`, matching by word prefix. Title matches come first,
    /// then content matches, then property matches, each best first.
    pub async fn search(&self, query: &str) -> Result<Vec<SearchHit>, StorageError> {
        // Words too short to be indexed would make every search come back empty.
        let words: Vec<&str> = query
            .split_whitespace()
            .filter(|word| word.chars().count() >= MIN_WORD)
            .collect();
        if words.is_empty() {
            return Ok(Vec::new());
        }

        let mut response = self
            .db
            .query(format!(
                "SELECT record::id(id) AS page_id, title, search::score(0) AS score
                     FROM page WHERE title @0@ $query ORDER BY score DESC LIMIT {MAX_HITS};
                 SELECT record::id(page) AS page_id, page.title AS title,
                        search::highlight($start, $end, 0) AS excerpt, search::score(0) AS score
                     FROM block WHERE text @0@ $query ORDER BY score DESC LIMIT {MAX_BLOCKS};
                 SELECT record::id(id) AS page_id, title,
                        search::highlight($start, $end, 0) AS excerpt, search::score(0) AS score
                     FROM page WHERE props_text @0@ $query ORDER BY score DESC LIMIT {MAX_HITS};"
            ))
            .bind(("query", words.join(" ")))
            .bind(("start", MATCH_START.to_string()))
            .bind(("end", MATCH_END.to_string()))
            .await?
            .check()?;
        let titles: Vec<TitleHit> = response.take(0)?;
        let blocks: Vec<BlockHit> = response.take(1)?;
        let rows: Vec<BlockHit> = response.take(2)?;

        let mut hits: Vec<SearchHit> = titles
            .into_iter()
            .map(|hit| SearchHit {
                page_id: hit.page_id,
                title: hit.title,
                excerpt: None,
            })
            .collect();
        let title_hits = hits.len();

        for block in blocks {
            match hits.iter().position(|hit| hit.page_id == block.page_id) {
                // The best matching block of a page provides its excerpt.
                Some(index) => {
                    if hits[index].excerpt.is_none() && index < title_hits {
                        hits[index].excerpt = Some(excerpt(&block.excerpt));
                    }
                }
                None if hits.len() < MAX_HITS => hits.push(SearchHit {
                    page_id: block.page_id,
                    title: block.title,
                    excerpt: Some(excerpt(&block.excerpt)),
                }),
                None => {}
            }
        }

        for row in rows {
            match hits.iter().position(|hit| hit.page_id == row.page_id) {
                // A row whose content matches keeps the content excerpt.
                Some(index) => {
                    if hits[index].excerpt.is_none() {
                        hits[index].excerpt = Some(property_excerpt(&row.excerpt));
                    }
                }
                None if hits.len() < MAX_HITS => hits.push(SearchHit {
                    page_id: row.page_id,
                    title: row.title,
                    excerpt: Some(property_excerpt(&row.excerpt)),
                }),
                None => {}
            }
        }

        Ok(hits)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, json};

    use super::*;
    use crate::domain::search::Segment;
    use crate::domain::{Block, CellValue, PropertyType, SelectOption};

    async fn page(storage: &Storage, title: &str, paragraphs: &[&str]) -> String {
        let page = storage.create_page(None).await.unwrap();
        storage.rename_page(&page.id, title).await.unwrap();
        write(storage, &page.id, paragraphs).await;
        page.id
    }

    async fn write(storage: &Storage, page_id: &str, paragraphs: &[&str]) {
        let blocks: Vec<Block> = paragraphs
            .iter()
            .enumerate()
            .map(|(index, text)| Block {
                id: format!("{page_id}-{index}"),
                kind: "paragraph".into(),
                props: Map::new(),
                content: Some(json!([{ "type": "text", "text": text, "styles": {} }])),
                children: Vec::new(),
            })
            .collect();
        storage.save_blocks(page_id, &blocks).await.unwrap();
    }

    async fn titles(storage: &Storage, query: &str) -> Vec<String> {
        storage
            .search(query)
            .await
            .unwrap()
            .into_iter()
            .map(|hit| hit.title)
            .collect()
    }

    /// The excerpt of the only hit, with brackets around the matches.
    async fn only_excerpt(storage: &Storage, query: &str) -> String {
        let mut hits = storage.search(query).await.unwrap();
        assert_eq!(hits.len(), 1, "{query:?} should find exactly one page");
        hits.remove(0)
            .excerpt
            .expect("a content match has an excerpt")
            .into_iter()
            .map(|segment| {
                if segment.matched {
                    format!("[{}]", segment.text)
                } else {
                    segment.text
                }
            })
            .collect()
    }

    #[tokio::test]
    async fn a_page_is_found_by_a_word_of_its_title() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(&storage, "Travel plans", &[]).await;
        page(&storage, "Recipes", &[]).await;

        let hits = storage.search("travel").await.unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Travel plans");
        assert_eq!(hits[0].excerpt, None);
    }

    #[tokio::test]
    async fn a_page_is_found_by_its_content_with_the_match_highlighted() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(
            &storage,
            "Bread",
            &["Flour and water", "Sourdough needs a long fermentation"],
        )
        .await;
        page(&storage, "Travel", &["Book the night train"]).await;

        assert_eq!(
            only_excerpt(&storage, "fermentation").await,
            "Sourdough needs a long [fermentation]"
        );
    }

    #[tokio::test]
    async fn words_match_by_prefix_without_regard_to_case_or_accents() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(&storage, "Bread", &["Sourdough needs a long Fermentation"]).await;
        page(&storage, "Garden", &["The fence needs paint"]).await;
        page(&storage, "Über uns", &[]).await;

        assert_eq!(titles(&storage, "FERM").await, ["Bread"]);
        assert_eq!(titles(&storage, "uber").await, ["Über uns"]);
        assert_eq!(titles(&storage, "über").await, ["Über uns"]);
    }

    #[tokio::test]
    async fn every_word_of_the_query_has_to_match() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(&storage, "Bread", &["Sourdough needs a long fermentation"]).await;
        page(&storage, "Beer", &["A short fermentation"]).await;

        assert_eq!(titles(&storage, "long ferm").await, ["Bread"]);
        assert!(titles(&storage, "long holiday").await.is_empty());
    }

    #[tokio::test]
    async fn one_letter_words_in_the_query_are_ignored() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(&storage, "Bread", &["Sourdough needs a long fermentation"]).await;

        assert_eq!(titles(&storage, "a ferm").await, ["Bread"]);
    }

    #[tokio::test]
    async fn too_short_and_empty_queries_find_nothing() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(&storage, "Bread", &["Sourdough"]).await;

        for query in ["", "   ", "b", "b s"] {
            assert!(storage.search(query).await.unwrap().is_empty(), "{query:?}");
        }
    }

    #[tokio::test]
    async fn a_page_is_listed_once_and_title_matches_come_first() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(
            &storage,
            "Notes",
            &["The garden needs water", "A garden in winter"],
        )
        .await;
        page(&storage, "Garden", &["Tomatoes and beans in the garden"]).await;

        let hits = storage.search("garden").await.unwrap();

        assert_eq!(
            hits.iter()
                .map(|hit| hit.title.as_str())
                .collect::<Vec<_>>(),
            ["Garden", "Notes"]
        );
        // A title match still shows where the term occurs in its content.
        assert!(hits[0].excerpt.is_some());
        assert!(hits[1].excerpt.is_some());
    }

    #[tokio::test]
    async fn the_better_content_match_comes_first() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(
            &storage,
            "Passing mention",
            &["A long text about many other things that only once says river and then moves on to mountains, weather, food and travel"],
        )
        .await;
        page(&storage, "All about it", &["river river river"]).await;

        assert_eq!(
            titles(&storage, "river").await,
            ["All about it", "Passing mention"]
        );
    }

    #[tokio::test]
    async fn at_most_twenty_pages_are_returned() {
        let storage = Storage::open_in_memory().await.unwrap();
        for index in 0..25 {
            page(
                &storage,
                &format!("Page {index}"),
                &["the same shared keyword"],
            )
            .await;
        }

        assert_eq!(storage.search("keyword").await.unwrap().len(), 20);
        assert_eq!(storage.search("page").await.unwrap().len(), 20);
    }

    #[tokio::test]
    async fn changed_content_is_found_and_removed_content_is_not() {
        let storage = Storage::open_in_memory().await.unwrap();
        let id = page(&storage, "Journal", &["Went swimming"]).await;
        assert_eq!(titles(&storage, "swimming").await, ["Journal"]);

        write(&storage, &id, &["Went climbing"]).await;

        assert!(titles(&storage, "swimming").await.is_empty());
        assert_eq!(titles(&storage, "climbing").await, ["Journal"]);
    }

    #[tokio::test]
    async fn a_renamed_or_deleted_page_is_reflected_at_once() {
        let storage = Storage::open_in_memory().await.unwrap();
        let id = page(&storage, "Draft", &["Unique marmalade"]).await;

        storage.rename_page(&id, "Final").await.unwrap();
        assert!(titles(&storage, "draft").await.is_empty());
        assert_eq!(titles(&storage, "final").await, ["Final"]);

        storage.delete_page(&id).await.unwrap();
        assert!(titles(&storage, "final").await.is_empty());
        assert!(titles(&storage, "marmalade").await.is_empty());
    }

    #[tokio::test]
    async fn text_in_the_query_is_data_not_query_language() {
        let storage = Storage::open_in_memory().await.unwrap();
        page(&storage, "Safe", &["nothing to see"]).await;

        for query in ["'; DELETE page; --", "title @@ 'x'", "$query", "\\u{E000}"] {
            storage.search(query).await.unwrap();
        }

        assert_eq!(storage.list_pages().await.unwrap().len(), 1);
    }

    // Rows, found by the text of their properties.

    /// A database with the properties `Notes` (text), `Status` (select with
    /// `Open` and `Done`), `Amount` (number) and `Due` (date).
    struct Table {
        database: String,
        notes: String,
        status: String,
        amount: String,
        due: String,
    }

    async fn property(storage: &Storage, database: &str, name: &str, kind: PropertyType) -> String {
        storage
            .create_property(database, name, kind, None)
            .await
            .unwrap()
            .id
    }

    fn option(id: &str, name: &str) -> SelectOption {
        SelectOption {
            id: id.into(),
            name: name.into(),
            color: "gray".into(),
        }
    }

    async fn table(storage: &Storage) -> Table {
        let database = storage.create_database(None).await.unwrap().page.id;
        storage.rename_page(&database, "Tasks").await.unwrap();
        let notes = property(storage, &database, "Notes", PropertyType::Text).await;
        let status = property(storage, &database, "Status", PropertyType::Select).await;
        let amount = property(storage, &database, "Amount", PropertyType::Number).await;
        let due = property(storage, &database, "Due", PropertyType::Date).await;
        storage
            .update_property(
                &status,
                None,
                Some(&[option("open", "Open"), option("done", "Done")]),
            )
            .await
            .unwrap();
        Table {
            database,
            notes,
            status,
            amount,
            due,
        }
    }

    async fn row(storage: &Storage, table: &Table, title: &str) -> String {
        let row = storage.create_row(&table.database).await.unwrap().id;
        storage.rename_page(&row, title).await.unwrap();
        row
    }

    async fn set(storage: &Storage, row: &str, property: &str, value: CellValue) {
        storage.set_cell(row, property, value).await.unwrap();
    }

    fn text(value: &str) -> CellValue {
        CellValue::Text(value.into())
    }

    fn select(id: &str) -> CellValue {
        CellValue::Select(id.into())
    }

    /// The stored search text of a page.
    async fn props_text(storage: &Storage, id: &str) -> Option<String> {
        storage
            .db
            .query("SELECT VALUE props_text FROM ONLY type::record('page', $id)")
            .bind(("id", id.to_owned()))
            .await
            .unwrap()
            .take(0)
            .unwrap()
    }

    #[tokio::test]
    async fn a_row_is_found_by_a_text_value_with_the_property_as_excerpt() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Bread").await;
        set(
            &storage,
            &row,
            &table.notes,
            text("Needs a long Fermentation"),
        )
        .await;
        set(&storage, &row, &table.status, select("open")).await;

        let hits = storage.search("ferm").await.unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, row);
        assert_eq!(hits[0].title, "Bread");
        assert_eq!(
            hits[0].excerpt,
            Some(vec![
                Segment {
                    text: "Notes: Needs a long ".into(),
                    matched: false
                },
                Segment {
                    text: "Fermentation".into(),
                    matched: true
                },
            ])
        );
        assert_eq!(
            props_text(&storage, &row).await.as_deref(),
            Some("Notes: Needs a long Fermentation\nStatus: Open")
        );
    }

    #[tokio::test]
    async fn text_and_select_values_match_by_prefix_without_regard_to_case_or_accents() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        storage
            .update_property(
                &table.status,
                None,
                Some(&[option("open", "Öffentlich"), option("done", "Done")]),
            )
            .await
            .unwrap();
        let first = row(&storage, &table, "First").await;
        let second = row(&storage, &table, "Second").await;
        set(&storage, &first, &table.notes, text("Über den Fluss")).await;
        set(&storage, &second, &table.status, select("open")).await;

        assert_eq!(titles(&storage, "UBER").await, ["First"]);
        assert_eq!(titles(&storage, "flu").await, ["First"]);
        assert_eq!(titles(&storage, "offent").await, ["Second"]);
        assert_eq!(only_excerpt(&storage, "öff").await, "Status: [Öffentlich]");
    }

    #[tokio::test]
    async fn the_name_of_the_property_is_found_with_its_value() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let done = row(&storage, &table, "Finished").await;
        let open = row(&storage, &table, "Pending").await;
        set(&storage, &done, &table.status, select("done")).await;
        set(&storage, &open, &table.status, select("open")).await;

        assert_eq!(titles(&storage, "status done").await, ["Finished"]);
        assert_eq!(only_excerpt(&storage, "done").await, "Status: [Done]");
    }

    #[tokio::test]
    async fn numbers_and_dates_are_not_searched() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Invoice").await;
        set(&storage, &row, &table.amount, CellValue::Number(4711.0)).await;
        set(
            &storage,
            &row,
            &table.due,
            CellValue::Date("2026-11-14".into()),
        )
        .await;

        for query in ["4711", "2026", "2026-11-14", "amount", "due"] {
            assert!(titles(&storage, query).await.is_empty(), "{query:?}");
        }
        assert_eq!(props_text(&storage, &row).await.as_deref(), Some(""));
    }

    #[tokio::test]
    async fn a_cleared_or_changed_cell_is_reflected_at_once() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Journal").await;
        set(&storage, &row, &table.notes, text("Went swimming")).await;
        set(&storage, &row, &table.status, select("open")).await;
        assert_eq!(titles(&storage, "swimming").await, ["Journal"]);

        set(&storage, &row, &table.notes, text("Went climbing")).await;
        assert!(titles(&storage, "swimming").await.is_empty());
        assert_eq!(titles(&storage, "climbing").await, ["Journal"]);

        set(&storage, &row, &table.notes, CellValue::Empty).await;
        set(&storage, &row, &table.status, select("done")).await;
        assert!(titles(&storage, "climbing").await.is_empty());
        assert!(titles(&storage, "open").await.is_empty());
        assert_eq!(titles(&storage, "done").await, ["Journal"]);

        set(&storage, &row, &table.status, CellValue::Empty).await;
        assert!(titles(&storage, "done").await.is_empty());
        assert_eq!(props_text(&storage, &row).await.as_deref(), Some(""));
    }

    #[tokio::test]
    async fn line_breaks_in_a_value_do_not_split_its_property() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Poem").await;
        set(
            &storage,
            &row,
            &table.notes,
            text("roses are red\nviolets are blue"),
        )
        .await;

        assert_eq!(
            only_excerpt(&storage, "violets").await,
            "Notes: roses are red [violets] are blue"
        );
    }

    #[tokio::test]
    async fn a_renamed_option_is_found_by_its_new_name_on_every_row_that_holds_it() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let first = row(&storage, &table, "First").await;
        let second = row(&storage, &table, "Second").await;
        let other = row(&storage, &table, "Other").await;
        set(&storage, &first, &table.status, select("open")).await;
        set(&storage, &second, &table.status, select("open")).await;
        set(&storage, &other, &table.status, select("done")).await;

        storage
            .update_property(
                &table.status,
                None,
                Some(&[option("open", "Started"), option("done", "Done")]),
            )
            .await
            .unwrap();

        assert!(titles(&storage, "open").await.is_empty());
        let mut found = titles(&storage, "started").await;
        found.sort();
        assert_eq!(found, ["First", "Second"]);
        assert_eq!(titles(&storage, "done").await, ["Other"]);
    }

    #[tokio::test]
    async fn an_option_left_out_of_the_new_list_is_no_longer_found() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Task").await;
        set(&storage, &row, &table.status, select("open")).await;

        storage
            .update_property(&table.status, None, Some(&[option("done", "Done")]))
            .await
            .unwrap();

        assert!(titles(&storage, "open").await.is_empty());
    }

    #[tokio::test]
    async fn a_renamed_property_is_found_by_its_new_name() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Task").await;
        set(&storage, &row, &table.status, select("open")).await;

        storage
            .update_property(&table.status, Some("Stage"), None)
            .await
            .unwrap();

        assert!(titles(&storage, "status").await.is_empty());
        assert_eq!(only_excerpt(&storage, "stage").await, "[Stage]: Open");
    }

    #[tokio::test]
    async fn a_deleted_option_or_property_is_no_longer_found_while_other_values_are() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Task").await;
        let owner = property(&storage, &table.database, "Owner", PropertyType::Text).await;
        set(&storage, &row, &table.notes, text("buy flour")).await;
        set(&storage, &row, &table.status, select("open")).await;
        set(&storage, &row, &owner, text("Lorenz")).await;

        storage
            .delete_select_option(&table.status, "open")
            .await
            .unwrap();
        assert!(titles(&storage, "open").await.is_empty());
        assert_eq!(titles(&storage, "flour").await, ["Task"]);

        storage.delete_property(&table.notes).await.unwrap();
        assert!(titles(&storage, "flour").await.is_empty());
        assert!(titles(&storage, "notes").await.is_empty());
        assert_eq!(titles(&storage, "lorenz").await, ["Task"]);
        assert_eq!(
            props_text(&storage, &row).await.as_deref(),
            Some("Owner: Lorenz")
        );
    }

    #[tokio::test]
    async fn a_changed_type_changes_what_is_found() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let first = row(&storage, &table, "First").await;
        let second = row(&storage, &table, "Second").await;
        set(&storage, &first, &table.notes, text("fermentation")).await;
        set(&storage, &second, &table.notes, text("42")).await;
        set(&storage, &first, &table.status, select("done")).await;

        // Text to number: the texts are gone, also the one that became 42.
        storage
            .change_property_type(&table.notes, PropertyType::Number)
            .await
            .unwrap();
        assert!(titles(&storage, "fermentation").await.is_empty());
        assert!(titles(&storage, "42").await.is_empty());
        assert!(titles(&storage, "notes").await.is_empty());
        assert_eq!(titles(&storage, "done").await, ["First"]);

        // Select to text: the names are still found, now as text.
        storage
            .change_property_type(&table.status, PropertyType::Text)
            .await
            .unwrap();
        assert_eq!(only_excerpt(&storage, "done").await, "Status: [Done]");

        // Text to select: the texts are found as the names of the new options.
        storage
            .change_property_type(&table.status, PropertyType::Select)
            .await
            .unwrap();
        assert_eq!(only_excerpt(&storage, "done").await, "Status: [Done]");
        let properties = storage
            .load_database(&table.database)
            .await
            .unwrap()
            .properties;
        let status = properties
            .iter()
            .find(|property| property.id == table.status)
            .unwrap();
        assert_eq!(status.kind, PropertyType::Select);
        assert_eq!(status.options.len(), 1);
    }

    #[tokio::test]
    async fn words_spread_over_the_title_and_the_properties_find_nothing() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let row = row(&storage, &table, "Bread").await;
        set(&storage, &row, &table.notes, text("long fermentation")).await;
        write(&storage, &row, &["Flour and water"]).await;

        assert!(titles(&storage, "bread ferm").await.is_empty());
        assert!(titles(&storage, "flour ferm").await.is_empty());
        assert_eq!(titles(&storage, "long ferm").await, ["Bread"]);
    }

    #[tokio::test]
    async fn property_hits_come_after_title_and_content_hits() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let by_property = row(&storage, &table, "Row").await;
        set(
            &storage,
            &by_property,
            &table.notes,
            text("garden garden garden"),
        )
        .await;
        page(&storage, "Notes", &["A garden in winter"]).await;
        page(&storage, "Garden", &[]).await;

        let hits = storage.search("garden").await.unwrap();

        assert_eq!(
            hits.iter()
                .map(|hit| hit.title.as_str())
                .collect::<Vec<_>>(),
            ["Garden", "Notes", "Row"]
        );
        assert_eq!(hits[2].page_id, by_property);
    }

    #[tokio::test]
    async fn a_row_is_listed_once_when_title_properties_and_content_match() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let all = row(&storage, &table, "Garden").await;
        set(&storage, &all, &table.notes, text("garden tools")).await;
        write(&storage, &all, &["Water the garden"]).await;
        let title_and_properties = row(&storage, &table, "Garden too").await;
        set(
            &storage,
            &title_and_properties,
            &table.notes,
            text("garden beds"),
        )
        .await;
        let content_and_properties = row(&storage, &table, "Plain").await;
        set(
            &storage,
            &content_and_properties,
            &table.notes,
            text("garden chairs"),
        )
        .await;
        write(&storage, &content_and_properties, &["Sit in the garden"]).await;

        let hits = storage.search("garden").await.unwrap();

        let shown: Vec<(&str, String)> = hits
            .iter()
            .map(|hit| {
                let excerpt = hit
                    .excerpt
                    .iter()
                    .flatten()
                    .map(|segment| segment.text.as_str())
                    .collect();
                (hit.title.as_str(), excerpt)
            })
            .collect();
        // Title hits first, each with the content excerpt when the content
        // matches and the property excerpt otherwise. The content wins over
        // the properties.
        assert_eq!(shown.len(), 3, "{shown:?}");
        assert!(
            shown[..2].contains(&("Garden", "Water the garden".to_owned())),
            "{shown:?}"
        );
        assert!(
            shown[..2].contains(&("Garden too", "Notes: garden beds".to_owned())),
            "{shown:?}"
        );
        assert_eq!(shown[2], ("Plain", "Sit in the garden".to_owned()));
    }

    #[tokio::test]
    async fn pages_and_rows_without_values_have_no_property_text() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        let empty = row(&storage, &table, "Empty").await;
        let ordinary = page(&storage, "Ordinary", &["Notes about status"]).await;

        assert_eq!(props_text(&storage, &empty).await, None);
        assert_eq!(props_text(&storage, &ordinary).await, None);
        assert_eq!(props_text(&storage, &table.database).await, None);
        assert_eq!(titles(&storage, "status").await, ["Ordinary"]);
        assert_eq!(titles(&storage, "empty").await, ["Empty"]);
        assert_eq!(storage.search("empty").await.unwrap()[0].excerpt, None);
    }

    #[tokio::test]
    async fn at_most_twenty_results_also_with_property_hits() {
        let storage = Storage::open_in_memory().await.unwrap();
        let table = table(&storage).await;
        for index in 0..15 {
            page(&storage, &format!("Keyword {index}"), &[]).await;
            let row = row(&storage, &table, &format!("Row {index}")).await;
            set(&storage, &row, &table.notes, text("keyword")).await;
        }

        let hits = storage.search("keyword").await.unwrap();

        assert_eq!(hits.len(), 20);
        assert!(
            hits[..15]
                .iter()
                .all(|hit| hit.title.starts_with("Keyword"))
        );
        assert!(hits[15..].iter().all(|hit| hit.title.starts_with("Row")));
    }
}
