# Verification evidence and safe reproduction

Audit date: 2026-10-12. Source commit: `0c7cd717c262b4fd5afcd1d785815cb53066c85e`.

## Prior executed checks

| Check | Result | What it establishes / limits |
| --- | --- | --- |
| Web tsc --noEmit --incremental false | Exit 0 | Installed TypeScript accepts frontend project; no browser/build/provider guarantee |
| Mobile tsc --noEmit --incremental false | Exit 0 | Installed TypeScript accepts native project; no native runtime/build guarantee |
| AST parse of backend/*.py and backend/app/**/*.py | 38 passed | Python syntax only; no application import |
| SQLite actual-function probes | Passed final corrected harness | AUD-002/003/007/008/009 behaviors in memory; real source functions with stubbed dependencies |
| Extracted intent classifiers | Passed | AUD-022 misclassification examples; no model call |
| Actual mobile api.ts with mocked XHR | Passed | AUD-016 drops split token but completes |
| Pure SPA path join | Uncontained relative path established | AUD-004 source weakness; not an HTTP normalization/exploit test |

Commands for the first three checks are in [AGENTS.md](../../AGENTS.md). They were not blindly rerun after the interruption because source and commit remained unchanged.

Initial disposable harness drafts encountered missing-stub and Windows text-decoding errors; those were corrected before the recorded successful runs. They were harness failures, not application verification results. Temporary tool stores were lost on interruption. The scripts below were reconstructed from retained conversation evidence and are marked separately in the post-resumption section.

## Dependency advisory scope

