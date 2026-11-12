"""Additive, transactional migrations for the assistant security boundary.

Called inside init_db's transaction. Never opens an independent connection or
commits caller work. Legacy auth rows intentionally do not acquire fresh authority.
"""


def migrate_assistant_security(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS assistant_schema_versions (
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    if conn.execute("SELECT 1 FROM assistant_schema_versions WHERE version=1").fetchone():
        return
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(auth_sessions)").fetchall()}
    if "authenticated_at" not in columns:
        conn.execute("ALTER TABLE auth_sessions ADD COLUMN authenticated_at REAL NOT NULL DEFAULT 0")
    conn.execute("""CREATE TABLE assistant_devices (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, installation_id TEXT NOT NULL,
        public_key TEXT NOT NULL UNIQUE, platform TEXT NOT NULL,
        origin TEXT NOT NULL, created_at REAL NOT NULL, revoked_at REAL,
        UNIQUE(user_id, installation_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_challenges (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
        purpose TEXT NOT NULL, device_id TEXT, payload TEXT NOT NULL,
        public_key TEXT NOT NULL, installation_id TEXT NOT NULL, platform TEXT NOT NULL,
        expires_at REAL NOT NULL, consumed_at REAL,
        FOREIGN KEY(token_hash) REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_security_sessions (
        token_hash TEXT PRIMARY KEY, parent_token_hash TEXT NOT NULL,
        user_id TEXT NOT NULL, device_id TEXT, kind TEXT NOT NULL,
        csrf_hash TEXT, origin TEXT NOT NULL, api_origin TEXT NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(parent_token_hash) REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("CREATE INDEX idx_assistant_challenge_expiry ON assistant_challenges(expires_at)")
    conn.execute("CREATE INDEX idx_assistant_security_expiry ON assistant_security_sessions(expires_at)")
    conn.execute("CREATE INDEX idx_assistant_challenge_user ON assistant_challenges(user_id,consumed_at,expires_at)")
    conn.execute("CREATE INDEX idx_assistant_security_user ON assistant_security_sessions(user_id,expires_at)")
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(1)")
