//! Tauri commands. Commands stay thin: they translate between the frontend
//! and plain functions that can be tested without Tauri.

pub mod app;
pub mod backup;
pub mod blocks;
pub mod databases;
pub mod error;
pub mod export;
pub mod images;
pub mod links;
pub mod notes;
pub mod pages;
pub mod search;
pub mod trash;
pub mod views;
