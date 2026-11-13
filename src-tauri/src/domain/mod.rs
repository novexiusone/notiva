//! Plain domain types. Nothing in here knows about the database or Tauri.

pub mod block;
pub mod database;
pub mod page;
pub mod search;

pub use block::Block;
pub use database::{Database, Property, PropertyType, SelectOption};
pub use page::{Page, PageKind, PageRef};
pub use search::SearchHit;
