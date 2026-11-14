//! The property repository: the typed columns of a database and the options
//! of a select.

use std::collections::HashSet;

use surrealdb::types::SurrealValue;

use super::databases::PropertyRow;
use super::{Storage, StorageError};
use crate::domain::{Page, PageKind, Property, PropertyType, SELECT_COLORS, SelectOption};

/// Selects a property with its ids as plain strings.
pub(super) const PROPERTY_FIELDS: &str = "record::id(id) AS id, \
     record::id(database) AS database_id, name, type AS kind, position, options, \
     IF target = NONE { NONE } ELSE { record::id(target) } AS target_id";

/// An option as it is written.
#[derive(SurrealValue)]
struct OptionWrite {
    id: String,
    name: String,
    color: String,
}

fn not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("property {id}"))
}

/// The name a property type is stored under.
fn type_name(kind: PropertyType) -> &'static str {
    match kind {
        PropertyType::Text => "text",
        PropertyType::Number => "number",
        PropertyType::Date => "date",
        PropertyType::Select => "select",
        PropertyType::Relation => "relation",
    }
}

/// Refuses a list of options that a select cannot hold.
fn check_options(options: &[SelectOption]) -> Result<(), StorageError> {
    let mut ids = HashSet::new();
    for option in options {
        if option.id.is_empty() {
            return Err(StorageError::Invalid("an option needs an id".into()));
        }
        if !ids.insert(option.id.as_str()) {
            return Err(StorageError::Invalid(format!(
                "two options cannot share the id {}",
                option.id
            )));
        }
        if !SELECT_COLORS.contains(&option.color.as_str()) {
            return Err(StorageError::Invalid(format!(
                "{} is not an option colour; use one of {}",
                option.color,
                SELECT_COLORS.join(", ")
            )));
        }
    }
    Ok(())
}

