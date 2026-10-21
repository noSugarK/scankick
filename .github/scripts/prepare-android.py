"""Configure the generated Tauri Android project for local hosting and signing."""

from pathlib import Path
import xml.etree.ElementTree as ET

app = Path("src-tauri/gen/android/app")
android = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", android)
manifest = app / "src/main/AndroidManifest.xml"
tree = ET.parse(manifest)
root = tree.getroot()
permission = f"{{{android}}}name"
if not any(p.get(permission) == "android.permission.INTERNET" for p in root.findall("uses-permission")):
    ET.SubElement(root, "uses-permission", {permission: "android.permission.INTERNET"})
application = root.find("application")
if application is None:
    raise SystemExit("Generated Android manifest is missing <application>")
application.set(f"{{{android}}}networkSecurityConfig", "@xml/scankick_network_security")
tree.write(manifest, encoding="utf-8", xml_declaration=True)

# The native game connects only to the loopback WebSocket. Public online services
# keep using TLS; this does not enable cleartext traffic to arbitrary hosts.
network = app / "src/main/res/xml/scankick_network_security.xml"
network.parent.mkdir(parents=True, exist_ok=True)
network.write_text("""<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain>127.0.0.1</domain>
        <domain>localhost</domain>
        <domain>tauri.localhost</domain>
    </domain-config>
</network-security-config>
""", encoding="utf-8")

gradle = app / "build.gradle.kts"
text = gradle.read_text(encoding="utf-8")
marker = "// ScanKick CI signing"
if marker not in text:
    gradle.write_text(text + """
// ScanKick CI signing
if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
    android {
        signingConfigs {
            maybeCreate("release").apply {
                storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH"))
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("release")
    }
}
""", encoding="utf-8")
