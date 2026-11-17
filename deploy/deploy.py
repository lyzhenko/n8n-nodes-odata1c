#!/usr/bin/env python3
"""Deploy the packed n8n community node to the n8n host.

Builds the package, copies the tarball to the server, installs it into the n8n user
folder (`/var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-odata1c`) and restarts n8n.

Usage (from the repository root):
    uv run --with paramiko --with python-dotenv python deploy/deploy.py
    uv run --with paramiko --with python-dotenv python deploy/deploy.py --no-build
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = 'n8n-nodes-odata1c'
ENV_CANDIDATES = [
	ROOT / '.env',
	ROOT / 'deploy' / '.env',
	ROOT.parent / 'n8n_deploy' / '.env',
]
REMOTE_TGZ = f'/tmp/{PACKAGE}.tgz'


def load_env() -> dict[str, str]:
	for env_file in ENV_CANDIDATES:
		if not env_file.exists():
			continue
		raw = dotenv_values(env_file)
		env = {key: (value or '') for key, value in raw.items() if value}
		host = env.get('SSH_HOST') or env.get('SSH_PATH', '').replace('https://', '').replace('http://', '')
		user = env.get('SSH_USER') or env.get('SSH_USERNAME')
		password = env.get('SSH_PASSWORD') or env.get('SSH_PASS')
		if host and user and password:
			print(f'[deploy] credentials from {env_file}')
			return {'host': host, 'port': env.get('SSH_PORT') or '22', 'user': user, 'password': password}
	raise SystemExit(f'[deploy] no SSH credentials in {", ".join(str(p) for p in ENV_CANDIDATES)}')


def run_local(command: list[str], cwd: Path) -> None:
	print(f'[deploy] $ {" ".join(command)}')
	subprocess.run(' '.join(command), cwd=cwd, check=True, shell=(sys.platform == 'win32'))


def build_and_pack(no_build: bool) -> Path:
	tarballs = sorted(ROOT.glob(f'{PACKAGE}-*.tgz'), key=lambda path: path.stat().st_mtime)
	if not no_build or not tarballs:
		run_local(['npm', 'run', 'build'], ROOT)
		run_local(['npm', 'pack', '--silent'], ROOT)
		tarballs = sorted(ROOT.glob(f'{PACKAGE}-*.tgz'), key=lambda path: path.stat().st_mtime)
	if not tarballs:
		raise SystemExit('[deploy] npm pack produced no tarball')
	tarball = tarballs[-1]
	print(f'[deploy] package: {tarball.name} ({tarball.stat().st_size / 1024:.0f} KiB)')
	return tarball


def quote(value: str) -> str:
	return "'" + value.replace("'", "'\\''") + "'"


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument('--no-build', action='store_true', help='skip npm build and pack')
	args = parser.parse_args()

	env = load_env()
	tarball = build_and_pack(args.no_build)

	print(f"[deploy] connecting to {env['user']}@{env['host']}:{env['port']}")
	client = paramiko.SSHClient()
	client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
	client.connect(
		hostname=env['host'],
		port=int(env['port']),
		username=env['user'],
		password=env['password'],
		timeout=25,
		banner_timeout=30,
		allow_agent=False,
		look_for_keys=False,
	)

	try:
		sftp = client.open_sftp()
		sftp.put(str(tarball), REMOTE_TGZ)
		sftp.chmod(REMOTE_TGZ, 0o644)
		remote_script = '/tmp/install-node.sh'
		sftp.put(str(ROOT / 'deploy' / 'install-node.sh'), remote_script)
		sftp.chmod(remote_script, 0o755)
		sftp.close()

		command = f'bash {remote_script} {REMOTE_TGZ}'
		stdin, stdout, stderr = client.exec_command(
			f"sudo -S -p '' bash -c {quote(command)}", timeout=900
		)
		stdin.write(env['password'] + '\n')
		stdin.flush()
		output = stdout.read().decode('utf-8', 'replace')
		errors = stderr.read().decode('utf-8', 'replace')
		exit_code = stdout.channel.recv_exit_status()
		if output.strip():
			print(output)
		if errors.strip():
			print(errors, file=sys.stderr)
		print(f'[deploy] remote exit code: {exit_code}')
		return exit_code
	finally:
		client.close()


if __name__ == '__main__':
	raise SystemExit(main())
