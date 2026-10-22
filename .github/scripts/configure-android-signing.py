"""Require a persistent Android signing key for published releases."""

import base64
import os
from pathlib import Path

names = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']
present = [bool(os.environ.get(name)) for name in names]
if any(present) and not all(present):
    raise SystemExit('Configure all four ANDROID_KEYSTORE_* / ANDROID_KEY_* secrets, or leave all unset for branch test builds')

signed = all(present)
if os.environ.get('GITHUB_REF_TYPE') == 'tag' and not signed:
    raise SystemExit('Release APKs require a persistent signing key. Configure all four ANDROID_KEYSTORE_* / ANDROID_KEY_* secrets; temporary test keys cannot support upgrades.')

if signed:
    key = base64.b64decode(os.environ['ANDROID_KEYSTORE_BASE64'], validate=True)
    if not key:
        raise SystemExit('Android signing keystore is empty')
    path = Path(os.environ['RUNNER_TEMP']) / 'scankick-upload.jks'
    path.touch(mode=0o600)
    path.chmod(0o600)
    path.write_bytes(key)
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        output.write(f'ANDROID_KEYSTORE_PATH={path}\n')
with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
    output.write(f'signed={str(signed).lower()}\n')
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
    output.write('Android: release build with production signing.\n' if signed else 'Android: branch test build with temporary signing; not suitable for upgrades or publication.\n')
