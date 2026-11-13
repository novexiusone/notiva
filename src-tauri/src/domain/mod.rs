//! Plain domain types. Nothing in here knows about the database or Tauri.

pub mod block;
pub mod page;
pub mod search;

pub use block::Block;
pub use page::{Page, PageRef};
pub use search::SearchHit;
