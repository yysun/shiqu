// 启动前验证内置 Node，通过私有 stdin 监督服务，升级进度不受启动超时中断。
use crate::config::Settings;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::path::PathBuf;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const PROBE: &str = "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE probe(x)');db.prepare('SELECT 1').setReturnArrays(true);db.close();process.stdout.write(JSON.stringify({version:process.versions.node,path:process.execPath,sqlite:true,arch:process.arch,platform:process.platform}));";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub path: String,
    pub version: String,
    pub sqlite: bool,
    pub arch: String,
    pub platform: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    version: String,
    platform: String,
    arch: String,
    binary: String,
    sha256: String,
    license_sha256: String,
}

fn digest(file: &Path) -> Result<String, String> {
    let mut input = File::open(file).map_err(|_| "内置 Node 资源缺失，请重新安装拾趣。")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let size = input
            .read(&mut buffer)
            .map_err(|_| "无法校验内置 Node，请重新安装拾趣。")?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn node_info(_explicit: &str, root: &Path) -> Result<NodeInfo, String> {
    let directory = root.parent().ok_or("应用资源目录无效。")?.join("node");
    let manifest: BundleManifest = serde_json::from_slice(
        &fs::read(directory.join("manifest.json"))
            .map_err(|_| "内置 Node 清单缺失，请重新安装拾趣。")?,
    )
    .map_err(|_| "内置 Node 清单损坏，请重新安装拾趣。")?;
    let binary = if cfg!(windows) { "node.exe" } else { "node" };
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let version = include_str!("../../.nvmrc").trim();
    if manifest.version != version
        || manifest.platform != platform
        || manifest.arch != arch
        || manifest.binary != binary
    {
        return Err("内置 Node 与应用版本或平台不匹配，请重新安装拾趣。".into());
    }
    let executable = directory.join(binary);
    if digest(&executable)? != manifest.sha256
        || digest(&directory.join("LICENSE"))? != manifest.license_sha256
    {
        return Err("内置 Node 校验失败，请重新安装拾趣。".into());
    }
    let info = probe(&executable).map_err(|_| "内置 Node 无法运行，请重新安装拾趣。")?;
    if info.version != version || info.platform != platform || info.arch != arch {
        return Err("内置 Node 版本或架构不兼容，请重新安装拾趣。".into());
    }
    Ok(info)
}

pub fn command(binary: &Path) -> Command {
    command_with_env(binary, |name| std::env::var_os(name))
}

fn command_with_env(
    binary: &Path,
    environment: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> Command {
    let mut cmd = Command::new(binary);
    // 只继承启动所需的非密钥变量，不继承任意Node注入参数或应用/API凭据。
    cmd.env_clear();
    for name in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "SYSTEMROOT",
        "WINDIR",
        "SSL_CERT_FILE",
        "CODEX_CA_CERTIFICATE",
        "CODEX_HOME",
        "SHIQU_SKILL_AUTO_INSTALL",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ] {
        if let Some(value) = environment(name) {
            cmd.env(name, value);
        }
    }
    // 图形启动可能没有nvm路径；为子进程保留所选Node的目录。
    if let Some(parent) = binary.parent() {
        let mut paths = vec![parent.to_path_buf()];
        if let Some(current) = environment("PATH") {
            paths.extend(std::env::split_paths(&current));
        }
        if let Ok(path) = std::env::join_paths(paths) {
            cmd.env("PATH", path);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn wait(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err("子进程检查失败，请确认可执行文件与运行环境。".into())
                }
            }
            Err(_) => return Err("无法读取进程状态。".into()),
            _ => {}
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("进程检查超时，请检查可执行文件。".into());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn probe(binary: &Path) -> Result<NodeInfo, String> {
    let mut child = command(binary)
        .args(["--no-warnings", "-e", PROBE])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "内置 Node 无法运行，请重新安装拾趣。")?;
    wait(&mut child, Duration::from_secs(8))?;
    let mut text = String::new();
    child
        .stdout
        .take()
        .ok_or("Node 未返回状态。")?
        .take(4096)
        .read_to_string(&mut text)
        .map_err(|_| "无法读取 Node 检查结果。")?;
    let info: NodeInfo = serde_json::from_str(&text)
        .map_err(|_| "Node 未返回有效状态；需要支持 SQLite 的 Node 24。")?;
    validate_node(&info)?;
    Ok(info)
}
fn validate_node(info: &NodeInfo) -> Result<(), String> {
    if info.version.split('.').next() != Some("24") || !info.sqlite {
        return Err("需要 Node 24（推荐 24.22.1）及内置 SQLite；当前运行时不兼容。".into());
    }
    Ok(())
}

fn lock(directory: &Path) -> Result<File, String> {
    fs::create_dir_all(directory).map_err(|_| "无法创建数据目录。")?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join(".desktop.lock"))
        .map_err(|_| "无法打开数据目录锁。")?;
    file.try_lock_exclusive()
        .map_err(|_| "此数据目录已由另一个桌面实例使用。")?;
    Ok(file)
}

// 有界状态帧同时承载升级进度、启动结果及隧道变化。
fn stream_status(output: impl Read, send: mpsc::Sender<Value>) {
    let mut reader = BufReader::new(output);
    loop {
        let mut line = String::new();
        match reader.by_ref().take(16385).read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if line.len() > 16384 || !line.ends_with('\n') => break,
            Ok(_) => {
                if let Ok(mut value) = serde_json::from_str::<Value>(&line) {
                    // Fatal diagnostics precede asynchronous Node cleanup. Keep the
                    // React status contract valid while that process is still alive.
                    if value.get("error").and_then(Value::as_str).is_some() {
                        value["running"] = json!(false);
                        value["state"] = json!("failed");
                        value["phoneUrls"] = json!([]);
                        value["publicUrl"] = json!("");
                    }
                    if send.send(value).is_err() {
                        break;
                    }
                }
            }
        }
    }
}

