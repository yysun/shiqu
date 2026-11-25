// 原生只检查书库格式与恢复日志，在所有权写入前拒绝未知版本，不读取故事记录。
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::io::{ErrorKind, Read};
use std::path::Path;

// 两种发行包编译同一份格式声明，不依赖运行时资源查找。
fn library_format() -> Value {
    serde_json::from_str(include_str!("../../db/library-format.json")).unwrap()
}
fn supported_version() -> i64 {
    library_format()["schemaVersion"].as_i64().unwrap()
}
fn minimum_version() -> i64 {
    library_format()["minimumReadableFormat"].as_i64().unwrap()
}
fn earlier_format_error() -> String {
    format!(
        "LIBRARY_EARLIER_FORMAT: {}",
        library_format()["earlierFormatGuide"].as_str().unwrap()
    )
}
// 打开 SQLite 前读取头部，拒绝时不创建 WAL 或 SHM 文件。
fn check_header(file: &Path) -> Result<(), String> {
    let mut input = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut header = [0; 64];
    match input.read_exact(&mut header) {
        Ok(()) => {
            let version = u32::from_be_bytes(header[60..64].try_into().unwrap()) as i64;
            if &header[..16] == b"SQLite format 3\0" {
                if version > supported_version() {
                    return Err("LIBRARY_NEWER_SCHEMA: use a newer Shiqu app".into());
                }
                if version < minimum_version() {
                    return Err(earlier_format_error());
                }
            }
        }
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(())
}
// 后续迁移由 Node 执行，原生只检查最新迁移是否存在。
fn latest_migration() -> String {
    library_format()["latestMigration"]
        .as_str()
        .unwrap()
        .to_string()
}
pub fn needs_upgrade(directory: &Path) -> Result<bool, String> {
    if directory
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("LIBRARY_UNSAFE_DIRECTORY".into());
    }
    let journal = directory.join(".desktop-upgrade.json");
    let pending = journal.symlink_metadata().is_ok();
    if pending {
        if journal
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err("LIBRARY_UNSAFE_JOURNAL".into());
        }
        let value: Value =
            serde_json::from_slice(&std::fs::read(journal).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if !value["version"]
            .as_i64()
            .is_some_and(|v| (1..=supported_version()).contains(&v))
        {
            return Err("LIBRARY_NEWER_UPGRADER: unsupported recovery journal".into());
        }
        let work = value["work"].as_str().unwrap_or("");
        let suffix = work.strip_prefix(".desktop-upgrade-").unwrap_or("");
        if suffix.len() != 36
            || !suffix.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
            || !(value.get("backup") == Some(&Value::Null) || value["backup"].is_string())
        {
            return Err("LIBRARY_INVALID_JOURNAL".into());
        }
        if value["version"].as_i64().unwrap() < minimum_version() {
            return Err(earlier_format_error());
        }
    }
    let file = directory.join("shiqu.sqlite");
    if file
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("LIBRARY_UNSAFE_DATABASE".into());
    }
    if !file.exists() {
        return Ok(pending);
    }
    check_header(&file)?;
    let database = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let version: i64 = match database.query_row("PRAGMA user_version", [], |r| r.get(0)) {
        Ok(version) => version,
        Err(_) if pending => return Ok(true),
        Err(error) => return Err(error.to_string()),
    };
    if version > supported_version() {
        return Err("LIBRARY_NEWER_SCHEMA: use a newer Shiqu app".into());
    }
    if version < minimum_version() {
        return Err(earlier_format_error());
    }
    if pending {
        return Ok(true);
    }
    let column: bool = database
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('stories') WHERE name='document')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let retired: bool = database.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name IN ('reader_sessions','jobs','progress'))", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if column && !retired {
        let migrated: bool = database
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM app_migrations WHERE name=?1)",
                [latest_migration()],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        return Ok(!migrated);
    }
    Err("LIBRARY_INVALID_SCHEMA".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refusal_precedes_ownership_writes() {
        let folder =
            std::env::temp_dir().join(format!("shiqu-format-refusal-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("shiqu.sqlite");
        let db = Connection::open(&file).unwrap();
        db.execute_batch("PRAGMA user_version=999").unwrap();
        drop(db);
        let before = std::fs::read(&file).unwrap();
        assert!(needs_upgrade(&folder).unwrap_err().contains("NEWER_SCHEMA"));
        assert_eq!(before, std::fs::read(&file).unwrap());
        std::fs::remove_file(&file).unwrap();
        for version in [1, 2, 3] {
            let db = Connection::open(&file).unwrap();
            db.execute_batch(&format!(
                "PRAGMA user_version={version}; CREATE TABLE witness(value); PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO witness VALUES ('unchanged');"
            ))
            .unwrap();
            let files = ["shiqu.sqlite", "shiqu.sqlite-wal", "shiqu.sqlite-shm"];
            let before = files.map(|name| std::fs::read(folder.join(name)).unwrap());
            assert!(needs_upgrade(&folder).unwrap_err().contains("0.17.x"));
            assert_eq!(
                before,
                files.map(|name| std::fs::read(folder.join(name)).unwrap())
            );
            drop(db);
            std::fs::remove_file(&file).unwrap();
        }
        for journal in [
            r#"{"version":999}"#,
            r#"{"version":1}"#,
            r#"{"version":1,"work":"../bad","backup":null}"#,
        ] {
            std::fs::write(folder.join(".desktop-upgrade.json"), journal).unwrap();
            assert!(needs_upgrade(&folder).is_err());
            assert!(!folder.join(".desktop.lock").exists());
            assert!(!folder.join(".desktop-owner.sqlite").exists());
        }
        std::fs::write(
            folder.join(".desktop-upgrade.json"),
            r#"{"version":4,"work":".desktop-upgrade-11111111-1111-4111-8111-111111111111","backup":null}"#,
        )
        .unwrap();
        assert!(needs_upgrade(&folder).unwrap());
        assert!(!folder.join(".desktop-owner.sqlite").exists());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
