//! Full-text search over page titles and block text.

use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::SearchHit;
use crate::domain::search::{MATCH_END, MATCH_START, excerpt};

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
    /// Pages whose title or content contains every word of `query`, matching
    /// by word prefix. Title matches come first, then content matches, each
    /// best first.
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
                     FROM block WHERE text @0@ $query ORDER BY score DESC LIMIT {MAX_BLOCKS};"
            ))
            .bind(("query", words.join(" ")))
            .bind(("start", MATCH_START.to_string()))
            .bind(("end", MATCH_END.to_string()))
            .await?
            .check()?;
        let titles: Vec<TitleHit> = response.take(0)?;
        let blocks: Vec<BlockHit> = response.take(1)?;

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

        Ok(hits)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, json};

    use super::*;
    use crate::domain::Block;

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
}
