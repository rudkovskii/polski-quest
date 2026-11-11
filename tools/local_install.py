#!/usr/bin/env python3
"""Поставить или снять LaunchAgent локального сервера игры (`com.rudkovskiid.polski-local`, tools/local_server.py).

npm run local:install     поставить (или переставить) и запустить
npm run local:uninstall   снять

RunAtLoad + KeepAlive: сервер поднимается после входа в систему и перезапускается при падении. Логи — /tmp/polski-local.*.log.
Агент вписан в реестр ноута `~/Documents/GitHub/scripts/laptop/registry.json`.
"""
import os
import plistlib
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from local_site import APP  # noqa: E402

LABEL = 'com.rudkovskiid.polski-local'
PLIST = Path.home() / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'
DOMAIN = f'gui/{os.getuid()}'


def launchctl(*args: str) -> int:
    return subprocess.run(['launchctl', *args], capture_output=True, text=True).returncode


def install() -> None:
    plist = {
        'Label': LABEL,
        'ProgramArguments': [sys.executable, str(APP / 'tools' / 'local_server.py')],
        'WorkingDirectory': str(APP),
        'RunAtLoad': True,
        'KeepAlive': True,
        'ThrottleInterval': 10,
        'ProcessType': 'Background',
        'StandardOutPath': '/tmp/polski-local.out.log',
        'StandardErrorPath': '/tmp/polski-local.err.log',
    }
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    launchctl('bootout', f'{DOMAIN}/{LABEL}')
    with PLIST.open('wb') as f:
        plistlib.dump(plist, f)
    if launchctl('bootstrap', DOMAIN, str(PLIST)):
        sys.exit(f'launchctl bootstrap не прошёл: {PLIST}')
    print(f'поставлен {LABEL}: {PLIST}')


def uninstall() -> None:
    launchctl('bootout', f'{DOMAIN}/{LABEL}')
    PLIST.unlink(missing_ok=True)
    print(f'снят {LABEL}')


if __name__ == '__main__':
    {'install': install, 'uninstall': uninstall}.get(sys.argv[1] if len(sys.argv) > 1 else '', lambda: sys.exit(__doc__))()
