"""Validate the OpenAPI contract: parse, resolve every local $ref, report orphan schemas.

Run it from anywhere:  python backend/tools/validate_spec.py

Exits non-zero when a $ref points at a component that does not exist, which is the failure this
exists to catch -- a dangling ref is invisible to a YAML parser and shows up much later as a
missing schema in a generated client. Orphan schemas are reported but do not fail the run: a schema
that nothing references yet is usually a contract addition landing ahead of its endpoint.

Lives in tools/ rather than at the module root (tech debt D18) so that `backend/` holds the Maven
module and little else. It is kept rather than rewritten in Java because it has caught real
breakage after spec edits, and a working guardrail does not owe anyone a language choice.
"""
import re
import sys
from pathlib import Path

SPEC = (Path(__file__).resolve().parent.parent
        / 'src' / 'main' / 'resources' / 'static' / 'openapi' / 'draazy-api.yaml')

try:
    import yaml
except ImportError:
    sys.exit('PyYAML is required: python -m pip install pyyaml')

raw = SPEC.read_text(encoding='utf-8')
d = yaml.safe_load(raw)

print('spec:   ', SPEC)
print('paths:  ', len(d['paths']))
print('schemas:', len(d['components']['schemas']))

ops = sum(1 for p in d['paths'].values() for m in p if m in
          ('get', 'post', 'put', 'patch', 'delete'))
print('ops:    ', ops)

refs = set(re.findall(r"\$ref:\s*'#/components/([a-zA-Z]+)/([A-Za-z0-9_]+)'", raw))
missing = []
for kind, name in sorted(refs):
    if name not in d['components'].get(kind, {}):
        missing.append(kind + '/' + name)
print('DANGLING REFS:', missing or 'none')

used = {n for k, n in refs if k == 'schemas'}
orphans = sorted(set(d['components']['schemas']) - used)
print('orphan schemas:', len(orphans))
for o in orphans:
    print('   -', o)

sys.exit(1 if missing else 0)