impl Storage {
    /// Adds a property after the last one of the database. Only a relation
    /// has a target, and relations are delivered with #61.
    pub async fn create_property(
        &self,
        database_id: &str,
        name: &str,
        kind: PropertyType,
        target_id: Option<&str>,
    ) -> Result<Property, StorageError> {
        self.require_database(database_id).await?;
        if kind == PropertyType::Relation {
            return Err(StorageError::Invalid(
                "relation properties are not supported yet".into(),
            ));
        }
        if target_id.is_some() {
            return Err(StorageError::Invalid(
                "only a relation has a target database".into(),
            ));
        }

        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "LET $database = type::record('page', $database_id);
                 LET $last = (SELECT VALUE position FROM property WHERE database = $database
                     ORDER BY position DESC LIMIT 1)[0];
                 CREATE property SET database = $database, name = $name, type = $type,
                     position = ($last ?? -1.0) + 1.0, options = []
                     RETURN {PROPERTY_FIELDS};"
            ))
            .bind(("database_id", database_id.to_owned()))
            .bind(("name", name.to_owned()))
            .bind(("type", type_name(kind)))
            .await?
            .check()?
            .take(2)?;

        row.ok_or_else(|| StorageError::Database("the created property was not returned".into()))?
            .try_into()
    }

    /// Renames a property, replaces the options of a select, or both. `None`
    /// keeps what is there. An option left out of the new list is gone; cells
    /// that held it read as empty.
    pub async fn update_property(
        &self,
        id: &str,
        name: Option<&str>,
        options: Option<&[SelectOption]>,
    ) -> Result<Property, StorageError> {
        let property = self.find_property(id).await?.ok_or_else(|| not_found(id))?;
        if let Some(options) = options {
            if property.kind != PropertyType::Select {
                return Err(StorageError::Invalid("only a select has options".into()));
            }
            check_options(options)?;
        }

        let options: Option<Vec<OptionWrite>> = options.map(|options| {
            options
                .iter()
                .map(|option| OptionWrite {
                    id: option.id.clone(),
                    name: option.name.clone(),
                    color: option.color.clone(),
                })
                .collect()
        });
        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "UPDATE type::record('property', $id)
                     SET name = $name ?? name, options = $options ?? options
                     WHERE id != NONE RETURN {PROPERTY_FIELDS}"
            ))
            .bind(("id", id.to_owned()))
            .bind(("name", name.map(str::to_owned)))
            .bind(("options", options))
            .await?
            .check()?
            .take(0)?;

        row.ok_or_else(|| not_found(id))?.try_into()
    }

    /// The property with the given id, if there is one.
    pub(super) async fn find_property(&self, id: &str) -> Result<Option<Property>, StorageError> {
        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "SELECT {PROPERTY_FIELDS} FROM type::record('property', $id)"
            ))
            .bind(("id", id.to_owned()))
            .await?
            .check()?
            .take(0)?;

        row.map(Property::try_from).transpose()
    }

    /// The page of a database. An ordinary page or a row is not found.
    pub(super) async fn require_database(&self, id: &str) -> Result<Page, StorageError> {
        self.find_page(id)
            .await?
            .filter(|page| page.kind == PageKind::Database)
            .ok_or_else(|| StorageError::NotFound(format!("database {id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::run_with_pages;
    use super::*;

    async fn storage() -> Storage {
        Storage::open_in_memory().await.unwrap()
    }

    async fn database(storage: &Storage) -> String {
        storage.create_database(None).await.unwrap().page.id
    }

    fn option(id: &str, name: &str, color: &str) -> SelectOption {
        SelectOption {
            id: id.into(),
            name: name.into(),
            color: color.into(),
        }
    }

    #[tokio::test]
    async fn properties_are_appended_in_the_order_they_were_created() {
        let storage = storage().await;
        let id = database(&storage).await;

        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let due = storage
            .create_property(&id, "Due", PropertyType::Date, None)
            .await
            .unwrap();
        let notes = storage
            .create_property(&id, "Notes", PropertyType::Text, None)
            .await
            .unwrap();
        let amount = storage
            .create_property(&id, "Amount", PropertyType::Number, None)
            .await
            .unwrap();

        assert_eq!(status.database_id, id);
        assert_eq!(status.name, "Status");
        assert_eq!(status.kind, PropertyType::Select);
        assert!(status.options.is_empty());
        assert_eq!(status.target_id, None);
        assert_eq!(status.position, 0.0);
        assert!(due.position > status.position);
        assert!(notes.position > due.position);
        assert!(amount.position > notes.position);
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties,
            [status, due, notes, amount]
        );
    }

    #[tokio::test]
    async fn a_new_property_comes_after_the_highest_position() {
        let storage = storage().await;
        let id = database(&storage).await;
        run_with_pages(
            &storage,
            &[("database", &id)],
            "CREATE property:late SET database = $database, name = 'Late', type = 'text',
                 position = 7.5;",
        )
        .await;

        let added = storage
            .create_property(&id, "Added", PropertyType::Text, None)
            .await
            .unwrap();

        assert_eq!(added.position, 8.5);
    }

    #[tokio::test]
    async fn properties_of_one_database_do_not_shift_another() {
        let storage = storage().await;
        let first = database(&storage).await;
        let second = database(&storage).await;
        storage
            .create_property(&first, "A", PropertyType::Text, None)
            .await
            .unwrap();
        storage
            .create_property(&first, "B", PropertyType::Text, None)
            .await
            .unwrap();

        let other = storage
            .create_property(&second, "C", PropertyType::Text, None)
            .await
            .unwrap();

        assert_eq!(other.position, 0.0);
        assert_eq!(
            storage.load_database(&second).await.unwrap().properties,
            [other]
        );
    }

    #[tokio::test]
    async fn a_property_needs_a_database() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap().id;

        for id in [page.as_str(), "missing"] {
            let error = storage
                .create_property(id, "Name", PropertyType::Text, None)
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::NotFound(_)), "{id}");
        }
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn a_target_on_a_property_that_is_no_relation_is_refused() {
        let storage = storage().await;
        let id = database(&storage).await;

        for kind in [
            PropertyType::Text,
            PropertyType::Number,
            PropertyType::Date,
            PropertyType::Select,
        ] {
            let error = storage
                .create_property(&id, "Name", kind, Some(&id))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{kind:?}");
        }
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn relation_properties_are_refused_until_relations_arrive() {
        let storage = storage().await;
        let id = database(&storage).await;
        let target = database(&storage).await;

        for target in [Some(target.as_str()), None] {
            let error = storage
                .create_property(&id, "Link", PropertyType::Relation, target)
                .await
                .unwrap_err();
            assert!(
                matches!(&error, StorageError::Invalid(message) if message.contains("relation")),
                "{error}"
            );
        }
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn renaming_a_property_leaves_its_options_alone() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let options = [option("open", "Open", "green")];
        storage
            .update_property(&status.id, None, Some(&options))
            .await
            .unwrap();

        let renamed = storage
            .update_property(&status.id, Some("State"), None)
            .await
            .unwrap();

        assert_eq!(
            renamed,
            Property {
                name: "State".into(),
                options: options.to_vec(),
                ..status
            }
        );
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties,
            [renamed]
        );
    }

    #[tokio::test]
    async fn every_type_can_be_renamed() {
        let storage = storage().await;
        let id = database(&storage).await;

        for kind in [
            PropertyType::Text,
            PropertyType::Number,
            PropertyType::Date,
            PropertyType::Select,
        ] {
            let property = storage
                .create_property(&id, "Old", kind, None)
                .await
                .unwrap();
            let renamed = storage
                .update_property(&property.id, Some("New"), None)
                .await
                .unwrap();
            assert_eq!(renamed.name, "New");
            assert_eq!(renamed.kind, kind);
            assert_eq!(renamed.position, property.position);
        }
    }

    #[tokio::test]
    async fn options_are_replaced_as_a_list() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        storage
            .update_property(
                &status.id,
                None,
                Some(&[
                    option("open", "Open", "green"),
                    option("done", "Done", "gray"),
                ]),
            )
            .await
            .unwrap();

        // Rename and recolour `done`, move it first, add `later`.
        let replaced = [
            option("done", "Finished", "blue"),
            option("open", "Open", "green"),
            option("later", "Later", "yellow"),
        ];
        let updated = storage
            .update_property(&status.id, None, Some(&replaced))
            .await
            .unwrap();

        assert_eq!(updated.name, "Status");
        assert_eq!(updated.options, replaced);
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties[0].options,
            replaced
        );

        let emptied = storage
            .update_property(&status.id, None, Some(&[]))
            .await
            .unwrap();
        assert!(emptied.options.is_empty());
    }

    #[tokio::test]
    async fn every_colour_can_be_given_to_an_option() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let options: Vec<SelectOption> = SELECT_COLORS
            .iter()
            .map(|color| option(color, color, color))
            .collect();

        let updated = storage
            .update_property(&status.id, None, Some(&options))
            .await
            .unwrap();

        assert_eq!(updated.options, options);
    }

    #[tokio::test]
    async fn options_are_refused_on_a_property_that_is_no_select() {
        let storage = storage().await;
        let id = database(&storage).await;

        for kind in [PropertyType::Text, PropertyType::Number, PropertyType::Date] {
            let property = storage
                .create_property(&id, "Name", kind, None)
                .await
                .unwrap();
            let error = storage
                .update_property(&property.id, None, Some(&[option("a", "A", "red")]))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{kind:?}");
            // Not even an empty list.
            let error = storage
                .update_property(&property.id, Some("Renamed"), Some(&[]))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{kind:?}");
            assert_eq!(
                storage.find_property(&property.id).await.unwrap(),
                Some(property)
            );
        }
    }

    #[tokio::test]
    async fn options_with_an_empty_or_shared_id_or_an_unknown_colour_are_refused() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let open = option("open", "Open", "green");

        for options in [
            vec![option("", "Nameless", "green")],
            vec![open.clone(), open.clone()],
            vec![open.clone(), option("open", "Other", "red")],
            vec![option("pink", "Pink", "pink")],
            vec![option("loud", "Loud", "#ff0000")],
        ] {
            let error = storage
                .update_property(&status.id, Some("Renamed"), Some(&options))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{options:?}");
        }
        assert_eq!(
            storage.find_property(&status.id).await.unwrap(),
            Some(status),
            "a refused update changes nothing, not even the name"
        );
    }

    #[tokio::test]
    async fn updating_an_unknown_property_fails_without_creating_it() {
        let storage = storage().await;

        let error = storage
            .update_property("missing", Some("Name"), None)
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert_eq!(count_properties(&storage).await, 0);
    }

    async fn count_properties(storage: &Storage) -> i64 {
        let count: Option<i64> = storage
            .db
            .query("RETURN count(SELECT * FROM property)")
            .await
            .unwrap()
            .take(0)
            .unwrap();
        count.unwrap()
    }
}