pub struct Runtime {
    pub child: Child,
    pub status: Value,
    updates: mpsc::Receiver<Value>,
    _ownership: File,
}
impl Runtime {
    pub fn snapshot(&mut self) -> Value {
        for status in self.updates.try_iter() {
            self.status = status;
        }
        self.status.clone()
    }
    pub fn stop(&mut self) {
        if let Some(mut input) = self.child.stdin.take() {
            let _ = input.write_all(b"{\"action\":\"stop\"}\n");
        }
        // EOF is also the crash watchdog. Node kills its detached Codex groups before closing.
        let _ = wait(&mut self.child, Duration::from_secs(8));
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn launch(
    settings: &Settings,
    settings_file: &Path,
    root: &Path,
    on_status: impl Fn(Value),
) -> Result<(Child, Value, mpsc::Receiver<Value>), String> {
    settings.validate()?;
    let node = node_info(&settings.node_path, root)?;
    let entry = root.join("dist/server/desktop.js");
    if !entry.is_file() {
        return Err("应用运行资源缺失，请重新安装拾趣。".into());
    }
    let mut child = command(Path::new(&node.path))
        .arg("--no-warnings")
        .arg(&entry)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动 Node 服务。")?;
    let mut overrides = serde_json::Map::new();
    for name in [
        "SHIQU_AI_PROVIDER",
        "SHIQU_IMAGE_PROVIDER",
        "GEMINI_API_KEY",
        "GEMINI_TEXT_MODEL",
        "GEMINI_IMAGE_MODEL",
        "OPENAI_API_KEY",
        "OPENAI_TEXT_MODEL",
        "OPENAI_IMAGE_MODEL",
        "CODEX_BIN",
        "CODEX_MODEL",
        "SHIQU_CODEX_HOME",
        "CODEX_REASONING_EFFORT",
        "SHIQU_REASONING_SUGGEST",
        "SHIQU_REASONING_ART",
        "SHIQU_REASONING_FRAMES",
        "SHIQU_REASONING_OUTLINE",
        "SHIQU_REASONING_PLAN",
        "SHIQU_REASONING_REVIEW",
        "SHIQU_REASONING_REPAIR",
    ] {
        if let Ok(value) = std::env::var(name) {
            overrides.insert(name.into(), json!(value));
        }
    }
    let input = json!({"action":"start","settings":settings,"settingsFile":settings_file,"overrides":overrides});
    let wrote = child
        .stdin
        .as_mut()
        .ok_or("无法打开服务输入。")?
        .write_all(format!("{}\n", input).as_bytes());
    if wrote.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("无法发送服务配置。".into());
    }
    let output = child.stdout.take().ok_or("无法打开服务状态流。")?;
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        stream_status(output, send);
    });
    let response = startup_response(&receive, Duration::from_secs(60), on_status);
    let Some(response) = response else {
        drop(child.stdin.take());
        let _ = wait(&mut child, Duration::from_secs(8));
        return Err("服务未及时启动。请检查 Node 24、端口和数据目录。".into());
    };
    if let Some(message) = response.get("error").and_then(Value::as_str) {
        drop(child.stdin.take());
        let _ = wait(&mut child, Duration::from_secs(8));
        // stream_status already bounds the entire frame. Preserve the complete backup path.
        return Err(message.to_string());
    }
    Ok((child, response, receive))
}

