// Read summaries and manage reversible reader tombstones without starting generation or deleting media.
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

pub fn summary(directory: &Path) -> Result<Value, String> {
    let file = directory.join("shiqu.sqlite");
    if !file.exists() {
        return Ok(json!({"stories": []}));
    }
    let read = || -> Result<Value, Box<dyn std::error::Error>> {
        let database = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        database.busy_timeout(Duration::from_secs(1))?;
        let value: String =
            database.query_row(include_str!("../../desktop/library.sql"), [], |row| {
                row.get(0)
            })?;
        Ok(serde_json::from_str(&value)?)
    };
    read().map_err(|_| "无法读取本地书架，请检查数据目录及数据库版本。".into())
}

pub fn set_deleted(directory: &Path, id: &str, deleted: bool) -> Result<(), String> {
    let update = || -> Result<(), Box<dyn std::error::Error>> {
        let mut database = Connection::open_with_flags(
            directory.join("shiqu.sqlite"),
            OpenFlags::SQLITE_OPEN_READ_WRITE,
        )?;
        database.busy_timeout(Duration::from_secs(5))?;
        let transaction =
            database.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM reader_sessions WHERE id=?1)",
            [id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err("Story not found".into());
        }
        transaction.execute(
            if deleted {
                include_str!("../../desktop/library-delete.sql")
            } else {
                include_str!("../../desktop/library-restore.sql")
            },
            [id],
        )?;
        transaction.commit()?;
        Ok(())
    };
    update().map_err(|_| "故事暂时无法更新，请重试。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_reads_existing_data_without_creating_a_missing_library() {
        let folder =
            std::env::temp_dir().join(format!("shiqu-library-summary-{}", std::process::id()));
        assert_eq!(summary(&folder).unwrap(), json!({"stories": []}));
        assert!(!folder.exists());
        std::fs::create_dir(&folder).unwrap();
        let file = folder.join("shiqu.sqlite");
        let database = Connection::open(&file).unwrap();
        for migration in [
            include_str!("../../drizzle/0000_bitter_dragon_lord.sql"),
            include_str!("../../drizzle/0001_perfect_lester.sql"),
            include_str!("../../drizzle/0002_absent_tempest.sql"),
            include_str!("../../drizzle/0003_flowery_jetstream.sql"),
        ] {
            database.execute_batch(migration).unwrap();
        }
        database.execute("INSERT INTO reader_sessions (id,user_id,selection,document,state,created_at,updated_at) VALUES ('test','owner','{\"bookId\":\"book\",\"storyTitle\":\"故事\"}','{\"plan\":null,\"images\":[]}', 'idle','2026-10-29','2026-10-29')", []).unwrap();
        drop(database);
        let before = std::fs::read(&file).unwrap();
        let result = summary(&folder).unwrap();
        assert_eq!(result["stories"][0]["title"], "故事");
        assert_eq!(result["stories"][0]["jobs"], 0);
        assert_eq!(std::fs::read(&file).unwrap(), before);
        set_deleted(&folder, "test", true).unwrap();
        set_deleted(&folder, "test", true).unwrap();
        assert_eq!(summary(&folder).unwrap(), json!({"stories": []}));
        set_deleted(&folder, "test", false).unwrap();
        set_deleted(&folder, "test", false).unwrap();
        assert_eq!(summary(&folder).unwrap(), result);
        assert!(set_deleted(&folder, "missing", true).is_err());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
