"""Run inside WSL only while both managed services are stopped. No sample execution."""
import hashlib, json, os, pathlib, tarfile, sys

workspace=pathlib.Path('/mnt/f/bigsinger/OxenWeb').resolve()
folder=pathlib.Path(sys.argv[1]).resolve()
if not folder.is_relative_to(workspace/'.data/backups'):
    raise RuntimeError('Backup escaped approved directory')
pointer=json.loads((workspace/'infra/oxen/run/data-location.json').read_text())
native=pathlib.Path(pointer['nativeDataDirectory']).resolve()
if str(native)!='/home/sing/.local/share/oxen-web/4ec72b115d9269a1/data':
    raise RuntimeError('Unexpected native source')
restore=pathlib.Path('/home/sing/.local/share/oxen-web/4ec72b115d9269a1/r3-restore-20261108')
if restore.exists(): raise RuntimeError('Restore scratch already exists')
restore.mkdir(parents=True)
def digest(file):
    h=hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda:stream.read(1024*1024),b''):h.update(part)
    return h.hexdigest()
def tree(root,exclude_backups=False):
    result={}
    for directory,dirs,files in os.walk(root,followlinks=False):
        rel=pathlib.Path(directory).relative_to(root)
        if exclude_backups and pathlib.Path(directory)==workspace/'.data':
            dirs[:]=[item for item in dirs if item!='backups']
        for name in dirs+files:
            file=pathlib.Path(directory)/name; key=str(file.relative_to(root))
            if file.is_symlink():result[key]={'link':os.readlink(file)}
            elif file.is_file():result[key]={'sha256':digest(file),'size':file.stat().st_size}
    return result
archives=[]
specs=[('oxen-native.tar',native,['.'],False),('web-control-plane.tar',workspace,['.data','infra/oxen/config','infra/oxen/run','infra/oxen/repos','infra/oxen/local.env']+(['.env'] if (workspace/'.env').exists() else []),True)]
for filename,source,members,exclude in specs:
    target=folder/filename
    def filtering(info):
        if exclude and (info.name=='.data/backups' or info.name.startswith('.data/backups/')): return None
        return info
    with tarfile.open(target,'x') as archive:
        for member in members:archive.add(source/member,arcname=member,filter=filtering)
    destination=restore/filename.removesuffix('.tar');destination.mkdir()
    with tarfile.open(target,'r') as archive:archive.extractall(destination,filter='data')
    expected={}
    for member in members:
        original=source/member
        if original.is_file():expected[member]={'sha256':digest(original),'size':original.stat().st_size}
        else:
            for key,value in tree(original,exclude).items():
                qualified=key if member=='.' else str(pathlib.Path(member)/key)
                if exclude and (qualified=='.data/backups' or qualified.startswith('.data/backups/')):continue
                expected[qualified]=value
    actual=tree(destination)
    if actual!=expected:
        raise RuntimeError('Restored bytes or links differ: '+filename)
    receipt={'file':filename,'sha256':digest(target),'bytes':target.stat().st_size,'verifiedEntries':len(actual)}
    archives.append(receipt)
    print(json.dumps(receipt),flush=True)
(folder/'backup-verified.json').write_text(json.dumps({'version':1,'verified':True,'archives':archives,'restoreDirectory':str(restore)},indent=2))
os.chmod(folder/'backup-verified.json',0o600)
print('Offline backup extracted and every file/link matched.',flush=True)
