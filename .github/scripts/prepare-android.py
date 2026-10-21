"""Configure the generated Tauri Android project for local hosting and signing."""

from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

app = Path("src-tauri/gen/android/app")
tauri = Path(__file__).resolve().parents[2] / "src-tauri"
activity = app / "src/main/java/io/github/nosugark/scankick/MainActivity.kt"
activity.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(tauri / "android/MainActivity.kt", activity)
# Android init creates its own launcher resources instead of using desktop icons.
shutil.copytree(tauri / "icons/android", app / "src/main/res", dirs_exist_ok=True)

# Gradle's default 10-second download timeout is too short for CI network stalls.
wrapper = app.parent / "gradle/wrapper/gradle-wrapper.properties"
properties = wrapper.read_text(encoding="utf-8").splitlines()
properties = [line for line in properties if not line.startswith("networkTimeout=")]
wrapper.write_text("\n".join([*properties, "networkTimeout=120000", ""]), encoding="utf-8")

android = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", android)
manifest = app / "src/main/AndroidManifest.xml"
tree = ET.parse(manifest)
root = tree.getroot()
permission = f"{{{android}}}name"
# The WebView asks for CAMERA at runtime for QR scanning; Android only prompts for declared permissions.
for name in ("android.permission.INTERNET", "android.permission.CAMERA"):
    if not any(p.get(permission) == name for p in root.findall("uses-permission")):
        ET.SubElement(root, "uses-permission", {permission: name})
if not any(f.get(permission) == "android.hardware.camera" for f in root.findall("uses-feature")):
    ET.SubElement(root, "uses-feature", {permission: "android.hardware.camera", f"{{{android}}}required": "false"})
application = root.find("application")
if application is None:
    raise SystemExit("Generated Android manifest is missing <application>")
application.set(f"{{{android}}}networkSecurityConfig", "@xml/scankick_network_security")
application.set(f"{{{android}}}icon", "@mipmap/ic_launcher")
application.set(f"{{{android}}}roundIcon", "@mipmap/ic_launcher")
# The controller needs landscape even when the phone has rotation locked.
for activity_tag in application.findall("activity"):
    activity_tag.set(f"{{{android}}}screenOrientation", "fullSensor")
tree.write(manifest, encoding="utf-8", xml_declaration=True)

# The native game connects only to the loopback WebSocket. Public online services
# keep using TLS; this does not enable cleartext traffic to arbitrary hosts.
network = app / "src/main/res/xml/scankick_network_security.xml"
network.parent.mkdir(parents=True, exist_ok=True)
network.write_text("""<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">tauri.localhost</domain>
    </domain-config>
</network-security-config>
""", encoding="utf-8")

gradle = app / "build.gradle.kts"
text = gradle.read_text(encoding="utf-8")
marker = "// ScanKick CI signing"
gradle.write_text(text.split(marker, 1)[0].rstrip() + """

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
} else {
    android {
        buildTypes.getByName("release").apply {
            signingConfig = signingConfigs.getByName("debug")
            applicationIdSuffix = ".debug"
        }
    }
}
""", encoding="utf-8")
