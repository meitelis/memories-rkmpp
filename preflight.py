"""Read-only compatibility check; run on the Docker host before an upgrade."""

import argparse
import json
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--nextcloud", default="nextcloud")
parser.add_argument("--candidate", required=True)
args = parser.parse_args()
for name in (args.nextcloud, args.candidate):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
        parser.error("Use a Docker container name")


def run(command):
    try:
        result = subprocess.run(
            command, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit("Compatibility check could not complete; check Docker availability.") from error
    if result.returncode:
        raise SystemExit(
            "Compatibility check failed. Inspect the candidate and Nextcloud health before upgrading."
        )
    return result.stdout.strip()


php = r'''define("OC_CONSOLE",true);require "/app/www/public/lib/base.php";
$b=\OCP\Server::get(\OCA\Memories\Service\BinExt::class);
echo json_encode(["required"=>$b::GOVOD_VER,"tested"=>$b->testGoVod("HOST:47788")]);'''.replace(
    "HOST", args.candidate
)
check = json.loads(run(["docker", "exec", "-u", "abc", args.nextcloud, "php", "-r", php]))
app = run([
    "docker", "exec", "-u", "abc", args.nextcloud, "php", "/app/www/public/occ",
    "config:app:get", "memories", "installed_version",
])
version = run(["docker", "exec", args.candidate, "/app/go-vod", "-version"]).removeprefix("go-vod ")
container = json.loads(run(["docker", "inspect", args.candidate]))[0]
environment = dict(value.split("=", 1) for value in (container["Config"]["Env"] or []) if "=" in value)
expected_app = environment.get("MEMORIES_EXPECTED_APP_VERSION")
if check["required"] != version or check["tested"]["version"] != version or expected_app != app:
    raise SystemExit("Version mismatch: keep the running stack unchanged and prepare a matching build.")
print(json.dumps({
    "compatible": True,
    "memories": app,
    "go_vod_required": check["required"],
    "go_vod_actual": version,
    "image_id": container["Image"],
}, indent=2))
