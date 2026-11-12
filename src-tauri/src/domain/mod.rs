//! Plain domain types. Nothing in here knows about the database or Tauri.

pub mod block;
pub mod page;

pub use block::Block;
pub use page::Page;
