"""Additive, transactional migrations for the assistant security boundary.

Called inside init_db's transaction. Never opens an independent connection or
commits caller work. Legacy auth rows intentionally do not acquire fresh authority.
"""


def _migrate_security_v1(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS assistant_schema_versions (
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=1"
    ).fetchone():
        return
    columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(auth_sessions)").fetchall()
    }
    if "authenticated_at" not in columns:
        conn.execute(
            "ALTER TABLE auth_sessions ADD COLUMN authenticated_at REAL NOT NULL DEFAULT 0"
        )
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
    conn.execute(
        "CREATE INDEX idx_assistant_challenge_expiry ON assistant_challenges(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_assistant_security_expiry ON assistant_security_sessions(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_assistant_challenge_user ON assistant_challenges(user_id,consumed_at,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_assistant_security_user ON assistant_security_sessions(user_id,expires_at)"
    )
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(1)")


def _migrate_simulation_v2(conn) -> None:
    _migrate_security_v1(conn)
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=2"
    ).fetchone():
        return
    conn.execute("""CREATE TABLE assistant_simulation_sessions (
        token_hash TEXT PRIMARY KEY, parent_security_hash TEXT NOT NULL,
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(parent_security_hash) REFERENCES assistant_security_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, proposal_digest TEXT NOT NULL,
        policy_version INTEGER NOT NULL, state TEXT NOT NULL,
        created_at REAL NOT NULL, expires_at REAL NOT NULL,
        UNIQUE(user_id,device_id,idempotency_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_actions (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_index INTEGER NOT NULL,
        action_json TEXT NOT NULL, arguments_digest TEXT NOT NULL,
        dependencies_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL, claim_id TEXT, claim_expires_at REAL,
        UNIQUE(task_id,step_index),
        FOREIGN KEY(task_id) REFERENCES assistant_tasks(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_action_challenges (
        id TEXT PRIMARY KEY, action_id TEXT NOT NULL, session_hash TEXT NOT NULL,
        purpose TEXT NOT NULL, payload TEXT NOT NULL, expires_at REAL NOT NULL,
        consumed_at REAL,
        FOREIGN KEY(action_id) REFERENCES assistant_actions(id) ON DELETE CASCADE,
        FOREIGN KEY(session_hash) REFERENCES assistant_simulation_sessions(token_hash) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_permits (
        token_hash TEXT PRIMARY KEY, action_id TEXT NOT NULL,
        session_hash TEXT NOT NULL, action_revision INTEGER NOT NULL,
        expires_at REAL NOT NULL, consumed_at REAL,
        FOREIGN KEY(action_id) REFERENCES assistant_actions(id) ON DELETE CASCADE,
        FOREIGN KEY(session_hash) REFERENCES assistant_simulation_sessions(token_hash) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        action_id TEXT, state TEXT NOT NULL, created_at REAL NOT NULL,
        FOREIGN KEY(task_id) REFERENCES assistant_tasks(id) ON DELETE CASCADE
    )""")
    conn.execute(
        "CREATE INDEX idx_simulation_sessions_parent ON assistant_simulation_sessions(parent_security_hash)"
    )
    conn.execute(
        "CREATE INDEX idx_simulation_sessions_user ON assistant_simulation_sessions(user_id,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_simulation_sessions_expiry ON assistant_simulation_sessions(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_tasks_user_created ON assistant_tasks(user_id,created_at)"
    )
    conn.execute("CREATE INDEX idx_tasks_created ON assistant_tasks(created_at)")
    conn.execute("CREATE INDEX idx_tasks_device ON assistant_tasks(device_id)")
    conn.execute(
        "CREATE INDEX idx_action_challenges_action ON assistant_action_challenges(action_id,purpose,consumed_at)"
    )
    conn.execute(
        "CREATE INDEX idx_action_challenges_session ON assistant_action_challenges(session_hash)"
    )
    conn.execute("CREATE INDEX idx_permits_action ON assistant_permits(action_id)")
    conn.execute("CREATE INDEX idx_permits_session ON assistant_permits(session_hash)")
    conn.execute("CREATE INDEX idx_events_task ON assistant_events(task_id,id)")
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(2)")


