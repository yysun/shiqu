// Select verified bundled Node for Standard or system Node for Lite, then supervise private stdin.
use crate::config::Settings;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(feature = "bundled-node")]
use sha2::{Digest, Sha256};
#[cfg(any(not(feature = "bundled-node"), test))]
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

pub fn edition() -> &'static str {
    if cfg!(feature = "bundled-node") {
        "standard"
    } else {
        "lite"
    }
}

#[cfg(feature = "bundled-node")]
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

#[cfg(feature = "bundled-node")]
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

pub fn node_info(explicit: &str, root: &Path) -> Result<NodeInfo, String> {
    #[cfg(not(feature = "bundled-node"))]
    {
        let _ = root;
        detect(explicit)
    }
    #[cfg(feature = "bundled-node")]
    {
        let _ = explicit; // A saved Lite setting must never override Standard's runtime.
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
}

pub fn command(binary: &Path) -> Command {
    let mut cmd = Command::new(binary);
    // Do not inherit arbitrary Node injection flags or application/API credentials.
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
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ] {
        if let Some(value) = std::env::var_os(name) {
            cmd.env(name, value);
        }
    }
    // A GUI-launched app may have no nvm PATH; also let Codex find the selected Node.
    if let Some(parent) = binary.parent() {
        let mut paths = vec![parent.to_path_buf()];
        if let Some(current) = std::env::var_os("PATH") {
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
        .map_err(|_| "找不到或无法运行 Node。请选择 Node 24 可执行文件。")?;
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

#[cfg(any(not(feature = "bundled-node"), test))]
pub fn candidates() -> Vec<PathBuf> {
    let executable = if cfg!(windows) { "node.exe" } else { "node" };
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .map(|dir| dir.join(executable))
                .collect()
        })
        .unwrap_or_default();
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        paths.push(Path::new(directory).join(executable));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        let mut versions = fs::read_dir(home.join(".nvm/versions/node"))
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        paths.extend(
            versions
                .into_iter()
                .map(|version| version.join("bin").join(executable)),
        );
        paths.push(home.join(".volta/bin").join(executable));
        paths.push(
            home.join(".local/share/fnm/aliases/default/bin")
                .join(executable),
        );
    }
    for name in ["ProgramFiles", "LOCALAPPDATA", "NVM_SYMLINK"] {
        if let Some(value) = std::env::var_os(name) {
            paths.push(PathBuf::from(value).join(if name == "NVM_SYMLINK" {
                PathBuf::from(executable)
            } else {
                PathBuf::from("nodejs").join(executable)
            }));
        }
    }
    let mut unique = Vec::new();
    for file in paths {
        if file.is_file() && !unique.contains(&file) {
            unique.push(file);
        }
    }
    unique
}
#[cfg(any(not(feature = "bundled-node"), test))]
pub fn detect(explicit: &str) -> Result<NodeInfo, String> {
    if !explicit.trim().is_empty() {
        let file = Path::new(explicit);
        if !file.is_absolute() {
            return Err("请选择 Node 可执行文件的绝对路径。".into());
        }
        return probe(file);
    }
    for path in candidates() {
        if let Ok(info) = probe(&path) {
            return Ok(info);
        }
    }
    Err("未检测到兼容的 Node 24。请安装 Node 24，或手动选择已有安装。".into())
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

// Read bounded status frames for both readiness and later tunnel disconnects.
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
                        value = json!({"running":false,"phoneUrls":[],"publicUrl":"","error":value["error"]});
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
    key: &str,
    root: &Path,
    action: &str,
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
    let input = json!({"action":action,"settings":settings,"key":key});
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
    let response = receive
        .recv_timeout(Duration::from_secs(if action == "test" { 30 } else { 60 }))
        .ok();
    let Some(response) = response else {
        drop(child.stdin.take());
        let _ = wait(&mut child, Duration::from_secs(8));
        return Err("服务未及时启动。请检查 Node 24、端口和数据目录。".into());
    };
    if let Some(message) = response.get("error").and_then(Value::as_str) {
        drop(child.stdin.take());
        let _ = wait(&mut child, Duration::from_secs(8));
        return Err(message.chars().take(200).collect());
    }
    Ok((child, response, receive))
}

pub fn start(settings: &Settings, key: &str, root: &Path) -> Result<Runtime, String> {
    let ownership = lock(Path::new(&settings.data_directory))?;
    let (child, status, updates) = launch(settings, key, root, "start")?;
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
    #[cfg(feature = "bundled-node")]
    #[test]
    fn standard_uses_verified_bundle_and_ignores_saved_system_path() {
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
    #[cfg(feature = "bundled-node")]
    #[test]
    fn standard_rejects_missing_or_modified_bundle_without_fallback() {
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
            json!({"running":false,"phoneUrls":[],"publicUrl":"","error":"fatal"})
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
        assert!(detect("relative/node").is_err());
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
