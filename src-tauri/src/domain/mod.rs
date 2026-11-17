//! Plain domain types. Nothing in here knows about the database or Tauri.

pub mod block;
pub mod database;
pub mod page;
pub mod search;
pub mod trash;
pub mod view;

pub use block::Block;
pub use database::{
    CellValue, Database, IncomingRelation, Property, PropertyType, Row, SELECT_COLORS, SelectOption,
};
pub use page::{Page, PageKind, PageRef};
pub use search::SearchHit;
pub use trash::{PageVersion, PageVersionContent, TrashSettings, TrashedPage};
pub use view::{View, ViewConfig};
