"""Read-only compatibility check; run on the Docker host before an upgrade."""
import argparse
import json
import re
import subprocess

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--nextcloud',default='nextcloud')
p.add_argument('--candidate',required=True)
a=p.parse_args()
for name in (a.nextcloud,a.candidate):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+',name):p.error('Use a Docker container name')

def run(args):
    result=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=20)
    if result.returncode:raise SystemExit('Compatibility check failed. Inspect the candidate and Nextcloud health before upgrading.')
    return result.stdout.strip()

php=r'''define("OC_CONSOLE",true);require "/app/www/public/lib/base.php";
$b=\OCP\Server::get(\OCA\Memories\Service\BinExt::class);
echo json_encode(["required"=>$b::GOVOD_VER,"tested"=>$b->testGoVod("HOST:47788")]);'''.replace('HOST',a.candidate)
check=json.loads(run(['docker','exec','-u','abc',a.nextcloud,'php','-r',php]))
app=run(['docker','exec','-u','abc',a.nextcloud,'php','/app/www/public/occ','config:app:get','memories','installed_version'])
version=run(['docker','exec',a.candidate,'/app/go-vod','-version']).removeprefix('go-vod ')
container=json.loads(run(['docker','inspect',a.candidate]))[0]
env=dict(value.split('=',1) for value in container['Config']['Env'] if '=' in value)
expected_app=env.get('MEMORIES_EXPECTED_APP_VERSION')
if check['required']!=version or check['tested']['version']!=version or expected_app!=app:
    raise SystemExit('Version mismatch: keep the running stack unchanged and prepare a matching build.')
print(json.dumps({'compatible':True,'memories':app,'go_vod_required':check['required'],'go_vod_actual':version,'image_id':container['Image']},indent=2))
