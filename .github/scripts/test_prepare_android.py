import os
from pathlib import Path
import runpy
import tempfile
import unittest
import xml.etree.ElementTree as ET


class AndroidConfigTest(unittest.TestCase):
    def test_generated_project_keeps_permissions_and_is_idempotent(self):
        script = Path(__file__).with_name("prepare-android.py").resolve()
        namespace = "http://schemas.android.com/apk/res/android"
        for internet in (False, True):
            with self.subTest(existing_internet=internet), tempfile.TemporaryDirectory() as directory:
                previous = Path.cwd()
                try:
                    os.chdir(directory)
                    app = Path("src-tauri/gen/android/app")
                    (app / "src/main").mkdir(parents=True)
                    permission = '<uses-permission android:name="android.permission.INTERNET" />' if internet else ''
                    manifest = app / "src/main/AndroidManifest.xml"
                    manifest.write_text(f'<manifest xmlns:android="{namespace}">{permission}<uses-permission android:name="android.permission.VIBRATE"/><application android:label="ScanKick" /></manifest>', encoding="utf-8")
                    gradle = app / "build.gradle.kts"
                    gradle.write_text('plugins { id("com.android.application") }\n', encoding="utf-8")
                    runpy.run_path(str(script))
                    first_manifest = manifest.read_bytes()
                    first_gradle = gradle.read_bytes()
                    runpy.run_path(str(script))
                    self.assertEqual(manifest.read_bytes(), first_manifest)
                    self.assertEqual(gradle.read_bytes(), first_gradle)
                    root = ET.parse(manifest).getroot()
                    permissions = [p.get(f"{{{namespace}}}name") for p in root.findall("uses-permission")]
                    self.assertEqual(permissions.count("android.permission.INTERNET"), 1)
                    self.assertIn("android.permission.VIBRATE", permissions)
                    self.assertEqual(root.find("application").get(f"{{{namespace}}}label"), "ScanKick")
                    network = ET.parse(app / "src/main/res/xml/scankick_network_security.xml").getroot()
                    self.assertEqual(network.find("base-config").get("cleartextTrafficPermitted"), "false")
                    domains = {d.text for d in network.findall("domain-config/domain")}
                    self.assertEqual(domains, {"127.0.0.1", "localhost", "tauri.localhost"})
                    self.assertIn('System.getenv("ANDROID_KEYSTORE_PASSWORD")', gradle.read_text(encoding="utf-8"))
                finally:
                    os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
