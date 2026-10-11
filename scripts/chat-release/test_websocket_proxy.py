import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('repair', Path(__file__).with_name('repair-websocket-proxy.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

class ProxyRepairTest(unittest.TestCase):
    def test_atomic_restore_after_invalid_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'nginx.conf'
            config.write_text('original config\n')
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                if len(calls) == 2:
                    raise subprocess.CalledProcessError(1, command)
            with patch.object(repair, 'CONFIG', config), patch.object(repair, 'patched', return_value='candidate config\n'), patch.object(repair.os, 'geteuid', return_value=0), patch.object(repair.subprocess, 'run', side_effect=run), patch('sys.argv', ['repair']):
                with self.assertRaises(subprocess.CalledProcessError):
                    repair.main()
            self.assertEqual(config.read_text(), 'original config\n')
            self.assertEqual(len(list(Path(directory).glob('*.before-*'))), 1)
            self.assertEqual(calls[-1], ['systemctl', 'reload', 'nginx'])

    def test_unknown_config_rejected(self):
        with self.assertRaises(RuntimeError):
            repair.patched('unreviewed configuration')

    def test_already_installed_is_idempotent(self):
        source = 'existing settings\n' + repair.BLOCK
        self.assertEqual(repair.patched(source), source)

if __name__ == '__main__':
    unittest.main()
