use serde::Serialize;

/// A page found by search.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub page_id: String,
    pub title: String,
    /// Text from the page that matches. Absent when only the title matched.
    pub excerpt: Option<Vec<Segment>>,
}

/// A piece of an excerpt. Matching pieces are highlighted by the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Segment {
    pub text: String,
    pub matched: bool,
}

/// Marks the start and end of a match in text coming back from the search
/// index. Private-use characters, so they cannot occur in what people write.
pub const MATCH_START: char = '\u{E000}';
pub const MATCH_END: char = '\u{E001}';

const BEFORE: usize = 60;
const AFTER: usize = 120;

/// Cuts a short excerpt around the first match of `marked` text and splits it
/// into matching and non-matching segments.
pub fn excerpt(marked: &str) -> Vec<Segment> {
    // One entry per visible character, with whether it is inside a match.
    let mut characters: Vec<(char, bool)> = Vec::new();
    let mut matched = false;
    for character in marked.chars() {
        match character {
            MATCH_START => matched = true,
            MATCH_END => matched = false,
            _ if character.is_whitespace() => {
                // Line breaks and runs of spaces read as one space.
                if characters.last().is_some_and(|(last, _)| *last != ' ') {
                    characters.push((' ', matched));
                }
            }
            _ => characters.push((character, matched)),
        }
    }

    let first = characters
        .iter()
        .position(|(_, matched)| *matched)
        .unwrap_or(0);

    let mut start = first.saturating_sub(BEFORE);
    if start > 0 {
        // Begin at a word, not in the middle of one.
        while start < first && characters[start - 1].0 != ' ' {
            start += 1;
        }
    }
    let mut end = (first + AFTER).min(characters.len());
    if end < characters.len() {
        while end > first && characters[end].0 != ' ' && !characters[end - 1].1 {
            end -= 1;
        }
    }

    let mut segments: Vec<Segment> = Vec::new();
    for (character, matched) in &characters[start..end] {
        match segments.last_mut() {
            Some(segment) if segment.matched == *matched => segment.text.push(*character),
            _ => segments.push(Segment {
                text: character.to_string(),
                matched: *matched,
            }),
        }
    }

    if start > 0 {
        match segments.first_mut() {
            Some(segment) if !segment.matched => segment.text.insert(0, '…'),
            _ => segments.insert(
                0,
                Segment {
                    text: "…".into(),
                    matched: false,
                },
            ),
        }
    }
    if end < characters.len() {
        match segments.last_mut() {
            Some(segment) if !segment.matched => {
                let trimmed = segment.text.trim_end().len();
                segment.text.truncate(trimmed);
                segment.text.push('…');
            }
            _ => segments.push(Segment {
                text: "…".into(),
                matched: false,
            }),
        }
    }

    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mark(text: &str) -> String {
        text.replace('[', &MATCH_START.to_string())
            .replace(']', &MATCH_END.to_string())
    }

    /// Renders segments back with brackets around matches, for readable assertions.
    fn show(segments: &[Segment]) -> String {
        segments
            .iter()
            .map(|segment| {
                if segment.matched {
                    format!("[{}]", segment.text)
                } else {
                    segment.text.clone()
                }
            })
            .collect()
    }

    #[test]
    fn a_short_text_is_kept_whole_and_split_at_the_matches() {
        let segments = excerpt(&mark("Sourdough needs a [long] [fermentation] today"));

        assert_eq!(
            segments,
            [
                Segment {
                    text: "Sourdough needs a ".into(),
                    matched: false
                },
                Segment {
                    text: "long".into(),
                    matched: true
                },
                Segment {
                    text: " ".into(),
                    matched: false
                },
                Segment {
                    text: "fermentation".into(),
                    matched: true
                },
                Segment {
                    text: " today".into(),
                    matched: false
                },
            ]
        );
    }

    #[test]
    fn a_long_text_is_cut_around_the_first_match_at_word_boundaries() {
        let before = "word ".repeat(40);
        let after = " tail".repeat(60);
        let segments = excerpt(&mark(&format!("{before}[needle]{after}")));
        let shown = show(&segments);

        assert!(shown.starts_with("…word "), "{shown}");
        assert!(shown.contains("word [needle] tail"), "{shown}");
        assert!(shown.ends_with("tail…"), "{shown}");
        let length = shown.chars().count();
        assert!((100..=200).contains(&length), "{length}: {shown}");
    }

    #[test]
    fn a_match_at_the_start_has_no_leading_ellipsis() {
        let shown = show(&excerpt(&mark(&format!(
            "[Needle] first{}",
            " and more".repeat(40)
        ))));

        assert!(shown.starts_with("[Needle] first and more"), "{shown}");
        assert!(shown.ends_with('…'), "{shown}");
    }

    #[test]
    fn line_breaks_and_repeated_spaces_become_single_spaces() {
        assert_eq!(
            show(&excerpt(&mark("one\n\ntwo   [three]\tfour"))),
            "one two [three] four"
        );
    }

    #[test]
    fn text_without_a_match_is_cut_from_the_start() {
        let shown = show(&excerpt(&"plain ".repeat(60)));

        assert!(shown.starts_with("plain plain"), "{shown}");
        assert!(shown.ends_with('…'), "{shown}");
    }

    #[test]
    fn text_is_cut_at_characters_not_bytes() {
        let shown = show(&excerpt(&mark(&format!(
            "{}[Übung] {}",
            "größe ".repeat(30),
            "ärger ".repeat(40)
        ))));

        assert!(shown.contains("[Übung]"), "{shown}");
    }

    #[test]
    fn a_hit_serialises_to_the_shape_the_frontend_expects() {
        let hit = SearchHit {
            page_id: "p".into(),
            title: "Title".into(),
            excerpt: Some(vec![Segment {
                text: "match".into(),
                matched: true,
            }]),
        };

        assert_eq!(
            serde_json::to_value(hit).unwrap(),
            serde_json::json!({
                "pageId": "p",
                "title": "Title",
                "excerpt": [{ "text": "match", "matched": true }]
            })
        );
    }
}
