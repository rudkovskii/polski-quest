#!/usr/bin/env python3
"""Поставить или снять LaunchAgent автовыкладки лент (`com.rudkovskiid.polski-feed`, tools/feed_watch.py).

npm run feed:install     поставить (или переставить) и запустить
npm run feed:uninstall   снять

Следит за источниками (WatchPaths) и раз в 5 минут (StartInterval: после сна и если событие пропущено). Логи — /tmp/polski-feed.*.log.
После установки агент вписан в реестр ноута `~/Documents/GitHub/scripts/laptop/registry.json` (руками).
"""
import os
import plistlib
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feed_watch import APP, PARTS  # noqa: E402

LABEL = 'com.rudkovskiid.polski-feed'
PLIST = Path.home() / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'
DOMAIN = f'gui/{os.getuid()}'


def launchctl(*args: str) -> int:
    return subprocess.run(['launchctl', *args], capture_output=True, text=True).returncode


def install() -> None:
    py = sys.executable
    path = os.pathsep.join(dict.fromkeys([str(Path(py).parent), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']))
    plist = {
        'Label': LABEL,
        'ProgramArguments': [py, str(APP / 'tools' / 'feed_watch.py')],
        'WorkingDirectory': str(APP),
        'WatchPaths': [str(p) for part in PARTS.values() for p in part['sources']],
        'StartInterval': 300,
        'RunAtLoad': True,
        'ThrottleInterval': 30,
        'ProcessType': 'Background',
        'LowPriorityIO': True,
        'Nice': 10,
        'EnvironmentVariables': {'PATH': path},
        'StandardOutPath': '/tmp/polski-feed.out.log',
        'StandardErrorPath': '/tmp/polski-feed.err.log',
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
