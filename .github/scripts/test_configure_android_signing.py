import base64
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


class AndroidSigningTest(unittest.TestCase):
    def test_release_requires_all_signing_secrets_before_exporting_configuration(self):
        for secrets in ({}, {'ANDROID_KEY_ALIAS': 'test'}):
            with self.subTest(secrets=secrets), tempfile.TemporaryDirectory() as directory:
                with patch.dict(os.environ, {'GITHUB_REF_TYPE': 'tag', 'RUNNER_TEMP': directory, **secrets}, clear=True):
                    with self.assertRaisesRegex(SystemExit, 'all four'):
                        runpy.run_path(str(Path(__file__).with_name('configure-android-signing.py')))
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_branch_test_build_and_signed_release_export_expected_configuration(self):
        for signed in (False, True):
            with self.subTest(signed=signed), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                environment = {
                    'GITHUB_REF_TYPE': 'tag' if signed else 'branch',
                    'RUNNER_TEMP': directory,
                    'GITHUB_ENV': str(root / 'env'),
                    'GITHUB_OUTPUT': str(root / 'output'),
                    'GITHUB_STEP_SUMMARY': str(root / 'summary'),
                }
                if signed:
                    environment.update({
                        'ANDROID_KEYSTORE_BASE64': base64.b64encode(b'test-keystore').decode(),
                        'ANDROID_KEYSTORE_PASSWORD': 'store-password',
                        'ANDROID_KEY_ALIAS': 'test',
                        'ANDROID_KEY_PASSWORD': 'key-password',
                    })
                with patch.dict(os.environ, environment, clear=True):
                    runpy.run_path(str(Path(__file__).with_name('configure-android-signing.py')))
                self.assertEqual((root / 'output').read_text(), f'signed={str(signed).lower()}\n')
                key = root / 'scankick-upload.jks'
                if signed:
                    self.assertEqual(key.read_bytes(), b'test-keystore')
                    self.assertEqual(key.stat().st_mode & 0o777, 0o600)
                    self.assertEqual((root / 'env').read_text(), f'ANDROID_KEYSTORE_PATH={key}\n')
                else:
                    self.assertFalse(key.exists())
                    self.assertFalse((root / 'env').exists())


if __name__ == '__main__':
    unittest.main()