// 升级期间无启动超时；收到 starting 后才重新启用启动期限，断流仍立即失败。
fn startup_response(
    receive: &mpsc::Receiver<Value>,
    timeout: Duration,
    on_status: impl Fn(Value),
) -> Option<Value> {
    let mut upgrading = false;
    loop {
        let value = if upgrading {
            receive.recv().ok()?
        } else {
            receive.recv_timeout(timeout).ok()?
        };
        on_status(value.clone());
        if value["running"] == true || value["error"].is_string() {
            return Some(value);
        }
        upgrading = value["state"] == "upgrading";
    }
}

pub fn start(
    settings: &Settings,
    settings_file: &Path,
    root: &Path,
    on_status: impl Fn(Value),
) -> Result<Runtime, String> {
    crate::library::needs_upgrade(Path::new(&settings.data_directory))?;
    let ownership = lock(Path::new(&settings.data_directory))?;
    let (child, status, updates) = launch(settings, settings_file, root, on_status)?;
    Ok(Runtime {
        child,
        status,
        updates,
        _ownership: ownership,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrade_wait_outlives_startup_timeout_and_preserves_backup() {
        let (send, receive) = mpsc::channel();
        send.send(json!({"state":"upgrading"})).unwrap();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            send.send(json!({"state":"starting","backup":"/isolated/verified-backup"}))
                .unwrap();
            send.send(json!({"running":true,"backup":"/isolated/verified-backup"}))
                .unwrap();
        });
        let result = startup_response(&receive, Duration::from_millis(10), |_| {}).unwrap();
        assert_eq!(result["backup"], "/isolated/verified-backup");
        let (send, receive) = mpsc::channel();
        drop(send);
        assert!(startup_response(&receive, Duration::from_millis(1), |_| {}).is_none());
    }
    #[test]
    fn integration_environment_survives_without_node_injection_or_credentials() {
        use std::ffi::{OsStr, OsString};
        let cmd = command_with_env(Path::new("/isolated/node"), |name| match name {
            "CODEX_HOME" => Some(OsString::from("/isolated/agent")),
            "SHIQU_SKILL_AUTO_INSTALL" => Some(OsString::from("off")),
            "NODE_OPTIONS" | "OPENAI_API_KEY" => Some(OsString::from("must-not-inherit")),
            _ => None,
        });
        let environment: std::collections::BTreeMap<_, _> = cmd.get_envs().collect();
        assert_eq!(
            environment.get(OsStr::new("CODEX_HOME")).copied().flatten(),
            Some(OsStr::new("/isolated/agent"))
        );
        assert_eq!(
            environment
                .get(OsStr::new("SHIQU_SKILL_AUTO_INSTALL"))
                .copied()
                .flatten(),
            Some(OsStr::new("off"))
        );
        assert!(!environment.contains_key(OsStr::new("NODE_OPTIONS")));
        assert!(!environment.contains_key(OsStr::new("OPENAI_API_KEY")));
    }

    #[test]
    fn desktop_uses_verified_bundle_and_ignores_saved_system_path() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop/resources/runtime");
        let info = node_info("/shiqu-system-node-must-not-be-used", &root).unwrap();
        assert_eq!(info.version, include_str!("../../.nvmrc").trim());
        assert_eq!(
            fs::canonicalize(PathBuf::from(info.path)).unwrap(),
            fs::canonicalize(root.parent().unwrap().join("node").join(if cfg!(windows) {
                "node.exe"
            } else {
                "node"
            }))
            .unwrap()
        );
    }
    #[test]
    fn desktop_rejects_missing_or_modified_bundle_without_fallback() {
        let folder =
            std::env::temp_dir().join(format!("shiqu-integrity-test-{}", std::process::id()));
        let root = folder.join("runtime");
        let directory = folder.join("node");
        assert!(node_info("/usr/local/bin/node", &root).is_err());
        fs::create_dir_all(&directory).unwrap();
        let binary = if cfg!(windows) { "node.exe" } else { "node" };
        fs::write(
            directory.join(binary),
            b"modified executable must never run",
        )
        .unwrap();
        fs::write(directory.join("LICENSE"), b"test license").unwrap();
        let manifest = json!({"version":include_str!("../../.nvmrc").trim(),"platform":if cfg!(target_os="macos") { "darwin" } else if cfg!(windows) { "win32" } else { "linux" },"arch":if cfg!(target_arch="aarch64") { "arm64" } else { "x64" },"binary":binary,"sha256":"0".repeat(64),"licenseSha256":digest(&directory.join("LICENSE")).unwrap()});
        fs::write(directory.join("manifest.json"), manifest.to_string()).unwrap();
        assert!(node_info("/usr/local/bin/node", &root)
            .err()
            .unwrap()
            .contains("校验失败"));
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn status_stream_keeps_disconnect_updates_after_large_readiness_frame() {
        let initial = json!({"running":true,"url":"http://127.0.0.1:3000","publicUrl":"https://test.trycloudflare.com/connect#private","padding":"x".repeat(12000)});
        let disconnected = json!({"running":true,"url":"http://127.0.0.1:3000","publicUrl":"","internetError":"disconnected","padding":"x".repeat(12000)});
        let (send, receive) = mpsc::channel();
        stream_status(
            std::io::Cursor::new(format!("{}\n{}\n", initial, disconnected)),
            send,
        );
        assert_eq!(receive.recv().unwrap(), initial);
        assert_eq!(receive.recv().unwrap(), disconnected);
        assert!(receive.recv().is_err());
        let (send, receive) = mpsc::channel();
        stream_status(
            std::io::Cursor::new(format!("{}\n{}\n", "x".repeat(17000), disconnected)),
            send,
        );
        assert!(receive.recv().is_err());
    }
    #[test]
    fn status_stream_normalizes_fatal_diagnostics_during_cleanup() {
        let initial = json!({"running":true,"url":"http://127.0.0.1:3000","phoneUrls":["http://192.168.1.2:3000"],"publicUrl":"https://test.trycloudflare.com/connect#private"});
        let (send, receive) = mpsc::channel();
        stream_status(
            std::io::Cursor::new(format!("{}\n{{\"error\":\"fatal\"}}\n", initial)),
            send,
        );
        assert_eq!(receive.recv().unwrap(), initial);
        assert_eq!(
            receive.recv().unwrap(),
            json!({"running":false,"state":"failed","phoneUrls":[],"publicUrl":"","error":"fatal"})
        );
        assert!(receive.recv().is_err());
    }
    #[test]
    fn rejects_wrong_node_and_sqlite_capabilities() {
        assert!(validate_node(&NodeInfo {
            path: "node".into(),
            version: "22.23.4".into(),
            sqlite: true,
            ..Default::default()
        })
        .is_err());
        assert!(validate_node(&NodeInfo {
            path: "node".into(),
            version: "24.22.1".into(),
            sqlite: false,
            ..Default::default()
        })
        .is_err());
        validate_node(&NodeInfo {
            path: "node".into(),
            version: "24.22.1".into(),
            sqlite: true,
            ..Default::default()
        })
        .unwrap();
        assert!(probe(Path::new("/shiqu-missing-node")).is_err());
    }
    #[test]
    fn exclusive_directory_lock_releases_with_owner() {
        let directory =
            std::env::temp_dir().join(format!("shiqu-lock-test-{}", std::process::id()));
        let first = lock(&directory).unwrap();
        assert!(lock(&directory).is_err());
        drop(first);
        drop(lock(&directory).unwrap());
        fs::remove_dir_all(directory).unwrap();
    }
}
