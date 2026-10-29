// Discover/probe system Node and supervise a bounded private-stdin child without invoking a shell.
use crate::config::Settings;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const PROBE: &str = "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE probe(x)');db.prepare('SELECT 1').setReturnArrays(true);db.close();process.stdout.write(JSON.stringify({version:process.versions.node,path:process.execPath,sqlite:true}));";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub path: String,
    pub version: String,
    pub sqlite: bool,
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

pub struct Runtime {
    pub child: Child,
    pub status: Value,
    _ownership: File,
}
impl Runtime {
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
) -> Result<(Child, Value), String> {
    settings.validate()?;
    let node = detect(&settings.node_path)?;
    let entry = root.join("dist/server/desktop.js");
    if !entry.is_file() {
        return Err("应用运行资源缺失，请重新安装 Lite。".into());
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
        let mut reader = BufReader::new(output.take(16384));
        let mut line = String::new();
        let result = reader.read_line(&mut line).map(|_| line);
        let _ = send.send(result);
        // Drain bounded protocol diagnostics; never display raw process output.
        let mut discard = Vec::new();
        let _ = reader.read_to_end(&mut discard);
    });
    let response = receive
        .recv_timeout(Duration::from_secs(if action == "test" { 30 } else { 15 }))
        .ok()
        .and_then(Result::ok)
        .and_then(|line| serde_json::from_str::<Value>(&line).ok());
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
    Ok((child, response))
}

pub fn start(settings: &Settings, key: &str, root: &Path) -> Result<Runtime, String> {
    let ownership = lock(Path::new(&settings.data_directory))?;
    let (child, status) = launch(settings, key, root, "start")?;
    Ok(Runtime {
        child,
        status,
        _ownership: ownership,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_wrong_node_and_sqlite_capabilities() {
        assert!(validate_node(&NodeInfo {
            path: "node".into(),
            version: "22.23.4".into(),
            sqlite: true
        })
        .is_err());
        assert!(validate_node(&NodeInfo {
            path: "node".into(),
            version: "24.22.1".into(),
            sqlite: false
        })
        .is_err());
        validate_node(&NodeInfo {
            path: "node".into(),
            version: "24.22.1".into(),
            sqlite: true,
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
