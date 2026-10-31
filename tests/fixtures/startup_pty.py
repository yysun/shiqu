"""Test real terminal input against disposable CLI homes; never use personal settings or live providers."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = Path(sys.argv[1]).resolve()
NODE = Path(sys.argv[2]).resolve()
del sys.argv[1:]
ACTIVE_TERMINALS = []


class Terminal:
    def __init__(self, fixture, args):
        self.output = b""
        self.cursor = 0
        self.closed = False
        self.master, slave = pty.openpty()
        program = (
            "globalThis.fetch=async()=>{throw Error('TEST_EXTERNAL_NETWORK_DISABLED')};"
            "const {runCli}=await import(" + json.dumps((REPO / "server/cli.ts").as_uri()) + ");"
            "try{await runCli(process.argv[1],process.argv.slice(2));}"
            "catch(error){console.error(error.message);process.exitCode=1;}"
        )
        try:
            self.child = subprocess.Popen(
                [str(NODE), "--experimental-strip-types", "--input-type=module", "-e", program, str(fixture.root), *args],
                stdin=slave, stdout=slave, stderr=slave, cwd=fixture.root,
                env=fixture.env, start_new_session=True,
            )
        finally:
            os.close(slave)
        ACTIVE_TERMINALS.append(self)

    def read(self, timeout=0.1):
        if select.select([self.master], [], [], timeout)[0]:
            try:
                chunk = os.read(self.master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    return False
                raise
            self.output += chunk
            return bool(chunk)
        return True

    def expect(self, text, timeout=15):
        needle = text.encode()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            index = self.output.find(needle, self.cursor)
            if index >= 0:
                self.cursor = index + len(needle)
                return
            if not self.read():
                break
        # Only generated test keys can occur in these transcripts; still redact them on failure.
        transcript = self.output.decode(errors="replace")
        for key in ["test-only-openai", "test-only-gemini", "test-only-discarded", "test-only-edited"]:
            transcript = transcript.replace(key, "[test key]")
        raise AssertionError(f"Did not reach {text!r}; exit={self.child.poll()}; transcript={transcript}")

    def send(self, value):
        os.write(self.master, value.encode())

    def request_json(self, url):
        def request():
            with urllib.request.urlopen(url, timeout=5) as response:
                return json.load(response)

        # A real terminal keeps draining output while a phone/browser makes an HTTP request.
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(request)
            while not pending.done():
                self.read()
            return pending.result()

    def finish(self, expected=0):
        deadline = time.monotonic() + 10
        while self.child.poll() is None and time.monotonic() < deadline:
            self.read()
        if self.child.poll() is None:
            raise AssertionError("CLI did not exit after configuration completed")
        while self.read(0):
            if not select.select([self.master], [], [], 0)[0]:
                break
        if self.child.returncode != expected:
            raise AssertionError(f"CLI exit {self.child.returncode}, expected {expected}")

    def close(self):
        if self.closed:
            return
        if self.child.poll() is None:
            self.child.send_signal(signal.SIGTERM)
            deadline = time.monotonic() + 5
            while self.child.poll() is None and time.monotonic() < deadline:
                self.read()
            if self.child.poll() is None:
                # This process group belongs only to the child created above.
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=5)
        os.close(self.master)
        self.closed = True
        ACTIVE_TERMINALS.remove(self)


class StartupTerminalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="shiqu-startup-pty-")
        self.root = Path(self.temporary.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        shutil.copytree(REPO / "drizzle", self.root / "drizzle")
        (self.root / "docker").mkdir()
        shutil.copyfile(REPO / "docker/seed.sql", self.root / "docker/seed.sql")
        (self.root / "dist/client").mkdir(parents=True)
        (self.root / "dist/client/index.html").write_text("<html>PTY fixture</html>")
        self.env = {
            "PATH": str(NODE.parent), "HOME": str(self.home), "USERPROFILE": str(self.home),
            "APPDATA": str(self.home / "roaming"), "LOCALAPPDATA": str(self.home / "local"),
            "XDG_CONFIG_HOME": str(self.home / "config"), "XDG_DATA_HOME": str(self.home / "data"),
            "LANG": "en_US.UTF-8",
        }
        if "TMPDIR" in os.environ:
            self.env["TMPDIR"] = os.environ["TMPDIR"]
        fake_codex = self.root / "forbidden-codex"
        fake_codex.write_text(f"#!{NODE}\nthrow Error('PTY_MUST_NOT_INVOKE_CODEX');\n")
        fake_codex.chmod(0o700)
        self.env["CODEX_BIN"] = str(fake_codex)
        config = self.home / "Library/Application Support" if sys.platform == "darwin" else self.home / "config"
        self.database = config / "com.shiqu.desktop/desktop.sqlite"
        self.children = []
        self.assertTrue(self.database.is_relative_to(self.root))

    def tearDown(self):
        try:
            for child in reversed(self.children):
                child.close()
        finally:
            self.temporary.cleanup()

    def start(self, *args):
        child = Terminal(self, list(args))
        self.children.append(child)
        return child

    def state(self):
        self.assertTrue(self.database.is_relative_to(self.root))
        with sqlite3.connect(self.database) as db:
            settings, revision = db.execute("SELECT value,revision FROM desktop_settings WHERE id=1").fetchone()
            keys = dict(db.execute("SELECT name,value FROM desktop_credentials"))
        return json.loads(settings), revision, keys

    def choose(self, child, provider, key=None, models=("", "")):
        child.expect("输入编号或名称")
        child.send(provider + "\n")
        if provider in ["openai", "gemini"]:
            child.expect("API 密钥（输入隐藏")
            child.send((key or "") + "\n")
            child.expect("文本模型")
            child.send(models[0] + "\n")
            child.expect("图片模型")
            child.send(models[1] + "\n")
        elif provider == "codex":
            child.expect("Codex 模型")
            child.send("\n")

    def configure(self, provider, key=None, models=("", "")):
        child = self.start("--configure")
        self.choose(child, provider, key, models)
        child.expect("服务配置已保存。")
        child.finish()
        if key:
            self.assertNotIn(key.encode(), child.output)
        return child

    def running(self):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        return self.start("--port", str(port)), port

    def test_first_launch_each_provider_and_restart_without_questions(self):
        # Every first launch starts with a fresh home, so no prior provider hides setup bugs.
        for provider in ["openai", "gemini", "codex", "readonly"]:
            with self.subTest(provider=provider):
                if self.database.exists():
                    shutil.rmtree(self.database.parent)
                    for shelf in [self.home / "Library/Application Support/com.shiqu.desktop/library", self.home / "data/com.shiqu.desktop/library"]:
                        if shelf.exists():
                            shutil.rmtree(shelf)
                child, port = self.running()
                child.expect("请输入要使用或创建的目录")
                child.send("\n")
                self.choose(child, provider, "test-only-" + provider)
                child.expect("拾趣: http://")
                if provider != "codex":
                    status = child.request_json(f"http://127.0.0.1:{port}/api/reader/status")
                    self.assertEqual(status["provider"], provider)
                self.assertNotIn(("test-only-" + provider).encode(), child.output)
                child.close()
                self.children.remove(child)
                restarted, _ = self.running()
                restarted.expect("拾趣: http://")
                self.assertNotIn("选择生成服务".encode(), restarted.output)
                self.assertNotIn("请输入要使用或创建的目录".encode(), restarted.output)
                restarted.close()
                self.children.remove(restarted)

    def test_configure_before_library_selection(self):
        self.configure("openai", "test-only-openai")
        settings, _, _ = self.state()
        self.assertFalse(settings["libraryConfigured"])
        self.assertFalse(Path(settings["dataDirectory"]).exists())
        child, _ = self.running()
        child.expect("请输入要使用或创建的目录")
        child.send(str(self.root / "confirmed shelf") + "\n")
        child.expect("拾趣: http://")
        self.assertNotIn("选择生成服务".encode(), child.output)
        self.assertEqual(self.state()[0]["dataDirectory"], str(self.root / "confirmed shelf"))

    def test_cancelled_first_library_choice_has_no_database(self):
        for cancel in ["\x03", "\x04"]:
            with self.subTest(cancel=repr(cancel)):
                child, _ = self.running()
                child.expect("请输入要使用或创建的目录")
                child.send(cancel)
                child.expect("已取消选择书库")
                child.finish(1)
                self.assertFalse(self.database.exists())

    def test_key_and_model_cancellation_never_partially_save(self):
        self.configure("openai", "test-only-openai")
        before = self.state()
        for cancel in ["\x03", "\x04"]:
            with self.subTest(cancel=repr(cancel)):
                child = self.start("--configure")
                child.expect("输入编号或名称")
                child.send("gemini\n")
                child.expect("API 密钥（输入隐藏")
                child.send("test-only-discarded" + cancel)
                child.expect("已取消服务配置")
                child.finish(1)
                self.assertNotIn(b"test-only-discarded", child.output)
                self.assertEqual(self.state(), before)
        child = self.start("--configure")
        child.expect("输入编号或名称")
        child.send("gemini\n")
        child.expect("API 密钥（输入隐藏")
        child.send("test-only-discarded\n")
        child.expect("文本模型")
        child.send("\x04")
        child.expect("已取消服务配置")
        child.finish(1)
        self.assertEqual(self.state(), before)

    def test_switching_blank_retention_and_reset_preserve_non_provider_data(self):
        self.configure("openai", "test-only-openai", ("test-openai-text", "test-openai-image"))
        self.configure("gemini", "test-only-gemini", ("test-gemini-text", "test-gemini-image"))
        self.configure("readonly")
        self.configure("openai")
        settings, _, keys = self.state()
        self.assertEqual(keys, {"openai": "test-only-openai", "gemini": "test-only-gemini"})
        self.assertEqual(settings["openaiTextModel"], "test-openai-text")
        self.assertEqual(settings["textModel"], "test-gemini-text")
        library = self.root / "preserved shelf"
        library.mkdir()
        sentinel = library / "existing-story.bin"
        sentinel.write_bytes(b"test-only-existing-story-do-not-change")
        settings.update(dataDirectory=str(library), libraryConfigured=True, port=3458, internetEnabled=True)
        with sqlite3.connect(self.database) as db:
            db.execute("UPDATE desktop_settings SET value=?,revision=revision+1", [json.dumps(settings)])
        reset = self.start("--reset-providers")
        self.choose(reset, "readonly")
        reset.expect("服务配置已保存。")
        reset.finish()
        after, _, keys = self.state()
        self.assertEqual(keys, {})
        for field in ["dataDirectory", "libraryConfigured", "port", "internetEnabled"]:
            self.assertEqual(after[field], settings[field])
        self.assertEqual(sentinel.read_bytes(), b"test-only-existing-story-do-not-change")

    def test_empty_new_key_fails_without_partial_profile(self):
        self.configure("readonly")
        before = self.state()
        child = self.start("--configure")
        child.expect("输入编号或名称")
        child.send("invalid-provider\n")
        child.expect("输入编号或名称")
        child.send("openai\n")
        child.expect("API 密钥（输入隐藏")
        child.send("\n")
        child.expect("未输入 API 密钥")
        child.finish(1)
        self.assertEqual(self.state(), before)


if __name__ == "__main__":
    def terminate(_signal, _frame):
        # A CI watchdog must also stop each child in its independently owned PTY process group.
        for terminal in list(ACTIVE_TERMINALS):
            terminal.close()
        raise SystemExit(143)
    signal.signal(signal.SIGTERM, terminate)
    unittest.main(verbosity=2)
