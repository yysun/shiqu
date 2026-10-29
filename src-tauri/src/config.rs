// Persist only allowlisted nonsecret settings; API keys belong exclusively to the OS keyring.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const SERVICE: &str = "com.shiqu.desktop";
const ACCOUNT: &str = "gemini-api-key";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub node_path: String,
    pub data_directory: String,
    pub port: u16,
    pub lan_enabled: bool,
    pub provider: String,
    pub text_model: String,
    pub image_model: String,
    pub codex_path: String,
    pub codex_model: String,
    pub codex_home: String,
}

impl Settings {
    pub fn defaults(data: &Path) -> Self {
        Self {
            node_path: String::new(),
            data_directory: data.join("library").to_string_lossy().into(),
            port: 3000,
            lan_enabled: false,
            provider: "gemini".into(),
            text_model: "gemini-3.8-flash".into(),
            image_model: "gemini-nano-banana-2.1".into(),
            codex_path: String::new(),
            codex_model: "gpt-6.1-sol".into(),
            codex_home: String::new(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.port < 1024 || !["gemini", "codex"].contains(&self.provider.as_str()) {
            return Err("请选择有效的提供方与 1024–65535 之间的端口。".into());
        }
        if !Path::new(&self.data_directory).is_absolute() || self.data_directory.len() > 4096 {
            return Err("数据目录必须是有效的绝对路径。".into());
        }
        for model in [&self.text_model, &self.image_model, &self.codex_model] {
            if model.len() > 100
                || !model
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            {
                return Err("模型名称只能包含字母、数字、点、横线和下划线。".into());
            }
        }
        if self.text_model.is_empty() || self.image_model.is_empty() {
            return Err("请填写文本和图片模型。".into());
        }
        for value in [
            &self.node_path,
            &self.codex_path,
            &self.codex_home,
            &self.data_directory,
        ] {
            if value.len() > 4096 || value.contains(['\0', '\n', '\r']) {
                return Err("文件路径无效。".into());
            }
        }
        if cfg!(windows) && self.provider == "codex" {
            return Err("当前 Codex 集成不支持原生 Windows；请选择 Gemini。".into());
        }
        Ok(())
    }
}

pub fn load(file: &Path, data: &Path) -> Result<Settings, String> {
    let settings = match fs::read(file) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "设置文件损坏，请备份后移除 settings.json。")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::defaults(data),
        Err(_) => return Err("无法读取桌面设置，请检查目录权限。".into()),
    };
    Ok(settings)
}

pub fn persist(file: &Path, settings: &Settings) -> Result<(), String> {
    settings.validate()?;
    let parent = file.parent().ok_or("设置目录无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建设置目录。")?;
    let temporary = file.with_extension("json.tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> std::io::Result<()> {
        let mut output = options.open(&temporary)?;
        output.write_all(&serde_json::to_vec_pretty(settings)?)?;
        output.sync_all()?;
        fs::rename(&temporary, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_| "无法保存桌面设置，请检查目录权限。".into())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| "无法打开系统凭据存储。".into())
}
pub fn key() -> Result<String, String> {
    match entry()?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(_) => Err("无法读取系统凭据存储；请解锁钥匙串或启动 Secret Service。".into()),
    }
}
pub fn edit_key(action: &str, value: &str) -> Result<(), String> {
    match action {
        "keep" => Ok(()),
        "replace"
            if !value.trim().is_empty()
                && value.len() <= 4096
                && !value.contains(['\0', '\n', '\r']) =>
        {
            entry()?
                .set_password(value.trim())
                .map_err(|_| "无法将密钥保存到系统凭据存储；未写入明文文件。".into())
        }
        "delete" => match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("无法删除系统凭据，请先解锁凭据存储。".into()),
        },
        _ => Err("请填写有效的密钥或保留现有密钥。".into()),
    }
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
    Ok((config.join("settings.json"), data))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_have_no_secret_field_and_reject_invalid_values() {
        let mut settings = Settings::defaults(&std::env::temp_dir());
        settings.validate().unwrap();
        let value = serde_json::to_value(&settings).unwrap();
        assert!(value.get("key").is_none());
        let mut poisoned = value.clone();
        poisoned["key"] = "should-never-persist".into();
        assert!(serde_json::from_value::<Settings>(poisoned).is_err());
        settings.text_model = "bad/model".into();
        assert!(settings.validate().is_err());
        settings.text_model = "valid-model".into();
        settings.port = 80;
        assert!(settings.validate().is_err());
    }
    #[test]
    fn settings_persist_without_credentials() {
        let folder = std::env::temp_dir().join(format!("shiqu-config-test-{}", std::process::id()));
        let file = folder.join("settings.json");
        let settings = Settings::defaults(&folder);
        persist(&file, &settings).unwrap();
        assert_eq!(
            load(&file, &folder).unwrap().data_directory,
            settings.data_directory
        );
        assert!(!fs::read_to_string(&file).unwrap().contains("apiKey"));
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    #[ignore = "Explicit disposable native credential-store integration test"]
    fn disposable_keyring_round_trip() {
        let item = keyring::Entry::new(
            "com.shiqu.desktop.lite.test",
            &format!("disposable-{}", std::process::id()),
        )
        .unwrap();
        item.set_password("shiqu-disposable-not-a-provider-key")
            .unwrap();
        assert_eq!(
            item.get_password().unwrap(),
            "shiqu-disposable-not-a-provider-key"
        );
        item.delete_credential().unwrap();
        assert!(matches!(item.get_password(), Err(keyring::Error::NoEntry)));
    }
}
