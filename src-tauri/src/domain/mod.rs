//! Plain domain types. Nothing in here knows about the database or Tauri.

pub mod block;
pub mod database;
pub mod page;
pub mod search;
pub mod view;

pub use block::Block;
pub use database::{CellValue, Database, Property, PropertyType, Row, SELECT_COLORS, SelectOption};
pub use page::{Page, PageKind, PageLock, PageRef};
pub use search::SearchHit;
pub use view::{View, ViewConfig};