def _migrate_volume_v3(conn) -> None:
    _migrate_simulation_v2(conn)
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=3"
    ).fetchone():
        return
    conn.execute("""CREATE TABLE assistant_volume_sessions (
        token_hash TEXT PRIMARY KEY, parent_security_hash TEXT NOT NULL,
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(parent_security_hash) REFERENCES assistant_security_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_volume_tasks (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, user_id TEXT NOT NULL,
        device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, percent INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        state TEXT NOT NULL, revision INTEGER NOT NULL, created_at REAL NOT NULL,
        expires_at REAL NOT NULL, challenge_id TEXT, challenge_purpose TEXT,
        challenge_payload TEXT, challenge_expires_at REAL, permit_hash TEXT,
        permit_expires_at REAL, claim_id TEXT, claim_expires_at REAL, result_json TEXT,
        UNIQUE(user_id,device_id,idempotency_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    # Keep task tombstones after short-lived sessions expire: they prevent key reuse.
    conn.execute(
        "CREATE INDEX idx_volume_sessions_parent ON assistant_volume_sessions(parent_security_hash)"
    )
    conn.execute(
        "CREATE INDEX idx_volume_sessions_user ON assistant_volume_sessions(user_id,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_volume_sessions_expiry ON assistant_volume_sessions(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_volume_tasks_user ON assistant_volume_tasks(user_id,created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_volume_tasks_created ON assistant_volume_tasks(created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_volume_tasks_device ON assistant_volume_tasks(device_id)"
    )
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(3)")


def _migrate_brightness_v4(conn) -> None:
    _migrate_volume_v3(conn)
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=4"
    ).fetchone():
        return
    conn.execute("""CREATE TABLE assistant_brightness_sessions (
        token_hash TEXT PRIMARY KEY, parent_security_hash TEXT NOT NULL,
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(parent_security_hash) REFERENCES assistant_security_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_brightness_tasks (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, user_id TEXT NOT NULL,
        device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, percent INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        state TEXT NOT NULL, revision INTEGER NOT NULL, created_at REAL NOT NULL,
        expires_at REAL NOT NULL, challenge_id TEXT, challenge_purpose TEXT,
        challenge_payload TEXT, challenge_expires_at REAL, permit_hash TEXT,
        permit_expires_at REAL, claim_id TEXT, claim_expires_at REAL, result_json TEXT,
        UNIQUE(user_id,device_id,idempotency_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    # Keep task tombstones after short-lived sessions expire: they prevent key reuse.
    conn.execute(
        "CREATE INDEX idx_brightness_sessions_parent ON assistant_brightness_sessions(parent_security_hash)"
    )
    conn.execute(
        "CREATE INDEX idx_brightness_sessions_user ON assistant_brightness_sessions(user_id,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_brightness_sessions_expiry ON assistant_brightness_sessions(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_brightness_tasks_user ON assistant_brightness_tasks(user_id,created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_brightness_tasks_created ON assistant_brightness_tasks(created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_brightness_tasks_device ON assistant_brightness_tasks(device_id)"
    )
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(4)")


def _migrate_planning_v5(conn) -> None:
    _migrate_brightness_v4(conn)
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=5"
    ).fetchone():
        return
    conn.execute("""CREATE TABLE assistant_planning_grants (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
        device_id TEXT, policy_version INTEGER NOT NULL,
        created_at REAL NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(session_hash) REFERENCES assistant_security_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute(
        "CREATE INDEX idx_planning_grants_session ON assistant_planning_grants(session_hash)"
    )
    conn.execute(
        "CREATE INDEX idx_planning_grants_user ON assistant_planning_grants(user_id,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_planning_grants_device ON assistant_planning_grants(device_id)"
    )
    conn.execute(
        "CREATE INDEX idx_planning_grants_expiry ON assistant_planning_grants(expires_at)"
    )
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(5)")


def _migrate_application_v6(conn) -> None:
    _migrate_planning_v5(conn)
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=6"
    ).fetchone():
        return
    conn.execute("""CREATE TABLE assistant_application_sessions (
        token_hash TEXT PRIMARY KEY, parent_security_hash TEXT NOT NULL,
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(parent_security_hash) REFERENCES assistant_security_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_application_tasks (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, user_id TEXT NOT NULL,
        device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, application_id TEXT NOT NULL, package_id TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        state TEXT NOT NULL, revision INTEGER NOT NULL, created_at REAL NOT NULL,
        expires_at REAL NOT NULL, challenge_id TEXT, challenge_purpose TEXT,
        challenge_payload TEXT, challenge_expires_at REAL, permit_hash TEXT,
        permit_expires_at REAL, claim_id TEXT, claim_expires_at REAL, result_json TEXT,
        UNIQUE(user_id,device_id,idempotency_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    # Keep task tombstones after short-lived sessions expire: they prevent key reuse.
    conn.execute(
        "CREATE INDEX idx_application_sessions_parent ON assistant_application_sessions(parent_security_hash)"
    )
    conn.execute(
        "CREATE INDEX idx_application_sessions_user ON assistant_application_sessions(user_id,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_application_sessions_expiry ON assistant_application_sessions(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_application_tasks_user ON assistant_application_tasks(user_id,created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_application_tasks_created ON assistant_application_tasks(created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_application_tasks_device ON assistant_application_tasks(device_id)"
    )
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(6)")


def migrate_assistant_security(conn) -> None:
    _migrate_application_v6(conn)
    if conn.execute(
        "SELECT 1 FROM assistant_schema_versions WHERE version=7"
    ).fetchone():
        return
    conn.execute("""CREATE TABLE assistant_reminder_sessions (
        token_hash TEXT PRIMARY KEY, parent_security_hash TEXT NOT NULL,
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(parent_security_hash) REFERENCES assistant_security_sessions(token_hash) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_reminder_tasks (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, user_id TEXT NOT NULL,
        device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, capability_id TEXT NOT NULL, commitment TEXT NOT NULL, reminder_id TEXT, storage_mode TEXT, settings_revision INTEGER,
        policy_version INTEGER NOT NULL,
        state TEXT NOT NULL, revision INTEGER NOT NULL, created_at REAL NOT NULL,
        expires_at REAL NOT NULL, challenge_id TEXT, challenge_purpose TEXT,
        challenge_payload TEXT, challenge_expires_at REAL, permit_hash TEXT,
        permit_expires_at REAL, claim_id TEXT, claim_expires_at REAL, result_json TEXT,
        UNIQUE(user_id,device_id,idempotency_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    # Keep task tombstones after short-lived sessions expire: they prevent key reuse.
    conn.execute(
        "CREATE INDEX idx_reminder_sessions_parent ON assistant_reminder_sessions(parent_security_hash)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_sessions_user ON assistant_reminder_sessions(user_id,expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_sessions_expiry ON assistant_reminder_sessions(expires_at)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_tasks_user ON assistant_reminder_tasks(user_id,created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_tasks_created ON assistant_reminder_tasks(created_at)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_tasks_device ON assistant_reminder_tasks(device_id)"
    )

    conn.execute("""CREATE TABLE assistant_reminder_preferences (
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, mode TEXT NOT NULL,
        revision INTEGER NOT NULL, updated_at REAL NOT NULL,
        PRIMARY KEY(user_id,device_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute("""CREATE TABLE assistant_reminder_copies (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
        commitment TEXT NOT NULL, key_id TEXT NOT NULL, ciphertext TEXT NOT NULL,
        created_at REAL NOT NULL, expires_at REAL NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(device_id) REFERENCES assistant_devices(id) ON DELETE CASCADE
    )""")
    conn.execute(
        "CREATE INDEX idx_reminder_copies_owner ON assistant_reminder_copies(user_id,id)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_copies_device ON assistant_reminder_copies(device_id)"
    )
    conn.execute(
        "CREATE INDEX idx_reminder_copies_expiry ON assistant_reminder_copies(expires_at)"
    )
    conn.execute("INSERT INTO assistant_schema_versions(version) VALUES(7)")
