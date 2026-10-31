// Keep desktop settings and opt-in plaintext keys in private native SQLite, outside the reader library.
// Version/schema checks precede mutations; settings and key edits commit together without Keychain.
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskReasoningEfforts {
    pub suggest: String,
    pub art: String,
    pub frames: String,
    pub outline: String,
    pub plan: String,
    pub review: String,
    pub repair: String,
}

impl Default for TaskReasoningEfforts {
    fn default() -> Self {
        Self {
            suggest: "medium".into(),
            art: "low".into(),
            frames: "medium".into(),
            outline: "high".into(),
            plan: "high".into(),
            review: "high".into(),
            repair: "high".into(),
        }
    }
}

impl TaskReasoningEfforts {
    fn values(&self) -> [&str; 7] {
        [
            &self.suggest,
            &self.art,
            &self.frames,
            &self.outline,
            &self.plan,
            &self.review,
            &self.repair,
        ]
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub library_configured: bool,
    #[serde(default)]
    pub provider_configured: bool,
    #[serde(default = "openai_text_model")]
    pub openai_text_model: String,
    #[serde(default = "openai_image_model")]
    pub openai_image_model: String,
    pub node_path: String,
    pub data_directory: String,
    pub port: u16,
    // Legacy input is ignored; LAN is always on and internet requires a new opt-in.
    #[serde(default, skip_serializing, rename = "lanEnabled")]
    pub _legacy_lan_enabled: bool,
    #[serde(default)]
    pub internet_enabled: bool,
    #[serde(default)]
    pub cloudflared_path: String,
    pub provider: String,
    pub text_model: String,
    pub image_model: String,
    pub codex_path: String,
    pub codex_model: String,
    #[serde(default)]
    pub codex_reasoning_effort: String,
    #[serde(default)]
    pub task_reasoning_efforts: TaskReasoningEfforts,
    pub codex_home: String,
}

fn openai_text_model() -> String {
    "gpt-6.1-sol".into()
}
fn openai_image_model() -> String {
    "gpt-image-2.5-sunburst".into()
}

impl Settings {
    pub fn defaults(data: &Path) -> Self {
        Self {
            library_configured: false,
            provider_configured: false,
            openai_text_model: openai_text_model(),
            openai_image_model: openai_image_model(),
            node_path: String::new(),
            data_directory: data.join("library").to_string_lossy().into(),
            port: 3000,
            _legacy_lan_enabled: false,
            internet_enabled: false,
            cloudflared_path: String::new(),
            provider: "gemini".into(),
            text_model: "gemini-3.8-flash".into(),
            image_model: "gemini-nano-banana-2.1".into(),
            codex_path: String::new(),
            codex_model: "gpt-6.1-sol".into(),
            codex_reasoning_effort: String::new(),
            task_reasoning_efforts: TaskReasoningEfforts::default(),
            codex_home: String::new(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        for effort in self.task_reasoning_efforts.values() {
            let allowed = if self.provider == "gemini" {
                &["low", "medium", "high"][..]
            } else {
                &["low", "medium", "high", "xhigh", "max"][..]
            };
            if !allowed.contains(&effort) {
                return Err("任务推理档位无效；Gemini 仅支持 low、medium、high。".into());
            }
        }
        if !["", "low", "medium", "high", "xhigh", "max"]
            .contains(&self.codex_reasoning_effort.as_str())
        {
            return Err("请选择有效的 Codex 推理档位，或跟随 Codex 默认。".into());
        }
        if self.port < 1024
            || !["gemini", "codex", "openai", "readonly"].contains(&self.provider.as_str())
        {
            return Err("请选择有效的提供方与 1024–65535 之间的端口。".into());
        }
        if !Path::new(&self.data_directory).is_absolute() || self.data_directory.len() > 4096 {
            return Err("数据目录必须是有效的绝对路径。".into());
        }
        for model in [
            &self.text_model,
            &self.image_model,
            &self.codex_model,
            &self.openai_text_model,
            &self.openai_image_model,
        ] {
            if model.len() > 100
                || !model
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            {
                return Err("模型名称只能包含字母、数字、点、横线和下划线。".into());
            }
        }
        if self.text_model.is_empty()
            || self.image_model.is_empty()
            || self.openai_text_model.is_empty()
            || self.openai_image_model.is_empty()
        {
            return Err("请填写文本和图片模型。".into());
        }
        for value in [
            &self.cloudflared_path,
            &self.node_path,
            &self.codex_path,
            &self.codex_home,
            &self.data_directory,
        ] {
            if value.len() > 4096 || value.contains(['\0', '\n', '\r']) {
                return Err("文件路径无效。".into());
            }
        }
        if !self.cloudflared_path.is_empty() && !Path::new(&self.cloudflared_path).is_absolute() {
            return Err("cloudflared 路径必须是可执行文件的绝对路径。".into());
        }
        if cfg!(windows) && self.provider == "codex" {
            return Err(
                "当前 Codex 集成不支持原生 Windows；请选择 OpenAI API、Gemini 或只读。".into(),
            );
        }
        Ok(())
    }
}

const STORE_ERROR: &str = "无法读取或保存桌面数据库；请检查权限，或备份 desktop.sqlite 后重试。";
const SCHEMA_ERROR: &str = "桌面数据库损坏或版本不兼容；请保留备份，使用兼容版本打开。";

pub enum KeyChange<'a> {
    Keep,
    Set(&'a str),
    Delete,
}
pub struct Store {
    db: Connection,
}

impl Store {
    pub fn open(file: &Path, data: &Path) -> Result<Self, String> {
        let folder = file.parent().ok_or(STORE_ERROR)?;
        fs::create_dir_all(folder).map_err(|_| STORE_ERROR)?;
        if !fs::symlink_metadata(folder)
            .map_err(|_| STORE_ERROR)?
            .is_dir()
        {
            return Err(STORE_ERROR.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            fs::set_permissions(folder, fs::Permissions::from_mode(0o700))
                .map_err(|_| STORE_ERROR)?;
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(file)
            {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(STORE_ERROR.into()),
            }
        }
        #[cfg(not(unix))]
        {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(file)
            {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(STORE_ERROR.into()),
            }
        }
        if !fs::symlink_metadata(file)
            .map_err(|_| STORE_ERROR)?
            .is_file()
        {
            return Err(STORE_ERROR.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(file, fs::Permissions::from_mode(0o600))
                .map_err(|_| STORE_ERROR)?;
        }
        let mut db = Connection::open_with_flags(
            file,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| SCHEMA_ERROR)?;
        db.busy_timeout(Duration::from_secs(2))
            .map_err(|_| STORE_ERROR)?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| STORE_ERROR)?;
        let version: i64 = tx
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| SCHEMA_ERROR)?;
        if version == 0 {
            let count: i64 = tx
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| SCHEMA_ERROR)?;
            if count != 0 {
                return Err(SCHEMA_ERROR.into());
            }
            let legacy = folder.join("settings.json");
            let settings: Settings = match fs::read(&legacy) {
                Ok(bytes) => {
                    let mut saved: Settings = serde_json::from_slice(&bytes)
                        .map_err(|_| "旧 settings.json 损坏；请备份后修复或移走。")?;
                    saved.library_configured = true;
                    saved.provider_configured =
                        saved.provider == "codex" || saved.provider == "readonly";
                    saved
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Settings::defaults(data)
                }
                Err(_) => return Err(STORE_ERROR.into()),
            };
            settings.validate()?;
            tx.execute_batch("CREATE TABLE desktop_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0); CREATE TABLE desktop_credentials (name TEXT PRIMARY KEY CHECK(name IN ('gemini','openai')), value TEXT NOT NULL); PRAGMA user_version=2;").map_err(|_| STORE_ERROR)?;
            tx.execute(
                "INSERT INTO desktop_settings (id,value) VALUES (1, ?1)",
                [serde_json::to_string(&settings).map_err(|_| STORE_ERROR)?],
            )
            .map_err(|_| STORE_ERROR)?;
        } else if version == 1 {
            let value: String = tx
                .query_row("SELECT value FROM desktop_settings WHERE id=1", [], |row| {
                    row.get(0)
                })
                .map_err(|_| SCHEMA_ERROR)?;
            let mut settings: Settings = serde_json::from_str(&value).map_err(|_| SCHEMA_ERROR)?;
            settings.validate()?;
            let key: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM desktop_credentials WHERE name='gemini' AND length(value)>0)", [], |row| row.get(0)).map_err(|_| SCHEMA_ERROR)?;
            settings.library_configured = true;
            settings.provider_configured = settings.provider == "codex" || key;
            tx.execute_batch("ALTER TABLE desktop_settings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0; ALTER TABLE desktop_credentials RENAME TO old_credentials; CREATE TABLE desktop_credentials (name TEXT PRIMARY KEY CHECK(name IN ('gemini','openai')), value TEXT NOT NULL); INSERT INTO desktop_credentials SELECT * FROM old_credentials; DROP TABLE old_credentials; PRAGMA user_version=2;").map_err(|_| STORE_ERROR)?;
            tx.execute(
                "UPDATE desktop_settings SET value=?1 WHERE id=1",
                [serde_json::to_string(&settings).map_err(|_| STORE_ERROR)?],
            )
            .map_err(|_| STORE_ERROR)?;
        } else if version != 2 {
            return Err(SCHEMA_ERROR.into());
        }
        let value: String = tx
            .query_row("SELECT value FROM desktop_settings WHERE id=1", [], |row| {
                row.get(0)
            })
            .map_err(|_| SCHEMA_ERROR)?;
        serde_json::from_str::<Settings>(&value)
            .map_err(|_| SCHEMA_ERROR)?
            .validate()
            .map_err(|_| SCHEMA_ERROR)?;
        tx.prepare("SELECT id,value,revision FROM desktop_settings LIMIT 0")
            .map_err(|_| SCHEMA_ERROR)?;
        tx.prepare("SELECT name,value FROM desktop_credentials LIMIT 0")
            .map_err(|_| SCHEMA_ERROR)?;
        let integrity: String = tx
            .pragma_query_value(None, "quick_check", |row| row.get(0))
            .map_err(|_| SCHEMA_ERROR)?;
        if integrity != "ok" {
            return Err(SCHEMA_ERROR.into());
        }
        tx.commit().map_err(|_| STORE_ERROR)?;
        db.execute_batch("PRAGMA secure_delete=ON; PRAGMA temp_store=MEMORY;")
            .map_err(|_| STORE_ERROR)?;
        Ok(Self { db })
    }
    pub fn settings(&self) -> Result<Settings, String> {
        let value: String = self
            .db
            .query_row("SELECT value FROM desktop_settings WHERE id=1", [], |row| {
                row.get(0)
            })
            .map_err(|_| SCHEMA_ERROR)?;
        let settings: Settings = serde_json::from_str(&value).map_err(|_| SCHEMA_ERROR)?;
        settings.validate()?;
        Ok(settings)
    }
    pub fn revision(&self) -> Result<i64, String> {
        self.db
            .query_row(
                "SELECT revision FROM desktop_settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| STORE_ERROR.into())
    }
    // One SQLite statement binds the editable settings and revision to the same read snapshot.
    pub fn settings_snapshot(&self) -> Result<(Settings, i64, bool, bool), String> {
        let (value, revision, gemini, openai): (String, i64, bool, bool) = self.db.query_row(
            "SELECT value,revision,EXISTS(SELECT 1 FROM desktop_credentials WHERE name='gemini' AND length(value)>0),EXISTS(SELECT 1 FROM desktop_credentials WHERE name='openai' AND length(value)>0) FROM desktop_settings WHERE id=1",
            [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
        ).map_err(|_| SCHEMA_ERROR)?;
        let settings: Settings = serde_json::from_str(&value).map_err(|_| SCHEMA_ERROR)?;
        settings.validate()?;
        Ok((settings, revision, gemini, openai))
    }
    pub fn key_for(&self, provider: &str) -> Result<String, String> {
        if !["gemini", "openai"].contains(&provider) {
            return Ok(String::new());
        }
        self.db
            .query_row(
                "SELECT value FROM desktop_credentials WHERE name=?1",
                [provider],
                |row| row.get(0),
            )
            .optional()
            .map(|key| key.unwrap_or_default())
            .map_err(|_| STORE_ERROR.into())
    }
    pub fn key(&self) -> Result<String, String> {
        self.key_for(&self.settings()?.provider)
    }
    pub fn key_present(&self) -> Result<bool, String> {
        Ok(!self.key()?.is_empty())
    }
    pub fn save(&mut self, settings: &Settings, key: KeyChange<'_>) -> Result<(), String> {
        self.save_at(settings, key, None)
    }
    pub fn save_at(
        &mut self,
        settings: &Settings,
        key: KeyChange<'_>,
        expected: Option<i64>,
    ) -> Result<(), String> {
        settings.validate()?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| STORE_ERROR)?;
        let revision: i64 = tx
            .query_row(
                "SELECT revision FROM desktop_settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| STORE_ERROR)?;
        if expected.is_some_and(|value| value != revision) {
            return Err("设置已由另一入口修改，请重新读取后保存。".into());
        }
        let value = serde_json::to_string(settings).map_err(|_| STORE_ERROR)?;
        tx.execute(
            "UPDATE desktop_settings SET value=?1,revision=revision+1 WHERE id=1",
            [value],
        )
        .map_err(|_| STORE_ERROR)?;
        match key {
            KeyChange::Keep => {}
            KeyChange::Set(value) => {
                if !["gemini", "openai"].contains(&settings.provider.as_str()) {
                    return Err("所选服务不使用 API 密钥。".into());
                }
                let value = validate_key(value)?;
                tx.execute("INSERT INTO desktop_credentials VALUES (?1,?2) ON CONFLICT(name) DO UPDATE SET value=excluded.value", [&settings.provider,&value]).map_err(|_| STORE_ERROR)?;
            }
            KeyChange::Delete => {
                tx.execute(
                    "DELETE FROM desktop_credentials WHERE name=?1",
                    [&settings.provider],
                )
                .map_err(|_| STORE_ERROR)?;
            }
        }
        tx.commit().map_err(|_| STORE_ERROR.into())
    }
    pub fn reset_providers(&mut self) -> Result<(), String> {
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| STORE_ERROR)?;
        let value: String = tx
            .query_row("SELECT value FROM desktop_settings WHERE id=1", [], |row| {
                row.get(0)
            })
            .map_err(|_| STORE_ERROR)?;
        let mut settings: Settings = serde_json::from_str(&value).map_err(|_| SCHEMA_ERROR)?;
        let defaults = Settings::defaults(
            Path::new(&settings.data_directory)
                .parent()
                .ok_or(STORE_ERROR)?,
        );
        settings.provider = defaults.provider;
        settings.provider_configured = false;
        settings.text_model = defaults.text_model;
        settings.image_model = defaults.image_model;
        settings.openai_text_model = defaults.openai_text_model;
        settings.openai_image_model = defaults.openai_image_model;
        settings.codex_path.clear();
        settings.codex_home.clear();
        settings.codex_reasoning_effort.clear();
        settings.codex_model = defaults.codex_model;
        settings.task_reasoning_efforts = defaults.task_reasoning_efforts;
        tx.execute_batch("DELETE FROM desktop_credentials")
            .map_err(|_| STORE_ERROR)?;
        tx.execute(
            "UPDATE desktop_settings SET value=?1,revision=revision+1 WHERE id=1",
            [serde_json::to_string(&settings).map_err(|_| STORE_ERROR)?],
        )
        .map_err(|_| STORE_ERROR)?;
        tx.commit().map_err(|_| STORE_ERROR.into())
    }
}

pub fn validate_key(value: &str) -> Result<String, String> {
    if value.trim().is_empty() || value.len() > 4096 || value.contains(['\0', '\n', '\r']) {
        return Err("密钥格式无效；请填写单行、非空且不超过 4096 字节的密钥。".into());
    }
    Ok(value.trim().into())
}

pub fn directories(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    use tauri::Manager;
    let config = app
        .path()
        .app_config_dir()
        .map_err(|_| "无法确定设置目录。")?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法确定数据目录。")?;
    Ok((config.join("desktop.sqlite"), data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn folder() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "shiqu-store-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn legacy_lan_never_enables_internet_and_new_settings_round_trip() {
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let mut old = serde_json::to_value(Settings::defaults(&folder)).unwrap();
        old.as_object_mut().unwrap().remove("internetEnabled");
        old.as_object_mut().unwrap().remove("cloudflaredPath");
        old["lanEnabled"] = serde_json::json!(true);
        fs::write(folder.join("settings.json"), old.to_string()).unwrap();
        let store = Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        assert!(!settings.internet_enabled);
        assert_eq!(settings.cloudflared_path, "");
        store
            .db
            .execute(
                "UPDATE desktop_settings SET value=?1 WHERE id=1",
                [old.to_string()],
            )
            .unwrap();
        drop(store);
        let mut store = Store::open(&file, &folder).unwrap();
        assert!(!store.settings().unwrap().internet_enabled);
        settings.internet_enabled = true;
        settings.cloudflared_path = folder.join("cloudflared").to_string_lossy().into();
        store.save(&settings, KeyChange::Keep).unwrap();
        drop(store);
        let mut store = Store::open(&file, &folder).unwrap();
        assert!(store.settings().unwrap().internet_enabled);
        assert_eq!(
            store.settings().unwrap().cloudflared_path,
            settings.cloudflared_path
        );
        assert!(serde_json::to_value(store.settings().unwrap())
            .unwrap()
            .get("lanEnabled")
            .is_none());
        settings.cloudflared_path = "relative/cloudflared".into();
        assert!(store.save(&settings, KeyChange::Keep).is_err());
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn database_round_trip_delete_and_private_permissions() {
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let mut store = Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        settings.port = 43127;
        store
            .save(&settings, KeyChange::Set("disposable-db-key"))
            .unwrap();
        drop(store);
        let mut store = Store::open(&file, &folder).unwrap();
        assert_eq!(store.settings().unwrap().port, 43127);
        assert_eq!(store.key().unwrap(), "disposable-db-key");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(&folder).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        store.save(&settings, KeyChange::Delete).unwrap();
        drop(store);
        let store = Store::open(&file, &folder).unwrap();
        assert!(!store.key_present().unwrap());
        assert!(store.key().unwrap().is_empty());
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn migration_is_once_and_never_overwrites_database() {
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let mut settings = Settings::defaults(&folder);
        settings.port = 43128;
        fs::write(
            folder.join("settings.json"),
            serde_json::to_vec(&settings).unwrap(),
        )
        .unwrap();
        let mut store = Store::open(&file, &folder).unwrap();
        assert_eq!(store.settings().unwrap().port, 43128);
        settings.port = 43129;
        store.save(&settings, KeyChange::Keep).unwrap();
        drop(store);
        let store = Store::open(&file, &folder).unwrap();
        assert_eq!(store.settings().unwrap().port, 43129);
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn task_efforts_migrate_old_settings_and_reject_invalid_saves_atomically() {
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let mut old = serde_json::to_value(Settings::defaults(&folder)).unwrap();
        old.as_object_mut().unwrap().remove("taskReasoningEfforts");
        fs::write(
            folder.join("settings.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let mut store = Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        assert_eq!(
            settings.task_reasoning_efforts.values(),
            ["medium", "low", "medium", "high", "high", "high", "high"]
        );
        // Windows supports Gemini only; retain the extended Codex check on other hosts.
        let provider = if cfg!(windows) { "gemini" } else { "codex" };
        let review = if cfg!(windows) { "high" } else { "xhigh" };
        store
            .save(&settings, KeyChange::Set("disposable-task-key"))
            .unwrap();
        settings.provider = provider.into();
        settings.task_reasoning_efforts.review = review.into();
        settings.task_reasoning_efforts.art = "medium".into();
        store.save(&settings, KeyChange::Keep).unwrap();
        drop(store);
        let mut store = Store::open(&file, &folder).unwrap();
        assert_eq!(
            store.settings().unwrap().task_reasoning_efforts.review,
            review
        );
        assert_eq!(
            store.settings().unwrap().task_reasoning_efforts.art,
            "medium"
        );
        settings.provider = "gemini".into();
        settings.task_reasoning_efforts.review = "xhigh".into();
        assert!(store.save(&settings, KeyChange::Delete).is_err());
        assert_eq!(store.key_for("gemini").unwrap(), "disposable-task-key");
        settings.provider = provider.into();
        settings.task_reasoning_efforts.review = review.into();
        settings.task_reasoning_efforts.plan = "invalid".into();
        assert!(store.save(&settings, KeyChange::Delete).is_err());
        assert_eq!(
            store.settings().unwrap().task_reasoning_efforts.plan,
            "high"
        );
        assert_eq!(store.key_for("gemini").unwrap(), "disposable-task-key");
        let partial: TaskReasoningEfforts = serde_json::from_str(r#"{"review":"medium"}"#).unwrap();
        assert_eq!(partial.review, "medium");
        assert_eq!(partial.plan, "high");
        assert!(serde_json::from_str::<TaskReasoningEfforts>(r#"{"unknown":"high"}"#).is_err());
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn reasoning_effort_reads_old_settings_and_persists_without_changing_keys() {
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let mut old = serde_json::to_value(Settings::defaults(&folder)).unwrap();
        old.as_object_mut().unwrap().remove("codexReasoningEffort");
        fs::write(
            folder.join("settings.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let store = Store::open(&file, &folder).unwrap();
        assert_eq!(store.settings().unwrap().codex_reasoning_effort, "");
        // Simulate an already-versioned database written by an older application.
        store
            .db
            .execute(
                "UPDATE desktop_settings SET value=?1 WHERE id=1",
                [old.to_string()],
            )
            .unwrap();
        drop(store);
        let mut store = Store::open(&file, &folder).unwrap();
        assert_eq!(store.settings().unwrap().codex_reasoning_effort, "");
        let mut settings = store.settings().unwrap();
        for effort in ["low", "medium", "high", "xhigh", "max", ""] {
            settings.codex_reasoning_effort = effort.into();
            store
                .save(&settings, KeyChange::Set("disposable-effort-test-key"))
                .unwrap();
            drop(store);
            store = Store::open(&file, &folder).unwrap();
            assert_eq!(store.settings().unwrap().codex_reasoning_effort, effort);
            assert_eq!(store.key().unwrap(), "disposable-effort-test-key");
        }
        for invalid in ["light", "LOW", "none", "low\n-c unsafe=true"] {
            settings.codex_reasoning_effort = invalid.into();
            assert!(store.save(&settings, KeyChange::Delete).is_err());
            assert_eq!(store.settings().unwrap().codex_reasoning_effort, "");
            assert_eq!(store.key().unwrap(), "disposable-effort-test-key");
        }
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn failed_key_write_rolls_back_settings_and_key() {
        let folder = folder();
        let mut store = Store::open(&folder.join("desktop.sqlite"), &folder).unwrap();
        let mut settings = store.settings().unwrap();
        store.save(&settings, KeyChange::Set("old")).unwrap();
        store.db.execute_batch("CREATE TRIGGER fail_key BEFORE UPDATE ON desktop_credentials BEGIN SELECT RAISE(ABORT,'test-only'); END;").unwrap();
        settings.port = 43130;
        assert!(store.save(&settings, KeyChange::Set("new")).is_err());
        assert_eq!(store.settings().unwrap().port, 3000);
        assert_eq!(store.key().unwrap(), "old");
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn corrupt_future_and_unknown_schema_are_preserved() {
        for kind in ["corrupt", "future", "unknown", "invalid-v1"] {
            let folder = folder();
            let file = folder.join("desktop.sqlite");
            if kind == "corrupt" {
                fs::write(&file, b"original corrupt database").unwrap();
            } else {
                let db = Connection::open(&file).unwrap();
                db.execute_batch(match kind {
                    "future" => "PRAGMA user_version=9;",
                    "unknown" => "CREATE TABLE unexpected (id);",
                    _ => "PRAGMA user_version=1;",
                })
                .unwrap();
            }
            let before = fs::read(&file).unwrap();
            assert!(Store::open(&file, &folder).is_err());
            assert_eq!(fs::read(&file).unwrap(), before);
            fs::remove_dir_all(folder).unwrap();
        }
    }
    #[test]
    fn settings_cannot_contain_secret_fields_or_invalid_values() {
        let mut settings = Settings::defaults(&std::env::temp_dir());
        let mut value = serde_json::to_value(&settings).unwrap();
        value["key"] = "never-persist-as-settings".into();
        assert!(serde_json::from_value::<Settings>(value).is_err());
        settings.text_model = "bad/model".into();
        assert!(settings.validate().is_err());
        settings.text_model = "valid".into();
        settings.openai_text_model.clear();
        assert!(settings.validate().is_err());
        settings.openai_text_model = openai_text_model();
        settings.openai_image_model.clear();
        assert!(settings.validate().is_err());
        settings.openai_image_model = openai_image_model();
        settings.port = 80;
        assert!(settings.validate().is_err());
    }
    #[cfg(windows)]
    #[test]
    fn windows_rejects_codex_without_changing_saved_gemini_settings() {
        let folder = folder();
        let mut store = Store::open(&folder.join("desktop.sqlite"), &folder).unwrap();
        let mut settings = store.settings().unwrap();
        store
            .save(&settings, KeyChange::Set("windows-test-key"))
            .unwrap();
        settings.provider = "codex".into();
        assert!(store.save(&settings, KeyChange::Delete).is_err());
        assert_eq!(store.settings().unwrap().provider, "gemini");
        assert_eq!(store.key().unwrap(), "windows-test-key");
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlink_database_is_rejected() {
        use std::os::unix::fs::symlink;
        let folder = folder();
        let target = folder.join("outside");
        fs::write(&target, b"untouched").unwrap();
        let file = folder.join("desktop.sqlite");
        symlink(&target, &file).unwrap();
        assert!(Store::open(&file, &folder).is_err());
        assert_eq!(fs::read(target).unwrap(), b"untouched");
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn version_one_migrates_preserving_keys_and_revision_rejects_stale_saves() {
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let db = Connection::open(&file).unwrap();
        db.execute_batch("CREATE TABLE desktop_settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE desktop_credentials(name TEXT PRIMARY KEY CHECK(name='gemini'),value TEXT NOT NULL); PRAGMA user_version=1;").unwrap();
        let mut old = serde_json::to_value(Settings::defaults(&folder)).unwrap();
        for field in [
            "providerConfigured",
            "libraryConfigured",
            "openaiTextModel",
            "openaiImageModel",
        ] {
            old.as_object_mut().unwrap().remove(field);
        }
        db.execute(
            "INSERT INTO desktop_settings VALUES(1,?1)",
            [old.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO desktop_credentials VALUES('gemini','fixture-gemini')",
            [],
        )
        .unwrap();
        drop(db);
        let mut store = Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        assert!(settings.provider_configured);
        assert!(settings.library_configured);
        assert_eq!(store.key().unwrap(), "fixture-gemini");
        let revision = store.revision().unwrap();
        settings.provider = "openai".into();
        store
            .save_at(&settings, KeyChange::Set("fixture-openai"), Some(revision))
            .unwrap();
        assert_eq!(store.key_for("gemini").unwrap(), "fixture-gemini");
        let (snapshot, seen_revision, has_gemini, has_openai) = store.settings_snapshot().unwrap();
        assert_eq!(snapshot.provider, "openai");
        assert!(has_gemini && has_openai);
        let mut other = Store::open(&file, &folder).unwrap();
        let mut newer = other.settings().unwrap();
        newer.port = 3455;
        other.save(&newer, KeyChange::Keep).unwrap();
        assert!(store
            .save_at(&snapshot, KeyChange::Keep, Some(seen_revision))
            .is_err());
        assert_eq!(store.settings_snapshot().unwrap().0.port, 3455);
        drop(other);
        assert!(store
            .save_at(&settings, KeyChange::Delete, Some(revision))
            .is_err());
        assert_eq!(store.key().unwrap(), "fixture-openai");
        settings.port = 3456;
        store.save(&settings, KeyChange::Keep).unwrap();
        store.reset_providers().unwrap();
        assert_eq!(store.settings().unwrap().port, 3456);
        assert_eq!(
            store.settings().unwrap().data_directory,
            settings.data_directory
        );
        assert!(!store.settings().unwrap().provider_configured);
        assert!(store.key_for("openai").unwrap().is_empty());
        assert!(store.key_for("gemini").unwrap().is_empty());
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn typescript_and_native_share_the_actual_database_protocol() {
        use std::process::Command;
        let folder = folder();
        let file = folder.join("desktop.sqlite");
        let library = folder.join("library");
        let module = Path::new(env!("CARGO_MANIFEST_DIR")).join("../server/system-settings.ts");
        let script = r#"import {pathToFileURL} from 'node:url';const {SystemSettingsStore}=await import(pathToFileURL(process.argv[1]).href);const store=new SystemSettingsStore(process.argv[2],process.argv[3]);if(process.argv[4]==='write'){store.save({provider:'openai',providerConfigured:true,libraryConfigured:true},{provider:'openai',value:'interop-test-only'});}else{if(store.settings().provider!=='gemini'||store.key('gemini')!=='native-test-only'||store.key('openai')!=='interop-test-only')throw Error('Interop mismatch');store.save({port:3457});}store.close();"#;
        let run = |phase: &str| {
            let status = Command::new("node")
                .args([
                    "--experimental-strip-types",
                    "--input-type=module",
                    "-e",
                    script,
                ])
                .arg(&module)
                .arg(&file)
                .arg(&library)
                .arg(phase)
                .status()
                .unwrap();
            assert!(status.success(), "TypeScript interoperability phase failed");
        };
        run("write");
        let mut store = Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        assert_eq!(settings.provider, "openai");
        assert_eq!(store.key().unwrap(), "interop-test-only");
        settings.provider = "gemini".into();
        store
            .save(&settings, KeyChange::Set("native-test-only"))
            .unwrap();
        drop(store);
        run("read");
        let store = Store::open(&file, &folder).unwrap();
        assert_eq!(store.settings().unwrap().port, 3457);
        drop(store);
        fs::remove_dir_all(folder).unwrap();
    }
}