Read installed metadata without importing the application. pypdf 6.17.0 falls below the 6.18.1 patches for [GHSA-jw7q-gvrg-4vj3](https://github.com/py-pdf/pypdf/security/advisories/GHSA-jw7q-gvrg-4vj3), [GHSA-g9cg-prrw-2r8q](https://github.com/py-pdf/pypdf/security/advisories/GHSA-g9cg-prrw-2r8q), and [GHSA-fp3h-c4fm-7vvf](https://github.com/py-pdf/pypdf/security/advisories/GHSA-fp3h-c4fm-7vvf). These concern excessive processing/memory for malformed compressed streams and font data. See AUD-012.

Vite 8.2.2 matches the package range of [GHSA-9jrq-w75r-8gcw](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw), but its required custom middleware/transformIndexHtml setup was not found; the app uses ordinary SPA configuration. It is **not** asserted as an exploitable app finding. The older Windows path advisory [GHSA-fx2h-pf6j-xcff](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff) affects through Vite 8.0.15, not installed 8.2.2. No clean bill of health is implied: this was a targeted check, not exhaustive SCA/SBOM/license/container analysis.

## Isolated Python reproduction

Run the following from repository root with `python -B -` using stdin, or copy to a disposable script outside application source. It reads only allowlisted source files, compiles selected AST definitions into a stubbed namespace and uses SQLite :memory:. It does not import app modules, load .env, initialize a persistent vector store, or invoke providers/mail. It intentionally asserts the current defects; after fixes, assertions should be replaced with desired-behavior regression tests.

```python
import ast, pathlib, json, sqlite3, types, typing, contextlib, time, secrets, uuid, hashlib, base64, asyncio
from datetime import datetime, timedelta
from enum import Enum
root = pathlib.Path.cwd()
files = sorted((root / 'backend').glob('*.py')) + sorted((root / 'backend/app').rglob('*.py'))
for p in files:
    ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p))
print('Python AST parse:', len(files), 'files passed; no application imports')

def extract(path, names, ns):
    tree = ast.parse((root / path).read_text(encoding='utf-8-sig'))
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), ns)

class Logger:
    def __getattr__(self, name):
        return lambda *a, **k: None

class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail

ns = {**vars(typing), 'Path': pathlib.Path, 'datetime': datetime,
      'timedelta': timedelta, 'contextmanager': contextlib.contextmanager,
      'logger': Logger(), 'HTTPException': HttpError,
      'status': types.SimpleNamespace(HTTP_400_BAD_REQUEST=400, HTTP_404_NOT_FOUND=404),
      'json': json, 'uuid': uuid, 'secrets': secrets, 'time': time,
      'hashlib': hashlib, 'base64': base64, 're': __import__('re'), 'asyncio': asyncio}
for name in ['UserResponse', 'UserRegisterRequest', 'UserLoginRequest', 'SendOtpResponse',
             'ResetPasswordWithOtpRequest', 'GoogleAuthRequest', 'ChatSessionResponse',
             'MessageResponse', 'SessionHistoryResponse', 'DocumentMetadata', 'Citation',
             'MediaAttachment', 'MessageReplyReference']:
    ns[name] = lambda **k: types.SimpleNamespace(**k)

class ChatMode(str, Enum):
    AUTO = 'AUTO'
    WEB_SEARCH = 'WEB_SEARCH'

ns['ChatMode'] = ChatMode
ns['settings'] = types.SimpleNamespace(OTP_MAX_ATTEMPTS=3, TEMPORARY_CHAT_RETENTION_DAYS=3)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
tree = ast.parse((root / 'backend/app/db/database.py').read_text(encoding='utf-8-sig'))
for n in ast.walk(tree):
    if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'execute'
            and n.args and isinstance(n.args[0], ast.Constant)
            and isinstance(n.args[0].value, str)
            and n.args[0].value.strip().startswith('CREATE TABLE')):
        db.execute(n.args[0].value)
db.execute("INSERT INTO users VALUES ('u','fixture','fixture@example.invalid','Fixture','','','#123','','2026-01-01')")
db.execute("INSERT INTO email_otps VALUES ('o','fixture@example.invalid','123456',?,0,0,'2026-01-01')",
           (time.time() + 180,))
db.commit()

class Proxy:
    def __getattr__(self, n):
        return getattr(db, n)
    def close(self):
        pass

ns['sqlite3'] = types.SimpleNamespace(connect=lambda *a, **k: Proxy(), Row=sqlite3.Row)
ns['is_turso_configured'] = lambda: False
ns['get_db_path'] = lambda: ':memory:'
extract('backend/app/db/database.py', ['get_db_connection'], ns)
extract('backend/app/services/user_service.py',
        ['UserService', 'parse_google_id_token', 'hash_password', 'verify_password'], ns)
service = ns['UserService']()
for _ in range(4):
    try:
        service.verify_login_otp('fixture', '000000')
    except HttpError:
        pass
attempts = db.execute("SELECT attempts,is_used FROM email_otps WHERE id='o'").fetchone()
assert attempts['attempts'] == 0 and attempts['is_used'] == 0
print('OTP after four wrong attempts:', dict(attempts))

user = asyncio.run(service.authenticate_with_google(types.SimpleNamespace(
    credential=None, email='fixture@example.invalid', name=None, picture=None)))
assert user.id == 'u'
print('Google direct-email auth returned existing fixture account without credential')

extract('backend/app/services/chat_history_service.py', ['ChatHistoryService', 'get_row_value'], ns)
history = ns['ChatHistoryService']()
history.create_session('u', 's', mode=ChatMode.AUTO, is_temporary=True)
history.save_message('s', 'user', 'fixture message')
assert db.execute("SELECT COUNT(*) FROM messages WHERE session_id='s'").fetchone()[0] == 1
print('Temporary registered chat persists messages: confirmed')
history.create_session('u', 's', mode=ChatMode.AUTO)
assert db.execute("SELECT COUNT(*) FROM messages WHERE session_id='s'").fetchone()[0] == 0
print('Repeated session creation deletes prior messages through REPLACE cascade: confirmed')

ns['SessionState'] = lambda **k: types.SimpleNamespace(messages=[], **k)
ns['chat_history_service'] = history
extract('backend/app/repositories/session_store.py', ['SessionStoreRepository'], ns)
repo = ns['SessionStoreRepository']()
repo.record_message('s', 'user', 'cleared fixture')
history.save_message('s', 'user', 'cleared fixture')
history.clear_session_messages('s')
assert db.execute("SELECT count(*) FROM messages WHERE session_id='s'").fetchone()[0] == 0
assert repo.get_history_messages('s')[0]['content'] == 'cleared fixture'
print('Cleared DB history resurfaces through session cache: confirmed')

tree = ast.parse((root / 'backend/app/services/orchestrator.py').read_text(encoding='utf-8-sig'))
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
methods = [n for n in cls.body if isinstance(n, ast.FunctionDef)
           and n.name in ['_is_image_gen_intent', '_is_conversational_query']]
mini = ast.ClassDef(name='Router', bases=[], keywords=[], body=methods, decorator_list=[])
exec(compile(ast.fix_missing_locations(ast.Module(body=[mini], type_ignores=[])),
             'router-extract', 'exec'), ns)
router = ns['Router']()
assert router._is_conversational_query('Summarize key points covered in the document.')
assert router._is_image_gen_intent('Can you create a Python function?')
print('Document summary classified conversational; code creation classified image generation: confirmed')
base = pathlib.PurePosixPath('/app/frontend/dist')
assert '..' in (base / '../../backend/requirements.txt').parts
print('Uncontained SPA path join:', str(base / '../../backend/requirements.txt'))
db.close()
print('No app imports, configured DB, env files, provider calls, network or disk writes used.')
```

The fixture schema is extracted from actual CREATE TABLE statements but does not exercise migrations, FastAPI/Pydantic validation, middleware, concurrent transactions or the full production import graph. Stub UserResponse/SessionState types are deliberate. Do not interpret passing probes as comprehensive integration tests.

## Isolated mobile reproduction

Run from repository root with `node -` using stdin. It uses the already-installed frontend TypeScript package to transpile the actual native API module in memory; XHR and AsyncStorage are mocked, with no fetch/network capability exposed to that module.

```javascript
const fs = require('fs');
const ts = require('./frontend/node_modules/typescript');
const vm = require('vm');
let last;
class XHR {
  constructor() { last = this; this.responseText = ''; this.status = 200; }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {}
}
const mockExports = {};
const context = {
  exports: mockExports,
  require: n => n.includes('async-storage')
    ? {default: {getItem: async () => null}}
    : {Platform: {select: () => 'http://fixture.invalid'}},
  process: {env: {}},
  XMLHttpRequest: XHR, console, setTimeout, clearTimeout
};
const source = fs.readFileSync('mobile/src/services/api.ts', 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false}
}).outputText, context);
(async () => {
  const tokens = [];
  let completed = 0;
  mockExports.apiService.streamChat('fixture', 'hello', 'AUTO', {
    onToken: t => tokens.push(t), onComplete: () => completed++,
    onError: e => { throw Error(e); }, onCitations: () => {}
  });
  await new Promise(r => setImmediate(r));
  const event = 'data: {"event":"token","data":"hello"}\n\n';
  last.responseText = event.slice(0, 22); last.onprogress();
  last.responseText = event; last.onprogress();
  last.onload();
  if (tokens.length !== 0 || completed !== 1) throw Error('Unexpected result');
  console.log('Actual mobile streamChat, split JSON: token lost, completion reported; mocked XHR, no network.');
})();
```

A complete production parser test should cover every split offset, multiline/batched frames, EOF, Unicode, HTTP errors, abort and both terminal states; this probe establishes one concrete defect.

## Checks deliberately not executed

- Existing test_*.py/verify_*.py scripts: they use configured databases/providers and can write/send mail.
- Application import/startup, migrations, reset_db.py, cleanup or any user database inspection.
- npm/pip installs/updates, npm audit (network/environment side effects), production/web/native builds, Docker builds and EAS publish/deploy.
- Browser/device tests, production HTTP calls, provider quota/model tests, load tests, hostile-file payloads or cloud transaction experiments.
- Actual secret/environment/log/user-content reads.

Future runtime verification must use isolated disposable fixtures with explicitly approved external-service access if needed.

## Post-resumption verification

The reconstructed Python and JavaScript probes were rerun successfully (both exit 0). Python again parsed all 38 files and reproduced OTP rollback, direct-email Google impersonation, temporary SQL storage, REPLACE child deletion, cleared-cache fallback and routing misclassification. The mocked native stream again lost the split token while reporting completion. No application import, persistent-data access, provider request or network call was used.

Final reconciliation found 121 unique original inventory paths and exactly 121 ledger rows, with no missing/extra original paths: 77 Reviewed, 34 Partially Reviewed, 10 Excluded. All 33 unique AUD IDs resolve. All ten documentation files were readable UTF-8 and local Markdown targets existed. Git reported no changes to tracked baseline files; the only new files were the ten audit/knowledge Markdown documents. Previous TypeScript results remain historical and are not relabeled as rerun.

